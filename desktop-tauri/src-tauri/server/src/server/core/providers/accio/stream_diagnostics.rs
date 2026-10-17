//! Observe received SSE without storing content, event names, tools or signatures.
//! The guard lives in the source, including across prefetch; Drop publishes on
//! cancellation too. Counts describe received events, not downstream output.
use std::sync::Arc;
use std::time::{Duration, Instant};

use futures::{stream::BoxStream, StreamExt};
use serde::Serialize;

use super::super::sse::{Decoder, Event};
use super::{stream, Frame, RequestTelemetry};

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct Counts {
    bytes: u64,
    chunks: u64,
    data_frames: u64,
    sse_events: u64,
    id_events: u64,
    retry_events: u64,
    clean_eof: bool,
    heartbeats: u64,
    comments: u64,
    metadata: u64,
    unknown: u64,
    malformed: u64,
    errors: u64,
    content: u64,
    completion: u64,
    control_lines: u64,
    oversized: u64,
    pending_bytes: usize,
    first_frame_type: Option<&'static str>,
    first_data_type: Option<&'static str>,
    first_content_type: Option<&'static str>,
}

struct Observer {
    telemetry: Arc<RequestTelemetry>,
    attempt: Option<usize>,
    identity: serde_json::Value,
    counts: Counts,
    decoder: Decoder,
    published: Option<Instant>,
}

fn frame_kind(frame: &Frame) -> &'static str {
    if frame.is_error() {
        return "error";
    }
    if frame
        .parts
        .iter()
        .any(|p| matches!(p, stream::Part::FunctionCall { .. }))
    {
        return "tool";
    }
    if frame
        .parts
        .iter()
        .any(|p| matches!(p, stream::Part::Thought(t) if !t.is_empty()))
    {
        return "thought";
    }
    if frame
        .parts
        .iter()
        .any(|p| matches!(p, stream::Part::Text(t) if !t.is_empty()))
    {
        return "text";
    }
    if frame.turn_complete {
        return "complete";
    }
    "metadata"
}

impl Observer {
    fn event(&mut self, event: Event, out: &mut Vec<u8>) {
        self.counts.comments += event.comments;
        self.counts.heartbeats += event.comments;
        self.counts.control_lines += event.controls;
        self.counts.unknown += event.unknown;
        self.counts.id_events += u64::from(event.has_id);
        self.counts.retry_events += u64::from(event.has_retry);
        if event.comments > 0 {
            self.counts.first_frame_type.get_or_insert("comment");
        } else if event.controls > 0 {
            self.counts.first_frame_type.get_or_insert("control");
        }
        if event.data.is_some() || event.event.is_some() {
            self.counts.sse_events += 1;
        }
        let named_heartbeat = event
            .event
            .as_deref()
            .is_some_and(|e| matches!(e, "ping" | "heartbeat" | "keepalive"));
        let Some(data) = event.data.filter(|d| !d.is_empty()) else {
            if named_heartbeat {
                self.counts.heartbeats += 1;
            }
            return;
        };
        self.counts.data_frames += 1;
        let kind = match stream::decode_frame(&data) {
            Ok(Some(frame)) => {
                if frame.turn_complete {
                    self.counts.completion += 1;
                }
                frame_kind(&frame)
            }
            Ok(None) if data.trim().is_empty() => "empty_data",
            Ok(None) => "heartbeat",
            Err(error) if error.code.as_deref() != Some("accio_stream_protocol") => "error",
            Err(_) if serde_json::from_str::<serde_json::Value>(&data).is_err() => "malformed",
            Err(_) => "unknown",
        };
        match kind {
            "heartbeat" => self.counts.heartbeats += 1,
            "metadata" => self.counts.metadata += 1,
            "unknown" => self.counts.unknown += 1,
            "malformed" => self.counts.malformed += 1,
            "error" => self.counts.errors += 1,
            "tool" | "thought" | "text" => {
                self.counts.content += 1;
                self.counts.first_content_type.get_or_insert(kind);
            }
            _ => {}
        }
        self.counts.first_frame_type.get_or_insert(kind);
        self.counts.first_data_type.get_or_insert(kind);
        // Compact valid JSON so downstream's ADK data decoder is independent of
        // SSE physical lines. Invalid data remains invalid and fails closed.
        let data = serde_json::from_str::<serde_json::Value>(&data)
            .map(|v| v.to_string())
            .unwrap_or_else(|_| {
                if data.trim() == "[DONE]" {
                    "[DONE]".into()
                } else {
                    "[invalid SSE event data]".into()
                }
            });
        out.extend_from_slice(b"data: ");
        out.extend_from_slice(data.as_bytes());
        out.extend_from_slice(b"\n\n");
    }

    fn chunk(&mut self, chunk: &[u8]) -> Result<bytes::Bytes, std::io::Error> {
        self.counts.bytes = self.counts.bytes.saturating_add(chunk.len() as u64);
        self.counts.chunks += u64::from(!chunk.is_empty());
        let events = self.decoder.push(chunk).map_err(|message| {
            self.counts.oversized += u64::from(message.contains("size"));
            self.counts.malformed += u64::from(!message.contains("size"));
            std::io::Error::other(message)
        })?;
        let mut out = Vec::new();
        for event in events {
            self.event(event, &mut out);
        }
        self.counts.pending_bytes = self.decoder.pending_len();
        if self
            .published
            .is_none_or(|at| at.elapsed() >= Duration::from_secs(1))
        {
            self.publish();
        }
        Ok(bytes::Bytes::from(out))
    }

    fn publish(&mut self) {
        if let Some(attempt) = self.attempt {
            if let Ok(mut value) = serde_json::to_value(&self.counts) {
                if !self.identity.is_null() {
                    value["identity"] = self.identity.clone();
                }
                self.telemetry.note_accio_stream_diagnostics(attempt, value);
            }
        }
        self.published = Some(Instant::now());
    }
}

impl Drop for Observer {
    fn drop(&mut self) {
        // Only real EOF makes an unterminated last line a received frame.
        // Cancellation leaves pendingBytes visible instead of inventing a frame.
        self.publish();
        crate::server::logging::verbose(
            "[Accio SSE]",
            &format!(
                "request={} attempt={:?} identity={} diagnostics={}",
                self.telemetry.id(),
                self.attempt,
                self.identity,
                serde_json::to_string(&self.counts).unwrap_or_default()
            ),
        );
    }
}

pub(super) fn observe(
    source: BoxStream<'static, Result<bytes::Bytes, std::io::Error>>,
    telemetry: Arc<RequestTelemetry>,
) -> BoxStream<'static, Result<bytes::Bytes, std::io::Error>> {
    let attempt = telemetry.snapshot().attempts_detail.len().checked_sub(1);
    let identity = attempt
        .and_then(|i| {
            telemetry
                .snapshot()
                .attempts_detail
                .get(i)
                .and_then(|d| d.diagnostics.get("accioIdentity"))
                .cloned()
        })
        .unwrap_or(serde_json::Value::Null);
    let observer = Observer {
        telemetry,
        attempt,
        identity,
        counts: Counts::default(),
        decoder: Decoder::default(),
        published: None,
    };
    Box::pin(futures::stream::unfold(
        (source, observer),
        |(mut source, mut observer)| async move {
            if let Some(error) = observer.decoder.take_error() {
                observer.counts.oversized += u64::from(error.contains("size"));
                observer.counts.malformed += u64::from(!error.contains("size"));
                return Some((Err(std::io::Error::other(error)), (source, observer)));
            }
            match source.next().await {
                Some(item) => {
                    let item = item.and_then(|chunk| observer.chunk(&chunk));
                    Some((item, (source, observer)))
                }
                None => {
                    observer.counts.clean_eof = true;
                    let tail = observer.decoder.finish();
                    observer.counts.pending_bytes = 0;
                    match tail {
                        Ok(Some(event)) => {
                            let mut out = Vec::new();
                            observer.event(event, &mut out);
                            Some((Ok(bytes::Bytes::from(out)), (source, observer)))
                        }
                        Err(error) => Some((Err(std::io::Error::other(error)), (source, observer))),
                        Ok(None) => None,
                    }
                }
            }
        },
    ))
}
