//! Request-scoped telemetry. Sanitized diagnostics travel through SDK log events.
//! The host owns raw wire capture and final request accounting. SDK abort drops
//! the provider future, including queued/streamed network and task operations.

use std::sync::Arc;

use serde_json::Value;

/// 调试报文采集器（空实现：`capture()` 恒返回 `None`）。
#[allow(dead_code)]
pub struct Capture;

#[allow(dead_code)]
impl Capture {
    /// 记录一次即将发出的请求（空实现）。
    pub fn reset_request(&self, _url: &str, _provider: &str, _headers: &[(String, String)], _body: &Value) {}

    /// 记录响应状态与头（空实现）。
    pub fn attach_response(&self, _status: u16, _headers: &reqwest::header::HeaderMap) {}

    /// 追加一段响应体字节（空实现）。
    pub fn push(&self, _bytes: &[u8]) {}
}

/// 请求级遥测（空实现，见模块头）。
///
/// ── 为什么整块 allow(dead_code) ────────────────────────────
/// 这个类型的意义是「让搬来的调用点一行不改」。不同家用到的方法不一样
/// （Qoder 用 `note_queued` / `note_attempt_retry`，MonkeyCode 用
/// `report_usage` / `note_error`，抓包只在网关侧有消费方），所以总有几个
/// 方法在当前这批家里没有调用方。逐个加 allow 只会让每个家搬进来时多改
/// 一次；这里是**契约的一部分**，不是遗留代码。
#[allow(dead_code)]
#[derive(Clone, Default)]
pub struct RequestTelemetry { state: Arc<std::sync::Mutex<LocalState>> }

#[allow(dead_code)]
impl RequestTelemetry {
    /// 新建（插件里恒为一个无状态的空对象）。
    pub fn with_id()->Self{let v=Self::new();v.ensure_id(&crate::ids::uuid_v4());v}
    pub fn new() -> Self {
        Self::default()
    }

    /// 调试采集器：**恒为 `None`**（插件不上报调试报文，见模块头第 1 条）。
    pub fn capture(&self) -> Option<Arc<Capture>> {
        None
    }

    /// 上报用量（空实现，见模块头第 4 条）。
    pub fn report_usage(&self, usage: &Value) {if let Ok(mut s)=self.state.lock(){s.prompt_tokens=usage.get("prompt_tokens").and_then(Value::as_u64).unwrap_or(0);s.total_tokens=usage.get("total_tokens").and_then(Value::as_u64).unwrap_or(0);}}

    /// 记一次内部重试（空实现，见模块头第 2 条）。
    pub fn note_attempt_retry(&self, _reason: &str, _status: Option<i64>, _delay_ms: u64) {}

    /// 记一次排队等待（空实现，见模块头第 2 条）。
    pub fn note_queued(
        &self,
        _reason: &str,
        _code: Option<i64>,
        _wait_ms: u64,
        _attempt: usize,
        _max_attempts: usize,
    ) {
    }

    /// 记一次错误（空实现：错误本身仍会返回给调用方并进日志）。
    pub fn note_error(&self, message: &str) {if let Ok(mut s)=self.state.lock(){s.error=Some(message.into());}}

    /// 记「收到第一帧内容」的时刻（空实现：网关的时延统计在它自己那一侧算）。
    ///
    /// 从网关搬来的家（Trae 等）在首帧处调它。补一个空实现而不是删调用点，
    /// 理由与模块头一致：让 diff 里只剩真正的逻辑改动。
    pub fn note_first_frame(&self) {}

    /// 客户端取消令牌：**恒为 `None`**（插件拿不到网关的取消信号，见模块头第 3 条）。
    pub fn cancel_token(&self) -> Option<Arc<()>> {
        None
    }

    /// 客户端是否已取消：**恒为 `false`**（理由同 `cancel_token`）。
    pub fn is_cancelled(&self) -> bool {
        false
    }
}

#[derive(Clone, Default, Debug, serde::Serialize)]
pub struct Timing {pub stage:String,pub duration_ms:Option<u64>,pub completed:Option<bool>}
#[derive(Clone, Default)]
pub struct AttemptDetail { pub diagnostics: std::collections::BTreeMap<String, Value>,pub timings:Vec<Timing> }
#[derive(Clone, Default)]
pub struct Snapshot {pub attempts_detail: Vec<AttemptDetail>,pub prompt_tokens:u64,pub total_tokens:u64,pub error:Option<String>}
#[derive(Default)]
struct LocalState {id:String,context:std::collections::HashMap<String,Value>,attempts:Vec<AttemptDetail>,prompt_tokens:u64,total_tokens:u64,error:Option<String>}
pub struct Stage {name:String,started:std::time::Instant,state:Arc<std::sync::Mutex<LocalState>>,attempt:Option<usize>,done:bool}
impl Stage {
 fn publish(&mut self,completed:bool){if self.done{return;}self.done=true;if let Ok(mut s)=self.state.lock(){if let Some(row)=self.attempt.and_then(|i|s.attempts.get_mut(i)){row.timings.push(Timing{stage:self.name.clone(),duration_ms:Some(self.started.elapsed().as_millis()as u64),completed:Some(completed)});}}}
 pub fn finish(mut self){self.publish(true);}
}
impl Drop for Stage{fn drop(&mut self){self.publish(false);}}

impl RequestTelemetry {
    pub fn note_attempt(&self,_account:Option<&str>,_model:&str,_provider:&str) {}
    pub fn id(&self) -> String { self.state.lock().map(|s|s.id.clone()).unwrap_or_default() }
    pub fn ensure_id(&self, id: &str) { if let Ok(mut s)=self.state.lock(){if s.id.is_empty(){s.id=id.into();}} }
    pub fn provider_context(&self, key: &str, create: impl FnOnce()->Value) -> Value {
        if let Ok(mut s)=self.state.lock(){return s.context.entry(key.into()).or_insert_with(create).clone();} create()
    }
    pub fn snapshot(&self) -> Snapshot { self.state.lock().map(|s|Snapshot{attempts_detail:s.attempts.clone(),prompt_tokens:s.prompt_tokens,total_tokens:s.total_tokens,error:s.error.clone()}).unwrap_or_default() }
    pub fn note_attempt_started(&self, _provider: &str, _account: &str) { if let Ok(mut s)=self.state.lock(){s.attempts.push(AttemptDetail::default());} }
    pub fn begin_stage(&self, name: &str) -> Stage { Stage{name:name.into(),started:std::time::Instant::now(),state:self.state.clone(),attempt:self.state.lock().ok().and_then(|s|s.attempts.len().checked_sub(1)),done:false} }
    pub fn note_accio_diagnostics(&self, attempt: usize, key: &str, value: Value) {
        if let Ok(mut s)=self.state.lock(){if let Some(row)=s.attempts.get_mut(attempt){row.diagnostics.insert(key.into(),value.clone());}}
        // These reports contain normalized identity/SDK status/frame counters, never raw credentials.
        agent2api_provider_sdk::serve::emit_log("debug",format!("AIBUDDY_TELEMETRY:{}",serde_json::json!({"requestId":self.id(),"attempt":attempt,"provider":"accio","key":key,"value":value})));
    }
    pub fn note_accio_stream_diagnostics(&self, attempt: usize, value: Value) { self.note_accio_diagnostics(attempt,"accioStream",value); }
}
