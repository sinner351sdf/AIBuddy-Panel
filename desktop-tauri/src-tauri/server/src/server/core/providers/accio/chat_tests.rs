use super::*;
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
            store: AccountStore::with_db(None),
            account_id: String::new(),
            model: "test".into(),
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
