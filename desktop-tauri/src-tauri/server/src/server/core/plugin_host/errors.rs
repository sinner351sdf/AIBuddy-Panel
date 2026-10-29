//! 插件控制面错误的 HTTP 状态与业务码兼容解码。

use agent2api_provider_protocol as proto;
use serde::Deserialize;

use crate::server::errors::GatewayError;

const HTTP_CODE_PREFIX: &str = "provider_http:";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ErrorMetadata {
    status: i32,
    #[serde(default)]
    code: Option<String>,
    #[serde(default)]
    upstream_code: Option<i64>,
}

pub(super) fn control_error(error: &proto::WireError) -> Option<GatewayError> {
    let payload = error.code.as_deref()?.strip_prefix(HTTP_CODE_PREFIX)?;
    let metadata: ErrorMetadata = serde_json::from_str(payload).ok()?;
    if !(400..600).contains(&metadata.status) {
        return None;
    }
    let mut failure = GatewayError::with_status(metadata.status, error.message.clone())
        .with_optional_code(metadata.upstream_code);
    failure.code = metadata.code;
    failure.details = error.details.clone();
    Some(failure)
}

/// Decode both early conversation failures and failures after streaming began.
pub(super) fn wire_gateway(error: &proto::WireError) -> GatewayError {
    control_error(error).unwrap_or_else(|| {
        let status = match error.code.as_deref() {
            Some(proto::WireError::LOCAL_PRECONDITION) => 556,
            Some(proto::WireError::NO_METHOD | proto::WireError::UNSUPPORTED) => 501,
            _ => 502,
        };
        let mut failure = GatewayError::with_status(status, error.message.clone());
        failure.code = error.code.clone();
        failure.details = error.details.clone();
        failure
    })
}

#[cfg(test)]
mod migration_tests {
    use super::*;
    #[test]
    fn keeps_adk_policy_and_http_error_identity() {
        let mut wire = proto::WireError::with_code(
            "blocked",
            "provider_http:{\"status\":403,\"code\":\"accio_policy\",\"upstreamCode\":6004}",
        );
        wire.details = Some(
            serde_json::json!({"provider":"accio","error_metadata":{"replay_safe":false,"action":"authorize_connector"}}),
        );
        let error = control_error(&wire).unwrap();
        assert_eq!(error.status_code, 403);
        assert_eq!(error.code.as_deref(), Some("accio_policy"));
        assert_eq!(error.upstream_code, Some(6004));
        assert_eq!(error.details, wire.details);
        assert!(!crate::server::core::providers::accio::adk_error::allows_replay(&error));
    }
    #[test]
    fn malformed_status_is_not_accepted_as_business_error() {
        let wire = proto::WireError::with_code("bad", "provider_http:{\"status\":200}");
        assert!(control_error(&wire).is_none());
    }
}
