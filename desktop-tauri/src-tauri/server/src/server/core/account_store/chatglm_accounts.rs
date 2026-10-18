//! 智谱清言账号：访客换证落账号、粘贴令牌、公开形态。
//!
//! ── 三条添加路径（与各家一样，各路径独立因为凭证来源不同）──────
//! ```text
//!   1. 访客模式（`guest`）  —— 本家**独有**的入口：不需要手机号、不需要扫码，
//!      后台空 body 打一次 `guest/access` 就拿到一对令牌 + 一个设备号。
//!      适合「先跑起来再说」的用户；代价是没有积分体系（余额/签到不可用）。
//!   2. 粘贴令牌（`manual`） —— 用户从浏览器开发者工具里复制 `chatglm_token`
//!      的值（或整条 JWT）。适合已有登录账号的用户。
//!   3. 导入本机登录态（`desktop`）—— 读本机客户端 Cookies（**DPAPI 加密**，
//!      仅 Windows 可解，见 `providers::chatglm::credentials` 的模块头）。
//! ```
//!
//! ── 记录里的字段 ────────────────────────────────────────────
//! ```text
//! { id, provider: "chatglm", name, uid, loginName(=昵称),
//!   accessToken, refreshToken, tokenTail,
//!   deviceId, isGuest, source, priority, enabled, addedAt, updatedAt }
//! ```
//! 令牌在**顶层**（全仓的存储契约，理由见 `add_chatglm_account` 里那段注释）；
//! 嵌套 `auth.accessToken` 是**会话形态**（`StoreView::to_session` 的产物），
//! 不是记录形态。
//!
//! `deviceId` 必须落盘：它是**身份的一部分**（服务端把设备号写进 JWT，
//! 访客身份按它分配 —— 每次现随机就是每次换身份，见 `credentials` 的模块头）。
//! `refreshToken` 也要落：续期与新访客的失效恢复都靠它。
//!
//! ── 硬约束 ──────────────────────────────────────────────────
//! release 是 `panic=abort`：本文件零 unwrap/expect/panic，不持锁做网络。

use serde_json::{Map, Value};

use crate::server::core::account_store::priority::next_free_priority;
use crate::server::core::account_store::sql;
use crate::server::core::account_store::state::{mark_name_custom, StoredAccount};
use crate::server::core::account_store::store::{AccountStore, AccountStoreError};
use crate::server::core::account_store::store_util::{token_tail_of, truncate_chars};
use crate::server::core::providers::chatglm::credentials::ChatglmCredentials;
use crate::server::core::providers::{kind_id, ProviderKind};
use crate::server::logging;

/// 备注名长度上限
const MAX_NAME_LENGTH: usize = 100;

fn chatglm_id() -> &'static str {
    kind_id(ProviderKind::Chatglm)
}

impl AccountStore {
    // ─── 读：账号记录 ────────────────────────────────────────

    /// 取智谱清言账号的**原始记录**（含 auth.accessToken / deviceId）。
    ///
    /// `account_id` 为空 → 取本家组内优先级最小的启用账号（与转发选路同一判据）；
    /// 找不到返回 None（调用方据此报「没有可用凭证」）。
    pub fn chatglm_account_record(&self, account_id: &str) -> Option<Value> {
        let _guard = self.guard();
        let provider = chatglm_id();
        if !account_id.is_empty() {
            let record = self.record_by_id(&_guard, account_id)?;
            return (record.provider() == provider).then(|| record.to_value());
        }
        let mut candidates: Vec<StoredAccount> = self
            .records_for_provider(&_guard, provider)
            .into_iter()
            .filter(StoredAccount::enabled)
            .collect();
        candidates.sort_by_key(StoredAccount::order_key);
        candidates.into_iter().next().map(|item| item.to_value())
    }

    // ─── 写：落账号 ──────────────────────────────────────────

    /// 添加/更新一个智谱清言账号（三条添加路径共用的落账号入口）。
    ///
    /// `source` 记来源（`"guest"` / `"manual"` / `"desktop"`）。
    ///
    /// id 的生成：`uid` 优先（JWT 的 `uid` 声明）；拿不到时用
    /// `chatglm-<设备号前 8 位>` 兜底 —— 设备号是访客身份的唯一来源，
    /// 拿它做兜底 id 既稳定又能区分不同访客。
    pub fn add_chatglm_account(
        &self,
        credentials: &ChatglmCredentials,
        name: Option<&str>,
        source: &str,
    ) -> Result<Value, AccountStoreError> {
        let user_key = if !credentials.uid.trim().is_empty() {
            credentials.uid.trim().to_string()
        } else {
            let short: String = credentials.device_id.chars().take(8).collect();
            format!("chatglm-{short}")
        };
        if user_key.len() > 256 {
            return Err(AccountStoreError::new("智谱清言账号标识过长", 400));
        }
        let _guard = self.guard();
        let id = user_key;
        let existing = self.record_by_id(&_guard, &id);
        if let Some(existing) = existing.as_ref() {
            let existing_provider = existing.provider();
            if existing_provider != chatglm_id() {
                return Err(AccountStoreError::new(
                    format!(
                        "账号 id「{id}」已被{existing_provider}账号占用，无法添加同一标识的\
                         智谱清言账号（请先处理那个账号）"
                    ),
                    400,
                ));
            }
        }
        let nickname = credentials.nickname.trim().to_string();
        let explicit_name = name
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| truncate_chars(value, MAX_NAME_LENGTH));
        let explicit = explicit_name.is_some();
        // 访客账号没有昵称，给一句可读的默认名（而不是一串 id）
        let default_name = if credentials.is_guest {
            format!("访客 {}", credentials.token_tail())
        } else {
            format!("账号 {id}")
        };
        let record_name = explicit_name
            .or_else(|| {
                existing
                    .as_ref()
                    .map(StoredAccount::name)
                    .filter(|value| !value.is_empty())
            })
            .or_else(|| {
                if !nickname.is_empty() {
                    Some(nickname.clone())
                } else {
                    None
                }
            })
            .unwrap_or(default_name);
        let priority = match existing.as_ref() {
            Some(record) => record.priority(),
            None => {
                let used = self.with_conn(&_guard, |conn| sql::priorities_all(conn))?;
                next_free_priority(&used)
            }
        };
        let now = logging::now_ms();
        let mut record = Map::new();
        record.insert("id".to_string(), Value::String(id.clone()));
        record.insert("provider".to_string(), Value::String(chatglm_id().to_string()));
        record.insert("name".to_string(), Value::String(record_name.clone()));
        mark_name_custom(&mut record, explicit, existing.as_ref());
        record.insert("uid".to_string(), Value::String(credentials.uid.clone()));
        record.insert(
            "loginName".to_string(),
            Value::String(nickname.clone()),
        );
        // ── 令牌落**顶层** `accessToken` / `refreshToken`（不是嵌套 auth）─────
        // 全仓的凭证约定是顶层键：`StoredAccount::access_token()` 只读顶层
        // `accessToken`，而 `has_credentials()`（转发选路 / 余额查询 / 本轮行
        // 的 `hasCredentials` 三处的统一判据）正是建立在它之上。
        // 落进嵌套 `auth` 的后果是**静默吞掉一整家**：账号导入成功、目录也拉得到，
        // 但 `/v1/models` 里一个模型都没有、余额报「没有可用凭证」、点名转发报
        // 没有可用账号 —— 与 `state.rs::has_officeace_key` 那段注释描述的同款症状。
        // 参考实现（`Acainkao` 那套）读的是 `auth.accessToken`，本仓的存储契约
        // 不是它，别照抄。
        record.insert(
            "accessToken".to_string(),
            Value::String(credentials.access_token.clone()),
        );
        record.insert(
            "refreshToken".to_string(),
            Value::String(credentials.refresh_token.clone()),
        );
        let tail_source = if !credentials.access_token.is_empty() {
            &credentials.access_token
        } else {
            &credentials.refresh_token
        };
        record.insert(
            "tokenTail".to_string(),
            Value::String(token_tail_of(tail_source)),
        );
        // 设备号与访客标记：本家特有，见模块头
        record.insert(
            "deviceId".to_string(),
            Value::String(credentials.device_id.clone()),
        );
        record.insert("isGuest".to_string(), Value::Bool(credentials.is_guest));
        record.insert("nickname".to_string(), Value::String(nickname));
        record.insert("source".to_string(), Value::String(source.to_string()));
        record.insert("priority".to_string(), Value::from(priority));
        record.insert(
            "enabled".to_string(),
            Value::Bool(existing.as_ref().map(StoredAccount::enabled).unwrap_or(true)),
        );
        record.insert(
            "addedAt".to_string(),
            Value::from(existing.as_ref().map(StoredAccount::added_at).unwrap_or(now)),
        );
        record.insert("updatedAt".to_string(), Value::from(now));
        let mut merged = record;
        if let Some(existing) = existing.as_ref() {
            // 未知字段全量保留（与各家同一约定）
            for (key, value) in existing.fields() {
                merged.entry(key.clone()).or_insert_with(|| value.clone());
            }
        }
        let saved = StoredAccount::from_map(merged);
        self.with_conn(&_guard, |conn| sql::put(conn, &saved))?;
        drop(_guard);
        logging::log(
            "[Accounts]",
            &format!("✅ 智谱清言账号已保存: {record_name}（{id}，优先级 {priority}）"),
        );
        Ok(self.public_account(&saved))
    }

    /// 续期成功后回写令牌（`user/refresh` 会**轮换 refresh_token**，
    /// 不回写下次就用旧的换了）。
    pub fn update_chatglm_tokens(
        &self,
        account_id: &str,
        access_token: &str,
        refresh_token: &str,
        expected: &ChatglmCredentials,
    ) -> Result<(), AccountStoreError> {
        let _guard = self.guard();
        let Some(mut record) = self.record_by_id(&_guard, account_id) else {
            return Err(AccountStoreError::new("该智谱清言账号不存在", 404));
        };
        if record.provider() != chatglm_id() {
            return Err(AccountStoreError::new("该账号不是智谱清言账号", 400));
        }
        let current = crate::server::core::providers::chatglm::credentials::from_record(Some(&record.to_value()))
            .map_err(|error| AccountStoreError::new(error.message, error.status_code))?;
        if current.access_token != expected.access_token || current.refresh_token != expected.refresh_token
            || current.device_id != expected.device_id || current.is_guest != expected.is_guest {
            return Err(AccountStoreError::new("智谱清言凭证已变化，拒绝用旧续期结果覆盖", 409));
        }
        let mut merged = record.fields().clone();
        merged.insert(
            "accessToken".to_string(),
            Value::String(access_token.to_string()),
        );
        if !refresh_token.trim().is_empty() {
            merged.insert(
                "refreshToken".to_string(),
                Value::String(refresh_token.to_string()),
            );
        }
        // 历史上若把令牌写在嵌套 `auth` 里，一并清掉（避免两处不一致时
        // 哪个是权威变成看运气）
        merged.remove("auth");
        merged.insert(
            "tokenTail".to_string(),
            Value::String(token_tail_of(access_token)),
        );
        merged.insert("updatedAt".to_string(), Value::from(logging::now_ms()));
        record = StoredAccount::from_map(merged);
        self.with_conn(&_guard, |conn| sql::put(conn, &record))?;
        Ok(())
    }
}

#[cfg(test)]
mod local_regressions {
    use super::*;
    use crate::server::db::test_temp::TempDb;
    fn fixture() -> ChatglmCredentials {
        ChatglmCredentials { access_token: "synthetic-access-original".into(), refresh_token: "synthetic-refresh-original".into(), device_id: "c9074ab1-208b-4255-8f71-09cc2ce32278".into(), is_guest: true, uid: "chatglm-local-fixture".into(), nickname: "fixture".into() }
    }
    #[test]
    fn stale_refresh_cannot_overwrite_reimport_or_restore_deleted_account() {
        let (db, _temp) = TempDb::open("chatglm-refresh-race");
        let store = AccountStore::with_db(Some(db));
        let original = fixture();
        let public = store.add_chatglm_account(&original, Some("original"), "guest").unwrap();
        assert!(!public.to_string().contains("synthetic-access"));
        let id = public["id"].as_str().unwrap();
        store.update_chatglm_tokens(id, "synthetic-next-access", "synthetic-next-refresh", &original).unwrap();
        assert_eq!(store.update_chatglm_tokens(id, "late-access", "late-refresh", &original).unwrap_err().status_code, 409);
        let mut imported = original.clone(); imported.access_token = "synthetic-imported-access".into();
        store.add_chatglm_account(&imported, Some("renamed"), "manual").unwrap();
        assert_eq!(store.update_chatglm_tokens(id, "late-access", "late-refresh", &original).unwrap_err().status_code, 409);
        let row = store.chatglm_account_record(id).unwrap();
        assert_eq!(crate::server::core::providers::chatglm::credentials::from_record(Some(&row)).unwrap().access_token, imported.access_token);
        let guard = store.guard();
        store.with_conn(&guard, |conn| conn.execute("DELETE FROM accounts WHERE id=?1", [id]).map(|_| ())).unwrap();
        drop(guard);
        assert_eq!(store.update_chatglm_tokens(id, "late-access", "late-refresh", &imported).unwrap_err().status_code, 404);
        assert!(store.chatglm_account_record(id).is_none());
    }
}

pub(crate) fn migrate_nested_tokens(accounts: &mut [StoredAccount]) -> usize {
    let mut healed = 0usize;
    for record in accounts.iter_mut() {
        if record.provider() != chatglm_id() {
            continue;
        }
        // 先把要读的东西**全部克隆成自有值**再改：`record.get` 是共享借用，
        // 与后面的 `record.set` / `record.remove`（可变借用）不能同时活着
        // （与 `clear_rate_limit` / `migrate_rate_limit_keys` 同一处置）。
        let Some(nested) = record.get("auth").and_then(Value::as_object).cloned() else {
            continue;
        };
        // 嵌套里有没有值得搬的令牌（只认这两枚键）
        let nested_token = |key: &str| -> Option<String> {
            nested
                .get(key)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        };
        let nested_access = nested_token("accessToken");
        let nested_refresh = nested_token("refreshToken");
        // 顶层已有的值不动：写入侧已按新约定落过，那份比旧壳里的更可信
        let top_access = record
            .get("accessToken")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or("")
            .to_string();
        let top_refresh = record
            .get("refreshToken")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or("")
            .to_string();
        let mut changed = false;
        if top_access.is_empty() {
            if let Some(token) = nested_access.as_ref() {
                record.set("accessToken", Value::String(token.clone()));
                changed = true;
            }
        }
        if top_refresh.is_empty() {
            if let Some(token) = nested_refresh.as_ref() {
                record.set("refreshToken", Value::String(token.clone()));
                changed = true;
            }
        }
        // 空壳才删：`auth` 里除了这两枚令牌没别的东西
        let only_tokens = nested
            .keys()
            .all(|key| key == "accessToken" || key == "refreshToken");
        if only_tokens {
            record.remove("auth");
            changed = true;
        }
        if !changed {
            continue;
        }
        // 尾段跟着新令牌重算（原实现也是从令牌算的；顶层一旦补齐，界面读的就是它）
        let tail_source: &str = if !top_access.is_empty() {
            &top_access
        } else {
            nested_access
                .as_deref()
                .or(nested_refresh.as_deref())
                .unwrap_or("")
        };
        if !tail_source.is_empty() {
            record.set("tokenTail", Value::String(token_tail_of(tail_source)));
        }
        record.set_updated_at(logging::now_ms());
        healed += 1;
    }
    healed
}
