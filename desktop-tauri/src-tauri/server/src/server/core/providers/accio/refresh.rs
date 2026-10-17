//! Accio 凭证续期：同一凭证只刷一次，保存时确认账号未被重新导入或删除。
//!
//! 上游：`POST /api/auth/refresh_token`，body `{accessToken, refreshToken}`
//! → `{accessToken, refreshToken, expiresAt}`（桌面端同名链路，见
//! `core::login` 里那套账号切换的安全版是 `/api/auth/safe/refresh_token`，
//! 本网关不做账号切换，走普通那条）。
//!
//! 续期响应必须包含完整令牌和有效到期时间；不完整响应不能覆盖旧会话。

use std::sync::OnceLock;

use serde_json::Value;

use crate::server::core::account_store::{AccountStore, CredentialWrite};
use crate::server::core::providers::refresh_flight::{self, Join, Table};
use crate::server::errors::GatewayError;
use crate::server::logging;

use super::auth;
use super::credentials::{self, Credentials};
use super::endpoints;

static FLIGHTS: OnceLock<Table<Credentials>> = OnceLock::new();

/// 取账号记录 + 凭证（不刷新）。
///
/// `region` 必给：两个地区是两家 provider，取记录时按它过滤（见
/// `AccountStore::accio_account_record`）。
pub fn snapshot(
    store: &AccountStore,
    account_id: &str,
    region: super::endpoints::Region,
) -> Result<(Value, Credentials), GatewayError> {
    let record = store
        .accio_account_record(account_id, region.provider_id())
        .ok_or_else(|| GatewayError::with_status(404, "Accio 账号不存在，请先添加账号"))?;
    let credentials = auth::snapshot(&record)?;
    Ok((record, credentials))
}

/// 确保拿到可用凭证（`force = true` 时不看临期窗口，401 之后强制刷一次）。
pub async fn ensure_fresh(
    store: &AccountStore,
    account_id: &str,
    region: super::endpoints::Region,
    force: bool,
) -> Result<Credentials, GatewayError> {
    let (record, credentials) = snapshot(store, account_id, region)?;
    if !force && !credentials.expiring() {
        return Ok(credentials);
    }
    if !credentials.can_refresh() {
        return Err(super::session::blocked_error("login_required"));
    }
    let key = format!(
        "{}:{}:{}:{}:{}",
        store.file_string(),
        account_id,
        credentials.region.edition(),
        refresh_flight::fingerprint(&credentials.access_token),
        refresh_flight::fingerprint(&credentials.refresh_token),
    );
    let result = match FLIGHTS.get_or_init(Table::new).join(&key) {
        Join::Waiter(waiter) => waiter.wait().await,
        Join::Leader(leader) => {
            let result = refresh_and_save(store, &record, &credentials).await;
            leader.finish(result.clone());
            result
        }
    };
    if let Err(error) = &result {
        super::session::record_failure(store, &record, error);
    }
    result
}

async fn refresh_and_save(
    store: &AccountStore,
    record: &Value,
    credentials: &Credentials,
) -> Result<Credentials, GatewayError> {
    let proxy = auth::account_proxy(record)?;
    let body = serde_json::json!({
        "accessToken": credentials.access_token,
        "refreshToken": credentials.refresh_token,
    });
    let response = auth::post_for_session(
        credentials,
        endpoints::REFRESH_TOKEN_PATH,
        &body,
        proxy.as_ref(),
    )
    .await?;
    let data = auth::payload(response, "凭证续期").map(auth::unwrap_data)?;
    let token = credentials::secret(&data, &["accessToken", "access_token", "token"])?;
    if token.is_empty() {
        return Err(GatewayError::with_status(
            502,
            "Accio 续期响应缺少 accessToken，旧凭证未被覆盖",
        ));
    }
    let mut fresh = credentials.clone();
    if data.get("sgcookie").is_some() {
        fresh.sgcookie = credentials::security_cookie(&data)?;
    }
    if data.get("sid").is_some() {
        fresh.sid = credentials::secret(&data, &["sid"])?;
    }
    fresh.access_token = token;
    let refresh = credentials::secret(&data, &["refreshToken", "refresh_token"])?;
    let expiry = credentials::timestamp(data.get("expiresAt").or_else(|| data.get("expires_at")));
    if refresh.is_empty() || expiry.is_none_or(|at| at <= logging::now_ms()) {
        return Err(
            GatewayError::with_status(502, "Accio 续期响应不完整，旧凭证未被覆盖")
                .with_code("accio_refresh_invalid_response"),
        );
    }
    let user = credentials::text(&data, &["userId", "user_id"]);
    if !user.is_empty() && !credentials.user_id.is_empty() && user != credentials.user_id {
        return Err(GatewayError::with_status(
            409,
            "Accio 续期响应账号身份不一致，旧凭证未被覆盖",
        ));
    }
    fresh.refresh_token = refresh;
    fresh.expires_at = expiry;
    // 身份/地区不允许被续期结果改掉：那意味着串号（换到了另一个账号的凭证）
    if !credentials.user_id.is_empty() {
        fresh.user_id = credentials.user_id.clone();
    }
    fresh.device_id = credentials.device_id.clone();
    match store
        .update_accio_credentials_if_current(record, &fresh)
        .map_err(|error| GatewayError::with_status(error.status_code, error.message))?
    {
        CredentialWrite::Written => Ok(fresh),
        CredentialWrite::Stale => {
            // 回写被拒（记录已被换掉）：用最新那份，别把旧结果当成功用出去
            let id = record.get("id").and_then(Value::as_str).unwrap_or("");
            snapshot(store, id, credentials.region).map(|(_, credentials)| credentials)
        }
    }
}

/// Another in-flight request may already have refreshed this exact issuance.
/// Never force a second rotation of a now-current refresh token.
pub async fn after_unauthorized(
    store: &AccountStore,
    id: &str,
    region: super::endpoints::Region,
    rejected: &str,
) -> Result<Credentials, GatewayError> {
    let (_, current) = snapshot(store, id, region)?;
    if current.access_token != rejected {
        return Ok(current);
    }
    ensure_fresh(store, id, region, true).await
}
