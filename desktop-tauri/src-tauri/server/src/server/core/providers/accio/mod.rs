//! Accio 适配器（`accio` 国际版 / `accio-cn` 国内版，同一份实现按地区参数化）：
//! 账号管理 **+ 推理转发**。
//!
//! ── 上游长什么样（逆向来源：Accio Work 桌面端安装包的 app.asar）──────
//!   - 业务网关：`https://phoenix-gw.alibaba.com`（两地区共用），鉴权**不走
//!     Authorization**：GET 把 `accessToken` 拼 query、POST 放进 body。
//!   - 推理网关：`POST {gw}/api/adk/llm/generateContent?sg_k=<md5(requestId)>`，
//!     SSE，body 是 **Gemini 风格**的 protobuf-JSON（`contents` /
//!     `system_instruction` / `tools`），账号凭证放在 body 的 `token` 字段里。
//!   - 登录：OAuth 2.0 授权码 + PKCE（`client_id=accio-work`），登录站点按地区
//!     分（`www.accio.com` / `www.accio-ai.com`）。
//!   - 额度：`GET /api/entitlement/quota` → `{usagePercent, refreshCountdownSeconds}`。
//!   - **没有签到**：上游没有那个活动（桌面端全包检索无「签到 / checkin」），
//!     因此 `billing::checkin` 的范围判定把这家排除（见那边的 accio 分支）。
//!
//! ── 为什么走会话式转发（`is_stateful`）────────────────────────
//! 无状态路径假设「请求体由通用层序列化后原样发出、响应是 OpenAI 的 SSE」。
//! Accio 两条都不满足（请求体要先转成 Gemini 信封、响应要拆 ADK 的帧）。
//! 因此这里实现 `forward_conversation`，把「构造 → 发送 → 翻译」收进
//! `chat.rs`；产出仍是 `ForwardOutcome`，网关其余链路零改动。
//! Accio 的账号鉴权放在 body 的 token 中；官方 SecurityGuard 动态请求头
//! 由 `security_guard` 模块在发送前调用原生 SDK 生成。
//!
//! ── 未验证项（接上线后第一次真实调用要盯的）──────────────────
//!   1. 登录的 POST 用户资料、平台与设备字段已按官方静态代码对齐并做本地验证；
//!      请求形态一致不代表官方授权成功或账号限制解除。
//!   2. `redirect_uri` 白名单是否放行本网关的 loopback 地址（桌面端自己用的
//!      就是 `http://127.0.0.1:<port>/auth/callback`，形态一致，风险低）；
//!   3. 上游目录里 `visible: false` 的模型是否真的不可用（本实现按不可用过滤）。
//!
//! ── panic=abort ────────────────────────────────────────────
//! 本模块在对话链路上，绝不 unwrap/expect/panic。

pub mod adk_error;
pub mod auth;
pub mod balance;
pub mod chat;
mod compression;
pub mod credentials;
pub mod endpoints;
mod identity;
mod login_http;
#[cfg(test)]
mod login_tests;
mod media;
pub mod models;
pub mod oauth;
pub mod protocol;
pub mod refresh;
pub(crate) mod security_guard;
pub(crate) mod session;
#[cfg(test)]
mod session_tests;
mod sse;
pub mod stream;
mod transport;

use axum::http::HeaderMap;
use serde_json::Value;

use crate::server::core::account_store::AccountStore;
use crate::server::core::providers::adapter::{
    adapter_for, ChatRequestPlan, ModelRefreshOutcome, ProviderAdapter, ReasoningPatch,
    UpstreamErrorClass,
};
use crate::server::core::providers::ProviderKind;
use crate::server::core::proxies::ResolvedProxy;
use crate::server::core::upstream::usage::RequestTelemetry;
use crate::server::core::upstream::ForwardOutcome;
use crate::server::errors::GatewayError;
use crate::server::logging;

use self::credentials::Credentials;
use self::endpoints::Region;

/// 国际版适配器实例（`adapter_for(ProviderKind::Accio)` 给出这一个）
pub static ACCIO_ADAPTER: AccioAdapter = AccioAdapter {
    region: Region::Global,
};
/// 国内版适配器实例（同一份实现，只有登录站点与 `x-package-region` 不同）
pub static ACCIO_CN_ADAPTER: AccioAdapter = AccioAdapter { region: Region::Cn };

/// 按地区参数化的适配器。**无状态**：它只持有一个地区标签，
/// 清单与 pending 都挂在进程级句柄上（见 `models.rs` / `oauth.rs`）。
pub struct AccioAdapter {
    region: Region,
}

/// 思考档位注入的字段名。
///
/// Accio 上游认的是 `properties.reasoning_effort` 与顶层的 `reasoning_effort`
/// 两种（按模型家族二选一，见 `protocol.rs`）。这里注入的 `reasoning_effort`
/// 是**客户端语义**的键：真正的落点在 `chat.rs` 构造请求体时按模型家族决定，
/// 因此 `Set` 让 body 顶层带上它、由协议层消费。
const REASONING_FIELD: &str = "reasoning_effort";

impl ProviderAdapter for AccioAdapter {
    fn kind(&self) -> ProviderKind {
        self.region.kind()
    }

    /// Accio 参与推理转发
    fn supports_chat(&self) -> bool {
        true
    }

    /// 上游是「一次请求一次回答」，但请求构造与响应翻译必须由适配器完成
    /// （Gemini 信封 + ADK 帧），见模块头。
    fn is_stateful(&self) -> bool {
        true
    }

    fn list_models(&self) -> Vec<Value> {
        models::list()
    }

    /// 防御性报错：Accio 的请求体要先转成 Gemini 信封，通用层的序列化路径
    /// 产不出可用的字节。走到这里说明编排层的 `is_stateful` 分流坏了。
    fn build_chat_request(
        &self,
        _account: &Value,
        _body: &Value,
        _client_headers: &HeaderMap,
    ) -> Result<ChatRequestPlan, GatewayError> {
        Err(GatewayError::with_status(
            503,
            "Accio 走会话式转发，不走单请求路径（内部错误：编排层未按 is_stateful 分流）",
        ))
    }

    fn classify_error(&self, status: u16, error_body: &Value) -> UpstreamErrorClass {
        let error = adk_error::from_payload(status, error_body, "Accio 上游错误");
        self.classify_conversation_error(&error)
    }

    fn classify_conversation_error(&self, error: &GatewayError) -> UpstreamErrorClass {
        match error.code.as_deref() {
            Some("accio_quota") => UpstreamErrorClass::QuotaLimited {
                reset_at: adk_error::quota_reset(error),
                message: error.message.clone(),
                upstream_code: error.upstream_code,
                status: 429,
            },
            Some("accio_auth") => UpstreamErrorClass::TokenExpired {
                message: error.message.clone(),
            },
            _ => UpstreamErrorClass::Fatal {
                status: u16::try_from(error.status_code).unwrap_or(502),
                message: error.message.clone(),
                upstream_code: error.upstream_code,
            },
        }
    }

    fn ensure_access_token<'a>(
        &'a self,
        store: &'a AccountStore,
        account_id: &'a str,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<String, GatewayError>> + Send + 'a>,
    > {
        Box::pin(async move {
            refresh::ensure_fresh(store, account_id, self.region, false)
                .await
                .map(|credentials| credentials.access_token)
        })
    }

    /// 401 之后的**强制**续期：不看临期窗口（token 可能时间上还新但已被服务端
    /// 失效 —— 只调 ensure 会拿回同一个被拒的 token）。
    fn refresh_access_token<'a>(
        &'a self,
        store: &'a AccountStore,
        account_id: &'a str,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<String, GatewayError>> + Send + 'a>,
    > {
        Box::pin(async move {
            refresh::ensure_fresh(store, account_id, self.region, true)
                .await
                .map(|credentials| credentials.access_token)
        })
    }

    fn supports_refresh(&self) -> bool {
        true
    }

    fn credentials_expiring(&self, store: &AccountStore, account_id: &str) -> bool {
        store
            .accio_account_record(account_id, self.region.provider_id())
            .and_then(|record| Credentials::from_payload(&record).ok())
            .is_some_and(|credentials| credentials.expiring())
    }

    /// Accio **没有**「默认模型」概念：不指定模型时由它自己的目录决定
    fn supports_default_model(&self) -> bool {
        false
    }

    /// 思考等级绑定 → `reasoning_effort`（值原样交给协议层，按模型家族决定落点）。
    ///
    /// 客户端已显式指定时不覆盖（用户的明确意图比映射上的默认值更具体）；
    /// 档位不在通用 6 档表里时不注入（上游对未知档位要么忽略要么 400，都不如
    /// 明确跳过并说清原因）。`off` / `none` 在注入点就被拦下了（Accio 没有
    /// 可靠的「关闭思考」表达）。
    fn reasoning_patch(&self, level: &str, _model: &str, body: &Value) -> ReasoningPatch {
        if crate::server::core::model_rules::reasoning_is_off(level) {
            return ReasoningPatch::Skip {
                reason: "Accio 没有「关闭思考」的可靠表达，跳过注入",
            };
        }
        if crate::server::core::model_rules::read_client_level(body).is_some() {
            return ReasoningPatch::Skip {
                reason: "客户端请求体里已指定思考等级，绑定让位",
            };
        }
        if crate::server::core::model_rules::reasoning_rank(level).is_none() {
            return ReasoningPatch::Skip {
                reason: "该等级不在通用档位表内，Accio 不注入未知档位",
            };
        }
        ReasoningPatch::Set {
            field: REASONING_FIELD,
            value: Value::String(level.to_string()),
        }
    }

    fn supports_model_refresh(&self) -> bool {
        true
    }

    /// 刷新模型目录：用**库里第一个可用 Accio 账号**的凭证（目录接口要鉴权，
    /// 没有账号就拿不到）。
    fn refresh_models<'a>(
        &'a self,
        store: &'a AccountStore,
        account_id: &'a str,
        force: bool,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = ModelRefreshOutcome> + Send + 'a>> {
        Box::pin(async move {
            let Some(record) = store.accio_account_record(account_id, self.region.provider_id())
            else {
                logging::verbose(
                    "[Models]",
                    &format!(
                        "Accio {}模型目录刷新跳过：尚未添加账号",
                        self.region.label()
                    ),
                );
                if account_id.is_empty() {
                    return ModelRefreshOutcome::unchanged();
                }
                return ModelRefreshOutcome::failed("指定的账号不存在或不可用，请重新选择");
            };
            let credentials = match auth::snapshot(&record) {
                Ok(c) => c,
                Err(error) => return ModelRefreshOutcome::failed(error.message),
            };
            if credentials.region != self.region {
                return ModelRefreshOutcome::failed("指定的账号不属于这家（地区不匹配）");
            }
            let proxy = match auth::account_proxy(&record) {
                Ok(proxy) => proxy,
                Err(error) => return ModelRefreshOutcome::failed(error.message),
            };
            match models::refresh_checked(&credentials, proxy.as_ref(), force).await {
                Ok(outcome) => outcome,
                Err(error) => {
                    if session::restricted(&error) {
                        session::record_failure(store, &record, &error);
                    }
                    ModelRefreshOutcome::failed(error.message)
                }
            }
        })
    }

    /// Accio 有余额 / 额度概念（额度用量百分比 + 订阅）
    fn supports_usage(&self) -> bool {
        true
    }

    fn query_usage<'a>(
        &'a self,
        store: &'a AccountStore,
        account_id: &'a str,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Value, GatewayError>> + Send + 'a>>
    {
        Box::pin(async move { balance::query(store, account_id, self.region).await })
    }

    /// Accio 支持网页登录（OAuth 授权码 + PKCE，回调落在本机 loopback 端口）
    fn supports_web_login(&self) -> bool {
        true
    }

    /// 授权地址：`{loginBase}/login?return_url=<本机回调>&state=…&code_challenge=…`
    ///
    /// 回调地址由本进程的监听端口拼出（`ServerState::bootstrap` 时写入，
    /// 见 `oauth::set_loopback_port`）。端口未知时返回 None —— 上层文案会把
    /// 「未能生成授权地址」透给用户，比拼一个必然 404 的地址要好。
    fn build_login_url(&self) -> Option<(String, String)> {
        let base = oauth::loopback_base()?;
        let return_url = format!("{base}{}", oauth::CALLBACK_PATH);
        Some(oauth::begin_login(self.region, &return_url))
    }

    /// 用回调里的一次性 `code` 换凭证并落账号。
    ///
    /// `state` 在这里再校验一次（深度防御：回调路由已比对过，但真正的凭据是
    /// pending 表里那份 —— 取不到就是「不是本进程发起的那一轮」）。
    fn exchange_login_code<'a>(
        &'a self,
        store: &'a AccountStore,
        code: &'a str,
        state: &'a str,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<String, GatewayError>> + Send + 'a>,
    > {
        Box::pin(async move {
            let Some(pending) = oauth::take_pending(state) else {
                return Err(GatewayError::with_status(
                    404,
                    "这次登录已取消或已过期，请重新发起",
                ));
            };
            let credentials = oauth::exchange_code(
                pending.region,
                code,
                &pending.verifier,
                &pending.redirect_uri,
                None,
            )
            .await?;
            let account = store
                .add_accio_account(&credentials, None, "web")
                .map_err(|error| GatewayError::with_status(error.status_code, error.message))?;
            let account_id = account
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            logging::log(
                "[Login]",
                &format!(
                    "✅ Accio {}网页登录完成，账号已加入列表",
                    pending.region.label()
                ),
            );
            Ok(account_id)
        })
    }

    /// **会话式转发入口**：构造 → 发送 → 翻译。
    fn forward_conversation<'a>(
        &'a self,
        store: &'a AccountStore,
        account_id: &'a str,
        body: &'a Value,
        client_headers: &'a HeaderMap,
        proxy: Option<ResolvedProxy>,
        stream: bool,
        telemetry: &'a std::sync::Arc<RequestTelemetry>,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<ForwardOutcome, GatewayError>> + Send + 'a>,
    > {
        Box::pin(async move {
            let (expected, credentials) = refresh::snapshot(store, account_id, self.region)?;
            let call = identity::Call::for_request(
                body,
                client_headers,
                telemetry,
                &format!("{}:{account_id}", self.region.provider_id()),
            )?;

            let used = std::sync::Mutex::new(expected.clone());
            let result = session::recover(
                || {
                    self.forward_once(
                        store,
                        account_id,
                        body,
                        proxy.clone(),
                        stream,
                        telemetry,
                        &used,
                        &call,
                    )
                },
                || async {
                    let rejected = used
                        .lock()
                        .ok()
                        .and_then(|record| {
                            record
                                .get("accessToken")
                                .and_then(Value::as_str)
                                .map(str::to_string)
                        })
                        .unwrap_or_else(|| credentials.access_token.clone());
                    let refreshed =
                        refresh::after_unauthorized(store, account_id, self.region, &rejected)
                            .await;
                    if let Err(error) = &refreshed {
                        if !session::restricted(error) && error.status_code != 401 {
                            if let Ok(record) = used.lock() {
                                session::record_failure(store, &record, error);
                            }
                            return Err(session::blocked_error("refresh_failed"));
                        }
                    }
                    refreshed.map(|_| ())
                },
                || {
                    telemetry
                        .snapshot()
                        .attempts_detail
                        .last()
                        .is_some_and(|attempt| {
                            attempt
                                .timings
                                .iter()
                                .any(|t| t.stage == "first_content" && t.completed == Some(true))
                        })
                },
            )
            .await;
            let result = result.map_err(|error| call.annotate(error));
            match result {
                Err(error) if session::restricted(&error) || error.status_code == 401 => {
                    if let Ok(record) = used.lock() {
                        session::record_failure(store, &record, &error);
                    }
                    Err(
                        call.annotate(session::blocked_error(if session::restricted(&error) {
                            "restricted"
                        } else {
                            "login_required"
                        })),
                    )
                }
                other => other,
            }
        })
    }
}

impl AccioAdapter {
    async fn forward_once(
        &self,
        store: &AccountStore,
        account_id: &str,
        body: &Value,
        proxy: Option<ResolvedProxy>,
        stream: bool,
        telemetry: &std::sync::Arc<RequestTelemetry>,
        used: &std::sync::Mutex<Value>,
        call: &identity::Call,
    ) -> Result<ForwardOutcome, GatewayError> {
        let account_id = account_id.to_string();
        if account_id.is_empty() {
            return Err(GatewayError::with_status(
                503,
                "没有可用的 Accio 账号：请在账号页添加并启用账号",
            ));
        }
        let model_name = body
            .get("model")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        // 凭证（含临期主动刷新）。显式账号必填 —— Accio 没有环境变量旁路。
        let prepare = telemetry.begin_stage("credentials");
        let context = account_context(store, &account_id, self.region, false).await?;
        if let Ok(mut expected) = used.lock() {
            *expected = context.record.clone();
        }
        prepare.finish();
        let build = telemetry.begin_stage("build_request");
        // 思考档位：客户端显式指定 > 映射绑定（`body` 里已由 payload 层注入）
        let effort = protocol::client_effort(body);
        let mut plan = chat::build_plan_with_context(
            &context.credentials,
            body,
            &model_name,
            effort.as_deref(),
            call,
        )?;
        let attempt = telemetry.snapshot().attempts_detail.len().checked_sub(1);
        if let Some(attempt) = attempt {
            telemetry.note_accio_diagnostics(
                attempt,
                "accioIdentity",
                serde_json::to_value(call).unwrap_or(Value::Null),
            );
        }
        let effective_proxy = proxy.or(context.proxy);
        chat::prepare_media(&mut plan, effective_proxy.as_ref()).await?;
        telemetry.note_attempt_body_bytes(plan.body.len() as i64);
        build.finish();

        logging::verbose(
            "[Accio]",
            &format!(
                "POST {} model={} upstream={} stream={} region={} account={}",
                plan.url,
                if model_name.is_empty() {
                    "(默认)"
                } else {
                    &model_name
                },
                plan.upstream_key,
                stream,
                self.region.edition(),
                account_id,
            ),
        );

        let capture = telemetry.capture();
        if let Some(capture) = capture.as_deref() {
            let headers: Vec<(String, String)> = plan.headers.clone();
            let mut wire: Value = serde_json::from_slice(&plan.body).unwrap_or(Value::Null);
            if let Some(object) = wire.as_object_mut() {
                object.insert("token".into(), Value::String("[REDACTED]".into()));
            }
            capture.reset_request(&plan.url, self.region.provider_id(), &headers, &wire);
        }

        // reqwest exposes response headers, not independent DNS/TCP/TLS/upload
        // milestones. Keep this combined duration honest, including pool reuse.
        let headers = telemetry.begin_stage("send_headers");
        let response = chat::send_observed(&plan, effective_proxy.as_ref(), telemetry).await?;
        headers.finish();
        if let Some(capture) = capture.as_deref() {
            capture.attach_response(response.status().as_u16(), response.headers());
        }
        let response_report = transport::report(&response, Some(&plan.url));
        if let Some(attempt) = attempt {
            telemetry.note_accio_diagnostics(attempt, "accioTransport", response_report.clone());
        }
        if let Some(error) = transport::rejection(&response, Some(&plan.url)) {
            return Err(error);
        }
        if !response.status().is_success() {
            let status = response.status().as_u16();
            let error = chat::http_error(status, response).await;
            if let (Some(attempt), Some(facts)) = (
                attempt,
                error.details.as_ref().and_then(|v| v.get("transport")),
            ) {
                telemetry.note_accio_diagnostics(attempt, "accioTransport", facts.clone());
            }
            if error.status_code == 429 {
                chat::record_quota(
                    &LimitContext {
                        store: store.clone(),
                        account_id: account_id.clone(),
                        model: model_name.clone(),
                        session_record: Some(context.record.clone()),
                    },
                    &error,
                );
            }
            return Err(error);
        }

        let mut translator = chat::Translator::new(chat::response_id(), plan.model_name.clone());
        translator.accio_context = Some(call.response_context());
        let limit = chat::LimitContext {
            store: store.clone(),
            account_id: account_id.clone(),
            model: model_name.clone(),
            session_record: Some(context.record.clone()),
        };
        if stream {
            // 首帧预读：HTTP 200 内的业务错误交给会话恢复策略处理；
            // 明确受限时停止，只有允许重放的 401 才续期一次。
            let (prefetched, source) =
                chat::prefetch_stream_head(response, &limit, telemetry).await?;
            let (sender, receiver) =
                tokio::sync::mpsc::channel::<Result<bytes::Bytes, std::io::Error>>(64);
            let telemetry = telemetry.clone();
            crate::spawn_task(async move {
                chat::drive_stream(source, translator, telemetry, limit, sender, prefetched).await;
            });
            return Ok(ForwardOutcome::Stream {
                status: 200,
                stream: Box::new(tokio_stream::wrappers::ReceiverStream::new(receiver)),
            });
        }
        // 非流式：上游只支持流式，因此内部仍走流式拉取再聚合成完整响应
        match chat::drive_aggregate(response, translator, telemetry.clone(), &limit).await {
            Ok(body) => Ok(ForwardOutcome::Completion { body }),
            Err(error) => Err(error),
        }
    }
}

/// 一次转发用的凭证 + 出口快照
struct AccountContext {
    record: Value,
    credentials: Credentials,
    proxy: Option<ResolvedProxy>,
}

/// 取账号凭证（含临期主动刷新）与出口。
///
/// `force` 与 `refresh::ensure_fresh` 同义；401 的一次恢复由上面的
/// 会话式入口控制，仅在上游允许重放且未输出内容时执行。
async fn account_context(
    store: &AccountStore,
    account_id: &str,
    region: Region,
    force: bool,
) -> Result<AccountContext, GatewayError> {
    refresh::ensure_fresh(store, account_id, region, force).await?;
    let (record, credentials) = refresh::snapshot(store, account_id, region)?;
    let proxy = auth::account_proxy(&record)?;
    Ok(AccountContext {
        record,
        credentials,
        proxy,
    })
}

/// 会话式转发里的限额记账素材（`chat` 与 `protocol` 都要用，重导出避免深层路径）
pub use chat::LimitContext;

/// 供其它模块（登录路由）判断「这个 state 是否属于本家」用
pub fn region_from_provider_id(provider_id: &str) -> Option<Region> {
    Region::from_provider_id(provider_id)
}

/// 适配器实例自检（`implemented_kinds` 与 `adapter_for` 的一致性由编译期保证，
/// 这里只给一处便于排障的名字）
pub fn adapter_label() -> &'static str {
    "Accio"
}

/// 显式引用 `adapter_for`：让「加 kind 忘了接线」在本文件也会被编译器提醒
/// （模块头的约定，编译期断言的一种轻量形态）
pub fn adapter_for_self(region: Region) -> &'static dyn ProviderAdapter {
    adapter_for(region.kind())
}
