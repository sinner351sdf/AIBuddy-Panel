use super::*;
use crate::test_support::fixture_ctx;
use bytes::Bytes;
use futures::stream::{self as futures_stream, BoxStream};
use std::sync::Arc;
use std::time::Duration;

fn fixture() -> (LimitContext, Arc<RequestTelemetry>) {
    let telemetry = Arc::new(RequestTelemetry::new());
    telemetry.note_attempt(Some("test"), "test", "accio");
    telemetry.note_attempt_started("accio", "test");
    (
        LimitContext {
            ctx: fixture_ctx(),
            account_id: String::new(),
            model: "test".into(),
            session_record: None,
        },
        telemetry,
    )
}

fn source(
    chunks: Vec<Vec<u8>>,
    hold_open: bool,
) -> BoxStream<'static, Result<Bytes, std::io::Error>> {
    let data = futures_stream::iter(chunks.into_iter().map(|chunk| Ok(Bytes::from(chunk))));
    if hold_open {
        Box::pin(data.chain(futures_stream::pending()))
    } else {
        Box::pin(data)
    }
}

const HEAD: &str = "data: {\"content\":{\"parts\":[{\"text\":\"首帧\"}]}}\n\n";
const TOOL: &str = "data: {\"content\":{\"parts\":[{\"function_call\":{\"id\":\"call_1\",\"name\":\"read\",\"args_json\":\"{}\"}}]}}\n\n";
const END: &str = "data: {\"turn_complete\":true,\"usage_metadata\":{\"prompt_token_count\":17,\"candidates_token_count\":3,\"total_token_count\":20}}\n\n";

async fn collect(chunks: Vec<Vec<u8>>, hold_open: bool) -> (String, Arc<RequestTelemetry>) {
    let (limit, telemetry) = fixture();
    let (frames, source) = prefetch_source(source(chunks, hold_open), &limit, &telemetry)
        .await
        .unwrap();
    let (sender, mut receiver) = tokio::sync::mpsc::channel(64);
    tokio::time::timeout(
        Duration::from_secs(1),
        drive_stream(
            source,
            Translator::new("test".into(), "model".into()),
            telemetry.clone(),
            limit,
            sender,
            frames,
        ),
    )
    .await
    .expect("terminal frame must end the stream without waiting for EOF");
    let mut bytes = Vec::new();
    while let Some(chunk) = receiver.recv().await {
        bytes.extend_from_slice(&chunk.unwrap());
    }
    (String::from_utf8(bytes).unwrap(), telemetry)
}

#[tokio::test]
async fn coalesced_content_tool_usage_and_terminal_are_not_lost() {
    // Old prefetch kept HEAD and discarded TOOL/END, then waited forever for EOF.
    let (text, telemetry) = collect(vec![format!("{HEAD}{TOOL}{END}").into_bytes()], true).await;
    assert!(text.contains("首帧"));
    assert!(text.contains("read"));
    assert!(text.contains("[DONE]"));
    assert_eq!(telemetry.snapshot().prompt_tokens, 17);
    let diagnostics = telemetry.snapshot().attempts_detail[0].diagnostics["accioStream"].clone();
    assert_eq!(diagnostics["firstFrameType"], "text");
    assert_eq!(diagnostics["firstContentType"], "text");
    assert_eq!(diagnostics["dataFrames"], 3);
    assert_eq!(diagnostics["content"], 2);
    assert_eq!(diagnostics["completion"], 1);
    assert_eq!(diagnostics["bytes"], format!("{HEAD}{TOOL}{END}").len());
    let timings = telemetry.snapshot().attempts_detail[0].timings.clone();
    assert_eq!(
        timings.iter().map(|x| x.stage.as_str()).collect::<Vec<_>>(),
        ["first_byte", "first_content", "stream_response"]
    );
    assert!(timings.iter().all(|x| x.completed == Some(true)));
}

#[tokio::test]
async fn every_byte_boundary_preserves_utf8_and_sse_frames() {
    let payload = format!(
        "{HEAD}data: {{\"content\":{{\"parts\":[{{\"text\":\"后续中文🙂\"}}]}}}}\n\n{TOOL}{END}"
    )
    .into_bytes();
    // All two-chunk splits cover complete lines, partial lines and partial UTF-8
    // both before and after the prefetch handoff.
    for split in 0..=payload.len() {
        let (text, telemetry) = collect(
            vec![payload[..split].to_vec(), payload[split..].to_vec()],
            true,
        )
        .await;
        assert!(
            text.contains("首帧") && text.contains("后续中文🙂"),
            "split {split}: {text}"
        );
        assert!(text.contains("read"), "split {split}");
        assert!(!text.contains('\u{fffd}'), "split {split}");
        assert_eq!(telemetry.snapshot().total_tokens, 20, "split {split}");
        let d = telemetry.snapshot().attempts_detail[0].diagnostics["accioStream"].clone();
        assert_eq!(d["dataFrames"], 4, "split {split}");
        // A terminal line can finish before the final blank separator's
        // second newline is polled. Count received bytes, never force extra IO.
        let received = d["bytes"].as_u64().unwrap() as usize;
        assert!(
            (payload.len() - 1..=payload.len()).contains(&received),
            "split {split}: {d}"
        );
    }
}

#[tokio::test]
async fn error_after_first_content_in_same_chunk_is_still_reported() {
    let (text, telemetry) = collect(
        vec![format!(
            "{HEAD}data: {{\"error_code\":\"505\",\"error_message\":\"internal error\"}}\n\n"
        )
        .into_bytes()],
        false,
    )
    .await;
    assert!(text.contains("首帧"));
    assert!(telemetry
        .snapshot()
        .error
        .unwrap()
        .contains("internal error"));
    assert_eq!(
        telemetry.snapshot().attempts_detail[0]
            .timings
            .last()
            .unwrap()
            .completed,
        Some(false)
    );
}

#[tokio::test]
async fn first_frame_auth_error_remains_retryable() {
    let (limit, telemetry) = fixture();
    let result = prefetch_source(
        source(
            vec![b"data: {\"error_code\":\"402\",\"error_message\":\"unauthorized\"}\n\n".to_vec()],
            false,
        ),
        &limit,
        &telemetry,
    )
    .await;
    let error = match result {
        Err(error) => error,
        Ok(_) => panic!("must fail before stream handoff"),
    };
    assert_eq!(error.status_code, 401);
    assert_eq!(
        telemetry.snapshot().attempts_detail[0]
            .timings
            .last()
            .unwrap()
            .completed,
        Some(false)
    );
}

#[tokio::test]
async fn heartbeat_then_cancellation_keeps_the_waiting_stage() {
    let (limit, telemetry) = fixture();
    let result = tokio::time::timeout(
        Duration::from_millis(25),
        prefetch_source(
            source(vec![b": heartbeat\n\n".to_vec()], true),
            &limit,
            &telemetry,
        ),
    )
    .await;
    assert!(result.is_err());
    let timings = telemetry.snapshot().attempts_detail[0].timings.clone();
    assert_eq!(timings[0].completed, Some(true));
    assert_eq!(timings[1].stage, "first_content");
    assert_eq!(timings[1].completed, Some(false));
    assert!(timings[1].duration_ms.unwrap() >= 20);
    let d = telemetry.snapshot().attempts_detail[0].diagnostics["accioStream"].clone();
    assert_eq!(d["heartbeats"], 1);
    assert_eq!(d["comments"], 1);
    assert_eq!(d["firstFrameType"], "comment");
    assert!(d["firstContentType"].is_null());
}

#[tokio::test]
async fn received_frame_diagnostics_are_safe_and_survive_cancellation_and_retry() {
    let (limit, telemetry) = fixture();
    let payload = ": private-comment-cookie\r\n\r\ndata: {\"type\":\"ping\",\"token\":\"private-token\"}\n\ndata: {\"usageMetadata\":{}}\n\ndata: {\"type\":\"heartbeat\"}\n\ndata: {\"partial\":";
    let mut waiting = Box::pin(prefetch_source(
        source(vec![payload.as_bytes().to_vec()], true),
        &limit,
        &telemetry,
    ));
    // Poll into the wait before starting another attempt. Drop must update the
    // original attempt, never the latest one. The last line is still incomplete.
    tokio::select! {
        _ = &mut waiting => panic!("only keepalives/metadata must wait"),
        _ = tokio::time::sleep(Duration::from_millis(10)) => {}
    }
    telemetry.note_attempt_started("accio", "second");
    drop(waiting);
    let snapshot = telemetry.snapshot();
    let d = &snapshot.attempts_detail[0].diagnostics["accioStream"];
    assert_eq!(d["heartbeats"], 3);
    assert_eq!(d["metadata"], 1);
    assert_eq!(d["dataFrames"], 3);
    assert_eq!(d["firstDataType"], "heartbeat");
    assert_eq!(d["pendingBytes"], "data: {\"partial\":".len());
    assert!(snapshot.attempts_detail[1].diagnostics.is_empty());
    assert!(!d.to_string().contains("private-"));
}

#[tokio::test]
async fn frame_diagnostics_distinguish_errors_unknown_malformed_tools_and_thoughts() {
    for (payload, kind, counter) in [
        ("data: {bad}\n", "malformed", "malformed"),
        (
            "data: {\"futureFrame\":\"private-value\"}\n",
            "unknown",
            "unknown",
        ),
        (
            "data: {\"error_code\":\"505\",\"error_message\":\"private-error\"}\n",
            "error",
            "errors",
        ),
        (
            "data: {\"error\":{\"code\":\"402\",\"message\":\"private-error\"}}\n",
            "error",
            "errors",
        ),
        (TOOL, "tool", "content"),
        (
            "data: {\"content\":{\"parts\":[{\"thought\":true,\"text\":\"private-thought\"}]}}\n",
            "thought",
            "content",
        ),
    ] {
        let (limit, telemetry) = fixture();
        let result = prefetch_source(
            source(vec![payload.as_bytes().to_vec()], false),
            &limit,
            &telemetry,
        )
        .await;
        drop(result);
        let d = telemetry.snapshot().attempts_detail[0].diagnostics["accioStream"].clone();
        assert_eq!(d["firstDataType"], kind, "{kind}");
        assert_eq!(d[counter], 1, "{kind}");
        assert!(!d.to_string().contains("private-"));
    }
}

#[tokio::test]
async fn aggregate_preserves_coalesced_tool_and_usage_without_waiting_for_eof() {
    let (limit, telemetry) = fixture();
    let body = reqwest::Body::wrap_stream(source(
        vec![format!("{HEAD}{TOOL}{END}").into_bytes()],
        true,
    ));
    let response = reqwest::Response::from(axum::http::Response::new(body));
    let result = tokio::time::timeout(
        Duration::from_secs(1),
        drive_aggregate(
            response,
            Translator::new("test".into(), "model".into()),
            telemetry.clone(),
            &limit,
        ),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(result["choices"][0]["message"]["content"], "首帧");
    assert_eq!(
        result["choices"][0]["message"]["tool_calls"][0]["function"]["name"],
        "read"
    );
    assert_eq!(result["usage"]["prompt_tokens"], 17);
    assert!(telemetry.snapshot().attempts_detail[0]
        .timings
        .iter()
        .all(|x| x.completed == Some(true)));
}

#[tokio::test]
async fn tool_identity_is_announced_once_even_with_empty_initial_arguments() {
    let start = "data: {\"content\":{\"parts\":[{\"function_call\":{\"id\":\"call_x\",\"name\":\"read\",\"args_json\":\"\"}}]}}\n\n";
    let tail = "data: {\"content\":{\"parts\":[{\"function_call\":{\"id\":\"call_x\",\"name\":\"read\",\"args_json\":\"{}\"}}]}}\n\n";
    let (text, _) = collect(vec![format!("{start}{tail}{END}").into_bytes()], true).await;
    assert_eq!(text.matches("\"name\":\"read\"").count(), 1);
    assert_eq!(text.matches("\"id\":\"call_x\"").count(), 1);
    assert!(text.contains("\"arguments\":\"{}\""));
}

#[tokio::test]
async fn premature_eof_is_an_error_without_a_success_tail() {
    let (text, telemetry) = collect(vec![HEAD.as_bytes().to_vec()], false).await;
    assert!(text.contains("首帧"));
    assert!(text.contains("\"error\""));
    assert!(!text.contains("\"finish_reason\":\"stop\""));
    assert!(text.ends_with("data: [DONE]\n\n"));
    assert!(telemetry.snapshot().error.is_some());
}

#[tokio::test]
async fn malformed_data_and_errors_terminate_even_when_upstream_stays_open() {
    for tail in [
        "data: {broken}\n\n",
        "data: {\"error_code\":\"505\",\"error_message\":\"bad\"}\n\n",
    ] {
        let (text, telemetry) = collect(vec![format!("{HEAD}{tail}").into_bytes()], true).await;
        assert!(text.contains("\"error\""));
        assert!(!text.contains("\"finish_reason\":\"stop\""));
        assert!(telemetry.snapshot().error.is_some());
    }
}

#[tokio::test]
async fn done_after_content_completes_without_waiting_for_eof() {
    let (text, telemetry) =
        collect(vec![format!("{HEAD}data: [DONE]\n\n").into_bytes()], true).await;
    assert_eq!(text.matches("data: [DONE]").count(), 1);
    assert!(telemetry.snapshot().error.is_none());
}

#[tokio::test]
async fn empty_heartbeat_and_done_only_responses_fail_before_handoff() {
    for payload in [
        "",
        ": heartbeat\n\n",
        "data: [DONE]\n\n",
        "data: {bad}\n\n",
        "data: {}\n\n",
    ] {
        let (limit, telemetry) = fixture();
        assert!(
            prefetch_source(
                source(vec![payload.as_bytes().to_vec()], false),
                &limit,
                &telemetry
            )
            .await
            .is_err(),
            "{payload}"
        );
    }
}

#[tokio::test]
async fn aggregate_does_not_return_partial_text_as_success() {
    let (limit, telemetry) = fixture();
    let response = reqwest::Response::from(axum::http::Response::new(reqwest::Body::wrap_stream(
        source(vec![HEAD.as_bytes().to_vec()], false),
    )));
    let result = drive_aggregate(
        response,
        Translator::new("test".into(), "model".into()),
        telemetry,
        &limit,
    )
    .await;
    assert_eq!(
        result.unwrap_err().code.as_deref(),
        Some("accio_stream_protocol")
    );
}

#[test]
fn structured_error_category_overrides_rate_limit_words_and_preserves_retry_contract() {
    for (category, status, cooldown) in [
        ("policy", 403, false),
        ("capacity", 503, false),
        ("quota", 429, true),
        ("auth", 401, false),
        ("upstream", 502, false),
    ] {
        let value = json!({"error_code":"555","error_message":"rate limit", "error_metadata":{
            "schema_version":1,"gateway_error_code":"555","source":"gateway_policy",
            "category":category,"retryable":false,"replay_safe":false,"retry_after_ms":30000,"action":"none"}});
        let frame = super::stream::decode_frame(&value.to_string())
            .unwrap()
            .unwrap();
        let error = frame_error(&frame);
        assert_eq!(error.status_code, status);
        assert_eq!(error.is_quota_limit(), cooldown);
        assert_eq!(
            error.payload()["error"]["details"]["error_metadata"]["retry_after_ms"],
            30000
        );
        assert!(!super::super::adk_error::allows_replay(&error));
    }
}

#[test]
fn invalid_metadata_is_not_trusted_and_legacy_sentinel_is_not_quota() {
    let value = json!({"errorCode":555,"errorMessage":"internal error","errorMetadata":{
        "schemaVersion":1,"gatewayErrorCode":"999","category":"quota"}});
    let frame = super::stream::decode_frame(&value.to_string())
        .unwrap()
        .unwrap();
    assert!(frame.error_metadata.is_none());
    assert_eq!(frame_error(&frame).status_code, 503);
    let error =
        super::super::adk_error::gateway(429, "555", "blocked by sentinel rate limit", None);
    assert_eq!(error.status_code, 403);
    assert!(!error.is_quota_limit());
    assert!(!super::super::adk_error::allows_replay(&error));
}

#[test]
fn native_error_in_raw_response_is_not_a_successful_frame() {
    let raw = json!({"error":{"message":"quota exceeded","type":"quota"}}).to_string();
    let error =
        super::stream::decode_frame(&json!({"raw_response_json":raw}).to_string()).unwrap_err();
    assert_eq!(error.status_code, 429);
}

#[test]
fn gemini_signature_and_parallel_tool_fragments_round_trip() {
    let mut translator = Translator::new("test".into(), "model".into());
    for (id, name, args, sig) in [
        ("a", "read", "{\"p\":", None),
        ("b", "read", "{}", None),
        ("a", "read", "1}", Some("opaque-signature")),
    ] {
        let mut part = json!({"function_call":{"id":id,"name":name,"args_json":args}});
        if let Some(sig) = sig {
            part["thought_signature"] = json!(sig);
        }
        let frame = super::stream::decode_frame(&json!({"content":{"parts":[part]}}).to_string())
            .unwrap()
            .unwrap();
        translator.consume(&frame, None);
    }
    let calls = translator.final_tool_calls();
    assert_eq!(calls.len(), 2);
    assert_eq!(calls[0]["function"]["arguments"], "{\"p\":1}");
    assert_eq!(
        calls[0]["extra_content"]["google"]["thought_signature"],
        "opaque-signature"
    );
    let body = json!({"messages":[{"role":"assistant","tool_calls":calls}]});
    let upstream = super::super::protocol::build_upstream_body(
        &body,
        "1Nexus-test",
        "test",
        None,
        super::super::models::EffortPlacement::Top,
    )
    .body;
    assert_eq!(
        upstream["contents"][0]["parts"][0]["thought_signature"],
        "opaque-signature"
    );
    assert!(upstream.get("tool_config").is_none());
    assert!(upstream["properties"]["tool_config"].is_string());
    let claude = super::super::protocol::build_upstream_body(
        &body,
        "1Orbit-test",
        "test",
        None,
        super::super::models::EffortPlacement::Top,
    )
    .body;
    assert!(claude["properties"].get("tool_config").is_none());
}

#[tokio::test]
async fn continuous_heartbeats_do_not_keep_a_stalled_generation_alive() {
    let (limit, telemetry) = fixture();
    let heartbeats = futures_stream::unfold((), |()| async {
        tokio::time::sleep(Duration::from_millis(3)).await;
        Some((Ok(Bytes::from_static(b": ping\n\n")), ()))
    });
    let frame = super::stream::decode_frame(HEAD.trim().strip_prefix("data:").unwrap())
        .unwrap()
        .unwrap();
    let error = tokio::time::timeout(
        Duration::from_millis(250),
        consume_source(
            Box::pin(heartbeats),
            Translator::new("test".into(), "test".into()),
            &telemetry,
            &limit,
            vec![frame],
            None,
            Duration::from_millis(25),
        ),
    )
    .await
    .expect("semantic watchdog must fire")
    .err()
    .unwrap();
    assert!(error.message.contains("空闲超时"));
}

#[test]
fn tool_results_recover_names_by_call_id() {
    let body = json!({"messages":[
        {"role":"assistant","tool_calls":[{"id":"a","function":{"name":"read","arguments":"{}"}}]},
        {"role":"tool","tool_call_id":"a","content":"ok"}
    ]});
    let upstream = super::super::protocol::build_upstream_body(
        &body,
        "1Nexus-test",
        "test",
        None,
        super::super::models::EffortPlacement::Top,
    )
    .body;
    assert_eq!(
        upstream["contents"][1]["parts"][0]["function_response"]["name"],
        "read"
    );
}

#[test]
fn interrupted_tool_history_repairs_only_missing_results_in_place() {
    let body = json!({"messages":[
        {"role":"assistant","tool_calls":[
            {"id":"a","function":{"name":"read","arguments":"{}"}},
            {"id":"b","function":{"name":"write","arguments":"{}"}}]},
        {"role":"tool","tool_call_id":"a","content":"original result"},
        {"role":"user","content":"continue"},
        {"role":"assistant","tool_calls":[{"id":"c","function":{"name":"next","arguments":"{}"}}]}
    ]});
    let upstream = super::super::protocol::build_upstream_body(
        &body,
        "1Nexus-test",
        "fake",
        None,
        super::super::models::EffortPlacement::Top,
    )
    .body;
    let parts = upstream["contents"][1]["parts"].as_array().unwrap();
    assert_eq!(parts.len(), 2);
    assert_eq!(parts[0]["function_response"]["id"], "a");
    let original: Value = serde_json::from_str(
        parts[0]["function_response"]["response_json"]
            .as_str()
            .unwrap(),
    )
    .unwrap();
    assert_eq!(original["content"], "original result");
    assert_eq!(original["is_error"], false);
    assert_eq!(parts[1]["function_response"]["id"], "b");
    let repaired: Value = serde_json::from_str(
        parts[1]["function_response"]["response_json"]
            .as_str()
            .unwrap(),
    )
    .unwrap();
    assert_eq!(repaired["is_error"], true);
    assert!(repaired["content"]
        .as_str()
        .unwrap()
        .contains("may or may not have executed"));
    assert_eq!(upstream["contents"][2]["role"], "user");
    assert_eq!(
        upstream["contents"][4]["parts"][0]["function_response"]["id"],
        "c"
    );
}

#[tokio::test]
async fn multiline_events_crlf_and_eof_terminal_survive_every_split() {
    let payload = "\u{feff}: ping\r\nid: opaque\r\nretry: 100\r\nevent: message\r\ndata: {\r\ndata: \"content\":{\"parts\":[{\"text\":\"中文🙂\"}]}}\r\n\r\ndata: [DONE]".as_bytes();
    for split in 0..=payload.len() {
        let (text, telemetry) = collect(
            vec![payload[..split].to_vec(), payload[split..].to_vec()],
            false,
        )
        .await;
        assert!(text.contains("中文🙂"), "split {split}");
        assert!(telemetry.snapshot().error.is_none(), "split {split}");
        let d = telemetry.snapshot().attempts_detail[0].diagnostics["accioStream"].clone();
        assert_eq!(d["dataFrames"], 2);
        assert_eq!(d["sseEvents"], 2);
        assert_eq!(d["idEvents"], 1);
        assert_eq!(d["retryEvents"], 1);
        assert_eq!(d["cleanEof"], true);
    }
}

#[tokio::test]
async fn valid_content_before_invalid_utf8_is_preserved_and_fails() {
    let mut payload = HEAD.as_bytes().to_vec();
    payload.extend_from_slice(b"data: \xff\n\n");
    let (text, telemetry) = collect(vec![payload], true).await;
    assert!(text.contains("首帧"));
    assert!(text.contains("\"error\""));
    assert!(!text.contains("\"finish_reason\":\"stop\""));
    assert!(telemetry.snapshot().error.is_some());
}

#[tokio::test]
async fn unterminated_event_waits_for_boundary_and_malformed_multiline_stays_invalid() {
    let (limit, telemetry) = fixture();
    let pending = prefetch_source(
        source(
            vec![b"data: {\"content\":{\"parts\":[{\"text\":\"premature\"}]}}\n".to_vec()],
            true,
        ),
        &limit,
        &telemetry,
    );
    assert!(tokio::time::timeout(Duration::from_millis(20), pending)
        .await
        .is_err());
    let malformed = "data: {\"content\":{\"parts\":[{\"text\":\"first\ndata: second\"}]}}\n\n";
    let (text, telemetry) = collect(vec![format!("{HEAD}{malformed}").into_bytes()], true).await;
    assert!(!text.contains("first second"));
    assert!(telemetry.snapshot().error.is_some());
    assert_eq!(
        telemetry.snapshot().attempts_detail[0].diagnostics["accioStream"]["malformed"],
        1
    );
}

#[tokio::test]
#[ignore = "synthetic loopback gzip transport; run alone with --ignored --test-threads=1"]
async fn local_gzip_transport_regression() {
    use axum::{
        body::Bytes as BodyBytes,
        extract::State,
        http::{HeaderMap, StatusCode},
        routing::post,
        Router,
    };
    use std::sync::Mutex;
    type Seen = Arc<Mutex<Vec<(HeaderMap, Vec<u8>)>>>;
    async fn handler(
        State((seen, status, waf)): State<(Seen, u16, bool)>,
        headers: HeaderMap,
        body: BodyBytes,
    ) -> axum::response::Response {
        let first = {
            let mut seen = seen.lock().unwrap();
            seen.push((headers, body.to_vec()));
            seen.len() == 1
        };
        let status = if first { status } else { 200 };
        let mut response =
            axum::response::Response::new(axum::body::Body::from("data: [DONE]\n\n"));
        *response.status_mut() = StatusCode::from_u16(status).unwrap();
        if waf {
            response
                .headers_mut()
                .insert("bxpunish", "synthetic".parse().unwrap());
        }
        response
    }
    std::env::set_var("ACCIO_REQUEST_GZIP", "true");
    for (status, waf, inline) in [
        (415, false, false),
        (401, false, false),
        (403, false, false),
        (429, false, false),
        (500, false, false),
        (200, false, false),
        (415, true, false),
        (415, false, true),
    ] {
        let seen: Seen = Arc::new(Mutex::new(Vec::new()));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let app = Router::new()
            .route("/generateContent", post(handler))
            .with_state((seen.clone(), status, waf));
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        let credentials =
            Credentials::from_payload(&json!({"accessToken":"synthetic-token"})).unwrap();
        let mut plan = build_plan(
            &credentials,
            &json!({"messages":[{"role":"user","content":"long repeated text ".repeat(1000)}]}),
            "gemini-3-flash-preview",
            None,
        )
        .unwrap();
        if inline {
            use base64::Engine;
            let mut png = std::io::Cursor::new(Vec::new());
            image::DynamicImage::new_rgb8(2, 2)
                .write_to(&mut png, image::ImageFormat::Png)
                .unwrap();
            let mut body: Value = serde_json::from_slice(&plan.body).unwrap();
            body["contents"][0]["parts"].as_array_mut().unwrap().push(json!({"inline_data":{"mime_type":"image/png","data":base64::engine::general_purpose::STANDARD.encode(png.into_inner())}}));
            plan.body = serde_json::to_vec(&body).unwrap();
        }
        plan.url = format!("http://{address}/generateContent?sg_k=synthetic");
        let (_, telemetry) = fixture();
        let response = send_inner(
            &plan,
            None,
            super::super::security_guard::Mode::Off,
            Some(&telemetry),
        )
        .await
        .unwrap();
        assert_eq!(
            response.status().as_u16(),
            if status == 415 && !waf && !inline {
                200
            } else {
                status
            }
        );
        let seen = seen.lock().unwrap();
        let replay = status == 415 && !waf && !inline;
        assert_eq!(
            seen.len(),
            if replay { 2 } else { 1 },
            "status={status} waf={waf}"
        );
        let mut decoded = Vec::new();
        if inline {
            assert!(seen[0].0.get("content-encoding").is_none());
            decoded = seen[0].1.clone();
        } else {
            assert_eq!(seen[0].0["content-encoding"], "gzip");
            std::io::Read::read_to_end(
                &mut flate2::read::GzDecoder::new(seen[0].1.as_slice()),
                &mut decoded,
            )
            .unwrap();
        }
        let compressed: Value = serde_json::from_slice(&decoded).unwrap();
        if replay {
            assert!(seen[1].0.get("content-encoding").is_none());
            let original: Value = serde_json::from_slice(&seen[1].1).unwrap();
            assert_eq!(compressed, original); // all IDs, token, span and context
            let d = telemetry.snapshot().attempts_detail[0].diagnostics["accioCompression"].clone();
            assert_eq!(d["downgrades"], 1);
        }
        drop(seen);
        if replay {
            let response = send_inner(
                &plan,
                None,
                super::super::security_guard::Mode::Off,
                Some(&telemetry),
            )
            .await
            .unwrap();
            assert_eq!(response.status().as_u16(), 200);
            assert_eq!(
                telemetry.snapshot().attempts_detail[0].diagnostics["accioCompression"]
                    ["skipReason"],
                "runtime_disabled"
            );
        }
        server.abort();
    }
    std::env::remove_var("ACCIO_REQUEST_GZIP");
}
