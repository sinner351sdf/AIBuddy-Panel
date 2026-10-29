//! 按上游模型选择套餐；额度与冷却都不能跨通道共享。
use serde_json::Value;

use super::{plan_of, PLAN_AUTO, PLAN_CODING, PLAN_START};
use crate::logging;
use std::collections::HashMap;
use std::sync::{Mutex,OnceLock};

/// 在一次发送中冻结通道，避免余额刷新改变成功清理/失败记账的键。
pub const RESOLVED_FIELD: &str = "zcodeResolvedPlan";

pub fn cooldown_key(plan: &str, model: &str) -> String {
    format!("{plan}::{model}")
}

pub fn reset_at(account: &Value, plan: &str, model: &str, now: i64) -> i64 {
    let limits = &account["rateLimits"];
    let scoped = limits[cooldown_key(plan, model)]["resetAt"]
        .as_f64()
        .unwrap_or(0.0);
    // 升级前只有模型名：当时手选 Start 的记录归 Start，其余归 Coding。
    let legacy_plan = if plan_of(account) == PLAN_START {
        PLAN_START
    } else {
        PLAN_CODING
    };
    let legacy = if plan == legacy_plan {
        limits[model]["resetAt"].as_f64().unwrap_or(0.0)
    } else {
        0.0
    };
    let reset = scoped.max(legacy) as i64;
    if reset > now {
        reset
    } else {
        0
    }
}

fn number(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str()?.parse().ok())
        .filter(|n| n.is_finite())
}

fn not_expired(value: &Value, key: &str, now: f64) -> bool {
    number(&value[key]).is_none_or(|end| end <= 0.0 || end > now)
}

fn live_plan(plan: &Value, now: f64) -> bool {
    let name = plan["plan_id"].as_str().unwrap_or("").to_ascii_lowercase();
    let label = plan["name"].as_str().unwrap_or("").to_ascii_lowercase();
    (name.contains("start-plan") || label.contains("start plan"))
        && plan["status"].as_str() == Some("active")
        && not_expired(plan, "ends_at", now)
}

/// 使用 billing 的真实 remaining_units 和 model: 能力，不以 grant/总余额冒充余量。
/// 未查询、无归属、待生效、过期或没有该模型桶时 None；已耗尽的桶返回 Some(0)。
pub fn start_remaining(usage: &Value, model: &str, now_ms: i64) -> Option<f64> {
    let raw = &usage["raw"];
    let plans = raw["plans"].as_array()?;
    let buckets = raw["balances"].as_array()?;
    let now = now_ms as f64 / 1000.0;
    let capability = format!("model:{}", model.trim().to_ascii_lowercase());
    let mut found = false;
    let mut left = 0.0;
    for bucket in buckets {
        let matches = bucket["capabilities"].as_array().is_some_and(|caps| {
            caps.iter().any(|cap| {
                cap.as_str()
                    .is_some_and(|s| s.eq_ignore_ascii_case(&capability))
            })
        });
        if !matches
            || !not_expired(bucket, "expires_at", now)
            || !not_expired(bucket, "period_end", now)
            || number(&bucket["period_start"]).is_some_and(|start| start > now)
        {
            continue;
        }
        let owner = plans.iter().find(|plan| {
            match (
                bucket["user_plan_id"].as_str(),
                plan["user_plan_id"].as_str(),
            ) {
                (Some(a), Some(b)) => a == b,
                _ => bucket["plan_id"].as_str().is_some() && bucket["plan_id"] == plan["plan_id"],
            }
        });
        let Some(owner) = owner.filter(|plan| live_plan(plan, now)) else {
            continue;
        };
        let pending = owner["entitlements"].as_array().is_some_and(|items| {
            items.iter().any(|item| {
                item["entitlement_id"] == bucket["entitlement_id"]
                    && number(&item["effective_at"]).is_some_and(|at| at > now)
            })
        });
        if pending {
            continue;
        }
        let remaining = number(&bucket["remaining_units"])
            .or_else(|| Some(number(&bucket["total_units"])? - number(&bucket["used_units"])?))
            .or_else(|| number(&bucket["available_units"]));
        if let Some(remaining) = remaining {
            found = true;
            left += remaining.max(0.0);
        }
    }
    found.then_some(left)
}

fn has_start(account: &Value) -> bool {
    account["jwt"]
        .as_str()
        .is_some_and(|s| !s.trim().is_empty())
        || account["canClaim"].as_bool() == Some(true)
}

fn has_coding(account: &Value) -> bool {
    account.get("accessToken").or_else(||account.get("auth").and_then(|a|a.get("accessToken"))).unwrap_or(&Value::Null)
        .as_str()
        .is_some_and(|s| !s.trim().is_empty())
        || account["hasCodingToken"].as_bool() == Some(true)
}

pub fn candidates(
    account: &Value,
    model: &str,
    usage: Option<&Value>,
    now: i64,
) -> Vec<&'static str> {
    match plan_of(account) {
        PLAN_START => return vec![PLAN_START],
        PLAN_CODING => return vec![PLAN_CODING],
        _ => {}
    }
    let mut plans = Vec::new();
    if has_start(account)
        && usage
            .and_then(|u| start_remaining(u, model, now))
            .is_some_and(|n| n > 0.0)
    {
        plans.push(PLAN_START);
    }
    // Coding 的窗口比例与 Start 的 token 数不可比较。已知可用的活动余量优先；
    // 编码凭证可用而额度未知时保留它作为候选，以实际响应判断。
    if has_coding(account) {
        plans.push(PLAN_CODING)
    }
    plans
}

pub fn choose(account: &Value, model: &str, usage: Option<&Value>, now: i64) -> &'static str {
    let plans = candidates(account, model, usage, now);
    plans
        .iter()
        .copied()
        .find(|plan| reset_at(account, plan, model, now) == 0)
        // 全冷却时沿用路由层「恢复最早的通道可探测一次」的既有语义。
        .or_else(|| {
            plans
                .iter()
                .copied()
                .min_by_key(|plan| reset_at(account, plan, model, now))
        })
        .unwrap_or(PLAN_CODING)
}

pub fn cached_usage(account: &Value) -> Option<Value> {
    cache().lock().ok().and_then(|c|c.get(account["id"].as_str().unwrap_or("")).cloned())
}

pub fn selected(account: &Value, model: &str) -> &'static str {
    if let Some(plan) = account[RESOLVED_FIELD]
        .as_str()
        .and_then(super::normalize_plan)
    {
        if plan != PLAN_AUTO {
            return plan;
        }
    }
    choose(
        account,
        model,
        cached_usage(account).as_ref(),
        logging::now_ms(),
    )
}

pub fn next_available(account: &Value, model: &str, tried: &[&str]) -> Option<&'static str> {
    if plan_of(account) != PLAN_AUTO {
        return None;
    }
    let now = logging::now_ms();
    candidates(account, model, cached_usage(account).as_ref(), now)
        .into_iter()
        .find(|plan| !tried.contains(plan) && reset_at(account, plan, model, now) == 0)
}

pub fn supports_start(account: &Value) -> bool {
    plan_of(account) == PLAN_START || (plan_of(account) == PLAN_AUTO && has_start(account))
}

/// 只有资源耗尽的拒绝才尝试另一套餐；频率限流仍对当前通道冷却。
pub fn resource_exhausted(message: &str) -> bool {
    let text = message.to_ascii_lowercase();
    [
        "余额不足",
        "无可用资源包",
        "套餐已到期",
        "套餐已过期",
        "exceed quota",
        "insufficient quota",
        "quota exhausted",
    ]
    .iter()
    .any(|part| text.contains(part))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    const NOW: i64 = 2_000_000;
    fn account() -> Value {
        json!({"jwt":"test", "auth":{"accessToken":"test"}})
    }
    fn usage() -> Value {
        json!({"raw": {"plans":[{"plan_id":"start-plan", "status":"active", "ends_at":3000}],
        "balances":[
          {"plan_id":"start-plan","capabilities":["model:glm-5.3"],"remaining_units":0},
          {"plan_id":"start-plan","capabilities":["model:glm-5.3-flash"],"remaining_units":5000000}
        ]}})
    }
    #[test]
    fn automatic_is_default_and_model_buckets_are_independent() {
        assert_eq!(plan_of(&account()), PLAN_AUTO);
        assert_eq!(
            choose(&account(), "glm-5.3", Some(&usage()), NOW),
            PLAN_CODING
        );
        assert_eq!(
            choose(&account(), "glm-5.3-flash", Some(&usage()), NOW),
            PLAN_START
        );
        assert_eq!(
            choose(&account(), "glm-unknown", Some(&usage()), NOW),
            PLAN_CODING
        );
    }
    #[test]
    fn cooling_coding_and_legacy_limits_do_not_block_start() {
        let mut a = account();
        a["rateLimits"] = json!({"glm-5.3-flash":{"resetAt":NOW+2000},
            "coding-plan::glm-5.3-flash":{"resetAt":NOW+1000}});
        assert_eq!(choose(&a, "glm-5.3-flash", Some(&usage()), NOW), PLAN_START);
        a["rateLimits"]["start-plan::glm-5.3-flash"] = json!({"resetAt":NOW+3000});
        assert_eq!(
            choose(&a, "glm-5.3-flash", Some(&usage()), NOW),
            PLAN_CODING
        );
        a["rateLimits"]["coding-plan::glm-5.3-flash"]["resetAt"] = json!(NOW - 1);
        a["rateLimits"]["glm-5.3-flash"]["resetAt"] = json!(NOW - 1);
        assert_eq!(
            choose(&a, "glm-5.3-flash", Some(&usage()), NOW),
            PLAN_CODING
        );
    }
    #[test]
    fn expiry_pending_credentials_and_unknown_readings_do_not_create_quota() {
        let mut u = usage();
        u["raw"]["plans"][0]["ends_at"] = json!(1999);
        assert_eq!(
            choose(&account(), "glm-5.3-flash", Some(&u), NOW),
            PLAN_CODING
        );
        let mut u = usage();
        u["raw"]["balances"][1]["period_start"] = json!(2001);
        assert_eq!(
            choose(&account(), "glm-5.3-flash", Some(&u), NOW),
            PLAN_CODING
        );
        assert_eq!(
            choose(
                &json!({"auth":{"accessToken":"test"}}),
                "glm-5.3-flash",
                Some(&usage()),
                NOW
            ),
            PLAN_CODING
        );
        assert_eq!(choose(&account(), "glm-5.3-flash", None, NOW), PLAN_CODING);
        let mut u = usage();
        u["raw"]["balances"][1]["remaining_units"] = Value::Null;
        u["raw"]["balances"][1]["grant_units"] = json!(5000000);
        assert_eq!(start_remaining(&u, "glm-5.3-flash", NOW), None);
    }
    #[test]
    fn explicit_channel_and_cooldown_keys_are_preserved() {
        let mut a = account();
        a["zcodePlan"] = json!(PLAN_CODING);
        assert_eq!(
            choose(&a, "glm-5.3-flash", Some(&usage()), NOW),
            PLAN_CODING
        );
        a["zcodePlan"] = json!(PLAN_START);
        assert_eq!(choose(&a, "glm-5.3", None, NOW), PLAN_START);
        assert_ne!(
            cooldown_key(PLAN_START, "glm-5.3"),
            cooldown_key(PLAN_CODING, "glm-5.3")
        );
        assert!(resource_exhausted(
            "上游返回 429: 余额不足或无可用资源包,请充值。"
        ));
        assert!(!resource_exhausted("请求频率超限"));
    }

}

fn cache()->&'static Mutex<HashMap<String,Value>> {static C:OnceLock<Mutex<HashMap<String,Value>>>=OnceLock::new();C.get_or_init(||Mutex::new(HashMap::new()))}
pub async fn restore(ctx:&agent2api_provider_sdk::PluginCtx,provider:&str,id:&str){
 if cache().lock().is_ok_and(|c|c.contains_key(id)){return;}
 if let Ok(usage)=ctx.ledger_get(id,"zcode.channel.usage").await {if !usage.is_null(){if let Ok(mut c)=cache().lock(){c.insert(id.into(),usage);}}}
 let _=provider;
}
pub async fn save(ctx:&agent2api_provider_sdk::PluginCtx,id:&str,usage:&Value){
 if let Ok(mut c)=cache().lock(){c.insert(id.into(),usage.clone());}
 if let Err(e)=ctx.ledger_put(id,"zcode.channel.usage",usage).await {crate::logging::verbose("[ZCode]",&format!("通道余额缓存保存失败: {e}"));}
}
