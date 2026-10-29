//! 新手礼包与活动补偿领取（对照 refs upstream/blackcat.go:71-95 移植）。
//!
//! 新手礼包沿用 refs blackcat.go:73 的 www.codebuddy.cn 端点：
//!   POST /billing/meter/claim-gift            领取新手礼包（每号一次）
//! WorkBuddy 网页补偿使用 www.workbuddy.cn 与 web 平台头：
//!   POST /billing/meter/compensation-status  查询活动与领取状态（只读）
//!   POST /billing/meter/claim-compensation   领取活动补偿（有则领）
//!
//! 语义（refs blackcat.go 与 scheduler/streak.go:40-46 的用法）：code=0 成功，
//! 响应 data 带 `credit`；重复领取/无可领项返回**业务错误**（refs 的
//! streakBonusAccount 对其「无则业务错误静默跳过」）。
//!
//! 注意（与 trial 的差别，勿混）：refs 没有为礼包/补偿定义幂等码，这里是把
//! 上游返回的非 0 code + msg 原样透出；调用方（api 层）用面板既有的
//! 「msg 含 已领取/已领过 即完成态」口径（core::billing::checkin 的
//! `checkin_completed_today` 同款文案判据）把重复领取翻成中性结果，
//! 不在协议层编造幂等码。

use serde::Serialize;
use serde_json::{json, Value};

use super::request::{growth_extra, BillingBase, BillingSpec, CallOptions};
use super::{BillingError, BillingService};

/// 新手礼包端点（refs blackcat.go:73；路径不带 /v2 —— refs 原样照抄）。
const CLAIM_GIFT: BillingSpec = BillingSpec {
    method: "POST",
    path: "/billing/meter/claim-gift",
    body: super::request::empty_body,
    whitelist_headers: false,
    base: BillingBase::Billing,
};

/// 活动补偿端点（refs blackcat.go:86）。
const CLAIM_COMPENSATION: BillingSpec = BillingSpec {
    method: "POST",
    path: "/billing/meter/claim-compensation",
    body: super::request::empty_body,
    whitelist_headers: false,
    base: BillingBase::Web,
};

const COMPENSATION_STATUS: BillingSpec = BillingSpec {
    method: "POST",
    path: "/billing/meter/compensation-status",
    body: super::request::empty_body,
    whitelist_headers: false,
    base: BillingBase::Web,
};

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompensationStatus {
    pub active: bool,
    pub claimed: bool,
    pub claimable: bool,
    pub credit_num: Option<i64>,
    pub end_time: Option<String>,
}

fn parse_compensation_status(data: &Value) -> Result<CompensationStatus, BillingError> {
    let active = data
        .get("active")
        .and_then(Value::as_bool)
        .ok_or_else(|| BillingError::new("补偿状态响应缺少有效的 active 字段", 502))?;
    // A missing claim flag on an active campaign must never enable a claim.
    let claimed = match data.get("claimed").and_then(Value::as_bool) {
        Some(value) => value,
        None if !active => false,
        None => {
            return Err(BillingError::new(
                "补偿状态响应缺少有效的 claimed 字段",
                502,
            ))
        }
    };
    Ok(CompensationStatus {
        active,
        claimed,
        claimable: active && !claimed,
        credit_num: data
            .get("credit_num")
            .and_then(Value::as_i64)
            .filter(|n| *n >= 0),
        end_time: data
            .get("end_time")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(str::to_owned),
    })
}

fn compensation_extra(session: &Value) -> Vec<(String, String)> {
    let mut headers = growth_extra(session, false);
    headers.push(("X-Client-Platform".into(), "web".into()));
    headers
}

/// Read-only upstream POST. Identity and egress come from the selected stored account.
pub async fn compensation_status(
    service: &BillingService,
    session: &Value,
) -> Result<CompensationStatus, BillingError> {
    crate::server::core::billing::legacy_call(
        service,
        session,
        "aibuddy.gift.compensation_status",
        serde_json::json!({}),
    )
    .await
}

/// Recheck eligibility under the caller's account lock; never retry a claim write.
pub async fn claim_compensation(
    service: &BillingService,
    session: &Value,
) -> Result<GiftOutcome, BillingError> {
    crate::server::core::billing::legacy_call(
        service,
        session,
        "aibuddy.gift.claim_compensation",
        serde_json::json!({}),
    )
    .await
}

/// 礼包/补偿的动作种类（API 层 `kind` 字段的合法值）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum GiftKind {
    /// 新手礼包（每号一次）
    Gift,
    /// 活动补偿（有则领）
    Compensation,
}

impl GiftKind {
    /// 从 API 的 kind 字符串解析（'gift' | 'compensation'）。
    pub fn parse(kind: &str) -> Option<Self> {
        match kind {
            "gift" => Some(Self::Gift),
            "compensation" => Some(Self::Compensation),
            _ => None,
        }
    }

    fn spec(self) -> BillingSpec {
        match self {
            Self::Gift => CLAIM_GIFT,
            Self::Compensation => CLAIM_COMPENSATION,
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Gift => "新手礼包",
            Self::Compensation => "活动补偿",
        }
    }
}

/// 领取结果。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct GiftOutcome {
    pub credit_known: bool,
    /// true = 本次领取成功（credit 为到账积分）
    pub claimed: bool,
    /// true = 已领过/无可领（幂等中性结果，非错误）
    pub already: bool,
    /// 到账积分（成功时）
    pub credit: i64,
    /// 给前端展示的一句话
    pub message: String,
}

/// 领取礼包/补偿（逐账号调用；code=0 成功、非 0 code 视上游 msg 而定）。
pub async fn claim_gift(
    service: &BillingService,
    session: &Value,
    kind: GiftKind,
) -> Result<GiftOutcome, BillingError> {
    crate::server::core::billing::legacy_call(
        service,
        session,
        "aibuddy.gift.claim_gift",
        serde_json::json!({"kind": kind}),
    )
    .await
}
