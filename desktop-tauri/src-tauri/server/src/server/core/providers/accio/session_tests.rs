//! Synthetic-only regressions. The ignored transport test uses 127.0.0.1.
use super::*;
use serde_json::json;
use std::future::IntoFuture;

fn credentials(token: &str) -> credentials::Credentials {
    credentials::Credentials::from_payload(&json!({"accessToken":token,"refreshToken":"synthetic-refresh","userId":"synthetic-user","mode":"intl","expiresAt":4102444800000i64,"sgcookie":"synthetic-cookie","routeRegion":"GLOBAL","teamId":"synthetic-team","deviceId":"synthetic-device"})).unwrap()
}

#[test]
fn business_http_200_does_not_hide_session_failure_or_lock() {
    use crate::server::core::auth_http::ApiResponse;
    for (code, status) in [("NOT_LOGIN", 401), ("423", 403), ("429", 429)] {
        let error = auth::payload(
            ApiResponse {
                status: 200,
                ok: true,
                payload: Some(json!({"success":false,"code":code,"message":"denied"})),
            },
            "fixture",
        )
        .unwrap_err();
        assert_eq!(error.status_code, status);
        if code == "423" {
            assert!(session::restricted(&error));
            assert!(!adk_error::allows_replay(&error));
        }
    }
    let value = auth::payload(
        ApiResponse {
            status: 200,
            ok: true,
            payload: Some(json!({"success":true,"data":{"userId":"synthetic-user"}})),
        },
        "fixture",
    )
    .unwrap();
    assert_eq!(auth::unwrap_data(value)["userId"], "synthetic-user");
}

#[test]
fn issuance_cookie_survives_storage_but_is_not_public_or_reused_on_relogin() {
    let (db, _temp) = crate::server::db::test_temp::TempDb::open("accio-session");
    let store = AccountStore::with_db(Some(db));
    let mut first = credentials("synthetic-first");
    let public = store.add_accio_account(&first, None, "fixture").unwrap();
    let id = public["id"].as_str().unwrap();
    assert!(!public.to_string().contains("synthetic-cookie"));
    let old = store.accio_account_record(id, "accio").unwrap();
    assert_eq!(old["sgcookie"], "synthetic-cookie");
    assert!(store
        .mark_accio_session_if_current(&old, "restricted")
        .is_ok());
    let blocked = store.accio_account_record(id, "accio").unwrap();
    assert!(auth::snapshot(&blocked).is_err());
    first.access_token = "synthetic-second".into();
    first.sgcookie = String::new();
    first.team_id = String::new();
    first.route_region = String::new();
    store.add_accio_account(&first, None, "fixture").unwrap();
    let new = store.accio_account_record(id, "accio").unwrap();
    assert!(auth::snapshot(&new).is_ok());
    assert!(new.get("sgcookie").is_none_or(Value::is_null));
    assert!(new.get("teamId").is_none_or(Value::is_null));
    assert!(matches!(
        store
            .mark_accio_session_if_current(&old, "restricted")
            .unwrap(),
        crate::server::core::account_store::CredentialWrite::Stale
    ));
    assert!(auth::snapshot(&store.accio_account_record(id, "accio").unwrap()).is_ok());
}

#[test]
fn profile_identity_and_route_validation_are_fail_closed() {
    let mut c = credentials("synthetic-access");
    assert!(auth::verify_profile(&mut c, &json!({"userId":"different-user"})).is_err());
    assert!(auth::verify_profile(&mut c, &json!({"name":"no identity"})).is_err());
    assert!(auth::verify_profile(
        &mut c,
        &json!({"userId":"synthetic-user","routeRegion":"bad\r\nvalue"})
    )
    .is_err());
    let mut c = credentials("synthetic-access");
    auth::verify_profile(&mut c,&json!({"userId":"synthetic-user","routeRegion":"GLOBAL","activeTeam":{"teamId":"verified-team"}})).unwrap();
    let plan = chat::build_plan(
        &c,
        &json!({"messages":[{"role":"user","content":"local fixture"}]}),
        "gemini-3-flash-preview",
        None,
    )
    .unwrap();
    assert!(plan
        .headers
        .contains(&("x-team-id".into(), "verified-team".into())));
    assert!(plan
        .headers
        .contains(&("x-accio-route-region".into(), "GLOBAL".into())));
    assert!(!plan.headers.iter().any(|(_, v)| v == "synthetic-cookie"));
}

/// Run this one test in its own process: it temporarily selects a loopback-only
/// upstream and a synthetic JS SDK. No official native addon is loaded.
#[tokio::test]
#[ignore = "isolated loopback session regression; run alone with --test-threads=1"]
async fn local_session_transport_regression() {
    use crate::server::core::upstream::usage::RequestTelemetry;
    use axum::{extract::State, routing::post, Json, Router};
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };
    #[derive(Clone)]
    struct Mock {
        sends: Arc<AtomicUsize>,
        refreshes: Arc<AtomicUsize>,
        mode: Arc<AtomicUsize>,
        requests: Arc<std::sync::Mutex<Vec<Value>>>,
    }
    async fn llm(
        State(m): State<Mock>,
        headers: axum::http::HeaderMap,
        axum::extract::Query(query): axum::extract::Query<
            std::collections::HashMap<String, String>,
        >,
        Json(body): Json<Value>,
    ) -> axum::response::Response {
        use axum::response::IntoResponse;
        m.sends.fetch_add(1, Ordering::SeqCst);
        m.requests.lock().unwrap().push(body.clone());
        assert!(body["message_id"]
            .as_str()
            .unwrap()
            .starts_with("AI_AccioWork_"));
        assert_ne!(body["request_id"], body["user_request_id"]);
        assert_eq!(body["agent_id"], "synthetic-agent");
        assert_eq!(body["round_number"], 3);
        assert_eq!(body["max_output_tokens"], 16384);
        for key in ["tenant", "iai_tag", "empid"] {
            assert!(body.get(key).is_none());
        }
        let expected =
            protocol::generate_content_url("http://local", body["request_id"].as_str().unwrap());
        assert_eq!(
            query.get("sg_k").unwrap(),
            expected.split("sg_k=").nth(1).unwrap()
        );
        let mode = m.mode.load(Ordering::SeqCst);
        assert_eq!(
            headers.get("x-bx-case").unwrap().to_str().unwrap(),
            mode.to_string()
        );
        if mode == 8 || mode == 9 {
            return (
                axum::http::StatusCode::from_u16(if mode == 8 { 200 } else { 401 }).unwrap(),
                [
                    ("bxpunish", "private-challenge"),
                    ("bxuuid", "private-uuid"),
                    ("x-request-id", "synthetic-gateway-request"),
                ],
                "private body",
            )
                .into_response();
        }
        if mode == 10 {
            return (
                axum::http::StatusCode::FOUND,
                [("location", "/local-redirected")],
                "",
            )
                .into_response();
        }
        if mode == 3 || mode == 4 {
            return ([("content-type","text/event-stream")],"data: {\"content\":{\"parts\":[{\"text\":\"partial\"}]}}\n\ndata: {\"error_code\":\"402\",\"error_message\":\"unauthorized\"}\n\n").into_response();
        }
        let frame = if mode == 2 {
            json!({"error_code":"423","error_message":"account locked"})
        } else if mode == 1 || body["token"] == "synthetic-old" {
            json!({"error_code":"402","error_message":"unauthorized"})
        } else {
            json!({"content":{"parts":[{"text":"OK"}]},"turn_complete":true})
        };
        (
            [("content-type", "text/event-stream")],
            format!("data: {frame}\n\n"),
        )
            .into_response()
    }
    async fn refresh(
        State(m): State<Mock>,
        headers: axum::http::HeaderMap,
        Json(body): Json<Value>,
    ) -> Json<Value> {
        m.refreshes.fetch_add(1, Ordering::SeqCst);
        assert_eq!(body["accessToken"], "synthetic-old");
        assert_eq!(headers["x-team-id"], "synthetic-team");
        assert_eq!(headers["x-accio-route-region"], "GLOBAL");
        assert_eq!(headers["x-deploy-target"], "desktop");
        match m.mode.load(Ordering::SeqCst) {
            5 => return Json(json!({"success":true,"data":{"accessToken":"incomplete"}})),
            6 => return Json(json!({"success":false,"code":"NOT_LOGIN","message":"denied"})),
            7 => return Json(json!({"success":false,"code":"ACCOUNT_LOCKED","message":"denied"})),
            _ => {}
        }
        Json(
            json!({"success":true,"data":{"accessToken":"synthetic-fresh","refreshToken":"synthetic-refresh-next","expiresAt":4102444800i64}}),
        )
    }
    async fn token(Json(body): Json<Value>) -> Json<Value> {
        assert_eq!(body["codeVerifier"], "synthetic-verifier");
        Json(
            json!({"success":true,"data":{"accessToken":"synthetic-issued","refreshToken":"synthetic-refresh","expiresAt":4102444800i64,"sgcookie":"synthetic-issued-cookie","sid":"synthetic-sid"}}),
        )
    }
    async fn profile() -> Json<Value> {
        Json(
            json!({"success":true,"data":{"userId":"synthetic-user","routeRegion":"GLOBAL","activeTeam":{"teamId":"synthetic-team"}}}),
        )
    }
    let m = Mock {
        sends: Arc::new(AtomicUsize::new(0)),
        refreshes: Arc::new(AtomicUsize::new(0)),
        mode: Arc::new(AtomicUsize::new(0)),
        requests: Arc::new(std::sync::Mutex::new(Vec::new())),
    };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server = tokio::spawn(
        axum::serve(
            listener,
            Router::new()
                .route("/api/adk/llm/generateContent", post(llm))
                .route("/api/auth/refresh_token", post(refresh))
                .route("/api/oauth/token", post(token))
                .route("/api/auth/userinfo", post(profile))
                .with_state(m.clone()),
        )
        .into_future(),
    );
    let previous = std::env::var_os("ACCIO_GATEWAY_BASE");
    let sg = std::env::var_os("ACCIO_SECURITY_GUARD");
    std::env::set_var("ACCIO_GATEWAY_BASE", format!("http://{addr}"));
    let old_module = std::env::var_os("ACCIO_SECURITY_GUARD_MODULE");
    let mock_module =
        std::env::temp_dir().join(format!("accio-synthetic-sdk-{}.cjs", std::process::id()));
    std::fs::write(&mock_module,r#"let cookie;module.exports={initUmid:async()=>{throw Error('environment initialization must not be used');},initUmidBySgCookie:async c=>{cookie=c;return 'synthetic-umid';},getSecurityToken:()=> 'synthetic-umid',getSecurityFactorsForWeb:()=>JSON.stringify({'x-bx-case':cookie.split('-').at(-1)})};"#).unwrap();
    std::env::set_var("ACCIO_SECURITY_GUARD_MODULE", &mock_module);
    std::env::set_var("ACCIO_SECURITY_GUARD", "required");
    let issued = oauth::exchange_code(
        Region::Global,
        "synthetic-code",
        "synthetic-verifier",
        "http://127.0.0.1/callback",
        None,
    )
    .await
    .unwrap();
    assert_eq!(issued.sgcookie, "synthetic-issued-cookie");
    assert_eq!(issued.sid, "synthetic-sid");
    assert_eq!(issued.team_id, "synthetic-team");
    for (mode, expected_sends, expected_refreshes) in [
        (0, 2, 1),
        (1, 2, 1),
        (2, 1, 0),
        (3, 1, 0),
        (4, 1, 0),
        (5, 1, 1),
        (6, 1, 1),
        (7, 1, 1),
        (8, 1, 0),
        (9, 1, 0),
        (10, 1, 0),
    ] {
        m.mode.store(mode, Ordering::SeqCst);
        m.sends.store(0, Ordering::SeqCst);
        m.requests.lock().unwrap().clear();
        m.refreshes.store(0, Ordering::SeqCst);
        let (db, _temp) = crate::server::db::test_temp::TempDb::open("accio-session");
        let store = AccountStore::with_db(Some(db));
        let mut c = credentials("synthetic-old");
        c.sgcookie = format!("synthetic-cookie-{mode}");
        let public = store.add_accio_account(&c, None, "fixture").unwrap();
        let id = public["id"].as_str().unwrap();
        let telemetry = Arc::new(RequestTelemetry::new());
        telemetry.note_attempt(Some(id), "fixture", "accio");
        telemetry.note_attempt_started("accio", "fixture");
        let conversation = crate::server::core::upstream::request::new_request_id();
        let body = json!({"model":"gemini-3-flash-preview","messages":[{"role":"user","content":"local fixture"}],
            "metadata":{"accio":{"conversation_id":conversation,"session_key":format!("agent:synthetic-agent:cid:{conversation}"),"round_number":3}}});
        let result = ACCIO_ADAPTER
            .forward_conversation(
                &store,
                id,
                &body,
                &HeaderMap::new(),
                None,
                mode == 4,
                &telemetry,
            )
            .await;
        let identity = telemetry.snapshot().attempts_detail[0].diagnostics["accioIdentity"].clone();
        assert_eq!(identity["conversation_id"], conversation);
        assert_eq!(identity["round_number"], 3);
        assert_eq!(
            telemetry.snapshot().attempts_detail[0].diagnostics["accioSecurityGuard"]["outcome"],
            "factors_generated"
        );
        {
            let requests = m.requests.lock().unwrap();
            if requests.len() == 2 {
                for key in [
                    "request_id",
                    "user_request_id",
                    "message_id",
                    "conversation_id",
                    "round_number",
                    "parent_span_id",
                ] {
                    assert_eq!(requests[0][key], requests[1][key], "replay changed {key}");
                }
            }
            if let Ok(crate::server::core::upstream::ForwardOutcome::Completion { body }) = &result
            {
                assert_eq!(
                    body["accio_context"]["message_id"],
                    requests[0]["message_id"]
                );
                assert_eq!(
                    body["accio_context"]["user_request_id"],
                    requests[0]["user_request_id"]
                );
            }
        }
        if mode >= 8 {
            let error = match result {
                Err(error) => error,
                Ok(_) => panic!("transport rejection expected"),
            };
            assert_eq!(
                error.code.as_deref(),
                Some(if mode == 10 {
                    "accio_transport_redirect"
                } else {
                    "accio_waf_block"
                })
            );
            assert!(!session::restricted(&error));
            assert!(!session::can_refresh(&error, false));
            assert_eq!(m.sends.load(Ordering::SeqCst), 1);
            assert_eq!(m.refreshes.load(Ordering::SeqCst), 0);
            assert!(store
                .accio_account_record(id, "accio")
                .unwrap()
                .get("sessionStatus")
                .is_none_or(Value::is_null));
            assert!(!error.payload().to_string().contains("private-"));
            continue;
        }
        if mode == 4 {
            use futures::StreamExt;
            let crate::server::core::upstream::ForwardOutcome::Stream { mut stream, .. } =
                result.unwrap()
            else {
                panic!("stream expected")
            };
            let mut bytes = Vec::new();
            while let Some(chunk) = stream.next().await {
                bytes.extend_from_slice(&chunk.unwrap());
            }
            let text = String::from_utf8(bytes).unwrap();
            assert!(text.contains("partial"));
            assert!(text.contains("accio_context"));
            assert!(text.contains(identity["message_id"].as_str().unwrap()));
            assert!(text.contains("error"));
        } else {
            assert_eq!(result.is_ok(), mode == 0);
        }
        assert_eq!(m.sends.load(Ordering::SeqCst), expected_sends);
        assert_eq!(m.refreshes.load(Ordering::SeqCst), expected_refreshes);
        if mode == 0 {
            let record = store.accio_account_record(id, "accio").unwrap();
            assert_eq!(record["accessToken"], "synthetic-fresh");
            assert_eq!(record["sgcookie"], format!("synthetic-cookie-{mode}"));
        } else {
            if mode >= 5 {
                let record = store.accio_account_record(id, "accio").unwrap();
                assert_eq!(record["accessToken"], "synthetic-old");
                assert_eq!(record["refreshToken"], "synthetic-refresh");
                assert_eq!(record["sgcookie"], format!("synthetic-cookie-{mode}"));
                assert_eq!(
                    record["sessionStatus"],
                    match mode {
                        5 => "refresh_failed",
                        6 => "login_required",
                        _ => "restricted",
                    }
                );
            }
            let second = ACCIO_ADAPTER
                .forward_conversation(
                    &store,
                    id,
                    &body,
                    &HeaderMap::new(),
                    None,
                    false,
                    &telemetry,
                )
                .await;
            assert!(second.is_err());
            assert_eq!(m.sends.load(Ordering::SeqCst), expected_sends);
            assert_eq!(m.refreshes.load(Ordering::SeqCst), expected_refreshes);
        }
    }
    if let Some(value) = previous {
        std::env::set_var("ACCIO_GATEWAY_BASE", value);
    } else {
        std::env::remove_var("ACCIO_GATEWAY_BASE");
    }
    if let Some(value) = sg {
        std::env::set_var("ACCIO_SECURITY_GUARD", value);
    } else {
        std::env::remove_var("ACCIO_SECURITY_GUARD");
    }
    super::security_guard::reset_worker_for_test().await;
    if let Some(value) = old_module {
        std::env::set_var("ACCIO_SECURITY_GUARD_MODULE", value);
    } else {
        std::env::remove_var("ACCIO_SECURITY_GUARD_MODULE");
    }
    std::fs::remove_file(mock_module).unwrap();
    server.abort();
}

#[test]
fn opaque_cookie_is_not_treated_as_a_bearer_token() {
    assert_eq!(
        credentials::security_cookie(&json!({"sgcookie":"Bearer synthetic-cookie"})).unwrap(),
        "Bearer synthetic-cookie"
    );
    assert!(credentials::security_cookie(&json!({"sgcookie":"x".repeat(16000)})).is_ok());
    assert!(credentials::security_cookie(&json!({"sgcookie":"x".repeat(65537)})).is_err());
    assert!(credentials::security_cookie(&json!({"sgcookie":"bad\r\ncookie"})).is_err());
}
