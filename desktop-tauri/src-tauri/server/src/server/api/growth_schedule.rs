//! 猫猫旅行定时排程的管理端点（签到页 / 设置页用）。
//!
//! ```text
//!   GET  /api/travel-schedule        开关、时刻数组、今日已执行时刻、上一轮结果
//!   POST /api/travel-schedule        改配置 { enabled?, times? }
//!   POST /api/travel-schedule/run    立即巡检一轮（真打上游）
//! ```
//!
//! ── 为什么是独立一组接口 ─────────────────────────────────────
//! 旅行与签到是**两个独立排程**（参考项目也是 `travel_hours` /
//! `checkin_hours` 两套开关与时刻）：它们服务的是不同玩法，用户可能只想
//! 自动签到、不想自动派猫。合成一组会让「关掉旅行」变成「关掉签到」的副作用。
//!
//! ── 错误信封 ────────────────────────────────────────────────
//! 与 `/api/scheduled-tasks` 同一口径：参数校验失败走**管理信封** 400
//! `{success:false,error:"…"}`，而不是 auto-checkin 那套 OpenAI 风格 body
//! （那是 Node 版历史契约，本接口是纯新增的管理 API）。
//!
//! ── 「正在执行中」────────────────────────────────────────────
//! 手动 run 撞上已有轮次在跑时返回 400 管理信封（与 `/api/scheduled-tasks`
//! 的 run 同款），前端能按一个套路处理。

use axum::body::Bytes;
use axum::extract::{State, Query};
use std::collections::HashMap;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};

use crate::server::core::growth_scheduler;
use crate::server::http::{ok_json, parse_body};
use crate::server::logging;
use crate::server::ServerState;

/// `GET /api/travel-schedule` —— 当前配置与运行状态。
pub async fn get_state(Query(query): Query<HashMap<String, String>>) -> Response {
    let state=growth_scheduler::state_for(query.get("batchId").map(String::as_str));
    if let Some(error)=state.get("error").and_then(Value::as_str) { return bad_request(error); }
    ok_json(state)
}

/// `POST /api/travel-schedule` —— 改开关与时刻（只改传进来的字段）。
pub async fn configure(body: Bytes) -> Response {
    let payload = match parse_body(&body) {
        Ok(value) => value,
        Err(error) => return bad_request(error.message),
    };
    // 空对象视为「没有需要更新的字段」：与 /api/scheduled-tasks 同一取舍
    let has_field = payload
        .as_object()
        .map(|object| object.contains_key("enabled") || object.contains_key("times"))
        .unwrap_or(false);
    if !has_field {
        return bad_request("没有需要更新的字段（enabled / times）");
    }
    match growth_scheduler::configure(&payload) {
        Ok(state) => {
            let enabled = state.get("enabled").and_then(Value::as_bool).unwrap_or(false);
            let times = state
                .get("times")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .collect::<Vec<_>>()
                        .join(" / ")
                })
                .unwrap_or_default();
            logging::log(
                "[Travel]",
                &format!(
                    "猫猫旅行排程已{}，时刻 {times}",
                    if enabled { "开启" } else { "关闭" }
                ),
            );
            ok_json(state)
        }
        Err(message) => bad_request(message),
    }
}

/// `POST /api/travel-schedule/run` —— 立即巡检一轮。
///
/// 入队成功后返回 batchId；完成摘要通过 GET ?batchId=… 查询，避免把入队当成执行完成。
pub async fn run_now(State(state): State<ServerState>) -> Response {
    let queue = crate::server::core::growth_queue::global(state.store().clone(), state.billing().clone());
    match queue.run_selected(1, None, crate::server::core::growth_queue::RunOptions { kind: "travel".into(), ..Default::default() }).await {
        Ok(0) => ok_json(json!({"queued":0,"batchId":null,"summary":{"accounts":0,"actions":[],"credit":null,"failed":0,"running":false},"schedule":growth_scheduler::state()})),
        Ok(queued) => {
            let snapshot=queue.state();
            let batch=snapshot["items"].as_array().and_then(|items|items.first()).and_then(|item|item["runId"].as_i64()).and_then(|id|crate::server::core::task_records::detail(id).ok().flatten()).and_then(|row|row["batchId"].as_str().map(str::to_string));
            ok_json(json!({"queued":queued,"batchId":batch,"summary":null,"schedule":growth_scheduler::state_for(batch.as_deref())}))
        }
        Err(()) => bad_request("已有任务正在执行，请稍候"),
    }
}

/// 管理信封的 400（`{success:false,error}`），并打一行日志。
fn bad_request(message: impl Into<String>) -> Response {
    let message = message.into();
    logging::log("[Travel]", &format!("❌ {message}"));
    (
        StatusCode::BAD_REQUEST,
        Json(json!({ "success": false, "error": message })),
    )
        .into_response()
}
