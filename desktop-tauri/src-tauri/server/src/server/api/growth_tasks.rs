//! 「WorkBuddy 成长任务」路由处理器（路由在 http.rs 由主会话接线，本文件
//! 只提供 handler 与响应形状）。
//!
//!   GET  /api/growth-tasks/scan     全账号任务扫描（只读；全部任务带状态）
//!   POST /api/growth-tasks/run      启动执行队列 {concurrency?, accountId?}（running 时 409）
//!   GET  /api/growth-tasks/accounts/{id}         单账号任务列表
//!   POST /api/growth-tasks/accounts/{id}/accept  接受任务 {code} 或 {all:true}
//!   POST /api/growth-tasks/accounts/{id}/claim   达标领奖 {code}
//!   GET  /api/growth-tasks/queue    队列进度（前端 3s 轮询）
//!   POST /api/growth-tasks/stop     尽力取消（当前项完成后停）
//!   POST /api/growth-tasks/trial    国际版一次性 trial 加油包 {accountId}
//!   POST /api/growth-tasks/gift     新手礼包/活动补偿 {accountId, kind}
//!   GET  /api/growth-tasks/schedule 调度设置（开关/时点，默认全关）
//!   PUT  /api/growth-tasks/schedule 保存调度设置 {streakEnabled?, growthEnabled?,
//!                                    growthTime?, travelEnabled?, travelHours?,
//!                                    blackcatEnabled?, blackcatTime?}
//!
//! ── 响应形状 ────────────────────────────────────────────────
//! 全部走管理 API 信封 `{success:true, data}` / `management_error`：
//! 这些都是本壳新增端点（无 Node 版对齐项），与 probe_api / scheduled_tasks
//! 的管理信封一致，**不**沿用 api::billing 的 OpenAI 风格 body（那是 Node
//! 大 try 落点的复刻，仅存量计费路由保持）。
//!
//! ── 审计埋点 ────────────────────────────────────────────────
//! scan / run / stop / schedule / trial / gift 在 handler 层埋
//! （`audit_api::audit`，事件标识 `growth.*`）；队列跑完的 `growth.complete`
//! 在 core::growth_queue 的收尾任务里埋（那里才知道真正的完成时刻）；
//! 定时调度触发（growth/blackcat/travel）在 core::growth_schedule 落 [Growth]
//! 日志（低频后台动作，不入审计流）。
//!
//! ── trial / gift 的 edition 闸 ─────────────────────────────
//! trial 仅国际版（refs trial.go:2-3：CN 无 /billing/ide/trial 端点）；
//! gift 仅国内版（refs scheduler/streak.go 的 D4 门控：global 不发起 CN
//! 计费域调用）。非对应版本直接 400，不发上游请求。

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::response::Response;
use serde_json::{json, Value};

use crate::server::api::audit_api::audit;
use crate::server::core::billing::gift::GiftKind;
use crate::server::core::billing::{gift, growth, trial};
use crate::server::core::growth_queue::{self, GrowthQueue};
use crate::server::core::growth_schedule;
use crate::server::errors;
use crate::server::http::{ok_json, parse_body};
use crate::server::logging;
use crate::server::ServerState;

/// 取全局队列句柄（首次调用以 ServerState 的 store/billing 初始化）。
fn queue_of(state: &ServerState) -> GrowthQueue {
    growth_queue::global(state.store().clone(), state.billing().clone())
}

/// 解析 body 里的对象；空 body 视为 {}。
fn parse_object(body: &Bytes) -> Result<Value, Response> {
    match parse_body(body) {
        Ok(value) if value.is_object() => Ok(value),
        Ok(_) => Err(errors::management_error(400, "请求体必须是 JSON 对象")),
        Err(error) => Err(errors::management_error(400, error.message)),
    }
}

/// GET /api/growth-tasks/scan —— 全账号任务扫描（只读）
pub async fn scan(State(state): State<ServerState>) -> Response {
    let data = queue_of(&state).scan().await;
    let accounts = data
        .get("results")
        .and_then(Value::as_array)
        .map(|items| items.len())
        .unwrap_or(0);
    audit("growth.scan", &format!("扫描 {accounts} 个账号的成长任务"));
    ok_json(data)
}

/// POST /api/growth-tasks/run —— 全账号队列或指定 accountId 的单账号队列。
pub async fn run(State(state): State<ServerState>, body: Bytes) -> Response {
    let payload = match parse_object(&body) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let concurrency = payload
        .get("concurrency")
        .and_then(Value::as_u64)
        .unwrap_or(growth_queue::DEFAULT_CONCURRENCY as u64) as usize;
    let selected = match payload.get("accountId") {
        None => None,
        Some(Value::String(id)) if !id.trim().is_empty() => Some(id.clone()),
        Some(_) => return errors::management_error(400, "accountId 必须是非空字符串"),
    };
    if let Some(id) = selected.as_deref() {
        if let Err(response) = account_session(&state, id) { return response; }
    }
    let queue = queue_of(&state);
    let result = match selected.as_deref() {
        Some(id) => queue.run_for_account(id).await,
        None => queue.run(concurrency).await,
    };
    match result {
        Ok(total) => {
            audit(
                "growth.run",
                &format!("成长任务队列启动（{total} 项待办，范围 {}）", selected.as_deref().unwrap_or("全部账号")),
            );
            ok_json(json!({ "started": true, "total": total }))
        }
        Err(()) => {
            logging::log("[Growth]", "❌ 队列已在执行中，拒绝重复启动");
            errors::management_error(409, "成长任务队列正在执行中，请等本轮结束后再试")
        }
    }
}

/// Provider and edition checks precede credential resolution and all upstream calls.
fn account_session(state: &ServerState, id: &str) -> Result<Value, Response> {
    let snapshot = state.store().list_accounts();
    let account = snapshot.get("accounts").and_then(Value::as_array)
        .and_then(|items| items.iter().find(|item| item.get("id").and_then(Value::as_str) == Some(id)))
        .ok_or_else(|| errors::management_error(404, "账号不存在"))?;
    if !is_cn_workbuddy(account) {
        return Err(errors::management_error(400, "成长任务仅支持 WorkBuddy 国内版账号"));
    }
    let session = state.store().get_session_by_id(id)
        .ok_or_else(|| errors::management_error(404, "账号没有可用凭证"))?.session;
    if session.get("edition").and_then(Value::as_str) == Some("intl") {
        return Err(errors::management_error(400, "成长任务仅支持 WorkBuddy 国内版账号"));
    }
    Ok(session)
}

fn is_cn_workbuddy(account: &Value) -> bool {
    account.get("provider").and_then(Value::as_str) == Some("workbuddy")
        && account.get("edition").and_then(Value::as_str) != Some("intl")
}

fn detail_json(task: &growth::Task) -> Value {
    let mut value = growth::task_scan_json(task);
    value["title"] = json!(task.title);
    value["description"] = json!(task.task_desc);
    value["tag"] = json!(task.tag);
    value["accepted"] = json!(matches!(task.accept_status.as_str(), "accepted" | "completed" | "claimed"));
    value["automatable"] = json!(growth::is_actionable(&task.task_code));
    value
}

/// Single-account task details; reading the list does not accept, execute or claim.
pub async fn account_tasks(State(state): State<ServerState>, Path(id): Path<String>) -> Response {
    let session = match account_session(&state, &id) { Ok(value) => value, Err(error) => return error };
    match growth::list_tasks_merged(state.billing(), &session).await {
        Ok(tasks) => ok_json(json!({"accountId":id,"queriedAt":logging::now_ms(),
            "tasks":tasks.iter().map(detail_json).collect::<Vec<_>>()})),
        Err(error) => errors::management_error(error.status_code, error.message),
    }
}

/// Accept one listed task or all unlocked, unclaimed tasks on this account.
pub async fn accept_account_tasks(State(state): State<ServerState>, Path(id): Path<String>, body: Bytes) -> Response {
    let payload = match parse_object(&body) { Ok(value) => value, Err(error) => return error };
    let code = payload.get("code").and_then(Value::as_str).filter(|code| !code.is_empty());
    if code.is_none() && payload.get("all").and_then(Value::as_bool) != Some(true) {
        return errors::management_error(400, "请指定 code 或 all: true");
    }
    let session = match account_session(&state, &id) { Ok(value) => value, Err(error) => return error };
    let tasks = match growth::list_tasks_merged(state.billing(), &session).await {
        Ok(tasks) => tasks, Err(error) => return errors::management_error(error.status_code, error.message),
    };
    if code.is_some_and(|code| !tasks.iter().any(|task| task.task_code == code)) {
        return errors::management_error(400, "该账号的任务列表中没有此任务");
    }
    let pending: Vec<_> = tasks.iter().filter(|task| !task.claimed && !task.locked
        && !matches!(task.accept_status.as_str(), "accepted" | "completed")
        && code.is_none_or(|code| task.task_code == code)).collect();
    for mp in [false, true] {
        let codes = pending.iter().filter(|task| growth::is_mp_task_code(&task.task_code) == mp)
            .map(|task| task.task_code.clone()).collect::<Vec<_>>();
        if let Err(error) = growth::accept_tasks_batched(state.billing(), &session, &codes, mp).await {
            return errors::management_error(error.status_code, error.message);
        }
    }
    audit("growth.accept", &format!("账号 {id} 接受任务 {} 项", pending.len()));
    ok_json(json!({"accepted":pending.len()}))
}

pub async fn claim_account_task(State(state): State<ServerState>, Path(id): Path<String>, body: Bytes) -> Response {
    let payload = match parse_object(&body) { Ok(value) => value, Err(error) => return error };
    let Some(code) = payload.get("code").and_then(Value::as_str).filter(|code| !code.is_empty()) else {
        return errors::management_error(400, "code 必填");
    };
    let session = match account_session(&state, &id) { Ok(value) => value, Err(error) => return error };
    let tasks = match growth::list_tasks_merged(state.billing(), &session).await {
        Ok(tasks) => tasks, Err(error) => return errors::management_error(error.status_code, error.message),
    };
    let Some(task) = tasks.iter().find(|task| task.task_code == code) else {
        return errors::management_error(400, "该账号的任务列表中没有此任务");
    };
    if task.claimed { return ok_json(json!({"claimed":true,"already":true})); }
    if task.locked || !task.claimable { return errors::management_error(400, "任务进度尚未达标或仍未解锁"); }
    match growth::claim_reward(&session, code, growth::is_mp_task_code(code)).await {
        Ok(reward) => {
            audit("growth.claim", &format!("账号 {id} 领取任务 {code}"));
            ok_json(json!({"claimed":true,"already":reward.already_claimed,"credit":reward.credit,"energy":reward.energy}))
        }
        Err(error) => errors::management_error(error.status_code, error.message),
    }
}

/// GET /api/growth-tasks/queue —— 队列进度（前端 3s 轮询）
pub async fn queue(State(state): State<ServerState>) -> Response {
    ok_json(queue_of(&state).state())
}

/// POST /api/growth-tasks/stop —— 尽力取消（当前项完成后停）
pub async fn stop(State(state): State<ServerState>) -> Response {
    queue_of(&state).stop();
    audit("growth.stop", "请求停止成长任务队列（当前项完成后停）");
    ok_json(json!({ "stopped": true }))
}

/// GET /api/growth-tasks/schedule —— 调度设置回显（开关/时点/默认全关）
pub async fn get_schedule(State(_state): State<ServerState>) -> Response {
    match growth_schedule::read_config() {
        Ok(config) => ok_json(growth_schedule::config_json(&config)),
        Err(error) => errors::management_error(503, format!("调度配置不可用: {error}")),
    }
}

/// PUT /api/growth-tasks/schedule —— 保存调度设置（部分字段可省）
pub async fn put_schedule(State(_state): State<ServerState>, body: Bytes) -> Response {
    let payload = match parse_object(&body) {
        Ok(value) => value,
        Err(response) => return response,
    };
    match growth_schedule::write_config(&payload) {
        Ok(config) => {
            audit("growth.schedule", "调度设置已更新");
            ok_json(config)
        }
        Err(error) => errors::management_error(400, error),
    }
}

// Provider identity is mandatory: other providers can also have edition="intl".
// Never send their credentials to WorkBuddy billing endpoints.
fn is_workbuddy_account(state: &ServerState, id: &str) -> bool {
    state.store().list_accounts().get("accounts").and_then(Value::as_array)
        .is_some_and(|accounts| accounts.iter().any(|account| {
            account.get("id").and_then(Value::as_str) == Some(id)
                && matches!(account.get("provider").and_then(Value::as_str),
                    Some("workbuddy" | "workbuddy-intl"))
        }))
}

/// POST /api/growth-tasks/trial —— 国际版一次性 trial 加油包（{accountId}）
pub async fn trial(State(state): State<ServerState>, body: Bytes) -> Response {
    let payload = match parse_object(&body) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let Some(account_id) = payload
        .get("accountId")
        .and_then(Value::as_str)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
    else {
        return errors::management_error(400, "accountId 必填");
    };
    if !is_workbuddy_account(&state, &account_id) {
        return errors::management_error(400, "该动作仅限 WorkBuddy 账号");
    }
    let Some(entry) = state.store().get_session_by_id(&account_id) else {
        return errors::management_error(404, "账号不存在或没有可用凭证");
    };
    // edition 闸：trial 仅国际版（CN 无此端点，refs trial.go:2-3）
    if entry.session.get("edition").and_then(Value::as_str) != Some("intl") {
        return errors::management_error(400, "该动作仅限国际版账号");
    }
    match trial::claim_trial(state.billing(), &entry.session).await {
        Ok(outcome) => {
            audit(
                "growth.trial",
                &format!("账号 {account_id} trial 加油包: {}", outcome.message),
            );
            ok_json(json!({
                "claimed": outcome.claimed,
                "message": outcome.message,
            }))
        }
        Err(error) => errors::management_error(error.status_code, error.message),
    }
}

/// POST /api/growth-tasks/gift —— 新手礼包/活动补偿（{accountId, kind}）
pub async fn gift(State(state): State<ServerState>, body: Bytes) -> Response {
    let payload = match parse_object(&body) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let Some(account_id) = payload
        .get("accountId")
        .and_then(Value::as_str)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
    else {
        return errors::management_error(400, "accountId 必填");
    };
    let Some(kind) = payload
        .get("kind")
        .and_then(Value::as_str)
        .and_then(GiftKind::parse)
    else {
        return errors::management_error(400, "kind 必须是 gift 或 compensation");
    };
    if !is_workbuddy_account(&state, &account_id) {
        return errors::management_error(400, "该动作仅限 WorkBuddy 账号");
    }
    let Some(entry) = state.store().get_session_by_id(&account_id) else {
        return errors::management_error(404, "账号不存在或没有可用凭证");
    };
    // edition 闸：礼包/补偿挂 CN 计费域（refs scheduler/streak.go 的 D4 门控：
    // 国际版账号不发起 CN 计费调用）
    if entry.session.get("edition").and_then(Value::as_str) == Some("intl") {
        return errors::management_error(400, "该动作仅限国内版账号");
    }
    match gift::claim_gift(state.billing(), &entry.session, kind).await {
        Ok(outcome) => {
            audit(
                "growth.gift",
                &format!("账号 {account_id} {}: {}", kind_label(kind), outcome.message),
            );
            ok_json(json!({
                "claimed": outcome.claimed,
                "already": outcome.already,
                "credit": outcome.credit,
                "message": outcome.message,
            }))
        }
        Err(error) => errors::management_error(error.status_code, error.message),
    }
}

/// 审计文案里的动作名。
fn kind_label(kind: GiftKind) -> &'static str {
    match kind {
        GiftKind::Gift => "新手礼包",
        GiftKind::Compensation => "活动补偿",
    }
}

#[cfg(test)]
mod account_task_tests {
    use super::*;

    #[test]
    fn account_tasks_never_use_other_providers_or_international_accounts() {
        assert!(is_cn_workbuddy(&json!({"provider":"workbuddy","edition":"cn"})));
        assert!(is_cn_workbuddy(&json!({"provider":"workbuddy"})));
        for account in [json!({}), json!({"provider":"raccoon"}),
            json!({"provider":"workbuddy-intl","edition":"intl"}),
            json!({"provider":"workbuddy","edition":"intl"})] {
            assert!(!is_cn_workbuddy(&account));
        }
    }

    #[test]
    fn task_details_expose_progress_and_actual_acceptance_state() {
        let mut task = growth::Task { task_code: "chat_5".into(), current: 3, target: 5,
            credit: 100, energy: 5, accept_status: "accepted".into(), ..Default::default() };
        let detail = detail_json(&task);
        assert_eq!(detail["current"], 3);
        assert_eq!(detail["target"], 5);
        assert_eq!(detail["rewardCredit"], 100);
        assert_eq!(detail["accepted"], true);
        assert_eq!(detail["automatable"], true);
        task.accept_status = "pending".into();
        task.task_code = "unknown_manual_task".into();
        let detail = detail_json(&task);
        assert_eq!(detail["accepted"], false);
        assert_eq!(detail["automatable"], false);
    }
}
