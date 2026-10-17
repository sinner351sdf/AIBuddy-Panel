//! Accio 对话转发（会话式转发入口的实现主体）。
//!
//! ── 一次转发分三步（与 Qoder 同一分工）──────────────────────
//!   构造（[`build_plan`]）→ 发送（[`send`]）→ 翻译（[`drive_stream`] /
//!   [`drive_aggregate`]）。产出是编排层认识的 `ForwardOutcome`，因此网关的其余
//!   链路（脱敏、记账、错误写出、换号）零改动。
//!
//! ── 为什么走会话式转发入口（`is_stateful`）────────────────────
//! 无状态路径假设「请求体由通用层序列化后原样发出、响应是 OpenAI 的 SSE」。
//! Accio 两条都不满足：请求体是 Gemini 风格的信封（`contents` / `tools` /
//! `token`，见 `protocol.rs`），响应是 ADK 自己的帧（`content.parts` /
//! `turn_complete`，见 `stream.rs`）。通用层的透传既发不出正确的请求体，
//! 也翻译不了回来的帧。
//!
//! ── 流内业务错误为什么要判两次 ────────────────────────────────
//! 上游的业务错误**不体现在 HTTP 状态码上**（常是 200 + 帧里的 `error_code`）。
//! 因此：
//!   - **首帧预读**（[`prefetch_stream_head`]）：把第一个内容帧拦在返回之前，
//!     错误帧转成带状态码的 `Err` 交回编排层换号（此刻还没下发任何字节，
//!     换号无损）；
//!   - **流内**（[`drive_stream`] 的每帧）：中途才冒出来的额度/鉴权错误在
//!     错误现场落冷却（编排层已经退出，看不到它了）。
//!
//! ── 硬约束 ──────────────────────────────────────────────────
//! release 是 `panic=abort`：零 unwrap/expect/panic；不持锁穿越 await
//! （凭证进来前取好快照）。

use futures::StreamExt;
use serde_json::{json, Value};

use crate::server::core::account_store::AccountStore;
use crate::server::core::egress;
use crate::server::core::proxies::ResolvedProxy;
use crate::server::core::upstream::usage::RequestTelemetry;
use crate::server::errors::GatewayError;

use super::credentials::Credentials;
use super::endpoints;
use super::protocol;
use super::stream::{self, Delta, Frame, LineBuffer};

/// 会话式转发用到的翻译器（`mod.rs` 构造它）
pub use super::stream::Translator;

#[cfg(test)]
#[path = "chat_tests.rs"]
mod tests;

/// 一次转发的完整计划（构造阶段不含网络，可在账号循环里对每个候选账号各跑一次）
#[derive(Clone)]
pub struct ChatPlan {
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
    /// 客户端请求的模型名（下发帧的 `model` 字段）
    pub model_name: String,
    /// 上游模型 code（日志用）
    pub upstream_key: String,
    /// 要不要下发思考内容（上游声明支持思考且档位不是「关」）
    pub thinking: bool,
    /// 本次请求 id（`sg_k` 由它算出来，日志里对得上）
    pub request_id: String,
    pub(crate) identity: super::identity::Call,
    supports_images: bool,
    max_images: Option<usize>,
    media_report: Option<Value>,
    pub(crate) security_context: super::security_guard::Context,
}

/// 客户端请求体 → 一次上游调用的完整计划。
pub fn build_plan(
    credentials: &Credentials,
    body: &Value,
    model_name: &str,
    effort: Option<&str>,
) -> Result<ChatPlan, GatewayError> {
    build_plan_with_context(
        credentials,
        body,
        model_name,
        effort,
        &super::identity::Call::fresh(),
    )
}

pub(crate) fn build_plan_with_context(
    credentials: &Credentials,
    body: &Value,
    model_name: &str,
    effort: Option<&str>,
    call: &super::identity::Call,
) -> Result<ChatPlan, GatewayError> {
    let entry = super::models::resolve(model_name, credentials.region).ok_or_else(|| {
        GatewayError::bad_request(format!(
            "模型不存在: {model_name}。Accio 可用模型见 GET /v1/models"
        ))
        .with_code("model_not_found")
    })?;
    let upstream_key = entry
        .get("upstreamKey")
        .or_else(|| entry.get("id"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    if upstream_key.is_empty() {
        return Err(GatewayError::with_status(502, "Accio 模型目录缺少上游标识"));
    }
    let efforts: Vec<String> = entry
        .get("reasoningEfforts")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    // 档位按模型自己声明的集合收敛（发一个它没声明的档位要么被忽略要么 400）
    let resolved_effort = effort.and_then(|level| protocol::resolve_effort(level, &efforts));
    // 档位落点由目录条目的 `protocol` 决定（见 `models::EffortPlacement`）
    let placement = super::models::EffortPlacement::from_entry(&entry);

    let built = protocol::build_upstream_body_with_context(
        body,
        &upstream_key,
        &credentials.access_token,
        resolved_effort.as_deref(),
        placement,
        call,
    );
    let request_id = built
        .body
        .get("request_id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let mut headers = vec![
        ("Content-Type".to_string(), "application/json".to_string()),
        ("Accept".to_string(), "text/event-stream".to_string()),
        (
            "x-language".to_string(),
            endpoints::ACCEPT_LANGUAGE.to_string(),
        ),
        ("x-app-version".to_string(), endpoints::app_version()),
        (
            "x-package-region".to_string(),
            credentials.region.package_region().to_string(),
        ),
        // **必带**：缺了它上游不报错，而是回一段「当前版本已不再支持，请升级」
        // 的普通文本（HTTP 200 + 正常帧形态），会被当成模型输出吐给下游。
        // 见 `endpoints::DEFAULT_APP_KEY`。
        ("appKey".to_string(), endpoints::app_key()),
    ];
    // Dynamic SecurityGuard factors are generated in send(), immediately before
    // transport, against this request's final URL. Never cache them in a plan.
    // 设备指纹（每条账号自带一个；缺省也能发，但带上更接近真实客户端）
    if !credentials.device_id.is_empty() {
        headers.push(("utdid".to_string(), credentials.device_id.clone()));
    }
    headers.push(("version".to_string(), endpoints::app_version()));
    headers.push(("x-deploy-target".into(), "desktop".into()));
    for (key, value) in [
        ("x-team-id", credentials.team_id.as_str()),
        ("x-accio-route-region", credentials.route_region.as_str()),
        ("x-client-timezone", credentials.client_timezone.as_str()),
    ] {
        if !value.is_empty() {
            headers.push((key.into(), value.into()));
        }
    }

    let body_bytes = serde_json::to_vec(&built.body)
        .map_err(|_| GatewayError::with_status(500, "Accio 请求体序列化失败"))?;
    Ok(ChatPlan {
        url: protocol::generate_content_url(&endpoints::llm_base(), &request_id),
        headers,
        body: body_bytes,
        model_name: model_name.to_string(),
        upstream_key,
        thinking: built.thinking,
        request_id,
        identity: call.clone(),
        supports_images: entry
            .get("supportsImages")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        max_images: entry
            .get("maxImages")
            .and_then(Value::as_u64)
            .and_then(|n| usize::try_from(n).ok()),
        media_report: None,
        security_context: super::security_guard::Context::from_credentials(credentials),
    })
}

pub(crate) async fn prepare_media(
    plan: &mut ChatPlan,
    proxy: Option<&ResolvedProxy>,
) -> Result<(), GatewayError> {
    if plan.media_report.is_some() {
        return Ok(());
    }
    let mut body: Value = serde_json::from_slice(&plan.body)
        .map_err(|_| GatewayError::with_status(500, "Accio 请求体解析失败"))?;
    let report =
        super::media::prepare(&mut body, plan.supports_images, plan.max_images, proxy).await;
    plan.body = serde_json::to_vec(&body)
        .map_err(|_| GatewayError::with_status(500, "Accio 媒体请求序列化失败"))?;
    plan.media_report = Some(serde_json::to_value(report).unwrap_or(Value::Null));
    Ok(())
}

/// 发一次上游请求（不读体，交给调用方决定怎么消费）。
pub async fn send(
    plan: &ChatPlan,
    proxy: Option<&ResolvedProxy>,
) -> Result<reqwest::Response, GatewayError> {
    send_with_security_guard(plan, proxy, super::security_guard::Mode::configured()?).await
}

pub(crate) async fn send_with_security_guard(
    plan: &ChatPlan,
    proxy: Option<&ResolvedProxy>,
    mode: super::security_guard::Mode,
) -> Result<reqwest::Response, GatewayError> {
    send_inner(plan, proxy, mode, None).await
}

pub(crate) async fn send_observed(
    plan: &ChatPlan,
    proxy: Option<&ResolvedProxy>,
    telemetry: &std::sync::Arc<RequestTelemetry>,
) -> Result<reqwest::Response, GatewayError> {
    send_inner(
        plan,
        proxy,
        super::security_guard::Mode::configured()?,
        Some(telemetry),
    )
    .await
}

async fn send_inner(
    plan: &ChatPlan,
    proxy: Option<&ResolvedProxy>,
    mode: super::security_guard::Mode,
    telemetry: Option<&std::sync::Arc<RequestTelemetry>>,
) -> Result<reqwest::Response, GatewayError> {
    let mut prepared = plan.clone();
    prepare_media(&mut prepared, proxy).await?;
    let plan = &prepared;
    if let Some(telemetry) = telemetry {
        if let Some(attempt) = telemetry.snapshot().attempts_detail.len().checked_sub(1) {
            telemetry.note_accio_diagnostics(
                attempt,
                "accioMedia",
                plan.media_report.clone().unwrap_or(Value::Null),
            );
        }
    }
    let result = super::security_guard::headers(&plan.url, mode, &plan.security_context).await;
    let report = match &result {
        Ok((_, report)) => serde_json::to_value(report).unwrap_or(Value::Null),
        Err(error) => error
            .details
            .as_ref()
            .and_then(|v| v.get("security_guard"))
            .cloned()
            .unwrap_or(Value::Null),
    };
    if let Some(telemetry) = telemetry {
        if let Some(attempt) = telemetry.snapshot().attempts_detail.len().checked_sub(1) {
            telemetry.note_accio_diagnostics(attempt, "accioSecurityGuard", report.clone());
        }
    }
    crate::server::logging::verbose(
        "[Accio SecurityGuard]",
        &json!({"identity":plan.identity,"security_guard":report}).to_string(),
    );
    let (factor_headers, report) = result?;
    let client = egress::client_for(proxy);
    let already_encoded = plan
        .headers
        .iter()
        .any(|(k, _)| k.eq_ignore_ascii_case("content-encoding"));
    let inline_media = plan
        .body
        .windows(b"\"inline_data\"".len())
        .any(|w| w == b"\"inline_data\"");
    let (mut wire_body, mut compression) = super::compression::encode(
        &plan.body,
        super::compression::configured(),
        super::compression::disabled(&plan.url),
        already_encoded || inline_media,
    );
    let mut compressed = compression["applied"] == true;
    let via = match proxy {
        Some(proxy) if !proxy.label.is_empty() => format!("经代理 {}", proxy.label),
        Some(proxy) => format!("经代理 {}", proxy.host),
        None => "直连".to_string(),
    };
    let budget =
        std::time::Duration::from_millis(crate::server::config::timeout_settings().headers_ms());
    let deadline = tokio::time::Instant::now() + budget;
    loop {
        if let Some(telemetry) = telemetry {
            if let Some(attempt) = telemetry.snapshot().attempts_detail.len().checked_sub(1) {
                telemetry.note_accio_diagnostics(attempt, "accioCompression", compression.clone());
            }
        }
        let mut builder = client.post(&plan.url).body(wire_body.clone());
        for (key, value) in &plan.headers {
            builder = builder.header(key, value);
        }
        builder = builder.headers(factor_headers.clone());
        if compressed {
            builder = builder.header("Content-Encoding", "gzip");
        }
        match tokio::time::timeout_at(deadline, builder.send()).await {
            Ok(Ok(response))
                if compressed
                    && response.status().as_u16() == 415
                    && super::transport::rejection(&response, Some(&plan.url)).is_none() =>
            {
                // Same URL, IDs, SDK factors and total header budget. Never read
                // inference content or retry auth/WAF responses for compression.
                drop(response);
                super::compression::disable(&plan.url);
                wire_body = plan.body.clone();
                compressed = false;
                compression["applied"] = json!(false);
                compression["skipReason"] = json!("gateway_unsupported");
                compression["encodedBytes"] = json!(wire_body.len());
                compression["downgrades"] = json!(1);
                compression["downgradeStatus"] = json!(415);
            }
            Ok(Ok(mut response)) => {
                response.extensions_mut().insert(report);
                return Ok(response);
            }
            Ok(Err(error)) if error.is_timeout() => {
                return Err(GatewayError::with_status(
                    502,
                    format!("Accio 连接中超时（出口 {via}）"),
                ))
            }
            Ok(Err(error)) => {
                return Err(GatewayError::with_status(
                    502,
                    format!(
                        "Accio 上游请求失败（{via}）: {}",
                        egress::describe_error_detail(&error)
                    ),
                ))
            }
            Err(_) => {
                return Err(GatewayError::with_status(
                    502,
                    format!("Accio 等待响应超时({}秒，出口 {via})", budget.as_secs()),
                ))
            }
        }
    }
}

/// 失败响应 → 客户端可用错误（流内错误另走 [`drive_stream`]）。
pub async fn http_error(status: u16, response: reqwest::Response) -> GatewayError {
    super::transport::http_error(status, response).await
}

/// 流式链路的限额记账素材（错误发生时用；handler 返回后流还在跑，所以带着走）
#[derive(Clone)]
pub struct LimitContext {
    pub store: AccountStore,
    pub account_id: String,
    pub model: String,
    pub(crate) session_record: Option<Value>,
}

/// 一帧的错误 → 网关错误（额度类带 429、鉴权类带 401）
fn frame_error(frame: &Frame) -> GatewayError {
    super::adk_error::gateway(
        200,
        &frame.error_code,
        &frame.error_message,
        frame.error_metadata.as_ref(),
    )
}

/// 面向客户端的 chunk 构造（流式）
fn chunk_frame(translator: &Translator, delta: Value, finish_reason: Value) -> Value {
    let mut frame = json!({
        "id": translator.response_id(),
        "object": "chat.completion.chunk",
        "created": translator.created(),
        "model": translator.model_out(),
        "choices": [{ "index": 0, "delta": delta, "finish_reason": finish_reason }],
    });
    if let Some(context) = &translator.accio_context {
        frame["accio_context"] = context.clone();
    }
    frame
}

/// 把一批 delta 翻成下发的 SSE 帧
fn frames_for_deltas(translator: &mut Translator, deltas: &[Delta]) -> Option<String> {
    let mut out = String::new();
    if !deltas.is_empty() && translator.take_role_frame() {
        out.push_str(&stream::sse_frame(&chunk_frame(
            translator,
            json!({ "role": "assistant", "content": "" }),
            Value::Null,
        )));
    }
    for delta in deltas {
        let payload = match delta {
            Delta::Content(text) => json!({ "content": text }),
            Delta::Reasoning(text) => json!({ "reasoning_content": text }),
            Delta::ToolSignature { index, signature } => {
                json!({"tool_calls":[{"index":index,"extra_content":{"google":{"thought_signature":signature}}}]})
            }
            Delta::ToolCall {
                index,
                id,
                name,
                arguments,
            } => {
                let mut function = serde_json::Map::new();
                if let Some(name) = name {
                    function.insert("name".to_string(), Value::String(name.clone()));
                }
                if let Some(arguments) = arguments {
                    function.insert("arguments".to_string(), Value::String(arguments.clone()));
                }
                let mut call = serde_json::Map::new();
                call.insert("index".to_string(), json!(index));
                if let Some(id) = id {
                    call.insert("id".to_string(), Value::String(id.clone()));
                    call.insert("type".to_string(), Value::String("function".to_string()));
                }
                call.insert("function".to_string(), Value::Object(function));
                json!({ "tool_calls": [Value::Object(call)] })
            }
        };
        out.push_str(&stream::sse_frame(&chunk_frame(
            translator,
            payload,
            Value::Null,
        )));
    }
    (!out.is_empty()).then_some(out)
}

/// 收尾帧（finish_reason + usage）
fn tail_frames(translator: &mut Translator) -> String {
    let mut out = String::new();
    if translator.take_role_frame() {
        out.push_str(&stream::sse_frame(&chunk_frame(
            translator,
            json!({ "role": "assistant", "content": "" }),
            Value::Null,
        )));
    }
    out.push_str(&stream::sse_frame(&chunk_frame(
        translator,
        json!({}),
        Value::String(translator.final_finish_reason()),
    )));
    if let Some(usage) = translator.usage() {
        out.push_str(&stream::sse_frame(&json!({
            "id": translator.response_id(),
            "object": "chat.completion.chunk",
            "created": translator.created(),
            "model": translator.model_out(),
            "choices": [],
            "usage": usage,
        })));
    }
    out.push_str(&stream::sse_done());
    out
}

/// 首帧预读：把上游拉到第一个**有内容或结束**的帧，决定「能不能交给客户端」。
///
/// 返回 `(预读到的帧, 剩余字节流)`。首帧前就撞上错误 → 交回带状态码的 `Err`，
/// 编排层据此换号（此刻一个字节都还没下发）。
pub(super) async fn prefetch_stream_head(
    response: reqwest::Response,
    limit: &LimitContext,
    telemetry: &std::sync::Arc<RequestTelemetry>,
) -> Result<
    (
        Vec<Frame>,
        futures::stream::BoxStream<'static, Result<bytes::Bytes, std::io::Error>>,
    ),
    GatewayError,
> {
    if let Some(error) = super::transport::rejection(&response, None) {
        return Err(error);
    }
    if response
        .headers()
        .get("content-type")
        .and_then(|h| h.to_str().ok())
        .is_some_and(|t| {
            !t.split(';')
                .next()
                .unwrap_or("")
                .trim()
                .eq_ignore_ascii_case("text/event-stream")
        })
    {
        return Err(http_error(response.status().as_u16(), response).await);
    }
    let source = response.bytes_stream().map(|item| {
        item.map_err(|error| std::io::Error::other(egress::describe_error_detail(&error)))
    });
    let source = crate::server::core::upstream::stall::idle_guard(
        Box::pin(source),
        std::time::Duration::from_millis(
            crate::server::config::timeout_settings().stream_idle_ms(),
        ),
    );
    prefetch_source(source, limit, telemetry).await
}

async fn prefetch_source(
    mut source: futures::stream::BoxStream<'static, Result<bytes::Bytes, std::io::Error>>,
    limit: &LimitContext,
    telemetry: &std::sync::Arc<RequestTelemetry>,
) -> Result<
    (
        Vec<Frame>,
        futures::stream::BoxStream<'static, Result<bytes::Bytes, std::io::Error>>,
    ),
    GatewayError,
> {
    // Observe the original transport once. Re-injected prefetch leftovers bypass
    // this wrapper, so bytes/frames are never counted twice across the handoff.
    source = stream_diagnostics::observe(source, telemetry.clone());
    let mut pending = Vec::new();
    let mut frames = Vec::new();
    let mut first_byte = Some(telemetry.begin_stage("first_byte"));
    let mut first_content = None;
    let deadline = tokio::time::Instant::now() + semantic_idle();
    loop {
        let item = tokio::time::timeout_at(deadline, source.next())
            .await
            .map_err(|_| stream::protocol_error("等待首个有效内容超时（仅心跳不能延长等待）"))?;
        let Some(item) = item else {
            return Err(stream::protocol_error("未收到内容或结束帧，上游连接已关闭"));
        };
        let chunk =
            item.map_err(|error| stream::protocol_error(&format!("上游传输中断：{error}")))?;
        if let Some(stage) = first_byte.take() {
            stage.finish();
            first_content = Some(telemetry.begin_stage("first_content"));
        }
        pending.extend_from_slice(&chunk);
        let mut consumed = 0;
        while let Some(newline) = pending[consumed..].iter().position(|byte| *byte == b'\n') {
            let end = consumed + newline + 1;
            let line = String::from_utf8_lossy(&pending[consumed..end]);
            consumed = end;
            let Some(frame) = decode_line(&line, limit)? else {
                continue;
            };
            let has_content = frame.parts.iter().any(|p| {
                matches!(p, stream::Part::Text(t) | stream::Part::Thought(t) if !t.is_empty())
                    || matches!(p, stream::Part::FunctionCall { .. })
            });
            if frame.turn_complete
                && !has_content
                && !frames.iter().any(|f: &Frame| !f.parts.is_empty())
            {
                return Err(stream::protocol_error(
                    "上游仅返回结束标记，没有生成任何内容",
                ));
            }
            let finished = frame.turn_complete;
            frames.push(frame);
            if has_content || finished {
                if let Some(stage) = first_content.take() {
                    stage.finish();
                }
                let leftover = pending.split_off(consumed);
                if !leftover.is_empty() {
                    source = Box::pin(
                        futures::stream::once(async move { Ok(bytes::Bytes::from(leftover)) })
                            .chain(source),
                    );
                }
                return Ok((frames, source));
            }
        }
        pending.drain(..consumed);
        if pending.len() > MAX_FRAME_BYTES {
            return Err(stream::protocol_error("数据帧超过大小限制"));
        }
        if frames.len() > 1024 {
            return Err(stream::protocol_error("上游持续返回元数据但没有有效内容"));
        }
    }
}

pub(super) const MAX_FRAME_BYTES: usize = 8 * 1024 * 1024;

fn semantic_idle() -> std::time::Duration {
    std::time::Duration::from_millis(crate::server::config::timeout_settings().stream_idle_ms())
}

fn decode_line(line: &str, limit: &LimitContext) -> Result<Option<Frame>, GatewayError> {
    let Some(data) = line.trim_start_matches('\u{feff}').strip_prefix("data:") else {
        return Ok(None);
    };
    if data.len() > MAX_FRAME_BYTES {
        return Err(stream::protocol_error("数据帧超过大小限制"));
    }
    let frame = stream::decode_frame(data).inspect_err(|error| {
        if super::session::restricted(error) {
            record_session_failure(limit, error);
        }
        if error.code.as_deref() == Some("accio_quota") {
            record_quota(limit, error);
        }
    })?;
    if let Some(frame) = &frame {
        if frame.is_error() {
            let error = frame_error(frame);
            if super::session::restricted(&error) {
                record_session_failure(limit, &error);
            }
            if error.code.as_deref() == Some("accio_quota") {
                record_quota(limit, &error);
            }
            return Err(error);
        }
    }
    Ok(frame)
}

fn record_session_failure(limit: &LimitContext, error: &GatewayError) {
    if let Some(record) = &limit.session_record {
        super::session::record_failure(&limit.store, record, error);
    }
}

pub(super) fn record_quota(limit: &LimitContext, error: &GatewayError) {
    if !limit.account_id.is_empty() {
        limit.store.mark_rate_limited(
            &limit.account_id,
            &limit.model,
            429,
            super::adk_error::quota_reset(error),
            None,
            &error.message,
        );
    }
}

/// Shared consumption for SSE and aggregate responses. Only explicit completion
/// may produce a success tail; EOF, malformed frames and idle heartbeats are errors.
async fn consume_source(
    mut source: futures::stream::BoxStream<'static, Result<bytes::Bytes, std::io::Error>>,
    mut translator: Translator,
    telemetry: &std::sync::Arc<RequestTelemetry>,
    limit: &LimitContext,
    prefetched: Vec<Frame>,
    sender: Option<&tokio::sync::mpsc::Sender<Result<bytes::Bytes, std::io::Error>>>,
    idle: std::time::Duration,
) -> Result<Translator, GatewayError> {
    let mut buffer = LineBuffer::new();
    let mut deadline = tokio::time::Instant::now() + idle;
    let mut batch = prefetched;
    let mut queued_error = None;
    loop {
        for frame in batch.drain(..) {
            let deltas = translator.consume(&frame, Some(telemetry));
            if !deltas.is_empty() {
                deadline = tokio::time::Instant::now() + idle;
            }
            if let Some(sender) = sender {
                if let Some(text) = frames_for_deltas(&mut translator, &deltas) {
                    sender
                        .send(Ok(bytes::Bytes::from(text)))
                        .await
                        .map_err(|_| {
                            GatewayError::with_status(499, "Accio 客户端已断开")
                                .with_code("client_abort")
                        })?;
                }
            }
            if frame.turn_complete {
                if !translator.has_output() {
                    return Err(stream::protocol_error("上游结束但没有生成任何内容"));
                }
                return Ok(translator);
            }
        }
        if let Some(error) = queued_error.take() {
            return Err(error);
        }
        let item = tokio::time::timeout_at(deadline, source.next())
            .await
            .map_err(|_| stream::protocol_error("有效内容空闲超时（仅心跳不能延长生成）"))?;
        let Some(item) = item else {
            let tail = buffer.take_pending();
            if !tail.is_empty() {
                if let Some(frame) = decode_line(&tail, limit)? {
                    if frame.turn_complete {
                        batch.push(frame);
                        continue;
                    }
                }
            }
            return Err(stream::protocol_error("未收到结束帧，上游连接提前关闭"));
        };
        let chunk = item.map_err(|e| stream::protocol_error(&format!("上游传输中断：{e}")))?;
        for line in buffer.push_bytes(&chunk) {
            match decode_line(&line, limit) {
                Ok(Some(frame)) => {
                    let finished = frame.turn_complete;
                    batch.push(frame);
                    if finished {
                        break;
                    }
                }
                Ok(None) => {}
                Err(error) => {
                    queued_error = Some(error);
                    break;
                }
            }
        }
        if buffer.pending_len() > MAX_FRAME_BYTES {
            return Err(stream::protocol_error("数据帧超过大小限制"));
        }
    }
}

pub async fn drive_stream(
    source: futures::stream::BoxStream<'static, Result<bytes::Bytes, std::io::Error>>,
    translator: Translator,
    telemetry: std::sync::Arc<RequestTelemetry>,
    limit: LimitContext,
    sender: tokio::sync::mpsc::Sender<Result<bytes::Bytes, std::io::Error>>,
    prefetched: Vec<Frame>,
) {
    let response_stage = telemetry.begin_stage("stream_response");
    match consume_source(
        source,
        translator,
        &telemetry,
        &limit,
        prefetched,
        Some(&sender),
        semantic_idle(),
    )
    .await
    {
        Ok(mut translator) => {
            response_stage.finish();
            let _ = sender
                .send(Ok(bytes::Bytes::from(tail_frames(&mut translator))))
                .await;
        }
        Err(error) => {
            if error.status_code == 401 || super::session::restricted(&error) {
                record_session_failure(&limit, &error);
            }

            telemetry.note_error(&error.message);
            if error.status_code != 499 {
                let text = format!(
                    "{}{}",
                    stream::sse_frame(&error.payload()),
                    stream::sse_done()
                );
                let _ = sender.send(Ok(bytes::Bytes::from(text))).await;
            }
        }
    }
}

pub async fn drive_aggregate(
    response: reqwest::Response,
    translator: Translator,
    telemetry: std::sync::Arc<RequestTelemetry>,
    limit: &LimitContext,
) -> Result<Value, GatewayError> {
    let (prefetched, source) = prefetch_stream_head(response, limit, &telemetry).await?;
    let response_stage = telemetry.begin_stage("stream_response");
    let translator = consume_source(
        source,
        translator,
        &telemetry,
        limit,
        prefetched,
        None,
        semantic_idle(),
    )
    .await?;
    response_stage.finish();
    Ok(completion_body(&translator))
}

/// 聚合产出的完整响应（OpenAI `chat.completion`）
fn completion_body(translator: &Translator) -> Value {
    let mut message = serde_json::Map::new();
    message.insert("role".to_string(), Value::String("assistant".to_string()));
    let content = translator.content();
    message.insert(
        "content".to_string(),
        if content.is_empty() {
            Value::Null
        } else {
            Value::String(content.to_string())
        },
    );
    let reasoning = translator.reasoning();
    if !reasoning.is_empty() {
        message.insert(
            "reasoning_content".to_string(),
            Value::String(reasoning.to_string()),
        );
    }
    let tool_calls = translator.final_tool_calls();
    if !tool_calls.is_empty() {
        message.insert("tool_calls".to_string(), Value::Array(tool_calls));
    }
    let mut body = json!({
        "id": translator.response_id(),
        "object": "chat.completion",
        "created": translator.created(),
        "model": translator.model_out(),
        "choices": [{
            "index": 0,
            "message": Value::Object(message),
            "finish_reason": translator.final_finish_reason(),
        }],
    });
    if let Some(context) = &translator.accio_context {
        body["accio_context"] = context.clone();
    }
    if let Some(usage) = translator.usage() {
        body["usage"] = usage;
    }
    body
}

/// 响应 id（与另外几家同形：`chatcmpl-` + 24 位随机）
pub fn response_id() -> String {
    let uuid = crate::server::core::upstream::request::new_request_id().replace('-', "");
    let short: String = uuid.chars().take(24).collect();
    format!("chatcmpl-{short}")
}

#[path = "stream_diagnostics.rs"]
mod stream_diagnostics;
