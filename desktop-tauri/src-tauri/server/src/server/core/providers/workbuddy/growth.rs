use serde_json::Value;
use crate::server::errors::GatewayError;
use super::adapter::{chat_headers, chat_completions_url};
use super::region::Region;

// ─── 真实对话并取服务端 requestId（成长任务专用内部入口）──────────

/// 发一条**指定账号**的真实对话并从 SSE 流解析上游返回的服务端 requestId
/// （对照 refs workbuddy2api-panel internal/upstream/desktop.go:415-515
/// `DesktopChatWithExpert`：expert_actual_use / skill_info 等 JOIN 事件的
/// requestId 必须是该服务端 id——自造 UUID 不计数）。
///
/// ── 为什么不走转发编排层 ───────────────────────────────────
/// 转发编排（`core::upstream` 的 provider_loop）按账号池**轮转**选号，
/// 而「给某个账号做成长任务」必须用**那个账号**的登录态打真实对话 ——
/// 两者的选号语义相反。因此这里只复用本模块的**请求形态知识**
/// （`chat_headers` / `chat_completions_url`，与转发链路逐字同源），
/// 不进编排层。头集合的既有形态即为桌面指纹（三段 UA + X-IDE-* +
/// X-Agent-Intent: craft），正是成长任务判据认的形状。
///
/// `expert_id` 非空时叠加 `X-Expert-Id`（expert_5 / Expert_team_use_3 /
/// Expert_lighthouse 的召唤链要求，refs desktop.go:456-458）。
/// 返回 `(conversation_id, 服务端 requestId)`；流里抓不到合法 id 时报错
/// （refs idRegex `^(cmb-)?[0-9a-f]{32}$`，desktop.go:517-518）。
pub async fn growth_chat_request_id(
    session: &Value,
    model_id: &str,
    prompt: &str,
    expert_id: &str,
) -> Result<(String, String), GatewayError> {
    use std::time::Duration;

    // refs desktop.go:420：conversationId 用 UnixNano（无需真实会话）
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let conversation_id = format!("wb2api-conv-{nanos}");
    let request_id = crate::server::core::upstream::request::new_request_id();
    let mut headers = chat_headers(session, Region::Cn, &request_id, Some("text/event-stream"));
    if !expert_id.is_empty() {
        headers.push(("X-Expert-Id".to_string(), expert_id.to_string()));
    }
    // 请求体照抄 refs desktop.go:421-431（短对话，消耗可忽略；上游强制流式）
    let body = serde_json::json!({
        "model": model_id,
        "messages": [
            { "role": "system", "content": "You are a helpful assistant. 当前处于中文环境，使用简体中文回答。" },
            { "role": "user", "content": prompt },
        ],
        "agent": "cli",
        "temperature": 1,
        "stream": true,
        "stream_options": { "include_usage": true },
    });
    let proxy = crate::server::core::proxies::ResolvedProxy::from_json(
        session.get("proxy").unwrap_or(&Value::Null),
    )
    .ok()
    .flatten();
    let client = crate::server::core::egress::client_for(proxy.as_ref());
    let mut builder = client.post(chat_completions_url(session, Region::Cn));
    for (key, value) in &headers {
        builder = builder.header(key, value);
    }
    // refs 的 HTTP client 总时长 120s（client.go:691）；SSE 流式读到收尾
    let response = builder
        .timeout(Duration::from_secs(120))
        .body(body.to_string())
        .send()
        .await
        .map_err(|error| {
            GatewayError::with_status(502, format!("真实对话请求失败: {error}"))
        })?;
    let status = response.status();
    if !status.is_success() {
        // 非 2xx：把状态码与 body 片段透出（调用方按 429/11128 做整账号冷却）
        let snippet = response.text().await.unwrap_or_default();
        let cut = snippet.len().min(200);
        let snippet = snippet.get(..cut).map(str::to_string).unwrap_or(snippet);
        return Err(GatewayError::with_status(
            status.as_u16() as i32,
            format!("真实对话失败 HTTP {}: {snippet}", status.as_u16()),
        ));
    }
    let text = response
        .text()
        .await
        .map_err(|error| GatewayError::with_status(502, format!("读取对话流失败: {error}")))?;
    match scan_server_request_id(&text) {
        Some(id) => Ok((conversation_id, id)),
        None => Err(GatewayError::with_status(
            502,
            "对话流中未找到服务端 requestId",
        )),
    }
}

/// 从 SSE 原文抓第一个合法的服务端 requestId（refs desktop.go:477-515 的
/// 读流扫描口径：`"id":"` 出现处取值、校验、不合法则推进偏移继续找）。
fn scan_server_request_id(text: &str) -> Option<String> {
    let mut search_from = 0;
    while let Some(rel) = text[search_from..].find("\"id\":\"") {
        let abs = search_from + rel;
        let rest = &text[abs + 6..];
        let Some(end) = rest.find('"') else {
            break;
        };
        if end > 0 {
            let candidate = &rest[..end];
            if is_server_request_id(candidate) {
                return Some(candidate.to_string());
            }
        }
        // 不合法则从下一个字节继续（refs searchFrom = abs + 1，避免同一
        // 位置重复命中）
        search_from = abs + 1;
    }
    None
}

/// 服务端 requestId 形状（refs desktop.go:517-518 `idRegex`：
/// `^(cmb-)?[0-9a-f]{32}$`）。
fn is_server_request_id(id: &str) -> bool {
    let bare = id.strip_prefix("cmb-").unwrap_or(id);
    bare.len() == 32
        && bare
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}
