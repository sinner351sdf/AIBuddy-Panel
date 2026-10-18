//! WorkBuddy schedules, always Beijing time. Missing preferences default on;
//! explicit persisted false values survive upgrades. Per-account slots live in SQLite.
use super::{
    account_store::AccountStore,
    beijing,
    billing::BillingService,
    growth_queue::{self, RunOptions},
    task_records, task_state,
};
use crate::server::logging;
use chrono::{Duration as CDuration, Timelike};
use serde_json::{json, Map, Value};
use std::sync::OnceLock;
use std::time::Duration;
const KV_KEY: &str = "growthSchedule";
pub const TICK_MS: u64 = 30_000;
pub const DEFAULT_GROWTH_TIME: &str = "01:00";
pub const DEFAULT_BLACKCAT_TIME: &str = "01:00";
pub const DEFAULT_TRAVEL_HOURS: &[u32] = &[9, 21];
const FLAGS: &[&str] = &[
    "growthEnabled",
    "blackcatEnabled",
    "travelEnabled",
    "activityEnabled",
    "streakEnabled",
];
fn normalize(mut raw: Map<String, Value>) -> Value {
    for key in FLAGS {
        raw.entry((*key).to_string()).or_insert(json!(true));
    }
    for (key, time) in [
        ("growthTime", DEFAULT_GROWTH_TIME),
        ("blackcatTime", DEFAULT_BLACKCAT_TIME),
        ("activityTime", "10:00"),
        ("streakTime", "10:00"),
    ] {
        raw.entry(key).or_insert(json!(time));
    }
    raw.entry("travelHours".to_string())
        .or_insert(json!(DEFAULT_TRAVEL_HOURS));
    raw.insert("defaultsVersion".into(), json!(2));
    Value::Object(raw)
}
pub fn read_config() -> Result<Value, String> {
    let old = task_state::read(KV_KEY)?.value.unwrap_or(json!({}));
    let config = normalize(old.as_object().cloned().ok_or("调度配置格式错误")?);
    if config != old {
        task_state::store_value(KV_KEY, config.clone())?;
    }
    Ok(config)
}
pub fn kind_enabled(kind: &str) -> bool {
    read_config().map(|v| enabled(&v, kind)).unwrap_or(false)
}
fn flag(kind: &str) -> &str {
    match kind {
        "growth" => "growthEnabled",
        "night" => "blackcatEnabled",
        "travel" => "travelEnabled",
        "activity" => "activityEnabled",
        "rewards" => "streakEnabled",
        _ => "",
    }
}
fn time_key(kind: &str) -> &str {
    match kind {
        "growth" => "growthTime",
        "night" => "blackcatTime",
        "activity" => "activityTime",
        _ => "streakTime",
    }
}
fn enabled(c: &Value, kind: &str) -> bool {
    c.get(flag(kind)).and_then(Value::as_bool) == Some(true)
}
fn minutes(text: &str) -> Option<u32> {
    let (h, m) = text.split_once(':')?;
    let h = h.parse::<u32>().ok()?;
    let m = m.parse::<u32>().ok()?;
    if h > 23 || m > 59 {
        None
    } else {
        Some(h * 60 + m)
    }
}
fn slots(c: &Value, kind: &str) -> Vec<u32> {
    if kind == "travel" {
        if let Some(times) = c.get("travelTimes").and_then(Value::as_array) {
            return times.iter().filter_map(|t| t.as_str().and_then(minutes)).collect();
        }
        c.get("travelHours")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|n| n.as_u64().filter(|n| *n < 24).map(|n| n as u32 * 60))
            .collect()
    } else {
        c.get(time_key(kind))
            .and_then(Value::as_str)
            .and_then(minutes)
            .into_iter()
            .collect()
    }
}
pub fn due_slot(
    c: &Value,
    kind: &str,
    now: chrono::DateTime<chrono::FixedOffset>,
) -> Option<String> {
    let now = now.with_timezone(&beijing::offset());
    if !enabled(c, kind)
        || (kind == "night" && !super::task_execution::in_night_window_at(now.hour()))
    {
        return None;
    }
    let minute = now.hour() * 60 + now.minute();
    let slot = slots(c, kind).into_iter().filter(|m| *m <= minute).max()?;
    Some(format!(
        "{}T{:02}:{:02}",
        beijing::date_key(now),
        slot / 60,
        slot % 60
    ))
}
pub fn config_json(c: &Value) -> Value {
    let now = beijing::now();
    let mut value = c.clone();
    let mut rows = Vec::new();
    for kind in ["growth", "night", "travel", "activity", "rewards"] {
        let next = slots(c, kind)
            .into_iter()
            .filter_map(|m| {
                now.with_hour(m / 60)?
                    .with_minute(m % 60)?
                    .with_second(0)?
                    .with_nanosecond(0)
            })
            .map(|at| {
                if at <= now {
                    at + CDuration::days(1)
                } else {
                    at
                }
            })
            .min();
        let mut filters = std::collections::HashMap::new();
        filters.insert("kind".into(), kind.into());
        filters.insert("limit".into(), "1".into());
        let last = task_records::query(&filters).ok().and_then(|v| {
            v.get("items")
                .and_then(Value::as_array)
                .and_then(|a| a.first())
                .cloned()
        });
        rows.push(json!({"kind":kind,"enabled":enabled(c,kind),"nextRunAt":if enabled(c,kind){next.map(|t|t.timestamp_millis())}else{None},"lastRunAt":last.as_ref().and_then(|v|v.get("startedAt")),"lastOutcome":last.as_ref().and_then(|v|v.get("outcome")),"reason":last.as_ref().and_then(|v|v.get("message")),"running":growth_queue::kind_running(kind)}));
    }
    value["tasks"] = json!(rows);
    value["timezone"] = json!("Asia/Shanghai");
    value["recordRetentionDays"] = json!(task_records::retention_days());
    value
}
pub fn write_config(patch: &Value) -> Result<Value, String> {
    let mut c = read_config()?;
    for key in FLAGS {
        if let Some(v) = patch.get(*key) {
            if !v.is_boolean() {
                return Err(format!("{key} 必须是布尔值"));
            }
            c[*key] = v.clone();
        }
    }
    for key in ["growthTime", "blackcatTime", "activityTime", "streakTime"] {
        if let Some(v) = patch.get(key) {
            let t = super::auto_checkin::normalize_time(Some(v)).map_err(|e| e.message)?;
            if key == "blackcatTime" && !minutes(&t).is_some_and(|m| m < 480 || m >= 1380) {
                return Err("夜猫时刻必须在北京时间23:00–08:00内".into());
            }
            c[key] = json!(t);
        }
    }
    if let Some(times) = patch.get("travelTimes") {
        let times = times.as_array().filter(|a| !a.is_empty() && a.len() <= 6).ok_or("旅行时刻需为1–6项")?;
        let mut parsed = Vec::new();
        for time in times { parsed.push(super::auto_checkin::normalize_time(Some(time)).map_err(|e| e.message)?); }
        parsed.sort(); parsed.dedup(); c["travelTimes"] = json!(parsed);
    }
    if let Some(hours) = patch.get("travelHours") {
        c.as_object_mut().map(|o| o.remove("travelTimes"));
        let a = hours.as_array().ok_or("travelHours必须是小时数组")?;
        let mut parsed = Vec::new();
        for h in a {
            parsed.push(
                h.as_u64()
                    .filter(|h| *h < 24)
                    .ok_or("旅行小时必须是0–23的整数")?,
            );
        }
        if parsed.is_empty() {
            parsed = vec![9, 21];
        }
        parsed.sort_unstable();
        parsed.dedup();
        c["travelHours"] = json!(parsed);
    }
    if let Some(days) = patch.get("recordRetentionDays") {
        let d = days
            .as_i64()
            .filter(|d| *d >= 1 && *d <= 3650)
            .ok_or("记录保留天数必须为1–3650")?;
        if !crate::server::config::update_raw_field("taskRecordRetentionDays", json!(d)) {
            return Err("记录保留设置保存失败".into());
        }
    }
    task_state::store_value(KV_KEY, c.clone())?;
    Ok(config_json(&c))
}
pub fn spawn(store: AccountStore, billing: BillingService) {
    static SPAWNED: OnceLock<()> = OnceLock::new();
    if SPAWNED.set(()).is_err() {
        return;
    }
    if let Err(e) = task_records::recover() {
        logging::log("[Growth]", &format!("恢复任务记录失败：{e}"));
    }
    crate::spawn_task(async move {
        let mut first = true;
        loop {
            tokio::time::sleep(Duration::from_millis(TICK_MS)).await;
            tick(&store, &billing, first).await;
            first = false;
        }
    });
}
async fn tick(store: &AccountStore, billing: &BillingService, startup: bool) {
    let _ = task_records::recover();
    let Ok(config) = read_config() else { return };
    let queue = growth_queue::global(store.clone(), billing.clone());
    if queue.state().get("running").and_then(Value::as_bool) == Some(true) {
        return;
    }
    for kind in ["night", "growth", "travel", "activity", "rewards"] {
        let Some(slot) = due_slot(&config, kind, beijing::now()) else {
            continue;
        };
        let opts = RunOptions {
            kind: kind.into(),
            mode: "full".into(),
            source: if startup { "startup" } else { "schedule" }.into(),
            slot: Some(slot),
        };
        if queue.run_selected(1, None, opts).await.is_ok() {
            while queue.state().get("running").and_then(Value::as_bool) == Some(true) {
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
        }
    }
    if let Err(e) = task_records::cleanup() {
        logging::verbose("[Growth]", &e);
    }
}
pub async fn run_streak_after_checkin(store: &AccountStore, billing: &BillingService) {
    if !kind_enabled("rewards") {
        return;
    }
    let queue = growth_queue::global(store.clone(), billing.clone());
    let _ = queue
        .run_selected(
            1,
            None,
            RunOptions {
                kind: "rewards".into(),
                source: "schedule".into(),
                ..Default::default()
            },
        )
        .await;
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn defaults_preserve_explicit_preferences() {
        let c = normalize(
            serde_json::from_value(json!({"growthEnabled":false,"blackcatTime":"23:00"})).unwrap(),
        );
        assert_eq!(c["growthEnabled"], false);
        assert_eq!(c["travelEnabled"], true);
        assert_eq!(c["blackcatTime"], "23:00");
        assert_eq!(normalize(c.as_object().unwrap().clone()), c);
    }
    #[test]
    fn host_offsets_and_midnight_do_not_change_slots() {
        let c = normalize(Map::new());
        let instants = [
            "2026-10-14T17:00:00Z",
            "2026-10-15T01:00:00+08:00",
            "2026-10-14T10:00:00-07:00",
        ];
        for text in instants {
            let at = chrono::DateTime::parse_from_rfc3339(text).unwrap();
            assert_eq!(
                due_slot(&c, "night", at).as_deref(),
                Some("2026-10-15T01:00")
            );
        }
        for (time, allowed) in [
            ("22:59", false),
            ("23:00", true),
            ("07:59", true),
            ("08:00", false),
        ] {
            let at = chrono::DateTime::parse_from_rfc3339(&format!("2026-10-15T{time}:00+08:00"))
                .unwrap();
            assert_eq!(due_slot(&c, "night", at).is_some(), allowed);
        }
    }
    #[test]
    fn travel_only_latest_today() {
        let c = normalize(Map::new());
        let at = chrono::DateTime::parse_from_rfc3339("2026-10-15T22:00:00+08:00").unwrap();
        assert_eq!(
            due_slot(&c, "travel", at).as_deref(),
            Some("2026-10-15T21:00")
        );
        assert!(due_slot(&c, "night", at).is_none());
    }
}
