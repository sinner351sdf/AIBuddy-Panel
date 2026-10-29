//! Shared task actions for the queue, legacy account routes and scheduler.
use super::{billing::BillingService, task_records::ResultRow as R};
use serde_json::Value;

pub struct Control {
    pub stop: std::sync::Arc<std::sync::atomic::AtomicBool>,
    pub kind: String,
    pub automatic: bool,
    pub run_id: i64,
}
tokio::task_local! {pub static CONTROL: Control;}
pub fn should_stop() -> bool {
    CONTROL
        .try_with(|c| {
            c.stop.load(std::sync::atomic::Ordering::Relaxed)
                || (c.automatic && !super::growth_schedule::kind_enabled(&c.kind))
        })
        .unwrap_or(false)
}

pub async fn execute_refreshed(
    store: &super::account_store::AccountStore,
    service: &BillingService,
    id: &str,
    session: &Value,
    code: &str,
    mode: &str,
) -> R {
    // The worker owns the refresh/retry boundary; never replay a completed action here.
    let _ = (store, id);
    run(
        service,
        session,
        "execute_refreshed",
        serde_json::json!({"code":code,"mode":mode}),
    )
    .await
}

pub async fn recorded(
    store: &super::account_store::AccountStore,
    service: &BillingService,
    id: &str,
    code: &str,
    mode: &str,
    kind: &str,
) -> Result<Value, String> {
    let _guard = super::task_records::account_lock(id).await;
    let entry = store.get_session_by_id(id).ok_or("账号没有可用凭证")?;
    let name = entry
        .session
        .pointer("/account/nickname")
        .and_then(Value::as_str)
        .unwrap_or(id);
    let batch = format!("manual-{}", crate::server::logging::now_ms());
    let run = super::task_records::begin(&batch, id, name, "workbuddy", kind, "manual", None)?
        .ok_or("任务已登记")?;
    let stop = CONTROL
        .try_with(|control| control.stop.clone())
        .unwrap_or_else(|_| std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)));
    let result = CONTROL
        .scope(
            Control {
                stop,
                kind: kind.to_string(),
                automatic: false,
                run_id: run,
            },
            execute_refreshed(store, service, id, &entry.session, code, mode),
        )
        .await;
    let saved = super::task_records::step(run, code, &result)
        .and_then(|_| super::task_records::finish(run, result.outcome, &result.message));
    let mut value = result.json();
    value["runId"] = serde_json::json!(run);
    value["code"] = serde_json::json!(code);
    value["id"] = serde_json::json!(id);
    if saved.is_err() {
        value["recordError"] = serde_json::json!("结果已执行，记录保存失败");
    }
    Ok(value)
}

pub fn kind_valid(kind: &str) -> bool {
    matches!(kind, "growth" | "night" | "travel" | "activity" | "rewards")
}
pub fn in_night_window_at(hour: u32) -> bool {
    hour >= 23 || hour < 8
}
pub fn night_window() -> bool {
    use chrono::Timelike;
    in_night_window_at(super::beijing::now().hour())
}

/// Convert a worker result without accepting arbitrary outcome names into persistent records.
fn decode_result(value: Value) -> Result<R, String> {
    let outcome = match value.get("outcome").and_then(Value::as_str) {
        Some("success") => "success",
        Some("failed") => "failed",
        Some("already") => "already",
        Some("skipped") => "skipped",
        Some("cancelled") => "cancelled",
        Some("pending") => "pending",
        _ => return Err("插件返回了无效任务状态".into()),
    };
    let message = value
        .get("message")
        .and_then(Value::as_str)
        .ok_or("插件任务结果缺少说明")?
        .to_owned();
    Ok(R {
        outcome,
        message,
        credit: value.get("credit").and_then(Value::as_i64),
        energy: value.get("energy").and_then(Value::as_i64),
    })
}
fn record_worker_steps(value: &Value) -> Result<(), String> {
    let run = CONTROL.try_with(|control| control.run_id).unwrap_or(0);
    if run <= 0 {
        return Ok(());
    }
    let Some(steps) = value.get("steps").and_then(Value::as_array) else {
        return Ok(());
    };
    if steps.len() > 256 {
        return Err("插件子步骤过多，未写入记录".into());
    }
    for step in steps {
        let code = step
            .get("code")
            .and_then(Value::as_str)
            .filter(|code| !code.is_empty() && code.len() <= 256)
            .ok_or("插件子步骤缺少有效任务码")?;
        let result = decode_result(step.get("result").unwrap_or(step).clone())?;
        super::task_records::step(run, code, &result)?;
    }
    Ok(())
}
async fn run(service: &BillingService, session: &Value, method: &str, mut payload: Value) -> R {
    if should_stop() {
        return R::new("cancelled", "任务已停止，未启动后续动作");
    }
    if !payload.is_object() {
        payload = serde_json::json!({});
    }
    payload["control"] = CONTROL
        .try_with(|control| serde_json::json!({"automatic":control.automatic,"kind":control.kind}))
        .unwrap_or_else(|_| serde_json::json!({"automatic":false,"kind":"manual"}));
    let action = format!("aibuddy.task_execution.{method}");
    match super::billing::legacy_call::<Value>(service, session, &action, payload).await {
        Ok(value) => {
            let saved = record_worker_steps(&value);
            let mut result = decode_result(value).unwrap_or_else(|error| R::new("failed", error));
            if saved.is_err() {
                result
                    .message
                    .push_str("；动作已执行，部分子步骤记录保存失败");
            }
            result
        }
        Err(_) if should_stop() => R::new("cancelled", "插件动作已停止，后续步骤已取消"),
        Err(error) => R::new("failed", error.message),
    }
}
pub async fn execute(service: &BillingService, session: &Value, code: &str, mode: &str) -> R {
    run(
        service,
        session,
        "execute",
        serde_json::json!({"code":code,"mode":mode}),
    )
    .await
}
pub async fn travel_run(service: &BillingService, session: &Value) -> R {
    run(service, session, "travel_run", Value::Null).await
}
pub async fn activity_run(service: &BillingService, session: &Value) -> R {
    run(service, session, "activity_run", Value::Null).await
}
pub async fn rewards_run(service: &BillingService, session: &Value) -> R {
    run(service, session, "rewards_run", Value::Null).await
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn worker_outcomes_are_closed_and_keep_rewards() {
        let r = decode_result(
            serde_json::json!({"outcome":"pending","message":"verify","credit":12,"energy":3}),
        )
        .unwrap();
        assert_eq!(r.outcome, "pending");
        assert_eq!(r.credit, Some(12));
        assert_eq!(r.energy, Some(3));
        assert!(decode_result(serde_json::json!({"outcome":"unknown","message":"bad"})).is_err());
        assert!(decode_result(serde_json::json!({"outcome":"success"})).is_err());
    }
    #[tokio::test]
    async fn cancellation_prevents_dispatch() {
        let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true));
        CONTROL
            .scope(
                Control {
                    stop,
                    kind: "growth".into(),
                    automatic: false,
                    run_id: 0,
                },
                async {
                    assert!(should_stop());
                },
            )
            .await;
    }
    #[test]
    fn night_window_preserved() {
        assert!(in_night_window_at(23));
        assert!(in_night_window_at(7));
        assert!(!in_night_window_at(8));
    }
}
