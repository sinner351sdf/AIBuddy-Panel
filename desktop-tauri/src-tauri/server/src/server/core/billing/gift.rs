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

use serde_json::{json, Value};
use serde::Serialize;

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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompensationStatus {
    pub active: bool,
    pub claimed: bool,
    pub claimable: bool,
    pub credit_num: Option<i64>,
    pub end_time: Option<String>,
}

#[cfg(test)]
mod compensation_tests {
    use super::*;
    use std::sync::{Arc, atomic::{AtomicUsize, Ordering}};

    #[test]
    fn missing_or_malformed_status_never_enables_claims() {
        for data in [json!(null), json!({}), json!({"active":"true","claimed":false}), json!({"active":true}), json!({"active":true,"claimed":0})] {
            assert!(parse_compensation_status(&data).is_err());
        }
        assert!(!parse_compensation_status(&json!({"active":false})).unwrap().claimable);
        let status = parse_compensation_status(&json!({"active":true,"claimed":false,"credit_num":0})).unwrap();
        assert_eq!(status.credit_num, Some(0));
        assert!(status.claimable);
        assert_eq!(parse_compensation_status(&json!({"active":true,"claimed":false})).unwrap().credit_num, None);
    }

    #[tokio::test]
    async fn status_query_is_read_only_and_uses_workbuddy_web_identity() {
        let service = BillingService::mock_headers(|url, body, headers| {
            assert_eq!(url, "https://www.workbuddy.cn/billing/meter/compensation-status");
            assert_eq!(body, Some(&json!({})));
            assert!(headers.iter().any(|(key,value)| key == "X-Client-Platform" && value == "web"));
            assert!(headers.iter().any(|(key,value)| key == "Authorization" && value == "Bearer fixture-token"));
            Ok(json!({"active":true,"claimed":false,"credit_num":500,"end_time":"2026-10-22 23:59:59"}))
        });
        let data = compensation_status(&service, &json!({"auth":{"accessToken":"fixture-token"}})).await.unwrap();
        let json = serde_json::to_value(data).unwrap();
        assert_eq!(json["creditNum"], 500);
        assert_eq!(json["claimable"], true);
        assert_eq!(json["endTime"], "2026-10-22 23:59:59");
        assert!(!json.to_string().contains("fixture-token"));
    }

    #[tokio::test]
    async fn claimed_inactive_and_failed_status_never_submit_a_claim() {
        for (active, claimed) in [(true,true),(false,true),(false,false)] {
            let service = BillingService::mock(move |url,_| {
                assert!(url.ends_with("/compensation-status"));
                Ok(json!({"active":active,"claimed":claimed}))
            });
            let result = claim_compensation(&service, &json!({})).await;
            if claimed { assert!(result.unwrap().already); }
            else { assert_eq!(result.unwrap_err().status_code, 409); }
        }
        let service = BillingService::mock(|url,_| {
            assert!(url.ends_with("/compensation-status"));
            Err(BillingError::new("fixture unavailable",504))
        });
        assert_eq!(claim_compensation(&service,&json!({})).await.unwrap_err().status_code,504);
    }

    #[tokio::test]
    async fn eligible_claim_is_submitted_once_and_unknown_credit_is_not_invented() {
        for fail in [false,true] {
            let writes = Arc::new(AtomicUsize::new(0));
            let count = writes.clone();
            let service = BillingService::mock_headers(move |url,body,headers| {
                assert!(url.starts_with("https://www.workbuddy.cn/"));
                assert!(headers.iter().any(|(k,v)| k == "X-Client-Platform" && v == "web"));
                assert_eq!(body,Some(&json!({})));
                if url.ends_with("/compensation-status") { return Ok(json!({"active":true,"claimed":false,"credit_num":500})); }
                assert!(url.ends_with("/claim-compensation"));
                count.fetch_add(1, Ordering::Relaxed);
                if fail { Err(BillingError::new("fixture lost response",504)) } else { Ok(json!({})) }
            });
            let result = claim_compensation(&service,&json!({})).await;
            assert_eq!(writes.load(Ordering::Relaxed),1);
            if fail { assert!(result.is_err()); }
            else { let outcome = result.unwrap(); assert!(outcome.claimed); assert!(!outcome.credit_known); }
        }
    }
}

fn parse_compensation_status(data: &Value) -> Result<CompensationStatus, BillingError> {
    let active = data.get("active").and_then(Value::as_bool)
        .ok_or_else(|| BillingError::new("补偿状态响应缺少有效的 active 字段", 502))?;
    // A missing claim flag on an active campaign must never enable a claim.
    let claimed = match data.get("claimed").and_then(Value::as_bool) {
        Some(value) => value,
        None if !active => false,
        None => return Err(BillingError::new("补偿状态响应缺少有效的 claimed 字段", 502)),
    };
    Ok(CompensationStatus {
        active,
        claimed,
        claimable: active && !claimed,
        credit_num: data.get("credit_num").and_then(Value::as_i64).filter(|n| *n >= 0),
        end_time: data.get("end_time").and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_owned),
    })
}

fn compensation_extra(session: &Value) -> Vec<(String, String)> {
    let mut headers = growth_extra(session, false);
    headers.push(("X-Client-Platform".into(), "web".into()));
    headers
}

/// Read-only upstream POST. Identity and egress come from the selected stored account.
pub async fn compensation_status(service: &BillingService, session: &Value) -> Result<CompensationStatus, BillingError> {
    let body = json!({});
    let call = service.call_billing(COMPENSATION_STATUS, CallOptions {
        session: Some(session), body: Some(&body), extra: compensation_extra(session), ..Default::default()
    }).await?;
    if call.code != Some(0) {
        return Err(BillingError::with_code("补偿状态响应缺少成功标记", 502, call.code));
    }
    parse_compensation_status(&call.data)
}

/// Recheck eligibility under the caller's account lock; never retry a claim write.
pub async fn claim_compensation(service: &BillingService, session: &Value) -> Result<GiftOutcome, BillingError> {
    let status = compensation_status(service, session).await?;
    if status.claimed {
        return Ok(GiftOutcome { claimed: false, already: true, credit_known: false, credit: 0,
            message: "补偿积分此前已领取过".into() });
    }
    if !status.claimable {
        return Err(BillingError::new("当前没有可领取的补偿活动", 409));
    }
    claim_gift(service, session, GiftKind::Compensation).await
}

/// 礼包/补偿的动作种类（API 层 `kind` 字段的合法值）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
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
#[derive(Debug, Clone)]
pub struct GiftOutcome {
    pub credit_known:bool,
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
    // refs blackcat.go:73/86 传的是空对象 body
    let body = json!({});
    let options = CallOptions {
        session: Some(session),
        body: Some(&body),
        // 非 0 code 也要拿回来自己判（幂等形态在 msg 文案里）
        expect_code_ok: false,
        extra: if kind == GiftKind::Compensation { compensation_extra(session) } else { growth_extra(session, false) },
        ..Default::default()
    };
    let call = service.call_billing(kind.spec(), options).await?;
    if call.code == Some(0) {
        let credit = call.data.get("credit").and_then(Value::as_i64).unwrap_or(0);
        return Ok(GiftOutcome {
            credit_known:call.data.get("credit").and_then(Value::as_i64).is_some(),
            claimed: true,
            already: false,
            credit,
            message: if call.data.get("credit").and_then(Value::as_i64).is_some(){format!("{}领取成功（+{credit}c）", kind.label())}else{format!("{}领取成功（上游未提供积分数）",kind.label())},
        });
    }
    // 非 0 code：上游 msg 含「已领取/已领过」时按面板既有口径翻成中性结果
    // （core::billing::checkin 的 checkin_completed_today 同款文案判据）；
    // 其余按失败透出
    let message = call.msg.clone().unwrap_or_default();
    if message.contains("已领取") || message.contains("已领过") {
        return Ok(GiftOutcome {
            credit_known:false,
            claimed: false,
            already: true,
            credit: 0,
            message: format!("{}此前已领取过", kind.label()),
        });
    }
    Err(BillingError::with_code(
        if message.is_empty() {
            format!("{}领取返回 code={:?}", kind.label(), call.code)
        } else {
            format!("{}领取失败: {message}", kind.label())
        },
        502,
        call.code,
    ))
}
