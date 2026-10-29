//! Accio 凭证续期：同一凭证只刷一次，保存时确认账号未被重新导入或删除。
//!
//! 上游：`POST /api/auth/refresh_token`，body `{accessToken, refreshToken}`
//! → `{accessToken, refreshToken, expiresAt}`（桌面端同名链路，见
//! `core::login` 里那套账号切换的安全版是 `/api/auth/safe/refresh_token`，
//! 本网关不做账号切换，走普通那条）。
//!
//! ── 上游没回过期时间怎么办 ──────────────────────────────────
//! `expiresAt` 缺失时给一个保守的默认值（1 小时）：它只影响「下次要不要续期」
//! 的判定，给短了会多刷一次（无害），给长了会让一个已经失效的 token 留着不走
//! 续期路径（有害）。桌面端的 token 有效期在小时级，1 小时是安全的下界。

use std::sync::OnceLock;

use serde_json::Value;

use agent2api_provider_sdk::PluginCtx;

use crate::flight::{Join, Table};
use crate::errors::GatewayError;
use crate::logging;

use super::auth;
use super::credentials::{self, Credentials};
use super::endpoints;


static FLIGHTS: OnceLock<Table<Credentials>> = OnceLock::new();

/// 取账号记录 + 凭证（不刷新）。
///
/// `region` 必给：两个地区是两家 provider，取记录时按它过滤（`store::record`
/// 已经按 provider 过滤，这里再核一次地区 —— 记录里的 `mode` 与 provider
/// 不一致时说明这条账号是从另一家迁过来的脏数据）。
pub async fn snapshot(
    ctx: &PluginCtx,
    account_id: &str,
    region: super::endpoints::Region,
) -> Result<(Value, Credentials), GatewayError> {
    let record = crate::store::record(ctx, region.provider_id(), account_id).await?;
    if !record.is_object() {
        return Err(GatewayError::with_status(404, "Accio 账号不存在，请先添加账号"));
    }
    let credentials = auth::snapshot(&record)?;
    Ok((record, credentials))
}

/// 确保拿到可用凭证（`force = true` 时不看临期窗口，401 之后强制刷一次）。
pub async fn ensure_fresh(
    ctx: &PluginCtx,
    account_id: &str,
    region: super::endpoints::Region,
    force: bool,
) -> Result<Credentials, GatewayError> {
    let (record, credentials) = snapshot(ctx, account_id, region).await?;
    if !force && !credentials.expiring() {
        return Ok(credentials);
    }
    if !credentials.can_refresh() {
        return Err(super::session::blocked_error("login_required"));
    }
    // 单飞键：插件只有一个进程、一个账号库，所以不需要网关那份 `file_string()`
    // 前缀（那是为了区分同一进程里挂多个库的情形）。
    let key = format!(
        "accio:{}:{}:{}:{}",
        account_id,
        credentials.region.edition(),
        crate::flight::fingerprint(&credentials.access_token),
        crate::flight::fingerprint(&credentials.refresh_token),
    );
    let result = match FLIGHTS.get_or_init(Table::new).join(&key) {
        Join::Waiter(waiter) => waiter.wait().await,
        Join::Leader(leader) => {
            let result = refresh_and_save(ctx, &record, &credentials).await;
            leader.finish(result.clone());
            result
        }
    };
    if let Err(error)=&result{super::session::record_failure(ctx,&record,error);}
    result
}

async fn refresh_and_save(
    ctx: &PluginCtx,
    record: &Value,
    credentials: &Credentials,
) -> Result<Credentials, GatewayError> {
    let proxy = auth::account_proxy(record)?;
    let body = serde_json::json!({
        "accessToken": credentials.access_token,
        "refreshToken": credentials.refresh_token,
    });
    let response = auth::post_for_session(credentials, endpoints::REFRESH_TOKEN_PATH, &body, proxy.as_ref())
        .await?;
    let data = auth::payload(response, "凭证续期").map(auth::unwrap_data)?;
    let token = credentials::secret(&data, &["accessToken", "access_token", "token"])?;
    if token.is_empty() {
        return Err(GatewayError::with_status(502, "Accio 续期响应缺少 accessToken，旧凭证未被覆盖"));
    }
    let mut fresh = credentials.clone();
    apply_security_context(&data, &mut fresh)?;
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
        // OAuth's userId may use a different namespace from userinfo.id.
        // Never accept that difference by itself: authenticate the newly issued
        // token against the same profile endpoint used when adding this account.
        let response = auth::post_for_session(
            &fresh, endpoints::USER_INFO_PATH,
            &serde_json::json!({"accessToken":fresh.access_token}), proxy.as_ref(),
        ).await?;
        let profile = auth::payload(response, "续期身份核验").map(auth::unwrap_data)?;
        verify_refreshed_profile(credentials, &profile)?;
        logging::log("[Accio]", "续期响应身份字段不同，已通过新凭证的用户资料确认仍为原账号");
    }
    fresh.refresh_token = refresh;
    fresh.expires_at = expiry;
    // 身份/地区不允许被续期结果改掉：那意味着串号（换到了另一个账号的凭证）
    if !credentials.user_id.is_empty() {
        fresh.user_id = credentials.user_id.clone();
    }
    fresh.device_id = credentials.device_id.clone();
    // 比较再写：`expect` 是读到时的 secret，网关只在它没变时才写。
    // 与网关那份 `update_accio_credentials_if_current` 的「逐键比对 5 个字段」
    // 同一语义（`store::save` 的通用形态）。
    let expect = crate::store::secret_view(record);
    let next = merge_credentials(&expect, &fresh);
    let id = record.get("id").and_then(Value::as_str).unwrap_or("");
    if id.is_empty() {
        return Err(GatewayError::with_status(
            409,
            "Accio 续期结果无法写回（账号记录缺 id），请重新添加该账号",
        ));
    }
    if crate::store::save(ctx, id, &expect, &next).await? {
        return Ok(fresh);
    }
    // 回写被拒（记录已被换掉）：用最新那份，别把旧结果当成功用出去
    snapshot(ctx, id, credentials.region)
        .await
        .map(|(_, credentials)| credentials)
}

/// Compare the authoritative profile identity without importing a different
/// identity, display name, routing configuration or device into the saved record.
fn verify_refreshed_profile(original: &Credentials, profile: &Value) -> Result<(), GatewayError> {
    let mut expected = original.clone();
    auth::verify_profile(&mut expected, profile).map_err(|error| {
        GatewayError::with_status(error.status_code,
            "Accio 续期凭证未通过原账号身份核验，旧凭证未被覆盖")
            .with_code("accio_refresh_identity_unverified")
    })
}

/// A missing field preserves the current session; an explicit clear is authoritative.
fn apply_security_context(data: &Value, fresh: &mut Credentials) -> Result<(), GatewayError> {
    if data.get("sgcookie").is_some() || data.get("sgCookie").is_some() {
        fresh.sgcookie = credentials::security_cookie(data)?;
    }
    if data.get("sid").is_some() {
        fresh.sid = credentials::secret(data, &["sid"])?;
    }
    Ok(())
}

/// Preserve account metadata while canonicalizing the security cookie. In contrast
/// to optional token fields, an explicit cookie clear must survive the next read.
fn merge_credentials(expect: &Value, fresh: &Credentials) -> Value {
    let mut next = expect.clone();
    if let (Some(obj), Some(fields)) = (next.as_object_mut(), fresh.to_value().as_object()) {
        for (key, value) in fields {
            if !value.is_null() && !value.as_str().is_some_and(str::is_empty) {
                obj.insert(key.clone(), value.clone());
            }
        }
        if fresh.sgcookie.is_empty() { obj.remove("sgcookie"); }
        if fresh.sid.is_empty() { obj.remove("sid"); }
        obj.remove("sgCookie");
        for key in ["sessionStatus", "sessionTokenBinding", "sessionRetryAt"] { obj.remove(key); }
    }
    next
}
pub async fn after_unauthorized(ctx:&PluginCtx,id:&str,region:super::endpoints::Region,rejected:&str)->Result<Credentials,GatewayError>{
 let (_,current)=snapshot(ctx,id,region).await?; if current.access_token!=rejected{return Ok(current);} ensure_fresh(ctx,id,region,true).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn refresh_identity_uses_authenticated_profile_without_replacing_account_metadata() {
        let original=Credentials::from_payload(&json!({"accessToken":"old", "userId":"profile-user", "nickname":"local-name", "deviceId":"stable-device"})).unwrap();
        assert!(verify_refreshed_profile(&original,&json!({"id":"profile-user","userId":"oauth-namespace-id","nickname":"upstream-name"})).is_ok());
        assert_eq!(original.name,"local-name");assert_eq!(original.device_id,"stable-device");
        let other=verify_refreshed_profile(&original,&json!({"id":"different-profile"})).unwrap_err();assert_eq!(other.status_code,409);
        assert_eq!(other.code.as_deref(),Some("accio_refresh_identity_unverified"));
        assert!(verify_refreshed_profile(&original,&json!({"nickname":"no-identity"})).is_err());
    }
    #[test]
    fn refresh_cookie_alias_missing_clear_and_invalid_are_distinct() {
        let mut fresh = Credentials::from_payload(&json!({"accessToken":"old", "sgcookie":"old-cookie"})).unwrap();
        apply_security_context(&json!({}), &mut fresh).unwrap();assert_eq!(fresh.sgcookie,"old-cookie");
        apply_security_context(&json!({"sgCookie":" exact/new+cookie== "}), &mut fresh).unwrap();assert_eq!(fresh.sgcookie," exact/new+cookie== ");
        assert!(apply_security_context(&json!({"sgcookie":42}), &mut fresh).is_err());assert_eq!(fresh.sgcookie," exact/new+cookie== ");
        apply_security_context(&json!({"sgcookie":null}), &mut fresh).unwrap();assert!(fresh.sgcookie.is_empty());
    }
    #[test]
    fn refreshed_cookie_is_canonical_and_explicit_clear_does_not_resurrect_old_cookie() {
        let original = json!({"accessToken":"old", "refreshToken":"refresh", "sgcookie":"old-cookie", "sgCookie":"alias-cookie", "deviceId":"stable", "sessionStatus":"refresh_failed", "custom":"keep"});
        let mut fresh = Credentials::from_payload(&original).unwrap();
        fresh.access_token="new".into();fresh.sgcookie="new-cookie".into();
        let merged=merge_credentials(&original,&fresh);
        assert_eq!(merged["sgcookie"],"new-cookie");assert!(merged.get("sgCookie").is_none());assert_eq!(merged["custom"],"keep");assert_eq!(merged["deviceId"],"stable");assert!(merged.get("sessionStatus").is_none());
        fresh.sgcookie.clear();let cleared=merge_credentials(&original,&fresh);
        assert!(cleared.get("sgcookie").is_none());assert!(cleared.get("sgCookie").is_none());
        assert_eq!(Credentials::from_payload(&cleared).unwrap().sgcookie, "");
    }
}

#[cfg(test)]
mod local_refresh_tests {
    use super::*;
    use agent2api_provider_sdk::{ctx::CallGateway, StoreError};
    use agent2api_provider_protocol::{HostEnv, methods::plugin::STORE_UPDATE};
    use axum::{extract::State, routing::post, Json, Router};
    use std::{sync::{Arc,Mutex},future::Future,pin::Pin};
    use serde_json::json;
    struct Writes { expected:Value, saved:Mutex<Option<Value>> }
    impl CallGateway for Writes {
        fn call<'a>(&'a self, method:&'a str, params:Value)->Pin<Box<dyn Future<Output=Result<Value,StoreError>>+Send+'a>> {
            Box::pin(async move {
                assert_eq!(method,STORE_UPDATE);assert_eq!(params["account"],"fixture-account");assert_eq!(params["expect"],self.expected);
                *self.saved.lock().unwrap()=Some(params["secret"].clone());Ok(json!({"updated":true}))
            })
        }
    }
    #[tokio::test]
    #[ignore = "isolated loopback refresh/profile contract; run alone with --ignored --test-threads=1"]
    async fn local_refresh_identity_regression() {
        async fn renew(Json(body):Json<Value>)->Json<Value> {
            assert_eq!(body["accessToken"],"old-token");
            Json(json!({"success":true,"data":{"accessToken":"new-token","refreshToken":"new-refresh","expiresAt":logging::now_ms()+600_000,"userId":"oauth-namespace","sgCookie":null}}))
        }
        async fn profile(State((kind,calls)):State<(u8,Arc<Mutex<usize>>)>,Json(body):Json<Value>)->Json<Value> {
            assert_eq!(body["accessToken"],"new-token");*calls.lock().unwrap()+=1;
            Json(match kind {0=>json!({"success":true,"data":{"id":"profile-user","nickname":"upstream-name"}}),1=>json!({"success":true,"data":{"id":"another-user"}}),_=>json!({"success":false,"data":{"id":"profile-user"}})})
        }
        let prior=std::env::var_os("ACCIO_GATEWAY_BASE");
        let prior_validation=std::env::var_os("AIBUDDY_VALIDATION_MODE");
        std::env::set_var("AIBUDDY_VALIDATION_MODE","1");
        for kind in 0..3 {
            let calls=Arc::new(Mutex::new(0));let listener=tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            std::env::set_var("ACCIO_GATEWAY_BASE",format!("http://{}",listener.local_addr().unwrap()));
            let router=Router::new().route(endpoints::REFRESH_TOKEN_PATH,post(renew)).route(endpoints::USER_INFO_PATH,post(profile)).with_state((kind,calls.clone()));
            let server=tokio::spawn(async move {axum::serve(listener,router).await.unwrap()});
            let record=json!({"id":"fixture-account","provider":"accio","name":"local-account","mode":"intl","userId":"profile-user","accessToken":"old-token","refreshToken":"old-refresh","deviceId":"stable-device","sgcookie":"old-cookie","customRule":"keep"});
            let callbacks=Arc::new(Writes{expected:crate::store::secret_view(&record),saved:Mutex::new(None)});
            let ctx=PluginCtx::from_gateway(HostEnv{host_version:"fixture".into(),data_dir:std::env::temp_dir().to_string_lossy().into(),target:"fixture".into(),proxy:String::new(),debug_traffic:false,loopback_port:0},callbacks.clone());
            let old=Credentials::from_payload(&record).unwrap();let result=refresh_and_save(&ctx,&record,&old).await;
            assert_eq!(*calls.lock().unwrap(),1);
            let saved=callbacks.saved.lock().unwrap();
            if kind==0 {assert!(result.is_ok());let saved=saved.as_ref().unwrap();assert_eq!(saved["accessToken"],"new-token");assert_eq!(saved["userId"],"profile-user");assert_eq!(saved["deviceId"],"stable-device");assert_eq!(saved["customRule"],"keep");assert!(saved.get("sgcookie").is_none());assert!(saved.get("sgCookie").is_none());}
            else {assert!(result.is_err());assert!(saved.is_none(),"unverified or rejected identities must never reach persistence");}
            server.abort();
        }
        match prior {Some(v)=>std::env::set_var("ACCIO_GATEWAY_BASE",v),None=>std::env::remove_var("ACCIO_GATEWAY_BASE")};
        match prior_validation {Some(v)=>std::env::set_var("AIBUDDY_VALIDATION_MODE",v),None=>std::env::remove_var("AIBUDDY_VALIDATION_MODE")};
    }
}
