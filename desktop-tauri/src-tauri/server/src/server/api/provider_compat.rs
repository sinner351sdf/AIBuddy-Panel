//! Compatibility routes retain old Cline key URLs and delegate execution to plugins.
use crate::server::{errors::management_error, http::ok_json, ServerState};
use axum::{
    extract::{Path, State},
    response::Response,
};
use serde_json::{json, Value};
async fn action(state: &ServerState, id: &str, action: &str, payload: Value) -> Response {
    let Some(_entry) = state.store().get_session_by_id(id) else {
        return management_error(404, "账号不存在");
    };
    if state.store().account_provider_of(id).as_deref() != Some("cline") {
        return management_error(400, "该账号不是 Cline 账号");
    }
    let Some(adapter) = crate::server::core::providers::adapter::adapter_by_id("cline") else {
        return management_error(503, "Cline 提供商插件未启用");
    };
    match adapter
        .admin_action(state.store(), id, action, &payload)
        .await
    {
        Ok(value) => ok_json(value),
        Err(error) => management_error(error.status_code, error.message),
    }
}
pub async fn cline_keys_list(State(state): State<ServerState>, Path(id): Path<String>) -> Response {
    action(&state, &id, "keys.list", Value::Null).await
}
pub async fn cline_keys_delete(
    State(state): State<ServerState>,
    Path((id, key)): Path<(String, String)>,
) -> Response {
    action(&state, &id, "keys.delete", json!({"keyId":key})).await
}
