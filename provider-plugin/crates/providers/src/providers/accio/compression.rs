//! ADK Qt/Xt: opt-in gzip, >=4096 bytes, level 6, only if beneficial;
//! only HTTP 415 permits one uncompressed replay. No auth/WAF downgrade.
use serde_json::{json, Value};
use std::io::Write;
use std::sync::{Mutex, OnceLock};

static DISABLED: OnceLock<Mutex<std::collections::HashSet<String>>> = OnceLock::new();

pub(super) fn disabled(url: &str) -> bool {
    DISABLED
        .get_or_init(Default::default)
        .lock()
        .map_or(true, |s| s.contains(&scope(url)))
}
pub(super) fn disable(url: &str) {
    if let Ok(mut entries) = DISABLED.get_or_init(Default::default).lock() {
        if entries.len() < 32 {
            entries.insert(scope(url));
        }
    }
}
fn scope(url: &str) -> String {
    url::Url::parse(url)
        .map(|u| u.origin().ascii_serialization())
        .unwrap_or_default()
}
pub(super) fn configured() -> bool {
    // Official llm_request_gzip defaults false. Local deployment has no official
    // feature-flag service, so expose the same opt-in policy explicitly.
    std::env::var("ACCIO_REQUEST_GZIP").is_ok_and(|v| v == "true" || v == "1")
}
pub(super) fn encode(
    raw: &[u8],
    enabled: bool,
    runtime_disabled: bool,
    already_encoded: bool,
) -> (Vec<u8>, Value) {
    let skip = if !enabled {
        Some("disabled")
    } else if runtime_disabled {
        Some("runtime_disabled")
    } else if already_encoded {
        Some("already_encoded")
    } else if raw.len() < 4096 {
        Some("below_threshold")
    } else {
        None
    };
    let mut reason = skip.unwrap_or("error");
    if skip.is_none() {
        let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::new(6));
        if encoder.write_all(raw).is_ok() {
            if let Ok(encoded) = encoder.finish() {
                if encoded.len() < raw.len() {
                    let report = json!({"applied":true,"algorithm":"gzip","rawBytes":raw.len(),"encodedBytes":encoded.len(),"downgrades":0});
                    return (encoded, report);
                }
                reason = "not_beneficial";
            }
        }
    }
    (
        raw.to_vec(),
        json!({"applied":false,"rawBytes":raw.len(),"encodedBytes":raw.len(),"skipReason":reason,"downgrades":0}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    #[test]
    fn threshold_policy_and_round_trip() {
        let raw = vec![b'a'; 8192];
        for (enabled, runtime, encoded, reason) in [
            (false, false, false, "disabled"),
            (true, true, false, "runtime_disabled"),
            (true, false, true, "already_encoded"),
        ] {
            let (body, report) = encode(&raw, enabled, runtime, encoded);
            assert_eq!(body, raw);
            assert_eq!(report["skipReason"], reason);
        }
        assert_eq!(
            encode(b"small", true, false, false).1["skipReason"],
            "below_threshold"
        );
        let (body, report) = encode(&raw, true, false, false);
        assert_eq!(report["applied"], true);
        let mut decoded = Vec::new();
        flate2::read::GzDecoder::new(body.as_slice())
            .read_to_end(&mut decoded)
            .unwrap();
        assert_eq!(decoded, raw);
    }
}
