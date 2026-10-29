//! Authorization failures are session state, not a reason to keep probing.
use crate::errors::GatewayError;
use agent2api_provider_sdk::PluginCtx;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

pub fn token_binding(token: &str) -> String {
    format!("{:x}", Sha256::digest(token.as_bytes()))
}

pub fn restricted(error: &GatewayError) -> bool {
    let text = error.message.to_lowercase();
    error.code.as_deref() == Some("accio_account_restricted")
        || error.upstream_code == Some(423)
        || error.status_code == 423
        || [
            "account locked",
            "account restricted",
            "account banned",
            "账号受限",
            "账号封禁",
            "账户受限",
            "账户封禁",
        ]
        .iter()
        .any(|s| text.contains(s))
}

pub fn blocked_error(state: &str) -> GatewayError {
    let (status, code, message) = match state {
        "restricted" => (
            403,
            "accio_account_restricted",
            "Accio 账号已受限，请先按官方提示处理账号状态；已停止自动请求",
        ),
        "refresh_failed" => (
            503,
            "accio_session_refresh_backoff",
            "Accio 会话续期暂时失败，正在等待后重试",
        ),
        _ => (
            401,
            "accio_login_required",
            "Accio 会话已失效，请重新完成网页登录授权",
        ),
    };
    let action = if state == "refresh_failed" {
        "none"
    } else {
        "login"
    };
    GatewayError::with_status(status, message)
        .with_code(code)
        .with_details(json!({
            "accio_session_state": state,
            "error_metadata": {"retryable": false, "replay_safe": false, "action": action}
        }))
}

pub fn guard(record: &Value) -> Result<(), GatewayError> {
    let state = record
        .get("sessionStatus")
        .and_then(Value::as_str)
        .unwrap_or("");
    if state.is_empty()
        || record.get("sessionTokenBinding").and_then(Value::as_str)
            != record
                .get("accessToken")
                .and_then(Value::as_str)
                .map(token_binding)
                .as_deref()
    {
        return Ok(());
    }
    if state == "refresh_failed"
        && record
            .get("sessionRetryAt")
            .and_then(Value::as_i64)
            .is_some_and(|at| at <= crate::logging::now_ms())
    {
        return Ok(());
    }
    Err(blocked_error(state))
}

/// Compare-and-set binds a refusal to the rejected issuance. A late response
/// must not disable an account that was reauthorized or deleted in the meantime.
pub fn record_failure(ctx: &PluginCtx, expected: &Value, error: &GatewayError) {
    let state = if restricted(error) { "restricted" } else if error.status_code == 401 { "login_required" } else { "refresh_failed" };
    let ctx = ctx.clone(); let expected = expected.clone();
    tokio::spawn(async move {
        let id = expected.get("id").and_then(Value::as_str).unwrap_or("");
        let original = crate::store::secret_view(&expected);
        let mut next = original.clone();
        next["sessionStatus"] = json!(state);
        next["sessionTokenBinding"] = json!(token_binding(original.get("accessToken").and_then(Value::as_str).unwrap_or("")));
        if state == "refresh_failed" { next["sessionRetryAt"] = json!(crate::logging::now_ms()+30_000); }
        if let Err(error) = crate::store::save(&ctx, id, &original, &next).await {
            crate::logging::verbose("[Accio]", &format!("会话状态保存失败（HTTP {}）", error.status_code));
        }
    });
}

pub fn can_refresh(error: &GatewayError, content_started: bool) -> bool {
    !content_started
        && error.status_code == 401
        && !restricted(error)
        && error.code.as_deref() != Some("accio_login_required")
        && super::adk_error::allows_replay(error)
}

/// Testable bounded recovery: at most one refresh and one replay, before output.
pub async fn recover<T, F, Fut, R, RFut, C>(
    mut send: F,
    refresh: R,
    content_started: C,
) -> Result<T, GatewayError>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<T, GatewayError>>,
    R: FnOnce() -> RFut,
    RFut: std::future::Future<Output = Result<(), GatewayError>>,
    C: Fn() -> bool,
{
    match send().await {
        Err(error) if can_refresh(&error, content_started()) => {
            refresh().await?;
            send().await
        }
        result => result,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    #[tokio::test]
    async fn only_one_refresh_and_no_replay_after_output_or_restriction() {
        let calls = Cell::new(0);
        let refreshes = Cell::new(0);
        let result: Result<(), _> = recover(
            || {
                calls.set(calls.get() + 1);
                async { Err(GatewayError::with_status(401, "unauthorized")) }
            },
            || {
                refreshes.set(refreshes.get() + 1);
                async { Ok(()) }
            },
            || false,
        )
        .await;
        assert!(result.is_err());
        assert_eq!(calls.get(), 2);
        assert_eq!(refreshes.get(), 1);
        for (error, started) in [
            (blocked_error("restricted"), false),
            (GatewayError::with_status(401, "unauthorized"), true),
            (
                GatewayError::with_status(401, "unauthorized")
                    .with_details(json!({"error_metadata":{"replay_safe":false}})),
                false,
            ),
        ] {
            let calls = Cell::new(0);
            let refreshes = Cell::new(0);
            let _: Result<(), _> = recover(
                || {
                    calls.set(calls.get() + 1);
                    let error = error.clone();
                    async move { Err(error) }
                },
                || {
                    refreshes.set(refreshes.get() + 1);
                    async { Ok(()) }
                },
                || started,
            )
            .await;
            assert_eq!(calls.get(), 1);
            assert_eq!(refreshes.get(), 0);
        }
    }
    #[test]
    fn late_refusal_does_not_poison_a_new_issuance() {
        let mut record = json!({"accessToken":"synthetic-old","sessionStatus":"restricted","sessionTokenBinding":token_binding("synthetic-old")});
        assert!(guard(&record).is_err());
        record["accessToken"] = json!("synthetic-new");
        assert!(guard(&record).is_ok());
    }

    #[test]
    fn refresh_backoff_expires_without_requesting_a_new_login() {
        let mut record = json!({
            "accessToken": "synthetic-token",
            "sessionStatus": "refresh_failed",
            "sessionTokenBinding": token_binding("synthetic-token"),
            "sessionRetryAt": crate::logging::now_ms() + 30_000
        });
        let error = guard(&record).unwrap_err();
        assert_eq!(error.status_code, 503);
        assert_eq!(error.details.unwrap()["error_metadata"]["action"], "none");
        record["sessionRetryAt"] = json!(crate::logging::now_ms() - 1);
        assert!(guard(&record).is_ok());
    }
}
