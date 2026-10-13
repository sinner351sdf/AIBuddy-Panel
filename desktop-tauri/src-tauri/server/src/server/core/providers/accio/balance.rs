//! Accio 额度查询：归一成账号页的统一形状（`ProviderAdapter::query_usage` 契约）。
//!
//! ── 上游给的是什么 ──────────────────────────────────────────
//! `GET /api/entitlement/quota?accessToken=…` → `{usagePercent, refreshCountdownSeconds}`
//! （桌面端本地路由 `/auth/quota` 就是把它算成这两个数给界面用的）。
//! 另有 `GET /api/entitlement/currentSubscription?accessToken=…` 给订阅详情
//! （套餐名 / 到期时间 / 剩余额度），它可能不存在（免费账号），失败就当没有。
//!
//! ── 为什么 available 给 null ────────────────────────────────
//! Accio 不暴露「还剩多少积分」的绝对数，只有一个**已用百分比**。把百分比
//! 伪装成积分数会误导（用户看到「还剩 37」不知道是什么单位），因此：
//!   - `available` = `null`（契约允许：判不出就给 null）；
//!   - `unit` = `"%"`；
//!   - `wallets` 里给一条「额度余量」= `100 - usagePercent`，
//!     并把重置倒计时写进它的 `detail` 字段；
//!   - `remainingPercent` 用于账号页进度条；缺失用量时报告查询失败，不假定未使用；
//!   - `subscription` 保留上游套餐的 `remainQuota / totalQuota`，与周期百分比
//!     是不同口径，不能把套餐额度当作百分比。
//!
//! ── 401 为什么原样透出 ──────────────────────────────────────
//! 契约要求（见 `ProviderAdapter::query_usage`）：调用方据此走「刷新后重试一次」。

use serde_json::{json, Value};

use crate::server::core::account_store::AccountStore;
use crate::server::errors::GatewayError;

use super::auth;
use super::endpoints;

/// 查一个账号的额度 / 订阅，归一成统一形状。
///
/// `region` 必给：两个地区是两家 provider，取记录时按它过滤。
pub async fn query(
    store: &AccountStore,
    account_id: &str,
    region: super::endpoints::Region,
) -> Result<Value, GatewayError> {
    let record = store
        .accio_account_record(account_id, region.provider_id())
        .ok_or_else(|| GatewayError::with_status(404, "Accio 账号不存在，请先添加账号"))?;
    let credentials = auth::snapshot(&record)?;
    let proxy = auth::account_proxy(&record)?;

    // ── 额度用量 ────────────────────────────────────────────────
    let quota_response = auth::get_with_token(
        credentials.region,
        endpoints::QUOTA_PATH,
        &credentials.access_token,
        &[],
        proxy.as_ref(),
    )
    .await?;
    if quota_response.status == 401 || quota_response.status == 403 {
        return Err(GatewayError::with_status(401, "Accio 凭证已失效，请重新登录"));
    }
    let quota = auth::payload(quota_response, "额度查询").map(auth::unwrap_data)?;
    let wallet = quota_wallet(&quota)?;

    // ── 订阅（可选，失败不影响额度的展示）──────────────────────
    let subscription = match auth::get_with_token(
        credentials.region,
        endpoints::SUBSCRIPTION_PATH,
        &credentials.access_token,
        &[],
        proxy.as_ref(),
    )
    .await
    {
        Ok(response) if response.ok => response
            .payload
            .map(auth::unwrap_data)
            .map(|value| subscription_shape(&value))
            .unwrap_or(Value::Null),
        // 免费账号没有订阅：失败当「没有」，不影响额度那一半的展示
        _ => Value::Null,
    };

    Ok(json!({
        // 上游只有百分比，没有绝对剩余量：按契约给 null（见模块头）
        "available": Value::Null,
        "unit": "%",
        "wallets": [wallet],
        "subscription": subscription,
        "raw": {
            "quota": quota,
            "region": credentials.region.edition(),
            "account": credentials.user_id,
        },
    }))
}

/// 百分比额度桶；不以 0 补缺失字段，否则未知额度会变成「剩余 100%」。
fn quota_wallet(quota: &Value) -> Result<Value, GatewayError> {
    let usage_percent = ["usagePercent", "usage_percent"]
        .iter()
        .find_map(|key| quota.get(*key).and_then(Value::as_f64))
        .filter(|value| value.is_finite())
        .ok_or_else(|| GatewayError::with_status(502, "Accio 额度查询未返回有效的已用百分比"))?
        .clamp(0.0, 100.0);
    let remain = 100.0 - usage_percent;
    let mut wallet = json!({
        "type": "entitlement",
        "displayName": "额度余量",
        "balance": remain,
        "unit": "%",
        "usedPercent": usage_percent,
        "remainingPercent": remain,
    });
    let countdown = ["refreshCountdownSeconds", "refresh_countdown_seconds"]
        .iter()
        .find_map(|key| quota.get(*key).and_then(Value::as_f64));
    if let Some(seconds) = countdown.filter(|value| value.is_finite() && *value > 0.0) {
        wallet["detail"] = Value::String(format!("{} 后重置", humanize_seconds(seconds)));
    }
    Ok(wallet)
}

/// 订阅响应 → 契约里的 `subscription` 形状（字段名宽口径）。
fn subscription_shape(payload: &Value) -> Value {
    let text = |keys: &[&str]| -> Value {
        keys.iter()
            .find_map(|key| payload.get(*key).and_then(Value::as_str))
            .filter(|value| !value.trim().is_empty())
            .map(|value| Value::String(value.to_string()))
            .unwrap_or(Value::Null)
    };
    let number = |keys: &[&str]| -> Value {
        keys.iter()
            .find_map(|key| payload.get(*key).and_then(Value::as_f64))
            .map(|value| json!(value))
            .unwrap_or(Value::Null)
    };
    let expire = ["expireAt", "expiresAt", "endTime", "end_time"]
        .iter()
        .find_map(|key| payload.get(*key))
        .cloned()
        .unwrap_or(Value::Null);
    json!({
        "planName": text(&["planName", "plan_name", "productName", "name"]),
        "status": text(&["status", "state"]),
        "expireAt": expire,
        "remainQuota": number(&["remainQuota", "remain", "remaining", "leftQuota"]),
        "totalQuota": number(&["totalQuota", "total", "quota"]),
    })
}

/// 秒 → 「3 小时 20 分」这类人话（界面直接显示）
fn humanize_seconds(seconds: f64) -> String {
    let total = seconds.max(0.0) as i64;
    let days = total / 86_400;
    let hours = (total % 86_400) / 3_600;
    let minutes = (total % 3_600) / 60;
    if days > 0 {
        format!("{days} 天 {hours} 小时")
    } else if hours > 0 {
        format!("{hours} 小时 {minutes} 分")
    } else if minutes > 0 {
        format!("{minutes} 分")
    } else {
        format!("{total} 秒")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quota_remaining_percent_preserves_zero_full_and_fractional_values() {
        for (used, remaining) in [(0.0, 100.0), (100.0, 0.0), (37.5, 62.5)] {
            let wallet = quota_wallet(&json!({"usagePercent": used})).unwrap();
            assert_eq!(wallet["balance"], json!(remaining));
            assert_eq!(wallet["remainingPercent"], json!(remaining));
            assert_eq!(wallet["usedPercent"], json!(used));
        }
    }

    #[test]
    fn quota_missing_or_invalid_percent_does_not_become_full() {
        for quota in [
            json!({}),
            json!({"usagePercent": null}),
            json!({"usagePercent": "unknown"}),
            json!({"usagePercent": false}),
        ] {
            assert!(quota_wallet(&quota).is_err());
        }
    }

    #[test]
    fn quota_alias_countdown_and_out_of_range_values() {
        let wallet = quota_wallet(&json!({
            "usage_percent": 25.0,
            "refresh_countdown_seconds": 86400,
        }))
        .unwrap();
        assert_eq!(wallet["remainingPercent"], json!(75.0));
        assert_eq!(wallet["detail"], "1 天 0 小时 后重置");
        assert_eq!(
            quota_wallet(&json!({"usagePercent": 120})).unwrap()["remainingPercent"],
            json!(0.0),
        );
        assert_eq!(
            quota_wallet(&json!({"usagePercent": -1})).unwrap()["remainingPercent"],
            json!(100.0),
        );
    }
}
