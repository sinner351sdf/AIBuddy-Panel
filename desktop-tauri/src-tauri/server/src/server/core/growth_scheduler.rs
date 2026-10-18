//! Compatibility view for 3.1 travel controls; execution stays in the persistent task queue.
use serde_json::{json, Value};
use super::{growth_schedule, task_records};
pub fn state() -> Value { state_for(None) }
pub fn state_for(batch: Option<&str>) -> Value {
    let result = (|| -> Result<Value, String> {
        let c = growth_schedule::read_config()?;
        let times = c.get("travelTimes").cloned().unwrap_or_else(|| json!(c["travelHours"].as_array().into_iter().flatten().filter_map(|h| h.as_u64().map(|h| format!("{h:02}:00"))).collect::<Vec<_>>()));
        let mut history=task_records::travel_history(batch)?;
        history["enabled"]=c["travelEnabled"].clone();
        history["times"]=times;
        history["running"]=json!(super::growth_queue::kind_running("travel"));
        history["nextRunAt"]=growth_schedule::config_json(&c)["tasks"].as_array().into_iter().flatten().find(|row|row["kind"]=="travel").and_then(|row|row.get("nextRunAt")).cloned().unwrap_or(Value::Null);
        if let Some(at)=history["lastResult"]["at"].as_i64().and_then(chrono::DateTime::from_timestamp_millis) {
            let at=at.with_timezone(&super::beijing::offset());
            history["lastFiredDate"]=json!(at.format("%Y-%m-%d").to_string());
            history["lastFiredTime"]=json!(at.format("%H:%M").to_string());
        }
        Ok(history)
    })();
    result.unwrap_or_else(|error|json!({"enabled":false,"times":[],"error":error}))
}
pub fn configure(patch: &Value) -> Result<Value, String> {
    let mut mapped=json!({});
    if let Some(enabled)=patch.get("enabled") { mapped["travelEnabled"]=enabled.clone(); }
    if let Some(times)=patch.get("times") { mapped["travelTimes"]=times.clone(); }
    growth_schedule::write_config(&mapped)?;
    Ok(state())
}
