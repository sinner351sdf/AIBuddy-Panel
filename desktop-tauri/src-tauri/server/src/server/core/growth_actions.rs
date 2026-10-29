//! WorkBuddy actions execute in the provider worker; the host keeps queue/records.
use super::billing::{growth, BillingError, BillingService};
use serde_json::Value;
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum ActionOutcome {
    Done,
    Skipped(String),
}
pub async fn run_action(
    service: &BillingService,
    session: &Value,
    code: &str,
    task: &growth::Task,
) -> Result<ActionOutcome, BillingError> {
    super::billing::legacy_call(
        service,
        session,
        "aibuddy.growth_actions.run_action",
        serde_json::json!({"code":code,"task":task}),
    )
    .await
}
