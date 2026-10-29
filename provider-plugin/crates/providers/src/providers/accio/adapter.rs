//! Accio 的 `Provider` 实现（两个地区各一个实例）。
//!
//! ── 本文件只做装配 ──────────────────────────────────────────
//! 请求构造（Gemini 信封）、发送、翻帧、限额记账都在 `chat.rs`；续期在
//! `refresh.rs`；账号面在 `accounts.rs`；登录在 `login.rs` + `oauth.rs`。
//! 这里负责把它们接到 `Provider` trait 上，并把 `PluginCtx` 传下去。
//!
//! ── 为什么 `stateful = true` ────────────────────────────────
//! 见模块头（Gemini 信封 + ADK 帧）。
//!
//! ── 续期是真的 ──────────────────────────────────────────────
//! 上游有 refreshToken 链（`/api/auth/refresh_token`），而且 accessToken 是
//! **小时级**有效期 —— 不接续期就会每小时撞一次 401。`ensure_token` 走临期
//! 门（5 分钟窗口），`refresh_token` 无条件换发（401 之后救一次）。
//!
//! ── 硬约束 ──────────────────────────────────────────────────
//! release 是 `panic=abort`：零 unwrap / expect / panic。

use serde_json::Value;

use agent2api_provider_protocol as proto;
use agent2api_provider_protocol::WireProxy as ResolvedProxy;
use agent2api_provider_sdk::{ConversationSink, PluginCtx, Provider, ProviderMeta, SendFuture};

use crate::content_block;
use crate::errors::GatewayError;
use crate::logging;
use crate::telemetry::RequestTelemetry;

use super::credentials::Credentials;
use super::endpoints::Region;
use super::{auth, balance, chat, models, protocol, refresh};

/// 思考档位注入的字段名。
///
/// Accio 上游认的是 `properties.reasoning_effort` 与顶层的 `reasoning_effort`
/// 两种（按模型家族二选一，见 `protocol.rs`）。这里注入的 `reasoning_effort`
/// 是**客户端语义**的键：真正的落点在 `chat.rs` 构造请求体时按模型家族决定，
/// 因此 `Set` 让 body 顶层带上它、由协议层消费。
const REASONING_FIELD: &str = "reasoning_effort";

/// 国际版实例。
pub static ACCIO: AccioProvider = AccioProvider { region: Region::Global };
/// 国内版实例（同一份实现，只有登录站点与 `x-package-region` 不同）。
pub static ACCIO_CN: AccioProvider = AccioProvider { region: Region::Cn };

/// 按地区参数化的提供商。**无状态**：它只持有一个地区标签，
/// 清单与登录 pending 都挂在进程级句柄上（见 `models.rs` / `oauth.rs`）。
#[derive(Clone, Copy)]
pub struct AccioProvider {
    region: Region,
}

impl Provider for AccioProvider {
    fn meta(&self) -> ProviderMeta {
        ProviderMeta::new(self.region.provider_id(), format!("Accio {}", self.region.label()))
            .with_capabilities(proto::Capabilities {
                chat: true,
                // Gemini 信封 + ADK 帧（见模块头）
                stateful: true,
                // `/api/auth/refresh_token`
                refresh: true,
                // `/api/agent/maas/model-catalog`（`models.rs`）
                model_refresh: true,
                // `/api/entitlement/quota`（`balance.rs`）
                usage: true,
                // 上游没有签到活动
                checkin: false,
                claims: false,
                // OAuth 授权码 + PKCE（`login.rs`）
                web_login: true,
                sse_model_rewrite: false,
                sse_strip_newline_chunks: false,
                // 没有环境变量旁路
                anonymous_default_session: false,
                system_proxy_when_unset: false,
                refresh_uses_account: true,
                // 本家是否认「默认模型」概念（协议新增位，见 `Capabilities`）
                supports_default_model: false,
                // 本家有没有环境变量 / 默认登录态旁路（协议新增位）
                env_credentials: false,
            })
            .with_login(vec![
                proto::LoginMethod::Browser {
                    button: "网页登录".to_string(),
                    hint: Some(format!(
                        "打开 Accio {}授权页，完成后自动收下账号",
                        self.region.label()
                    )),
                },
                proto::LoginMethod::Token {
                    label: "登录凭据".to_string(),
                    placeholder: "粘贴 accessToken / refreshToken".to_string(),
                    extra_fields: Vec::new(),
                },
            ])
            .with_models(models::list())
            // 账号行：两个地区都要申报（拆家后是两家 provider，漏一个那一家
            // 就掉进兜底，症状是余额入口消失、标识列空着）。
            //   `usage` —— `/api/entitlement/quota` 只给用量百分比，没有逐份
            //     积分包，所以不开 `credit_detail`。
            //   `edition` —— 公开形态带地区，徽章要拼。
            //   `email_as_name` —— 本家账号以邮箱报名字。
            .with_account_features(proto::AccountFeatures {
                usage: true,
                edition: true,
                identifier: vec!["userId".to_string()],
                expiry: vec!["expiresAt".to_string()],
                email_as_name: true,
                ..Default::default()
            })
    }

    fn models<'a>(
        &'a self,
        ctx: &'a PluginCtx,
        _account: &'a str,
    ) -> SendFuture<'a, proto::ModelList> {
        Box::pin(async move {
            // `list()` 是两地区的并集（GLOBAL 优先、同 id 去重）—— 与网关那份
            // 的 `list_models()` 一致：界面看到的是「Accio 有哪些模型」，
            // 而某条请求走哪个地区由账号决定。
            models::restore(ctx,self.region).await;
            Ok(proto::ModelList {
                models: models::list(),
                meta: proto::CatalogMeta {
                    remote: !models::remote_models(self.region).is_empty(),
                    refreshed_at: models::last_refreshed_at(self.region),
                },
            })
        })
    }

    /// **会话式转发入口**：构造 → 发送 → 翻译。
    fn conversation<'a>(
        &'a self,
        ctx: &'a PluginCtx,
        req: proto::ConversationRequest,
        sink: ConversationSink<'a>,
    ) -> SendFuture<'a, ()> {
        Box::pin(async move {
            let mut sink = sink;
            let account_id = req.account.clone();
            if account_id.is_empty() {
                return Err(
                    "没有可用的 Accio 账号：请在账号页添加并启用账号".to_string(),
                );
            }
            let model_name = req
                .body
                .get("model")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            crate::paths::init(&ctx.env.data_dir);
            models::restore(ctx,self.region).await;
            let effort=protocol::client_effort(&req.body);
            let telemetry=std::sync::Arc::new(RequestTelemetry::new());
            telemetry.note_attempt_started(self.region.provider_id(),&account_id);
            let mut headers=reqwest::header::HeaderMap::new();
            for(key,value)in &req.headers{if let(Ok(key),Ok(value))=(reqwest::header::HeaderName::from_bytes(key.as_bytes()),reqwest::header::HeaderValue::from_str(value)){headers.insert(key,value);}}
            let call=super::identity::Call::for_request(&req.body,&headers,&telemetry,&format!("{}:{}",self.region.provider_id(),account_id)).map_err(GatewayError::into_control_message)?;
            let mut attempt=0;
            let (plan,limit,prefetched,source)=loop {
                let context=account_context(ctx,&account_id,self.region,false).await.map_err(|e|call.annotate(e).into_control_message())?;
                let rejected=context.credentials.access_token.clone();
                let limit=chat::LimitContext{ctx:ctx.clone(),session_record:Some(crate::store::record(ctx,self.region.provider_id(),&account_id).await.map_err(GatewayError::into_control_message)?),account_id:account_id.clone(),model:model_name.clone()};
                let once=async {
                    let plan=chat::build_plan_with_context(&context.credentials,&req.body,&model_name,effort.as_deref(),&call)?;
                    let proxy=req.proxy.clone().or(context.proxy);
                    let response=chat::send_observed(&plan,proxy.as_ref(),&telemetry).await?;
                    telemetry.note_accio_diagnostics(attempt,"accioTransport",super::transport::report(&response,Some(&plan.url)));
                    if let Some(error)=super::transport::rejection(&response,Some(&plan.url)){return Err(error);}
                    if !response.status().is_success(){let status=response.status().as_u16();return Err(chat::http_error(status,response).await);}
                    let(prefetched,source)=chat::prefetch_stream_head(response,&limit,&telemetry).await?;
                    Ok((plan,prefetched,source))
                }.await;
                match once {
                    Ok((plan,prefetched,source))=>break(plan,limit,prefetched,source),
                    Err(error) if attempt==0 && super::session::can_refresh(&error,false)=>{
                        if let Err(error)=refresh::after_unauthorized(ctx,&account_id,self.region,&rejected).await{
                            let error=if super::session::restricted(&error)||error.status_code==401{error}else{super::session::blocked_error("refresh_failed")};
                            return Err(call.annotate(error).into_control_message());
                        }
                        attempt+=1; telemetry.note_attempt_started(self.region.provider_id(),&account_id);
                    },
                    Err(error)=>{
                        if error.status_code==429{chat::record_quota(&limit,&error);}
                        let error=if super::session::restricted(&error)||error.status_code==401 {
                            if let Some(record)=&limit.session_record{super::session::record_failure(ctx,record,&error);}
                            super::session::blocked_error(if super::session::restricted(&error){"restricted"}else{"login_required"})
                        }else{error}; return Err(call.annotate(error).into_control_message());
                    }
                }
            };
            let mut translator = chat::Translator::new(chat::response_id(), plan.model_name.clone());
            translator.accio_context=Some(call.response_context());
            if req.stream {
                sink.head(proto::StreamHead {
                    status: 200,
                    headers: [(
                        "content-type".to_string(),
                        "text/event-stream".to_string(),
                    )]
                    .into_iter()
                    .collect(),
                    upstream: proto::UpstreamKind::Chat,
                })
                .await
                .map_err(|error| GatewayError::with_status(499, error).message)?;
                // 直接 await：插件的 `conversation` 本身就是 async 函数、sink 是
                // 借用 —— 不必再绕一层通道（网关那版的 mpsc 是为了
                // `ForwardOutcome::Stream` 那个 Stream 类型）。语义不变。
                let (tx,mut rx)=tokio::sync::mpsc::channel(16);
                let drive=chat::drive_stream(source,translator,telemetry,limit,tx,prefetched);
                let forward=async { while let Some(chunk)=rx.recv().await { match chunk { Ok(bytes)=>sink.send(&bytes).await?,Err(error)=>return Err(error.to_string()) } } Ok::<(),String>(()) };
                let (_,result)=tokio::join!(drive,forward);
                result?;
                return Ok(());
            }
            // 非流式：上游只支持流式，因此内部仍走流式拉取再聚合成完整响应
            let body = chat::drive_aggregate_source(source, translator, telemetry, &limit, prefetched)
                .await
                .map_err(GatewayError::into_control_message)?;
            let payload = serde_json::to_string(&body).map_err(|error| {
                GatewayError::with_status(500, format!("Accio 聚合结果序列化失败：{error}")).message
            })?;
            sink.head(proto::StreamHead {
                status: 200,
                headers: [(
                    "content-type".to_string(),
                    "application/json".to_string(),
                )]
                .into_iter()
                .collect(),
                upstream: proto::UpstreamKind::Chat,
            })
            .await
            .map_err(|error| GatewayError::with_status(499, error).message)?;
            sink.send(payload.as_bytes())
                .await
                .map_err(|error| GatewayError::with_status(499, error).message)?;
            Ok(())
        })
    }

    fn classify_conversation(&self,wire:&proto::ConversationError)->proto::ErrorClass {
        let error=GatewayError{message:wire.message.clone(),status_code:wire.status,code:wire.code.clone(),upstream_code:wire.upstream_code,details:wire.details.clone()};
        match error.code.as_deref() {
            Some("accio_quota")=>proto::ErrorClass::QuotaLimited{reset_at:super::adk_error::quota_reset(&error),message:error.message.clone(),upstream_code:error.upstream_code,status:429},
            Some("accio_auth")=>proto::ErrorClass::TokenExpired{message:error.message.clone()},
            _=>proto::ErrorClass::Fatal{status:u16::try_from(error.status_code).unwrap_or(502),message:error.message.clone(),upstream_code:error.upstream_code},
        }
    }

    /// 非 2xx 的分类。**注意**业务错误多数不体现在状态码上（在 SSE 帧里），
    /// 那些由 `conversation` 直接转成带状态码的网关错误。
    fn classify(&self, status: u16, error_body: &Value) -> proto::ErrorClass {
        let raw = error_body
            .get("message")
            .and_then(Value::as_str)
            .filter(|text| !text.is_empty())
            .unwrap_or("上游错误");
        let message = format!("上游返回 {status}: {raw}");
        match protocol::classify_upstream_error(status, raw) {
            protocol::UpstreamKind::Auth => proto::ErrorClass::TokenExpired { message },
            protocol::UpstreamKind::Quota => proto::ErrorClass::QuotaLimited {
                reset_at: None,
                message,
                upstream_code: error_body.get("code").and_then(Value::as_i64),
                status: if status == 0 { 429 } else { status },
            },
            // 内容策略拦截 → ContentBlocked（不罚账号，换中性提示词重试一次）
            protocol::UpstreamKind::Other => content_block::classify_or_fatal(
                status,
                error_body,
                message,
                error_body.get("code").and_then(Value::as_i64),
            ),
        }
    }

    /// 取可用令牌：临期（5 分钟窗口）才续期。
    fn ensure_token<'a>(&'a self, ctx: &'a PluginCtx, account: &'a str) -> SendFuture<'a, String> {
        Box::pin(async move {
            refresh::ensure_fresh(ctx, account, self.region, false)
                .await
                .map(|credentials| credentials.access_token)
                .map_err(GatewayError::into_control_message)
        })
    }

    /// 401 之后的**强制**续期：不看临期窗口（token 可能时间上还新但已被服务端
    /// 失效 —— 只调 ensure 会拿回同一个被拒的 token）。
    fn refresh_token<'a>(&'a self, ctx: &'a PluginCtx, account: &'a str) -> SendFuture<'a, String> {
        Box::pin(async move {
            refresh::ensure_fresh(ctx, account, self.region, true)
                .await
                .map(|credentials| credentials.access_token)
                .map_err(GatewayError::into_control_message)
        })
    }

    /// 后台凭证维护问「这条账号是不是快到期了」。
    fn token_expiring<'a>(&'a self, ctx: &'a PluginCtx, account: &'a str) -> SendFuture<'a, bool> {
        Box::pin(async move {
            if account.trim().is_empty() {
                return Ok(false);
            }
            let record = match crate::store::record(ctx, self.region.provider_id(), account).await {
                Ok(record) if record.is_object() => record,
                _ => return Ok(false),
            };
            Ok(Credentials::from_payload(&record)
                .map(|credentials| credentials.expiring())
                .unwrap_or(false))
        })
    }

    /// 思考等级绑定 → `reasoning_effort`（值原样交给协议层，按模型家族决定落点）。
    ///
    /// 客户端已显式指定时不覆盖（用户的明确意图比映射上的默认值更具体）；
    /// 档位不在通用 6 档表里时不注入（上游对未知档位要么忽略要么 400，都不如
    /// 明确跳过并说清原因）。`off` / `none` 在注入点就被拦下了（Accio 没有
    /// 可靠的「关闭思考」表达）。
    fn reasoning_patch(&self, level: &str, _model: &str, body: &Value) -> proto::ReasoningPatch {
        if crate::model_rules::reasoning_is_off(level) {
            return proto::ReasoningPatch::Skip {
                reason: "Accio 没有「关闭思考」的可靠表达，跳过注入".to_string(),
            };
        }
        if crate::model_rules::read_client_level(body).is_some() {
            return proto::ReasoningPatch::Skip {
                reason: "客户端请求体里已指定思考等级，绑定让位".to_string(),
            };
        }
        if crate::model_rules::reasoning_rank(level).is_none() {
            return proto::ReasoningPatch::Skip {
                reason: "该等级不在通用档位表内，Accio 不注入未知档位".to_string(),
            };
        }
        proto::ReasoningPatch::Set {
            field: REASONING_FIELD.to_string(),
            value: Value::String(level.to_string()),
        }
    }

    /// 刷新模型目录：用**指定账号**的凭证（目录接口要鉴权，没有账号就拿不到）。
    fn refresh_models<'a>(
        &'a self,
        ctx: &'a PluginCtx,
        account: &'a str,
        force: bool,
    ) -> SendFuture<'a, proto::RefreshOutcome> {
        Box::pin(async move {
            let record = crate::store::record(ctx, self.region.provider_id(), account).await?;
            if !record.is_object() {
                logging::verbose(
                    "[Models]",
                    &format!("Accio {}模型目录刷新跳过：尚未添加账号", self.region.label()),
                );
                if account.trim().is_empty() {
                    return Ok(proto::RefreshOutcome::unchanged());
                }
                return Ok(proto::RefreshOutcome::failed(
                    "指定的账号不存在或不可用，请重新选择",
                ));
            }
            let credentials = match auth::snapshot(&record) {
                Ok(credentials) => credentials,
                Err(_) => {
                    return Ok(proto::RefreshOutcome::failed(
                        "Accio 账号凭证无效，请重新登录或粘贴凭证",
                    ))
                }
            };
            if credentials.region != self.region {
                return Ok(proto::RefreshOutcome::failed(
                    "指定的账号不属于这家（地区不匹配）",
                ));
            }
            let proxy = match auth::account_proxy(&record) {
                Ok(proxy) => proxy,
                Err(error) => return Ok(proto::RefreshOutcome::failed(error.message)),
            };
            models::restore(ctx,self.region).await;
            let result=models::refresh_checked(&credentials,proxy.as_ref(),force).await;
            match result{Ok(outcome)=>{if outcome.refreshed {models::persist(ctx,self.region).await.map_err(GatewayError::into_control_message)?;}Ok(outcome)},Err(e)=>Ok(proto::RefreshOutcome::failed(e.message))}
        })
    }

    /// 查额度 / 订阅（`balance.rs`）。
    fn usage<'a>(&'a self, ctx: &'a PluginCtx, account: &'a str) -> SendFuture<'a, Value> {
        Box::pin(async move {
            balance::query(ctx, account, self.region)
                .await
                .map_err(GatewayError::into_control_message)
        })
    }

    // ── 账号 ──────────────────────────────────────────────────

    fn normalize_account<'a>(
        &'a self,
        ctx: &'a PluginCtx,
        input: proto::NormalizeInput,
    ) -> SendFuture<'a, proto::NormalizedAccount> {
        Box::pin(super::accounts::normalize(ctx, self.region, input))
    }

    fn account_view(&self, secret: &Value) -> Result<Value, String> {
        Ok(super::accounts::account_view(secret))
    }

    fn account_identity(&self, secret: &Value) -> Result<String, String> {
        Ok(super::accounts::identity_of(secret))
    }

    // ── 登录（回调型 / 设备授权）──────────────────────────────

    fn login_start<'a>(
        &'a self,
        _ctx: &'a PluginCtx,
        method: &'a str,
        payload: &'a Value,
    ) -> SendFuture<'a, proto::LoginStart> {
        Box::pin(super::login::login_start(self.region, method, payload))
    }

    fn login_poll<'a>(
        &'a self,
        _ctx: &'a PluginCtx,
        flow: &'a str,
    ) -> SendFuture<'a, proto::LoginPoll> {
        Box::pin(super::login::login_poll(self.region, flow))
    }

    fn login_cancel<'a>(&'a self, _ctx: &'a PluginCtx, flow: &'a str) -> SendFuture<'a, ()> {
        Box::pin(super::login::login_cancel(flow))
    }
}

/// 一次转发用的凭证 + 出口快照
struct AccountContext {
    credentials: Credentials,
    proxy: Option<ResolvedProxy>,
}

/// 取账号凭证（含临期主动刷新）与出口。
///
/// `force` 语义与 `refresh::ensure_fresh` 一致；401 之后的强制刷新由编排层经
/// `refresh_token` 调用，不在这里。
async fn account_context(
    ctx: &PluginCtx,
    account_id: &str,
    region: Region,
    force: bool,
) -> Result<AccountContext, GatewayError> {
    let credentials = refresh::ensure_fresh(ctx, account_id, region, force).await?;
    let proxy = crate::store::record(ctx, region.provider_id(), account_id)
        .await
        .ok()
        .filter(Value::is_object)
        .map(|record| auth::account_proxy(&record))
        .transpose()?
        .flatten();
    Ok(AccountContext { credentials, proxy })
}



#[cfg(test)] mod stateful_classification_tests {
 use super::*;
 #[test] fn stateful_classification_preserves_quota_auth_and_nonreplayable_failures(){
  let mut error=proto::ConversationError{status:403,message:"restricted rate limit".into(),code:Some("accio_account_restricted".into()),..Default::default()};
  assert!(matches!(ACCIO.classify_conversation(&error),proto::ErrorClass::Fatal{status:403,..}));
  error.code=Some("accio_auth".into());error.status=401;
  assert!(matches!(ACCIO.classify_conversation(&error),proto::ErrorClass::TokenExpired{..}));
  error.code=Some("accio_quota".into());error.status=429;error.upstream_code=Some(429);
  assert!(matches!(ACCIO.classify_conversation(&error),proto::ErrorClass::QuotaLimited{status:429,upstream_code:Some(429),..}));
 }
}
