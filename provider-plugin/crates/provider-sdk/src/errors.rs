//! 控制面错误在 String 回调与 RPC 之间保留 HTTP 状态和业务码。

use agent2api_provider_protocol as proto;
use serde::{Deserialize, Serialize};

const CONTROL_ERROR_PREFIX: &str = "CONTROL_ERROR:";
const HTTP_CODE_PREFIX: &str = "provider_http:";

#[derive(Serialize, Deserialize)]
struct ControlError {
    message: String,
    #[serde(flatten)]
    metadata: ErrorMetadata,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ErrorMetadata {
    status: i32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    upstream_code: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    details: Option<serde_json::Value>,
}

pub fn control_error(
    status: i32,
    message: impl Into<String>,
    code: Option<String>,
    upstream_code: Option<i64>,
) -> String {
    control_error_details(status,message,code,upstream_code,None)
}

pub fn control_error_details(status:i32,message:impl Into<String>,code:Option<String>,upstream_code:Option<i64>,details:Option<serde_json::Value>)->String {
    let error = ControlError {
        message: message.into(),
        metadata: ErrorMetadata { status, code, upstream_code, details },
    };
    if !(400..600).contains(&status) {
        return error.message;
    }
    match serde_json::to_string(&error) {
        Ok(payload) => format!("{CONTROL_ERROR_PREFIX}{payload}"),
        Err(_) => error.message,
    }
}

pub(crate) fn split_control_error(message: &str) -> Option<proto::WireError> {
    let payload = message.strip_prefix(CONTROL_ERROR_PREFIX)?;
    let error: ControlError = serde_json::from_str(payload).ok()?;
    if !(400..600).contains(&error.metadata.status) {
        return None;
    }
    let metadata = serde_json::to_string(&error.metadata).ok()?;
    let mut wire=proto::WireError::with_code(error.message, format!("{HTTP_CODE_PREFIX}{metadata}"));
    wire.details=error.metadata.details;
    Some(wire)
}

#[cfg(test)]
mod tests {
    #[test]
    fn validated_metadata_survives_control_string_and_wire_error() {
        let details=serde_json::json!({"error_metadata":{"schema_version":1,"category":"policy","retryable":false,"replay_safe":false}});
        let encoded=super::control_error_details(403,"fixture",Some("accio_account_restricted".into()),Some(423),Some(details.clone()));
        let wire=super::split_control_error(&encoded).unwrap();
        assert_eq!(wire.details,Some(details));
        assert!(wire.code.unwrap().contains("accio_account_restricted"));
        let old:agent2api_provider_protocol::WireError=serde_json::from_value(serde_json::json!({"message":"legacy","code":"internal"})).unwrap();
        assert!(old.details.is_none());
    }
}
