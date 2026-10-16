//! OrcaTerm 余额：`DescribeUserBillingStatus` 的月度 AI 配额 → 统一 usage 形状。
//!
//! ── 上游形态（2026-10-16 实测）──────────────────────────────
//! `POST {CGI}/cgi/api?action=DescribeUserBillingStatus&uin=<userId>`
//! → `data.Response`：
//! ```jsonc
//! { "roleType": "basic", "usageStats": [
//!     { "feature": "hunyuan_ai", "quotaLimit": 1000, "quotaUsed": 0,
//!       "quotaStartDate": "2026-10-15T16:00:00.000Z",
//!       "quotaEndDate": "2026-11-15T16:00:00.000Z" }, … ] }
//! ```
//! 配额按自然月重置；`hunyuan_ai` 就是 AI 助手的对话额度（基础版 1000/月、
//! 专业版 6000/月，见 `DescribeProductEditions`）。本文件只关心这一项，
//! 其余（session_share / secret / space）不是推理额度，不进 usage。
//!
//! ── 归一形状（adapter::query_usage 的契约）──────────────────
//! `available` = limit - used、`unit` = "次"、`subscription` 带套餐档与
//! 重置时刻（`roleType` 映射展示名：basic → 基础版 / professional → 专业版，
//! 其余原样透出 —— 套餐名以上游原文为准，不引入本地码表）。
//!
//! ── 硬约束 ──────────────────────────────────────────────────
//! release 是 `panic=abort`：本文件零 unwrap/expect/panic。

use serde_json::{Value, json};

use crate::server::core::account_store::AccountStore;
use crate::server::errors::GatewayError;

use super::credentials;

/// AI 助手配额在 `usageStats[].feature` 里的取值
const HUNYUAN_FEATURE: &str = "hunyuan_ai";

/// 查询某账号的 AI 配额。
pub async fn query_usage(
    store: &AccountStore,
    account_id: &str,
) -> Result<Value, GatewayError> {
    let proxy = credentials::account_proxy(store, account_id)?;
    let mut credentials = credentials::snapshot_for(store, account_id)?;
    credentials = credentials::refresh(store, &credentials, account_id, false, proxy.as_ref()).await?;
    let response = credentials::cgi_action(&credentials, "DescribeUserBillingStatus", json!({}), proxy.as_ref()).await?;
    normalize_usage(response)
}

fn normalize_usage(response: Value) -> Result<Value, GatewayError> {
    if let Some(error) = response.get("Error") {
        let code = error.get("Code").and_then(Value::as_str).unwrap_or("UNKNOWN");
        let message = error.get("Message").and_then(Value::as_str).unwrap_or("上游错误");
        return Err(GatewayError::with_status(
            401,
            format!("OrcaTerm 余额查询被上游拒绝（{code}：{message}）"),
        ));
    }
    let role_type = response.get("roleType").and_then(Value::as_str).unwrap_or("");
    let stats = response
        .get("usageStats")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let ai = stats
        .iter()
        .find(|item| item.get("feature").and_then(Value::as_str) == Some(HUNYUAN_FEATURE));
    let Some(ai) = ai else {
        return Err(GatewayError::with_status(
            502,
            "OrcaTerm 余额响应里没有 AI 助手配额项（hunyuan_ai）",
        ));
    };
    let limit = quota_number(ai.get("quotaLimit"));
    let used = quota_number(ai.get("quotaUsed"));
    let available = limit.zip(used).map(|(limit, used)| limit.saturating_sub(used).max(0));
    let reset_at = iso_to_ms(ai.get("quotaEndDate").and_then(Value::as_str));
    let plan_name = response.get("planName").or_else(|| response.get("editionName"))
        .and_then(Value::as_str).filter(|name| !name.trim().is_empty()).unwrap_or(role_type);
    Ok(json!({
        "available": available,
        "unit": "次",
        "availableView": available.zip(limit).map(|(available, limit)| format!("{available}/{limit} 次")).unwrap_or_default(),
        "subscription": {
            "planName": plan_name,
            "status": "active",
            "expireAt": reset_at,
            "remainQuota": available,
            "totalQuota": limit,
        },
        "raw": response,
    }))
}

/// ISO-8601 时间串 → 毫秒时间戳（解析不出给 0；不引入时辰假设）。
fn iso_to_ms(text: Option<&str>) -> i64 {
    let Some(text) = text else { return 0 };
    // 上游是 `2026-11-15T16:00:00.000Z`（UTC）；用 chrono 已有依赖解析
    chrono::DateTime::parse_from_rfc3339(text)
        .map(|value| value.timestamp_millis())
        .unwrap_or(0)
}


fn quota_number(value: Option<&Value>) -> Option<i64> {
    let value = value?;
    value.as_i64().or_else(|| value.as_str()?.trim().parse::<i64>().ok()).filter(|value| *value >= 0)
}

#[cfg(test)]
mod local_regression_tests {
    use super::*;
    #[test]
    fn missing_quota_is_unknown_while_known_zero_is_zero() {
        let unknown = normalize_usage(json!({"roleType":"basic","usageStats":[{"feature":"hunyuan_ai"}]})).unwrap();
        assert!(unknown["available"].is_null());
        assert_eq!(unknown["availableView"], "");
        let known = normalize_usage(json!({"roleType":"basic","planName":"Original Plan", "usageStats":[{"feature":"hunyuan_ai","quotaLimit":"1000","quotaUsed":1000}]})).unwrap();
        assert_eq!(known["available"], 0);
        assert_eq!(known["subscription"]["planName"], "Original Plan");
        assert_eq!(known["availableView"], "0/1000 次");
    }
}
