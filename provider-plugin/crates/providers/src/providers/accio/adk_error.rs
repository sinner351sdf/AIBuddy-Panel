//! Validated ADK 0.3.32 error contract. Metadata takes precedence over text hints.
use super::protocol::{classify_upstream_error, UpstreamKind};
use crate::errors::GatewayError;
use serde_json::{json, Map, Value};

fn field<'a>(v: &'a Value, camel: &str, snake: &str) -> Option<&'a Value> {
    v.get(camel).or_else(|| v.get(snake))
}

pub fn error_code(v: &Value) -> String {
    let nested = v.get("error").filter(|v| v.is_object());
    nested
        .into_iter()
        .chain(std::iter::once(v))
        .flat_map(|v| [v.get("errorCode"), v.get("error_code"), v.get("code")])
        .flatten()
        .find_map(|v| match v {
            Value::String(s) if !s.trim().is_empty() => Some(s.trim().to_string()),
            Value::Number(n) => Some(n.to_string()),
            _ => None,
        })
        .or_else(|| v.get("error").and_then(Value::as_str).map(str::to_string))
        .unwrap_or_default()
}

/// Raw text is for classification only. Login diagnostics never emit this text.
pub fn error_message(v: &Value) -> &str {
    v.get("error")
        .filter(|v| v.is_object())
        .into_iter()
        .chain(std::iter::once(v))
        .flat_map(|v| {
            [
                "error_description",
                "errorMessage",
                "error_message",
                "message",
                "msg",
                "errorMsg",
            ]
            .map(|k| v.get(k))
        })
        .flatten()
        .filter_map(Value::as_str)
        .find(|s| !s.trim().is_empty())
        .unwrap_or("上游业务请求被拒绝")
}

/// Official acceptance rules: schema=1, valid numeric code, exact code binding,
/// and known source/action/category. Copy only documented fields.
pub fn metadata(v: &Value, code: &str) -> Option<Value> {
    let m = field(v, "errorMetadata", "error_metadata")?;
    let bound = field(m, "gatewayErrorCode", "gateway_error_code")?.as_str()?;
    if field(m, "schemaVersion", "schema_version")?.as_u64()? != 1
        || bound != code
        || !(3..=5).contains(&code.len())
        || code.starts_with('0')
        || !code.bytes().all(|b| b.is_ascii_digit())
    {
        return None;
    }
    let mut out = Map::new();
    out.insert("schema_version".into(), json!(1));
    out.insert("gateway_error_code".into(), json!(code));
    for (key, allowed) in [
        (
            "source",
            &[
                "gateway_policy",
                "gateway_internal",
                "upstream_model",
                "upstream_http",
                "transport",
            ][..],
        ),
        (
            "action",
            &[
                "none",
                "login",
                "authorize_connector",
                "quota_grace",
                "rollback_message",
                "rollback_turn",
            ][..],
        ),
        (
            "category",
            &[
                "auth", "quota", "policy", "capacity", "upstream", "internal",
            ][..],
        ),
    ] {
        if let Some(text) = m
            .get(key)
            .and_then(Value::as_str)
            .filter(|s| allowed.contains(s))
        {
            out.insert(key.into(), json!(text));
        }
    }
    for (camel, snake) in [
        ("retryable", "retryable"),
        ("replaySafe", "replay_safe"),
        ("retryExhausted", "retry_exhausted"),
    ] {
        if let Some(b) = field(m, camel, snake).and_then(Value::as_bool) {
            out.insert(snake.into(), json!(b));
        }
    }
    for (camel, snake) in [
        ("retryAfterMs", "retry_after_ms"),
        ("gatewayRetryCount", "gateway_retry_count"),
    ] {
        if let Some(n) = field(m, camel, snake).and_then(Value::as_u64) {
            out.insert(snake.into(), json!(n));
        }
    }
    for (camel, snake) in [
        ("upstreamErrorType", "upstream_error_type"),
        ("originalErrorCode", "original_error_code"),
        ("rejectReason", "reject_reason"),
        ("normalizationSource", "normalization_source"),
    ] {
        if let Some(s) = field(m, camel, snake).and_then(Value::as_str) {
            out.insert(snake.into(), json!(s.chars().take(200).collect::<String>()));
        }
    }
    Some(Value::Object(out))
}

pub fn gateway(status: u16, code: &str, message: &str, metadata: Option<&Value>) -> GatewayError {
    if code == "423"
        || ["ACCOUNT_LOCKED", "ACCOUNT_RESTRICTED", "ACCOUNT_BANNED"].contains(&code)
        || super::session::restricted(&GatewayError::with_status(i32::from(status), message))
    {
        return super::session::blocked_error("restricted").upstream_code(423);
    }
    let lower = message.to_ascii_lowercase();
    let category = metadata
        .and_then(|m| m.get("category"))
        .and_then(Value::as_str)
        .unwrap_or_else(|| {
            if matches!(
                code,
                "NOT_LOGIN" | "401" | "402" | "SESSION_EXPIRED" | "TOKEN_EXPIRED"
            ) {
                "auth"
            } else if matches!(code, "429" | "6004") {
                "quota"
            } else if lower.contains("sentinel")
                || lower.contains("securityguard")
                || lower.contains("security guard")
            {
                "policy"
            } else if code == "555" {
                "capacity"
            } else {
                match classify_upstream_error(status, message) {
                    UpstreamKind::Auth => "auth",
                    UpstreamKind::Quota => "quota",
                    UpstreamKind::Other => "upstream",
                }
            }
        });
    let mapped = match category {
        "auth" => 401,
        "quota" => 429,
        "policy" => 403,
        "capacity" => 503,
        _ => 502,
    };
    let mut error = GatewayError::with_status(
        mapped,
        format!(
            "Accio 上游错误：{}{}",
            if code.is_empty() {
                String::new()
            } else {
                format!("[{code}] ")
            },
            message
        ),
    )
    .with_code(format!("accio_{category}"));
    if let Ok(code) = code.parse::<i64>() {
        error = error.upstream_code(code);
    }
    if let Some(m) = metadata {
        error = error.with_details(json!({"provider":"accio", "error_metadata":m}));
    }
    error
}

pub fn from_payload(status: u16, v: &Value, fallback: &str) -> GatewayError {
    let code = error_code(v);
    let message = error_message(v);
    let message = if message == "上游业务请求被拒绝" {
        fallback
    } else {
        message
    };
    let nested = v.get("error").filter(|v| v.is_object()).unwrap_or(v);
    gateway(
        status,
        &code,
        message,
        metadata(nested, &code)
            .or_else(|| metadata(v, &code))
            .as_ref(),
    )
}

pub fn quota_reset(error: &GatewayError) -> Option<i64> {
    let delay = error
        .details
        .as_ref()?
        .get("error_metadata")?
        .get("retry_after_ms")?
        .as_u64()?;
    Some(crate::logging::now_ms().saturating_add(delay.min(i64::MAX as u64) as i64))
}

pub fn allows_replay(error: &GatewayError) -> bool {
    if matches!(
        error.code.as_deref(),
        Some("accio_account_restricted" | "accio_login_required" | "accio_session_refresh_backoff")
    ) {
        return false;
    }
    let Some(m) = error.details.as_ref().and_then(|d| d.get("error_metadata")) else {
        return error.code.as_deref() != Some("accio_policy");
    };
    m.get("replay_safe").and_then(Value::as_bool) != Some(false)
        && m.get("retryable").and_then(Value::as_bool) != Some(false)
        && m.get("action")
            .and_then(Value::as_str)
            .is_none_or(|s| s == "none" || s == "quota_grace")
        && error.code.as_deref() != Some("accio_policy")
}
