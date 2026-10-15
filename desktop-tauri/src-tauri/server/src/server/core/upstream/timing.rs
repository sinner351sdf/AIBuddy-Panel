//! Per-attempt stage timings. Wall time is only for display; durations use Instant.
//! Missing stages mean not reached / not instrumented, never zero milliseconds.

use std::sync::Arc;
use std::time::Instant;

use super::usage::RequestTelemetry;

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StageTiming {
    pub stage: String,
    pub started_at: i64,
    pub duration_ms: Option<i64>,
    /// None = running, true = completed, false = interrupted / failed.
    pub completed: Option<bool>,
    #[serde(skip)]
    pub(super) clock: Option<Instant>,
}

impl StageTiming {
    pub(super) fn finish(&mut self, completed: bool) {
        if self.duration_ms.is_some() {
            return;
        }
        self.duration_ms = Some(
            self.clock
                .map(|clock| clock.elapsed().as_millis().min(i64::MAX as u128) as i64)
                .unwrap_or(0),
        );
        self.completed = Some(completed);
    }
}

/// A cancelled future still closes its stage. The request finalizer also seals
/// open stages, because disconnect guards can run before this guard is dropped.
pub struct StageGuard {
    pub(super) telemetry: Arc<RequestTelemetry>,
    pub(super) position: Option<(usize, usize)>,
}

impl StageGuard {
    pub fn finish(mut self) {
        if let Some((attempt, stage)) = self.position.take() {
            self.telemetry.finish_stage(attempt, stage, true);
        }
    }
}

impl Drop for StageGuard {
    fn drop(&mut self) {
        if let Some((attempt, stage)) = self.position.take() {
            self.telemetry.finish_stage(attempt, stage, false);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[test]
    fn stages_flush_live_and_finalize_without_changing_completed_measurements() {
        let telemetry = Arc::new(RequestTelemetry::new());
        let writes = Arc::new(Mutex::new(Vec::new()));
        let sink = writes.clone();
        telemetry.set_live_sink(move |snapshot| {
            sink.lock()
                .unwrap()
                .push(serde_json::to_value(&snapshot.attempts_detail).unwrap());
        });
        telemetry.note_attempt_started("accio", "test");
        let prepare = telemetry.begin_stage("credentials");
        prepare.finish();
        telemetry.note_attempt_body_bytes(123);
        let wait = telemetry.begin_stage("send_headers");
        let live = writes.lock().unwrap().last().unwrap().clone();
        assert_eq!(live[0]["bodyBytes"], 123);
        assert_eq!(live[0]["timings"][0]["completed"], true);
        assert!(live[0]["timings"][1]["durationMs"].is_null());
        telemetry.seal_stages(); // simulate disconnect finalizer before the future drops
        let sealed = telemetry.snapshot().attempts_detail[0].timings.clone();
        wait.finish(); // a late callback must not overwrite the interruption
        assert_eq!(telemetry.snapshot().attempts_detail[0].timings, sealed);
        assert_eq!(sealed[1].completed, Some(false));
        assert!(sealed[1].duration_ms.is_some());
        let encoded = serde_json::to_string(&sealed).unwrap();
        assert!(!encoded.contains("clock"));
    }

    #[test]
    fn dropped_guard_stays_on_its_original_attempt() {
        let telemetry = Arc::new(RequestTelemetry::new());
        telemetry.note_attempt_started("accio", "first");
        let first = telemetry.begin_stage("send_headers");
        telemetry.note_attempt_started("accio", "second");
        let second = telemetry.begin_stage("send_headers");
        drop(first);
        let snapshot = telemetry.snapshot();
        assert_eq!(
            snapshot.attempts_detail[0].timings[0].completed,
            Some(false)
        );
        assert_eq!(snapshot.attempts_detail[1].timings[0].completed, None);
        second.finish();
    }
}
