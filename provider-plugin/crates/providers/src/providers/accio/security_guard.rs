//! Official SecurityGuard Node addon, isolated behind a bounded stdio worker.
//! No account tokens enter the worker. Factors are generated per URL and never cached.
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::{Duration, Instant};

use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;

use crate::errors::GatewayError;

const SCRIPT: &str = include_str!("security_guard.cjs");
const PREFIX: &[u8] = b"@accio-sg:";
const MAX_REPLY: usize = 64 * 1024;
const CALL_TIMEOUT: Duration = Duration::from_secs(20);
const RETRY_DELAY: Duration = Duration::from_secs(30);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Mode {
    Auto,
    Off,
    Required,
}

impl Mode {
    pub(crate) fn configured() -> Result<Self, GatewayError> {
        match std::env::var("ACCIO_SECURITY_GUARD")
            .unwrap_or_else(|_| "auto".into())
            .trim()
        {
            "auto" => Ok(Self::Auto),
            "off" => Ok(Self::Off),
            "required" => Ok(Self::Required),
            _ => Err(GatewayError::with_status(
                500,
                "ACCIO_SECURITY_GUARD 必须是 auto/off/required",
            )
            .with_code("accio_security_guard_config")),
        }
    }
}

/// Safe to log/store: only state and header names, never factors or native output.
#[derive(Clone, Debug, Serialize)]
pub(crate) struct Report {
    pub mode: &'static str,
    pub outcome: String,
    pub init_status: Option<String>,
    pub init_mode: Option<String>,
    pub token_present: bool,
    pub init_error_code: Option<i64>,
    pub cookie_error_code: Option<i64>,
    pub init_reason: Option<String>,
    pub cookie_reason: Option<String>,
    pub fallback_attempted: bool,
    pub recovery_backoff: bool,
    pub header_names: Vec<String>,
    pub duration_ms: u64,
}

#[derive(Clone, Deserialize)]
struct Init {
    status: String,
    mode: Option<String>,
    #[serde(rename = "tokenPresent")]
    token_present: bool,
    #[serde(rename = "errorCode")]
    error_code: Option<i64>,
    #[serde(rename = "cookieErrorCode")]
    cookie_error_code: Option<i64>,
    reason: Option<String>,
    #[serde(rename = "cookieReason")]
    cookie_reason: Option<String>,
    #[serde(rename = "fallbackAttempted", default)]
    fallback_attempted: bool,
}

#[derive(Clone, Deserialize)]
struct Reply {
    id: u64,
    #[serde(skip)]
    recovery_backoff: bool,
    init: Option<Init>,
    headers: Option<BTreeMap<String, String>>,
    #[serde(rename = "errType")]
    err_type: Option<String>,
    #[serde(rename = "errCode")]
    err_code: Option<i64>,
}

struct Worker {
    child: Child,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
    next_id: u64,
    binding: String,
}
struct State {
    worker: Option<Worker>,
    failed: Option<(Instant, &'static str, String)>,
    failed_reply: Option<Reply>,
}
static STATE: Mutex<State> = Mutex::const_new(State {
    worker: None,
    failed: None,
    failed_reply: None,
});

fn module_path() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("ACCIO_SECURITY_GUARD_MODULE") {
        let path = PathBuf::from(path);
        return (path.is_absolute() && path.is_file()).then_some(path);
    }
    // Only discover installed official macOS modules. Windows deployments can
    // select their matching official addon explicitly; Linux is not supported by
    // the audited official wrapper. Never substitute a stub or foreign platform.
    if cfg!(target_os = "macos") {
        let arch = if cfg!(target_arch = "aarch64") {
            "arm64"
        } else {
            "x64"
        };
        let relative = format!("Contents/Resources/app.asar.unpacked/node_modules/@phoenix-common/security-guard/prebuild/darwin-{arch}/security_guard.node");
        let mut apps = vec![PathBuf::from("/Applications/Accio.app")];
        if let Some(home) = std::env::var_os("HOME") {
            apps.push(PathBuf::from(home).join("Applications/Accio.app"));
        }
        return apps
            .into_iter()
            .map(|app| app.join(&relative))
            .find(|path| path.is_file());
    }
    None
}

/// Only the cookie required by the SDK crosses the private pipe. No access or
/// refresh token is sent. Hashes scope workers/backoff without logging identity.
#[derive(Clone)]
pub(crate) struct Context {
    binding: String,
    sgcookie: String,
}
impl Context {
    pub(crate) fn from_credentials(c: &super::credentials::Credentials) -> Self {
        let binding = format!(
            "{:x}",
            Sha256::digest(
                serde_json::to_vec(&json!([
                    c.region.edition(),
                    c.user_id,
                    c.device_id,
                    c.sgcookie
                ]))
                .unwrap_or_default()
            )
        );
        Self {
            binding,
            sgcookie: c.sgcookie.clone(),
        }
    }
}

impl Worker {
    fn spawn(module: PathBuf, binding: String) -> Result<Self, &'static str> {
        let runtime =
            std::env::var_os("ACCIO_SECURITY_GUARD_NODE").unwrap_or_else(|| "node".into());
        let mut child = Command::new(runtime)
            .arg("-e")
            .arg(SCRIPT)
            .arg(module)
            .env_remove("NODE_OPTIONS")
            .env_remove("NODE_PATH")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .map_err(|_| "sg_runtime_unavailable")?;
        let input = child.stdin.take().ok_or("sg_bridge_error")?;
        let output = BufReader::new(child.stdout.take().ok_or("sg_bridge_error")?);
        Ok(Self {
            child,
            input,
            output,
            next_id: 0,
            binding,
        })
    }

    async fn call(&mut self, url: &str, sgcookie: &str) -> Result<Reply, &'static str> {
        self.next_id = self.next_id.wrapping_add(1);
        let appkey = std::env::var("ACCIO_SECURITY_GUARD_APPKEY")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| {
                if cfg!(target_os = "macos") {
                    "35337600"
                } else {
                    "35336201"
                }
                .into()
            });
        let mut line = serde_json::to_vec(&json!({"id":self.next_id,"url":url,"appkey":appkey,"binding":self.binding,"sgcookie":sgcookie}))
            .map_err(|_| "sg_bridge_error")?;
        line.push(b'\n');
        self.input
            .write_all(&line)
            .await
            .map_err(|_| "sg_bridge_error")?;
        self.input.flush().await.map_err(|_| "sg_bridge_error")?;
        let mut line = Vec::new();
        let mut total = 0;
        loop {
            // fill_buf bounds memory even if a broken addon never writes a newline.
            let available = self
                .output
                .fill_buf()
                .await
                .map_err(|_| "sg_bridge_error")?;
            if available.is_empty() {
                return Err("sg_bridge_error");
            }
            let count = available
                .iter()
                .position(|b| *b == b'\n')
                .map_or(available.len(), |p| p + 1);
            total += count;
            if total > MAX_REPLY {
                return Err("sg_invalid_shape");
            }
            line.extend_from_slice(&available[..count]);
            self.output.consume(count);
            if line.last() != Some(&b'\n') {
                continue;
            }
            if let Some(payload) = line.strip_prefix(PREFIX) {
                let reply: Reply =
                    serde_json::from_slice(payload).map_err(|_| "sg_invalid_shape")?;
                if reply.id != self.next_id {
                    return Err("sg_bridge_error");
                }
                return Ok(reply);
            }
            // Native diagnostics can use stdout. Discard them without logging.
            line.clear();
        }
    }
}

fn validate_headers(values: &BTreeMap<String, String>) -> Result<HeaderMap, &'static str> {
    if values.is_empty() || values.len() > 32 {
        return Err("sg_invalid_shape");
    }
    let mut out = HeaderMap::new();
    for (key, value) in values {
        let lower = key.to_ascii_lowercase();
        // Never let an addon replace credentials, host, framing or proxy headers.
        if !(lower.starts_with("x-bx-") || lower.starts_with("pctb-") || lower.starts_with("x-sg-"))
            || lower == "x-sg-err"
            || value.len() > 16 * 1024
        {
            return Err("sg_invalid_shape");
        }
        let name = HeaderName::from_bytes(key.as_bytes()).map_err(|_| "sg_invalid_shape")?;
        let value = HeaderValue::from_str(value).map_err(|_| "sg_invalid_shape")?;
        out.insert(name, value);
    }
    Ok(out)
}

async fn obtain(url: &str, context: &Context) -> Result<Reply, &'static str> {
    let mut state = STATE.lock().await;
    if let Some((when, error, binding)) = state.failed.as_ref() {
        if when.elapsed() < RETRY_DELAY && binding == &context.binding {
            if let Some(mut reply) = state.failed_reply.clone() {
                reply.recovery_backoff = true;
                return Ok(reply);
            }
            return Err(*error);
        }
        state.failed = None;
        state.failed_reply = None;
    }
    if state
        .worker
        .as_ref()
        .is_some_and(|worker| worker.binding != context.binding)
    {
        if let Some(mut old) = state.worker.take() {
            let _ = old.child.kill().await;
        }
    }
    if state.worker.is_none() {
        let result = module_path()
            .ok_or("sg_unavailable")
            .and_then(|path| Worker::spawn(path, context.binding.clone()));
        match result {
            Ok(worker) => state.worker = Some(worker),
            Err(error) => {
                state.failed = Some((Instant::now(), error, context.binding.clone()));
                return Err(error);
            }
        }
    }
    // Own the worker during the await: cancelling this future drops/kills it,
    // so a half-read reply can never leak into the next request.
    let mut worker = state.worker.take().ok_or("sg_unavailable")?;
    let result = match tokio::time::timeout(CALL_TIMEOUT, worker.call(url, &context.sgcookie)).await
    {
        Ok(result) => result,
        Err(_) => Err("sg_timeout"),
    };
    match &result {
        Ok(reply)
            if matches!(
                reply.err_type.as_deref(),
                Some("sg_init_failed" | "sg_unavailable")
            ) =>
        {
            // A resolved failed promise in Node cannot recover. Retire this worker;
            // preserve safe diagnostics during backoff, then create a fresh worker.
            let _ = worker.child.start_kill();
            state.failed = Some((Instant::now(), "sg_init_failed", context.binding.clone()));
            state.failed_reply = Some(reply.clone());
        }
        Ok(_) => state.worker = Some(worker),
        Err(error) => {
            let _ = worker.child.start_kill();
            state.failed = Some((Instant::now(), error, context.binding.clone()));
        }
    }
    result
}

pub(crate) async fn headers(
    url: &str,
    mode: Mode,
    context: &Context,
) -> Result<(HeaderMap, Report), GatewayError> {
    let started = Instant::now();
    if mode == Mode::Off {
        return finish_headers(Mode::Off, Err("disabled"), 0);
    }
    crate::http::require_validation_url(url).map_err(|why|GatewayError::with_status(403,why).with_code("validation_egress_blocked"))?;
    if crate::http::validation_mode() && std::env::var("AIBUDDY_VALIDATION_SG_FIXTURE").ok().as_deref()!=Some("1") {
        return finish_headers(mode,Err("validation_native_disabled"),0);
    }
    let budget = CALL_TIMEOUT + Duration::from_secs(1);
    // Includes waiting for the worker lock, so parallel initialization cannot
    // leave callers queued indefinitely behind other SDK calls.
    let reply = tokio::time::timeout(budget, obtain(url, context))
        .await
        .unwrap_or(Err("sg_timeout"));
    finish_headers(
        mode,
        reply,
        started.elapsed().as_millis().min(u64::MAX as u128) as u64,
    )
}

fn safe_label(value: &str, allowed: &[&str]) -> Option<String> {
    allowed.contains(&value).then(|| value.to_string())
}
fn safe_reason(value: &str) -> Option<String> {
    safe_label(
        value,
        &[
            "already_initialized",
            "already_in_progress",
            "native_error",
            "missing_token",
        ],
    )
}

fn finish_headers(
    mode: Mode,
    reply: Result<Reply, &'static str>,
    duration_ms: u64,
) -> Result<(HeaderMap, Report), GatewayError> {
    let mut report = Report {
        mode: match mode {
            Mode::Auto => "auto",
            Mode::Off => "off",
            Mode::Required => "required",
        },
        outcome: "disabled".into(),
        init_status: None,
        init_mode: None,
        token_present: false,
        init_error_code: None,
        cookie_error_code: None,
        init_reason: None,
        cookie_reason: None,
        fallback_attempted: false,
        recovery_backoff: false,
        header_names: vec![],
        duration_ms,
    };
    if mode == Mode::Off {
        return Ok((HeaderMap::new(), report));
    }
    let result = match reply {
        Ok(reply) => {
            report.recovery_backoff = reply.recovery_backoff;
            if let Some(init) = reply.init {
                report.token_present = init.token_present;
                report.init_status = safe_label(
                    init.status.as_str(),
                    &["success", "already_initialized", "failed", "unavailable"],
                );
                report.init_mode = init
                    .mode
                    .as_deref()
                    .and_then(|s| safe_label(s, &["sgcookie", "environment"]));
                report.init_error_code = init.error_code;
                report.cookie_error_code = init.cookie_error_code;
                report.init_reason = init.reason.as_deref().and_then(safe_reason);
                report.cookie_reason = init.cookie_reason.as_deref().and_then(safe_reason);
                report.fallback_attempted = init.fallback_attempted;
            }
            if let Some(error) = reply.err_type {
                let kind = match error.as_str() {
                    "sg_unavailable" => "sg_unavailable",
                    "sg_native_error" => "sg_native_error",
                    "sg_parse_error" => "sg_parse_error",
                    "sg_init_failed" => "sg_init_failed",
                    "sg_context_changed" => "sg_context_changed",
                    _ => "sg_invalid_shape",
                };
                report.outcome = if kind == "sg_native_error" {
                    reply
                        .err_code
                        .map(|c| format!("sg_native_{c}"))
                        .unwrap_or_else(|| kind.into())
                } else {
                    kind.into()
                };
                Err(kind)
            } else if mode == Mode::Required
                && (!report.token_present
                    || !matches!(
                        report.init_status.as_deref(),
                        Some("success" | "already_initialized")
                    ))
            {
                Err("sg_init_failed")
            } else {
                reply
                    .headers
                    .as_ref()
                    .ok_or("sg_invalid_shape")
                    .and_then(validate_headers)
            }
        }
        Err(error) => Err(error),
    };
    match result {
        Ok(headers) => {
            report.outcome = "factors_generated".into();
            report.header_names = headers.keys().map(|k| k.to_string()).collect();
            Ok((headers, report))
        }
        Err(error) => {
            if report.outcome == "disabled" {
                report.outcome = error.into();
            }
            if mode == Mode::Required {
                return Err(GatewayError::with_status(503,"Accio SecurityGuard 尚未就绪，请检查官方模块与 Node 运行环境")
                    .with_code("accio_security_guard_unavailable")
                    .with_details(json!({"security_guard":report,"error_metadata":{"retryable":false,"replay_safe":false}})));
            }
            // Official ADK fails open with an explicit x-sg-err diagnostic.
            let mut headers = HeaderMap::new();
            if let Ok(value) = HeaderValue::from_str(&report.outcome) {
                headers.insert("x-sg-err", value);
            }
            Ok((headers, report))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_header_injection_and_credential_overrides() {
        for (key, value) in [
            ("authorization", "secret"),
            ("host", "evil"),
            ("pctb-x-api", "x\r\ny"),
            ("x-sg-err", "fake"),
        ] {
            assert!(validate_headers(&BTreeMap::from([(key.into(), value.into())])).is_err());
        }
        assert!(validate_headers(&BTreeMap::new()).is_err());
        assert!(validate_headers(&BTreeMap::from([(
            "pctb-x-api".into(),
            "example.com%2Fapi".into()
        )]))
        .is_ok());
    }
    #[tokio::test]
    async fn disabled_mode_does_not_load_native_code() {
        let (headers, report) = headers(
            "invalid URL",
            Mode::Off,
            &Context {
                binding: "synthetic".into(),
                sgcookie: String::new(),
            },
        )
        .await
        .unwrap();
        assert!(headers.is_empty());
        assert_eq!(report.outcome, "disabled");
    }

    #[test]
    fn unavailable_sdk_fails_open_explicitly_or_blocks_without_account_replay() {
        let (headers, report) = finish_headers(Mode::Auto, Err("sg_unavailable"), 5).unwrap();
        assert_eq!(headers["x-sg-err"], "sg_unavailable");
        assert_eq!(report.outcome, "sg_unavailable");
        assert_eq!(report.duration_ms, 5);
        let error = finish_headers(Mode::Required, Err("sg_unavailable"), 5).unwrap_err();
        assert_eq!(error.status_code, 503);
        assert!(!super::super::adk_error::allows_replay(&error));
    }

    #[test]
    fn required_mode_needs_verified_initialization_and_valid_factors() {
        for token in [false, true] {
            let reply:Reply=serde_json::from_value(json!({"id":1,"init":{"status":"already_initialized","tokenPresent":token},"headers":{"pctb-x-t":"123"}})).unwrap();
            let result = finish_headers(Mode::Required, Ok(reply), 0);
            assert_eq!(result.is_ok(), token);
            if let Ok((headers, report)) = result {
                assert_eq!(headers["pctb-x-t"], "123");
                assert_eq!(report.header_names, ["pctb-x-t"]);
            }
        }
        let reply:Reply=serde_json::from_value(json!({"id":1,"init":{"status":"success","tokenPresent":true},"headers":{"authorization":"never-forward"}})).unwrap();
        assert!(finish_headers(Mode::Required, Ok(reply), 0).is_err());
        let reply: Reply =
            serde_json::from_value(json!({"id":1,"errType":"sg_native_error","errCode":42}))
                .unwrap();
        let (headers, _) = finish_headers(Mode::Auto, Ok(reply), 0).unwrap();
        assert_eq!(headers["x-sg-err"], "sg_native_42");
    }

    #[test]
    fn initialization_diagnostics_keep_both_codes_but_no_arbitrary_native_labels() {
        let reply: Reply = serde_json::from_value(json!({"id":1,"errType":"sg_init_failed",
            "init":{"status":"failed","mode":"environment","tokenPresent":true,
            "errorCode":43,"cookieErrorCode":42,"reason":"native_error",
            "cookieReason":"private-cookie-or-path","fallbackAttempted":true}}))
        .unwrap();
        let (_, report) = finish_headers(Mode::Auto, Ok(reply.clone()), 2).unwrap();
        assert_eq!(report.init_error_code, Some(43));
        assert_eq!(report.cookie_error_code, Some(42));
        assert!(report.fallback_attempted);
        assert!(report.cookie_reason.is_none());
        assert!(!serde_json::to_string(&report).unwrap().contains("private-"));
        let required = finish_headers(Mode::Required, Ok(reply), 2).unwrap_err();
        assert_eq!(
            required.details.as_ref().unwrap()["security_guard"]["init_error_code"],
            43
        );
    }

    /// Explicitly opt in: executes only a temporary synthetic .cjs module, with
    /// no native addon, account store or network. Run this target alone because
    /// it controls worker environment variables and the process-global state.
    #[tokio::test]
    #[ignore = "local synthetic Node worker; run alone with --ignored --test-threads=1"]
    async fn local_sdk_recovery_regression() {
        let folder = std::env::temp_dir().join(format!(
            "accio-sg-recovery-{}",
            crate::ids::uuid_v4()
        ));
        std::fs::create_dir_all(&folder).unwrap();
        let module = folder.join("sdk.cjs");
        let marker = folder.join("attempts");
        // Increment a marker only when a fresh worker loads this fake module.
        let fake = format!(
            r#"const fs=require('node:fs');fs.appendFileSync({},'load\n');
            module.exports={{initUmidBySgCookie:async()=>{{throw Object.assign(Error('private cookie'),{{errorCode:42}})}},
            initUmid:async()=>{{throw Object.assign(Error('private environment'),{{errorCode:43}})}},
            getSecurityToken:()=> 'stale-token',getSecurityFactorsForWeb:()=>JSON.stringify({{'x-bx-test':'ok'}})}};"#,
            serde_json::to_string(&marker.to_string_lossy()).unwrap()
        );
        std::fs::write(&module, fake).unwrap();
        let previous = std::env::var_os("ACCIO_SECURITY_GUARD_MODULE");
        std::env::set_var("AIBUDDY_VALIDATION_SG_FIXTURE", "1");
        std::env::set_var("ACCIO_SECURITY_GUARD_MODULE", &module);
        reset_worker_for_test().await;
        let context = Context {
            binding: "synthetic".into(),
            sgcookie: "synthetic-cookie".into(),
        };
        let (_, first) = headers("http://127.0.0.1/path", Mode::Auto, &context)
            .await
            .unwrap();
        assert_eq!(first.init_error_code, Some(43));
        assert_eq!(first.cookie_error_code, Some(42));
        assert!(first.fallback_attempted);
        assert!(!first.recovery_backoff);
        assert!(STATE.lock().await.worker.is_none());
        let (_, cached) = headers("http://127.0.0.1/path", Mode::Auto, &context)
            .await
            .unwrap();
        assert!(cached.recovery_backoff);
        assert_eq!(cached.init_error_code, Some(43));
        assert_eq!(std::fs::read_to_string(&marker).unwrap().lines().count(), 1);
        assert!(
            headers("http://127.0.0.1/path", Mode::Required, &context)
                .await
                .is_err()
        );
        // Simulate expiry without waiting 30 seconds; a successful fresh module
        // is picked up, rather than reusing the old resolved failed promise.
        std::fs::write(
            &module,
            r#"module.exports={initUmidBySgCookie:async()=> 'synthetic-token',
            getSecurityFactorsForWeb:()=>JSON.stringify({'x-bx-test':'ok'})};"#,
        )
        .unwrap();
        {
            let mut state = STATE.lock().await;
            state.failed.as_mut().unwrap().0 = Instant::now() - RETRY_DELAY;
        }
        let (factors, recovered) =
            headers("http://127.0.0.1/path", Mode::Required, &context)
                .await
                .unwrap();
        assert_eq!(factors["x-bx-test"], "ok");
        assert_eq!(recovered.outcome, "factors_generated");
        assert!(!recovered.recovery_backoff);
        reset_worker_for_test().await;
        std::env::remove_var("AIBUDDY_VALIDATION_SG_FIXTURE");
        match previous {
            Some(v) => std::env::set_var("ACCIO_SECURITY_GUARD_MODULE", v),
            None => std::env::remove_var("ACCIO_SECURITY_GUARD_MODULE"),
        }
        std::fs::remove_dir_all(folder).unwrap();
    }
}

#[cfg(test)]
pub(super) async fn reset_worker_for_test() {
    let mut state = STATE.lock().await;
    if let Some(mut worker) = state.worker.take() {
        let _ = worker.child.kill().await;
    }
    state.failed = None;
    state.failed_reply = None;
}
