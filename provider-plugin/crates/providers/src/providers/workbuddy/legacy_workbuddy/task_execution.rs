//! Shared task actions for the queue, legacy account routes and scheduler.
use super::{
    billing::{growth, report, streak, travel, BillingService},
    growth_actions::{self, ActionOutcome},
    ResultRow as R,
};
use serde_json::Value;
use std::time::Duration;

/// Cancellation is owned by the SDK call task; dropping it cancels this action chain.
pub struct Control{pub stop:std::sync::Arc<std::sync::atomic::AtomicBool>,pub kind:String,pub automatic:bool,pub run_id:i64}
tokio::task_local!{pub static CONTROL:Control;}
tokio::task_local!{pub static TASK_STEPS:std::cell::RefCell<Vec<Value>>;}
/// Runtime-only execution context and substep collection. The host persists rows.
pub async fn with_control<F>(payload:&Value,future:F)->Result<Value,crate::errors::GatewayError>
where F:std::future::Future<Output=Result<Value,crate::errors::GatewayError>> {
 let control=payload.get("control").unwrap_or(&Value::Null);
 let control=Control{stop:std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),kind:control.get("kind").and_then(Value::as_str).unwrap_or("").into(),automatic:control.get("automatic").and_then(Value::as_bool).unwrap_or(false),run_id:0};
 CONTROL.scope(control,TASK_STEPS.scope(std::cell::RefCell::new(Vec::new()),async {
    let mut value=future.await?;
    value["steps"]=TASK_STEPS.with(|rows|Value::Array(rows.borrow().clone()));
    Ok(value)
 })).await
}
pub fn should_stop()->bool {CONTROL.try_with(|c|c.stop.load(std::sync::atomic::Ordering::Relaxed)).unwrap_or(false)}

pub fn kind_valid(kind: &str) -> bool {
    matches!(kind, "growth" | "night" | "travel" | "activity" | "rewards")
}
pub fn in_night_window_at(hour: u32) -> bool {
    hour >= 23 || hour < 8
}
pub fn night_window() -> bool {
    use chrono::Timelike;
    in_night_window_at(crate::beijing::now().hour())
}

pub async fn execute(service: &BillingService, session: &Value, code: &str, mode: &str) -> R {
    if should_stop() {
        return R::new("cancelled", "任务已停止，未开始后续步骤");
    }
    match code {
        "@travel" => return travel_run(service, session).await,
        "@activity" if mode == "claim" => return activity_verify_only(service, session).await,
        "@activity" => return activity_run(service, session).await,
        "@rewards" => return rewards_run(service, session).await,
        _ => {}
    }
    let mut lookup = growth::task_by_code(service, session, code).await;
    for delay in [1, 3] {
        if lookup.as_ref().err().is_some_and(|e| e.status_code >= 500) {
            tokio::time::sleep(Duration::from_secs(delay)).await;
            lookup = growth::task_by_code(service, session, code).await;
        }
    }
    let mut task = match lookup {
        Ok(Some(task)) => task,
        Ok(None) => return R::new("skipped", "上游未下发此任务"),
        Err(e) => return R::new("failed", e.message),
    };
    if task.claimed {
        return R::new("already", "奖励已领取");
    }
    if task.locked {
        return R::new("skipped", "任务未解锁");
    }
    if !task.claimable {
        if mode == "claim" {
            return R::new("skipped", "进度未达标，仅领奖模式不执行动作");
        }
        if !growth::is_actionable(code) {
            return R::new("skipped", "此任务需要真实操作，暂无自动化支持");
        }
        if code == "black_cat" && !night_window() {
            return R::new("skipped", "不在北京时间 23:00–08:00 夜猫窗口");
        }
        if !task.is_registered() {
            task = match growth::accept_verified_task(service, session, code).await {
                Ok(fresh) => fresh,
                Err(_) if should_stop() => {
                    return R::new("cancelled", "接受任务确认已停止，未执行后续动作")
                }
                Err(error) => {
                    return R::new(
                        "failed",
                        format!(
                            "接受任务未确认生效：{}（HTTP {}）",
                            error.message, error.status_code
                        ),
                    )
                }
            };
        }
        if task.claimed {
            return R::new("already", "回读确认奖励已领取，未重复执行动作");
        }
        if task.locked {
            return R::new("skipped", "回读确认任务未解锁，未执行动作");
        }
        if !task.claimable {
            match growth_actions::run_action(service, session, code, &task).await {
                Ok(ActionOutcome::Done) => {}
                Ok(ActionOutcome::Skipped(_)) if should_stop() => {
                    return R::new("cancelled", "已停止后续动作")
                }
                Ok(ActionOutcome::Skipped(msg)) => return R::new("skipped", msg),
                Err(e)
                    if e.status_code >= 500
                        && (e.message.contains("超时")
                            || e.message.to_lowercase().contains("timeout")) =>
                {
                    return R::new(
                        "pending",
                        "动作请求结果不明，需核实进度；未重发可能扣费的请求",
                    )
                }
                Err(_) if should_stop() => {
                    return R::new("cancelled", "任务已停止，未发送后续请求")
                }
                Err(e) => return R::new("failed", e.message),
            }
            match growth::task_by_code_waiting(service, session, code).await {
                Ok(Some(after)) if after.claimed => return R::new("already", "上游确认奖励已领取"),
                Ok(Some(after)) if after.claimable => {}
                Ok(Some(after)) => return R::new("pending", format!("动作已提交，上游进度 {}/{}，尚未确认达标；不立即重复动作", after.current, after.target)),
                Ok(None) => return R::new("pending", "动作已提交，上游暂未返回该任务；需核实后再执行"),
                Err(_) => return R::new("pending", "动作已提交，进度回读失败，需核实后再执行"),
            }
        }
    }
    if should_stop() {
        return R::new("cancelled", "当前动作结束，后续领奖已停止");
    }
    match growth::claim_reward(session, code, growth::is_mp_task_code(code)).await {
        Ok(reward) => R {
            outcome: if reward.already_claimed {
                "already"
            } else {
                "success"
            },
            message: if reward.already_claimed {
                "奖励已领取".into()
            } else {
                "奖励领取成功".into()
            },
            credit: reward.credit_known.then_some(reward.credit),
            energy: reward.energy_known.then_some(reward.energy),
        },
        Err(e) => R::new(
            "failed",
            format!("领奖失败：{}；下次先查询领取状态", e.message),
        ),
    }
}

pub async fn travel_run(service: &BillingService, session: &Value) -> R {
    let buddy = match travel::buddy_info(service, session).await {
        Ok(b) => b,
        Err(e) => return R::new("failed", e.message),
    };
    let Some(_buddy) = buddy else {
        let uid = session
            .pointer("/account/uid")
            .and_then(Value::as_str)
            .unwrap_or("");
        let text = travel::travel_account_once(service, session, uid).await;
        return R::new(
            if text.contains("失败") {
                "failed"
            } else if text.contains("已领取") {
                "success"
            } else {
                "skipped"
            },
            text,
        );
    };
    let state = match travel::travel_status(service, session).await {
        Ok(s) => s,
        Err(e) => return R::new("failed", e.message),
    };
    match state.state.as_str() {
        "arrived" => {
            if state.record_id <= 0 {
                return R::new("skipped", "已到站但缺少记录编号，未领奖");
            }
            let credit = match travel::travel_claim_known(service, session, state.record_id).await {
                Ok(c) => c,
                Err(e) => return R::new("failed", e.message),
            };
            let mut result = R::new("success", "旅行奖励已领取");
            result.credit = credit;
            match travel::travel_status(service, session).await {
                Ok(next) if next.state == "idle" && !next.daily_limit_reached => {
                    match travel::travel_depart(service, session).await {
                        Ok(()) => result.message.push_str("，已接续派出旅行"),
                        Err(_) => result.message.push_str("；接续派出未确认，下次先查询状态"),
                    }
                }
                Err(_) => result.message.push_str("；后续状态未取到"),
                _ => {}
            }
            result
        }
        "idle" if !state.daily_limit_reached => match travel::travel_depart(service, session).await
        {
            Ok(()) => R::new("success", "已派出旅行"),
            Err(e) => R::new("failed", e.message),
        },
        "idle" => R::new("skipped", "今日已派出过"),
        "traveling" => R::new("skipped", "猫猫在旅行途中"),
        _ => R::new("skipped", "未知旅行状态，未执行写操作"),
    }
}

async fn activity_verify_only(service: &BillingService, session: &Value) -> R {
    if session.get("edition").and_then(Value::as_str) != Some("intl")
        && streak::active_today(service, session)
            .await
            .unwrap_or(false)
    {
        return R::new("already", "回读已确认今日活跃；未重发上报");
    }
    R::new(
        "pending",
        "仅回查未确认今日活跃；中断恢复或仅领奖模式不重发事件",
    )
}

pub async fn activity_run(service: &BillingService, session: &Value) -> R {
    let intl = session.get("edition").and_then(Value::as_str) == Some("intl");
    if !intl
        && streak::active_today(service, session)
            .await
            .unwrap_or(false)
    {
        return R::new("already", "上游已确认今日活跃，无需重复上报");
    }
    let conversation = format!("agent2api-activity-{}", crate::logging::now_ms());
    if let Err(e) = report::report_chat_activity(service, session, &conversation, "", "", "").await
    {
        return R::new("failed", e.message);
    }
    if intl {
        return R::new("pending", "活跃事件已提交；国际版暂无当天计入验证接口");
    }
    // Elapsed checkpoints: 2s, 5s, 10s. Never send another event on failed verification.
    for gap in [2, 3, 5] {
        tokio::time::sleep(Duration::from_secs(if cfg!(test) { 0 } else { gap })).await;
        if streak::active_today(service, session)
            .await
            .unwrap_or(false)
        {
            travel::allow_adopt_retry(session);
            return R::new("success", "上游当天热力图已确认活跃");
        }
    }
    R::new(
        "pending",
        "活跃事件已提交，未验证计入；未补发事件或模型对话",
    )
}
fn reward_step(code:&str,result:&R){
 let mut row=result.json();row["code"]=serde_json::json!(code);
 let _=TASK_STEPS.try_with(|rows|rows.borrow_mut().push(row.clone()));
 crate::logging::log("[WorkBuddy Task Step]",&row.to_string());
}
pub async fn rewards_run(service: &BillingService, session: &Value) -> R {
    let mut claimed = 0;
    let mut failed = 0;
    for kind in [
        super::billing::gift::GiftKind::Gift,
        super::billing::gift::GiftKind::Compensation,
    ] {
        if should_stop() {
            return R::new("cancelled", "奖励领取已停止");
        }
        match super::billing::gift::claim_gift(service, session, kind).await {
            Ok(g) => {
                let mut r = R::new(if g.claimed { "success" } else { "already" }, g.message);
                r.credit = g.credit_known.then_some(g.credit);
                reward_step("gift", &r);
                if g.claimed {
                    claimed += 1;
                }
            }
            Err(e) => {
                failed += 1;
                reward_step("gift", &R::new("failed", e.message));
            }
        }
    }
    match streak::streak_full(service, session).await {
        Ok(full) => {
            for tier in full.tiers {
                if !matches!(
                    tier.status.as_str(),
                    "available" | "unclaimed" | "claimable" | "unlocked" | "ready"
                ) || tier.tier.is_empty()
                {
                    continue;
                }
                if should_stop() {
                    break;
                }
                match streak::redeem_tier(service, session, &tier.tier).await {
                    Ok(()) => {
                        claimed += 1;
                        reward_step(
                            &tier.tier,
                            &R::new(
                                "success",
                                "已兑换达标档位；奖励金额未返回，不以任务标称值记账",
                            ),
                        );
                    }
                    Err(e) => {
                        failed += 1;
                        reward_step(&tier.tier, &R::new("failed", e.message));
                    }
                }
            }
        }
        Err(e) => {
            failed += 1;
            reward_step("streak", &R::new("failed", e.message));
        }
    }
    match growth::list_tasks_merged(service, session).await {
        Ok(tasks) => {
            for task in tasks
                .into_iter()
                .filter(|t| t.claimable && !t.claimed && !t.locked)
            {
                if should_stop() {
                    break;
                }
                let r = Box::pin(execute(service, session, &task.task_code, "claim")).await;
                if r.outcome == "success" {
                    claimed += 1;
                }
                if r.outcome == "failed" {
                    failed += 1;
                }
                reward_step(&task.task_code, &r);
            }
        }
        Err(e) => {
            failed += 1;
            reward_step("claim-scan", &R::new("failed", e.message));
        }
    }
    R::new(
        if failed > 0 {
            "failed"
        } else if claimed > 0 {
            "success"
        } else {
            "skipped"
        },
        format!("领取{claimed}项，失败{failed}项；未使用补签卡或抽奖机会"),
    )
}


#[cfg(test)] mod reward_policy_and_history_tests {
 use super::*; use serde_json::json;
 #[tokio::test] async fn rewards_keep_substeps_and_never_spend_cards_or_draw(){
  let billing=BillingService::mock(|url,_|{assert!(!url.contains("lottery"));assert!(!url.contains("makeup"));Ok(if url.ends_with("/streak"){json!({"streak":{"days":28},"makeup_cards":{"balance":10},"redemption_status":{"tiers":[]}})}else if url.contains("/tasks"){json!({"tasks":[]})}else{json!({"credit":100})})});
  let payload=json!({"control":{"automatic":true,"kind":"rewards"}});
  let value=with_control(&payload,async{assert!(CONTROL.with(|c|c.automatic));assert_eq!(CONTROL.with(|c|c.kind.clone()),"rewards");Ok(rewards_run(&billing,&json!({"edition":"cn"})).await.json())}).await.unwrap();
  assert_eq!(value["outcome"],"success");assert!(value["credit"].is_null());
  let rows=value["steps"].as_array().unwrap();assert!(rows.len()>=2);
  for row in rows {for key in ["code","outcome","message","credit","energy"]{assert!(row.get(key).is_some(),"missing {key}");}}
 }
}
