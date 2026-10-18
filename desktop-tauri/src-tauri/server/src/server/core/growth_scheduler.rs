//! Compatibility view for 3.1 travel controls; execution stays in the persistent local task queue.
use serde_json::{json, Value};
use super::growth_schedule;
pub fn state() -> Value {
    match growth_schedule::read_config() {
        Ok(c) => {
            let times = c.get("travelTimes").cloned().unwrap_or_else(|| json!(c["travelHours"].as_array().into_iter().flatten().filter_map(|h| h.as_u64().map(|h| format!("{h:02}:00"))).collect::<Vec<_>>()));
            json!({"enabled":c["travelEnabled"],"times":times,"running":super::growth_queue::kind_running("travel"),"firedToday":[],"lastResult":null,"nextRunAt":null})
        }
        Err(e) => json!({"enabled":false,"times":[],"error":e}),
    }
}
pub fn configure(patch: &Value) -> Result<Value, String> {
    let mut mapped=json!({});
    if let Some(enabled)=patch.get("enabled") { mapped["travelEnabled"]=enabled.clone(); }
    if let Some(times)=patch.get("times") { mapped["travelTimes"]=times.clone(); }
    growth_schedule::write_config(&mapped)?;
    Ok(state())
}
