//! No real login/account. Ignored transport coverage binds only 127.0.0.1.
use super::{
    adk_error,
    endpoints::{self, Region},
    login_http::{Context, Stage},
    oauth,
};
use serde_json::{json, Value};

#[test]
fn login_errors_keep_stage_http_code_but_never_upstream_free_text() {
    let context = Context::new(Region::Global, Some("synthetic-device")).unwrap();
    let sent = json!({"code":"secret-code","codeVerifier":"secret-verifier","accessToken":"secret-access","refreshToken":"secret-refresh","sgcookie":"secret-cookie"});
    let echoed="secret-code secret-verifier secret-access secret-refresh secret-cookie alice@example.org https://example.org/callback?token=secret-url";
    for (status, code, expected_reason, expected_status) in [
        (200, "NOT_LOGIN", "not_login", 401),
        (200, "ACCOUNT_LOCKED", "account_restricted", 403),
        (400, "invalid_grant", "invalid_grant", 400),
        (400, "PKCE_MISMATCH", "pkce_mismatch", 400),
        (400, "REDIRECT_URI_MISMATCH", "redirect_mismatch", 400),
        (400, "invalid_client", "invalid_client", 400),
        (429, "429", "quota", 429),
        (403, "DENIED", "forbidden", 403),
        (503, "UNKNOWN", "upstream_failure", 502),
    ] {
        let v = json!({"success":false,"error":{"code":code,"message":echoed},"request_id":"0123456789abcdef"});
        let e = context
            .parse(
                Stage::TokenExchange,
                status,
                &serde_json::to_vec(&v).unwrap(),
                json!({"stage":"token_exchange"}),
                &sent,
            )
            .err()
            .unwrap();
        assert_eq!(e.status_code, expected_status);
        let details = e.details.as_ref().unwrap();
        assert_eq!(details["login_diagnostic"]["http_status"], status);
        assert_eq!(details["login_diagnostic"]["business_code"], code);
        assert_eq!(details["login_diagnostic"]["reason"], expected_reason);
        assert_eq!(
            details["login_diagnostic"]["upstream_request_id"],
            "0123456789abcdef"
        );
        let output = format!("{} {details}", e.message);
        for secret in [
            "secret-code",
            "secret-verifier",
            "secret-access",
            "secret-refresh",
            "secret-cookie",
            "alice@example.org",
            "example.org",
            "secret-url",
        ] {
            assert!(!output.contains(secret), "leaked {secret}");
        }
        assert!(e.message.contains("token_exchange"));
    }
}

#[test]
fn html_invalid_json_empty_and_incomplete_envelopes_are_distinct() {
    let c = Context::new(Region::Cn, Some("synthetic-device")).unwrap();
    for (status, bytes, reason, format) in [
        (
            403,
            "<html>bixi-intl.alicdn.com/punish?token=secret</html>",
            "security_challenge",
            "html",
        ),
        (200, "<html>secret</html>", "invalid_json", "html"),
        (200, "not-json secret", "invalid_json", "non_json"),
        (502, "", "invalid_json", "empty"),
        (
            200,
            "{\"data\":{\"accessToken\":\"secret\"}}",
            "business_failure",
            "json",
        ),
        (
            200,
            "{\"success\":true,\"data\":null}",
            "invalid_envelope",
            "json",
        ),
    ] {
        let e = c
            .parse(
                Stage::UserInfo,
                status,
                bytes.as_bytes(),
                json!({"stage":"userinfo"}),
                &json!({}),
            )
            .err()
            .unwrap();
        assert_eq!(
            e.details.as_ref().unwrap()["login_diagnostic"]["reason"],
            reason
        );
        assert_eq!(
            e.details.as_ref().unwrap()["login_diagnostic"]["response_format"],
            format
        );
        assert!(e.message.contains("userinfo"));
        assert!(!format!("{} {:?}", e.message, e.details).contains("secret"));
    }
}

#[test]
fn nested_aliases_null_codes_and_echoed_identifiers_are_handled() {
    for v in [
        json!({"code":null,"error":{"code":"NOT_LOGIN","errorMsg":"denied"}}),
        json!({"error":"NOT_LOGIN","error_description":"denied"}),
    ] {
        assert_eq!(adk_error::error_code(&v), "NOT_LOGIN");
        assert_eq!(adk_error::error_message(&v), "denied");
        assert_eq!(
            adk_error::from_payload(200, &v, "fallback").status_code,
            401
        );
    }
    assert_eq!(adk_error::error_code(&json!({"code":null})), "");
    let c = Context::new(Region::Global, Some("synthetic-device")).unwrap();
    let token = "0123456789abcdef";
    let e = c
        .parse(
            Stage::UserInfo,
            403,
            &serde_json::to_vec(&json!({"success":false,"code":token,"request_id":token})).unwrap(),
            json!({"upstream_request_id":token}),
            &json!({"accessToken":token}),
        )
        .err()
        .unwrap();
    assert!(!format!("{} {:?}", e.message, e.details).contains(token));
    let e = c
        .parse(
            Stage::UserInfo,
            403,
            &serde_json::to_vec(&json!({"success":false,"code":token,"accessToken":token}))
                .unwrap(),
            json!({}),
            &json!({}),
        )
        .err()
        .unwrap();
    assert!(!format!("{} {:?}", e.message, e.details).contains(token));
}

/// Run alone with --ignored --test-threads=1; no native SDK is needed or loaded.
#[tokio::test]
#[ignore = "loopback-only OAuth regression; isolated process required"]
async fn local_login_transport_regression() {
    use axum::{
        extract::State,
        http::{HeaderMap, StatusCode},
        response::IntoResponse,
        routing::post,
        Json, Router,
    };
    use std::{
        future::IntoFuture,
        sync::{
            atomic::{AtomicUsize, Ordering},
            Arc, Mutex,
        },
    };
    #[derive(Clone)]
    struct Mock {
        mode: Arc<AtomicUsize>,
        exchange: Arc<AtomicUsize>,
        profile: Arc<AtomicUsize>,
        device: Arc<Mutex<String>>,
    }
    fn verify(headers: &HeaderMap, body: &Value) {
        assert!(headers.get("authorization").is_none());
        assert!(headers.get("cookie").is_none());
        assert_eq!(headers["x-utdid"], body["utdid"].as_str().unwrap());
        assert_eq!(headers["x-app-version"], body["version"].as_str().unwrap());
        assert_eq!(
            headers["x-platform"],
            match std::env::consts::OS {
                "macos" => "pc-mac",
                "windows" => "pc-win",
                _ => "pc-linux",
            }
        );
        assert_eq!(
            headers["x-os"],
            match std::env::consts::OS {
                "macos" => "darwin",
                "windows" => "win32",
                other => other,
            }
        );
        assert_eq!(headers["x-deploy-target"], "desktop");
        assert_eq!(headers["x-source"], "ACCIO_DESKTOP");
        assert_eq!(headers["x-language"], "en");
        assert_eq!(headers["x-locale"], "en-US");
        assert_eq!(headers["x-package-region"], "GLOBAL");
        assert!(!headers["eagleeye-traceid"].is_empty());
    }
    async fn token(
        State(m): State<Mock>,
        headers: HeaderMap,
        Json(body): Json<Value>,
    ) -> axum::response::Response {
        m.exchange.fetch_add(1, Ordering::SeqCst);
        verify(&headers, &body);
        assert_eq!(body["code"], "synthetic-code");
        assert_eq!(body["codeVerifier"], "synthetic-verifier");
        assert_eq!(body["clientId"], "accio-work");
        assert_eq!(body["redirectUri"], "http://127.0.0.1/callback?keep=exact");
        *m.device.lock().unwrap() = body["utdid"].as_str().unwrap().to_string();
        match m.mode.load(Ordering::SeqCst) {
            1=>return (StatusCode::BAD_REQUEST,Json(json!({"success":false,"error":{"code":"invalid_grant","message":"synthetic-code synthetic-verifier"}}))).into_response(),
            4=>return (StatusCode::FORBIDDEN,"<html>bixi-intl.alicdn.com/punish?secret=synthetic-code</html>").into_response(),
            5=>return Json(json!({"success":true,"data":{"accessToken":"synthetic-access"}})).into_response(),
            _=>{}
        }
        Json(json!({"success":true,"data":{"accessToken":"synthetic-access","refreshToken":"synthetic-refresh","expiresAt":4102444800i64,"sgcookie":"synthetic-cookie","sid":"synthetic-sid","userId":"synthetic-user"}})).into_response()
    }
    async fn profile(
        State(m): State<Mock>,
        headers: HeaderMap,
        Json(body): Json<Value>,
    ) -> axum::response::Response {
        m.profile.fetch_add(1, Ordering::SeqCst);
        verify(&headers, &body);
        assert_eq!(body["accessToken"], "synthetic-access");
        assert_eq!(body["utdid"], *m.device.lock().unwrap());
        match m.mode.load(Ordering::SeqCst) {
            2=>return (StatusCode::FORBIDDEN,Json(json!({"success":false,"message":"synthetic-access synthetic-cookie alice@example.org"}))).into_response(),
            3=>return Json(json!({"success":false,"error":{"code":"NOT_LOGIN","message":"synthetic-access"}})).into_response(),
            6=>return Json(json!({"success":true,"data":{"userId":"another-user"}})).into_response(),
            7=>return Json(json!({"success":true,"data":{"name":"missing-id"}})).into_response(),
            _=>{}
        }
        Json(json!({"success":true,"data":{"userId":"synthetic-user","routeRegion":"GLOBAL","activeTeam":{"teamId":"synthetic-team"}}})).into_response()
    }
    let mock = Mock {
        mode: Arc::new(AtomicUsize::new(0)),
        exchange: Arc::new(AtomicUsize::new(0)),
        profile: Arc::new(AtomicUsize::new(0)),
        device: Arc::new(Mutex::new(String::new())),
    };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server = tokio::spawn(
        axum::serve(
            listener,
            Router::new()
                .route(endpoints::OAUTH_TOKEN_PATH, post(token))
                .route(endpoints::USER_INFO_PATH, post(profile))
                .with_state(mock.clone()),
        )
        .into_future(),
    );
    let previous = std::env::var_os("ACCIO_GATEWAY_BASE");
    std::env::set_var("ACCIO_GATEWAY_BASE", format!("http://{addr}"));
    let mut saved_device = None;
    for (mode, stage, http, reason, profile_calls) in [
        (0, "", 0, "", 1),
        (1, "token_exchange", 400, "invalid_grant", 0),
        (2, "userinfo", 403, "forbidden", 1),
        (3, "userinfo", 200, "not_login", 1),
        (4, "token_exchange", 403, "security_challenge", 0),
        (5, "token_exchange", 200, "incomplete_token", 0),
        (6, "userinfo", 200, "identity_mismatch", 1),
        (7, "userinfo", 200, "missing_user_id", 1),
    ] {
        mock.mode.store(mode, Ordering::SeqCst);
        mock.exchange.store(0, Ordering::SeqCst);
        mock.profile.store(0, Ordering::SeqCst);
        let result = oauth::exchange_code(
            Region::Global,
            "synthetic-code",
            "synthetic-verifier",
            "http://127.0.0.1/callback?keep=exact",
            None,
        )
        .await;
        if mode == 0 {
            let c = result.unwrap();
            assert_eq!(c.sgcookie, "synthetic-cookie");
            assert_eq!(c.sid, "synthetic-sid");
            assert_eq!(c.team_id, "synthetic-team");
            saved_device = Some(c.device_id);
        } else {
            let e = result.err().unwrap();
            let d = &e.details.as_ref().unwrap()["login_diagnostic"];
            assert_eq!(d["stage"], stage);
            assert_eq!(d["http_status"], http);
            assert_eq!(d["reason"], reason);
            let text = format!("{} {:?}", e.message, e.details);
            for secret in [
                "synthetic-code",
                "synthetic-verifier",
                "synthetic-access",
                "synthetic-cookie",
                "synthetic-refresh",
                "alice@example.org",
            ] {
                assert!(!text.contains(secret), "{text}");
            }
        }
        assert_eq!(mock.exchange.load(Ordering::SeqCst), 1);
        assert_eq!(mock.profile.load(Ordering::SeqCst), profile_calls);
        assert_eq!(Some(mock.device.lock().unwrap().clone()), saved_device);
    }
    // Manual credentials also use POST userinfo with the supplied stable device.
    mock.mode.store(0, Ordering::SeqCst);
    mock.profile.store(0, Ordering::SeqCst);
    let c = super::auth::prepare_account(
        &json!({"accessToken":"synthetic-access","deviceId":saved_device.unwrap(),"mode":"intl"}),
    )
    .await
    .unwrap();
    assert_eq!(c.user_id, "synthetic-user");
    assert_eq!(mock.profile.load(Ordering::SeqCst), 1);
    match previous {
        Some(v) => std::env::set_var("ACCIO_GATEWAY_BASE", v),
        None => std::env::remove_var("ACCIO_GATEWAY_BASE"),
    };
    server.abort();
}
