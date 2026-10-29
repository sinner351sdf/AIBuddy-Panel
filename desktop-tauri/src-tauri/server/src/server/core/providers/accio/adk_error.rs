//! Host replay policy for validated plugin ADK error metadata.
use crate::server::errors::GatewayError;
use serde_json::Value;

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
