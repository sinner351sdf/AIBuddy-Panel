//! Bounded error reads and safe transport facts; no WAF challenge execution.
use crate::server::errors::GatewayError;
use futures::StreamExt;
use serde_json::{json, Value};
use std::time::Duration;

const MAX_ERROR_BYTES: usize = 32 * 1024;
const ERROR_READ_BUDGET: Duration = Duration::from_secs(2);

fn safe_header(response: &reqwest::Response, names: &[&str]) -> Option<String> {
    names.iter().find_map(|name| {
        response
            .headers()
            .get(*name)?
            .to_str()
            .ok()
            .filter(|s| {
                !s.is_empty()
                    && s.len() <= 128
                    && s.bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"-_.:/".contains(&b))
            })
            .map(str::to_string)
    })
}

pub(crate) fn report(response: &reqwest::Response, requested: Option<&str>) -> Value {
    let mime = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let kind = if mime.starts_with("text/event-stream") {
        "sse"
    } else if mime.contains("json") {
        "json"
    } else if mime.contains("html") {
        "html"
    } else if mime.is_empty() {
        "missing"
    } else {
        "other"
    };
    json!({"httpStatus":response.status().as_u16(),"bodyKind":kind,
        "responseHost":response.url().host_str(),
        "redirected":requested.is_some_and(|url| url != response.url().as_str()),
        "gatewayRequestId":safe_header(response,&["x-phoenix-gateway-request-id","x-request-id","x-trace-id"]),
        "bxpunishPresent":response.headers().contains_key("bxpunish"),
        "bxuuidPresent":response.headers().contains_key("bxuuid")})
}

pub(crate) fn rejection(
    response: &reqwest::Response,
    requested: Option<&str>,
) -> Option<GatewayError> {
    let (code, status, label, source) = if response
        .headers()
        .get("bxpunish")
        .is_some_and(|v| !v.as_bytes().is_empty())
    {
        ("accio_waf_block", 403, "WAF_BLOCK", "gateway_edge")
    } else if response.status().is_redirection()
        || requested.is_some_and(|url| url != response.url().as_str())
    {
        (
            "accio_transport_redirect",
            502,
            "REDIRECT_RESPONSE",
            "transport",
        )
    } else {
        return None;
    };
    Some(
        GatewayError::with_status(status, format!("Accio 网关请求被拒绝（{label}）"))
            .with_code(code)
            .with_details(
                json!({"transport":report(response,requested),"transport_code":label,
            "error_metadata":{"source":source,"retryable":false,"replay_safe":false}}),
            ),
    )
}

pub(crate) async fn http_error(status: u16, response: reqwest::Response) -> GatewayError {
    if let Some(error) = rejection(&response, None) {
        return error;
    }
    let mut facts = report(&response, None);
    let mut source = response.bytes_stream();
    let mut bytes = Vec::new();
    let mut truncated = false;
    let mut failed = false;
    let result = tokio::time::timeout(ERROR_READ_BUDGET, async {
        while let Some(item) = source.next().await {
            match item {
                Ok(chunk) => {
                    let remaining = MAX_ERROR_BYTES.saturating_sub(bytes.len());
                    bytes.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
                    if bytes.len() == MAX_ERROR_BYTES {
                        truncated = true;
                        break;
                    }
                }
                Err(_) => {
                    failed = true;
                    break;
                }
            }
        }
    })
    .await;
    let timed_out = result.is_err();
    let payload: Value = if !truncated && !timed_out && !failed {
        serde_json::from_slice(&bytes).unwrap_or(Value::Null)
    } else {
        Value::Null
    };
    facts["errorBodyBytes"] = json!(bytes.len());
    facts["errorBodyTruncated"] = json!(truncated);
    facts["errorBodyTimedOut"] = json!(timed_out);
    facts["errorBodyReadFailed"] = json!(failed);
    // Non-JSON HTML/text may contain challenge tokens or account data. Only
    // structured business errors are classified; raw previews never leave here.
    let mut error = super::adk_error::from_payload(status, &payload, "上游返回错误或非 SSE 响应");
    let mut details = error.details.take().unwrap_or_else(|| json!({}));
    if let Some(object) = details.as_object_mut() {
        object.insert("transport".into(), facts);
    }
    error.with_details(details)
}

#[cfg(test)]
mod tests {
    use super::*;
    use bytes::Bytes;

    fn response(status: u16, body: reqwest::Body, headers: &[(&str, &str)]) -> reqwest::Response {
        let mut builder = axum::http::Response::builder().status(status);
        for (key, value) in headers {
            builder = builder.header(*key, *value);
        }
        reqwest::Response::from(builder.body(body).unwrap())
    }

    #[tokio::test]
    async fn waf_is_detected_before_body_and_never_refreshes_or_exposes_challenge() {
        for status in [200, 401, 403, 429] {
            let body = reqwest::Body::wrap_stream(futures::stream::pending::<
                Result<Bytes, std::io::Error>,
            >());
            let response = response(
                status,
                body,
                &[
                    ("bxpunish", "private-challenge"),
                    ("bxuuid", "private-uuid"),
                    ("x-request-id", "safe-request-id"),
                ],
            );
            let error =
                tokio::time::timeout(Duration::from_millis(100), http_error(status, response))
                    .await
                    .unwrap();
            assert_eq!(error.status_code, 403);
            assert_eq!(error.code.as_deref(), Some("accio_waf_block"));
            assert!(!super::super::session::restricted(&error));
            assert!(!super::super::session::can_refresh(&error, false));
            assert!(!super::super::adk_error::allows_replay(&error));
            assert!(!error.payload().to_string().contains("private-"));
            assert_eq!(
                error.details.as_ref().unwrap()["transport"]["gatewayRequestId"],
                "safe-request-id"
            );
        }
    }

    #[tokio::test]
    async fn error_reads_are_bounded_and_structured_auth_remains_recoverable() {
        let error = http_error(
            200,
            response(
                200,
                reqwest::Body::from(r#"{"error_code":"402","error_message":"unauthorized"}"#),
                &[("content-type", "application/json")],
            ),
        )
        .await;
        assert_eq!(error.status_code, 401);
        assert!(super::super::session::can_refresh(&error, false));
        let stream = futures::stream::once(async {
            Ok::<_, std::io::Error>(Bytes::from(vec![b'x'; MAX_ERROR_BYTES + 100]))
        })
        .chain(futures::stream::pending());
        let error = tokio::time::timeout(
            Duration::from_millis(100),
            http_error(502, response(502, reqwest::Body::wrap_stream(stream), &[])),
        )
        .await
        .unwrap();
        let facts = &error.details.as_ref().unwrap()["transport"];
        assert_eq!(facts["errorBodyTruncated"], true);
        assert_eq!(facts["errorBodyBytes"], MAX_ERROR_BYTES);
        assert!(!error.payload().to_string().contains("xxxxxxxxxx"));
        let error = http_error(
            502,
            response(
                502,
                reqwest::Body::wrap_stream(
                    futures::stream::pending::<Result<Bytes, std::io::Error>>(),
                ),
                &[],
            ),
        )
        .await;
        assert_eq!(
            error.details.as_ref().unwrap()["transport"]["errorBodyTimedOut"],
            true
        );
    }

    #[test]
    fn redirects_and_header_diagnostics_do_not_echo_sensitive_values() {
        let empty_marker = response(200, reqwest::Body::from(""), &[("bxpunish", "")]);
        assert!(rejection(&empty_marker, None).is_none());
        let response = response(
            302,
            reqwest::Body::from(""),
            &[
                ("location", "https://example.invalid/?token=private"),
                ("x-request-id", "private value"),
            ],
        );
        let error = rejection(&response, None).unwrap();
        assert_eq!(error.code.as_deref(), Some("accio_transport_redirect"));
        assert!(!error.payload().to_string().contains("private"));
        assert!(!super::super::adk_error::allows_replay(&error));
    }
}
