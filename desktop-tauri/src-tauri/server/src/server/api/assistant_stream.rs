//! OpenAI SSE -> AI SDK UI Message Stream v1. The original forwarding/recording
//! stream stays underneath this adapter, including its disconnect guard.
use std::collections::{BTreeMap, HashSet, VecDeque};
use axum::body::{Body, Bytes};
use axum::response::Response;
use futures::StreamExt;
use serde_json::{json, Value};

const MAX_EVENT: usize = 2 * 1024 * 1024;

#[derive(Default)]
struct Tool { id: String, name: String, args: String }

#[derive(Default)]
struct Decoder {
    line: Vec<u8>,
    data: String,
    queue: VecDeque<Bytes>,
    tools: BTreeMap<u64, Tool>,
    tool_bytes: usize,
    text: bool,
    reasoning: bool,
    finish: String,
    ended: bool,
}

impl Decoder {
    fn emit(&mut self, part: Value) {
        self.queue.push_back(Bytes::from(format!("data: {part}\n\n")));
    }
    fn close_text(&mut self) {
        if self.text { self.emit(json!({"type":"text-end","id":"answer"})); self.text = false; }
        if self.reasoning { self.emit(json!({"type":"reasoning-end","id":"reasoning"})); self.reasoning = false; }
    }
    fn fail(&mut self, message: impl Into<String>) {
        if self.ended { return; }
        self.close_text();
        self.emit(json!({"type":"error","errorText":message.into()}));
        self.queue.push_back(Bytes::from_static(b"data: [DONE]\n\n"));
        self.ended = true;
    }
    fn event(&mut self) {
        let data = std::mem::take(&mut self.data);
        let data = data.trim();
        if data.is_empty() || self.ended { return; }
        if data == "[DONE]" {
            if self.finish.is_empty() { self.fail("上游响应缺少完成状态，请重试"); return; }
            if !self.tools.is_empty() && self.finish != "tool_calls" {
                self.fail("上游工具调用未正常完成，未执行"); return;
            }
            // Validate the entire batch before releasing ANY executable tool input.
            let mut ids = HashSet::new();
            let mut ready = Vec::new();
            for tool in self.tools.values() {
                let input = serde_json::from_str::<Value>(&tool.args);
                if tool.id.is_empty() || tool.name.is_empty() || !ids.insert(tool.id.clone())
                    || !input.as_ref().is_ok_and(Value::is_object) {
                    self.fail("上游工具调用不完整或参数无效，未执行"); return;
                }
                ready.push(json!({"type":"tool-input-available","toolCallId":tool.id,
                    "toolName":tool.name,"input":input.unwrap_or(Value::Null),"dynamic":true}));
            }
            if self.finish == "tool_calls" && ready.is_empty() {
                self.fail("上游没有返回完整工具调用，未执行"); return;
            }
            self.close_text();
            for part in ready { self.emit(part); }
            self.emit(json!({"type":"finish-step"}));
            let reason = match self.finish.as_str() {
                "tool_calls" => "tool-calls", "length" => "length", "content_filter" => "content-filter", _ => "stop",
            };
            self.emit(json!({"type":"finish","finishReason":reason}));
            self.queue.push_back(Bytes::from_static(b"data: [DONE]\n\n"));
            self.ended = true;
            return;
        }
        let chunk = match serde_json::from_str::<Value>(data) {
            Ok(value) => value,
            Err(_) => { self.fail("上游返回了无效的流式数据"); return; }
        };
        if let Some(error) = chunk.get("error").filter(|e| !e.is_null()) {
            let message = error.as_str().or_else(|| error.get("message").and_then(Value::as_str))
                .unwrap_or("上游流式请求失败");
            self.fail(message.chars().take(500).collect::<String>()); return;
        }
        let Some(choice) = chunk.get("choices").and_then(Value::as_array).and_then(|a| a.first()) else { return; };
        let delta = &choice["delta"];
        if let Some(content) = delta.get("reasoning_content").and_then(Value::as_str).filter(|s| !s.is_empty()) {
            if !self.reasoning { self.emit(json!({"type":"reasoning-start","id":"reasoning"})); self.reasoning = true; }
            self.emit(json!({"type":"reasoning-delta","id":"reasoning","delta":content}));
        }
        if let Some(content) = delta.get("content").and_then(Value::as_str).filter(|s| !s.is_empty()) {
            if !self.text { self.emit(json!({"type":"text-start","id":"answer"})); self.text = true; }
            self.emit(json!({"type":"text-delta","id":"answer","delta":content}));
        }
        if let Some(calls) = delta.get("tool_calls").and_then(Value::as_array) {
            for call in calls {
                let index = call.get("index").and_then(Value::as_u64).unwrap_or(0);
                if self.tools.len() >= 64 && !self.tools.contains_key(&index) { self.fail("上游工具调用数量超限"); return; }
                let tool = self.tools.entry(index).or_default();
                if let Some(id) = call.get("id").and_then(Value::as_str) { tool.id = id.to_string(); }
                if let Some(name) = call.pointer("/function/name").and_then(Value::as_str) { self.tool_bytes += name.len(); tool.name.push_str(name); }
                if let Some(args) = call.pointer("/function/arguments").and_then(Value::as_str) { self.tool_bytes += args.len(); tool.args.push_str(args); }
                if self.tool_bytes > MAX_EVENT { self.fail("上游工具参数总量超限"); return; }
                if tool.args.len() + tool.name.len() + tool.id.len() > MAX_EVENT { self.fail("上游工具参数超限"); return; }
            }
        }
        if let Some(reason) = choice.get("finish_reason").and_then(Value::as_str) { self.finish = reason.to_string(); }
    }
    fn push(&mut self, bytes: &[u8]) {
        for byte in bytes {
            if self.ended { break; }
            if *byte != b'\n' {
                self.line.push(*byte);
                if self.line.len() + self.data.len() > MAX_EVENT { self.fail("上游流式事件超限"); }
                continue;
            }
            if self.line.last() == Some(&b'\r') { self.line.pop(); }
            let line = std::mem::take(&mut self.line);
            let line = match std::str::from_utf8(&line) {
                Ok(line) => line,
                Err(_) => { self.fail("上游流式数据不是有效 UTF-8"); return; }
            };
            if line.is_empty() { self.event(); }
            else if let Some(data) = line.strip_prefix("data:") {
                if !self.data.is_empty() { self.data.push('\n'); }
                self.data.push_str(data.strip_prefix(' ').unwrap_or(data));
            }
        }
    }
    fn eof(&mut self) {
        if !self.line.is_empty() { self.push(b"\n"); }
        if !self.data.is_empty() { self.event(); }
        if !self.ended { self.fail("上游连接在响应完成前断开，请重试"); }
    }
}

pub async fn adapt(response: Response) -> Response {
    if !response.status().is_success() { return response; }
    let (mut parts, body) = response.into_parts();
    let is_sse = parts.headers.get("content-type").and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.starts_with("text/event-stream"));
    let body = if is_sse { body } else {
        let bytes = match axum::body::to_bytes(body, 32 * 1024 * 1024).await {
            Ok(bytes) => bytes,
            Err(_) => return super::super::errors::management_error(502, "助手响应读取失败"),
        };
        let value = serde_json::from_slice::<Value>(&bytes).unwrap_or(Value::Null);
        let choice = &value["choices"][0];
        let mut message = choice["message"].clone();
        if let Some(calls) = message.get_mut("tool_calls").and_then(Value::as_array_mut) {
            for (index, call) in calls.iter_mut().enumerate() {
                if let Some(object) = call.as_object_mut() { object.insert("index".into(), json!(index)); }
            }
        }
        let chunk = if value.get("error").is_some() { value } else { json!({"choices":[{"delta":message,"finish_reason":choice["finish_reason"]}]}) };
        Body::from(format!("data: {chunk}\n\ndata: [DONE]\n\n"))
    };
    let mut decoder = Decoder::default();
    decoder.emit(json!({"type":"start"}));
    decoder.emit(json!({"type":"start-step"}));
    let stream = futures::stream::unfold((body.into_data_stream(), decoder), |(mut source, mut decoder)| async move {
        loop {
            if let Some(bytes) = decoder.queue.pop_front() {
                return Some((Ok::<_, std::io::Error>(bytes), (source, decoder)));
            }
            if decoder.ended { return None; }
            match source.next().await {
                Some(Ok(bytes)) => decoder.push(&bytes),
                Some(Err(_)) => decoder.fail("上游连接读取失败，请重试"),
                None => decoder.eof(),
            }
        }
    });
    parts.headers.remove("content-length");
    parts.headers.insert("content-type", axum::http::HeaderValue::from_static("text/event-stream"));
    parts.headers.insert("x-vercel-ai-ui-message-stream", axum::http::HeaderValue::from_static("v1"));
    parts.headers.insert("cache-control", axum::http::HeaderValue::from_static("no-cache"));
    Response::from_parts(parts, Body::from_stream(stream))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn decode(data: &[u8], width: usize) -> String {
        let mut d = Decoder::default();
        for part in data.chunks(width) { d.push(part); }
        d.eof();
        d.queue.into_iter().map(|b| String::from_utf8_lossy(&b).to_string()).collect()
    }
    #[test] fn handles_crlf_utf8_and_split_terminal() {
        let wire = "data: {\"choices\":[{\"delta\":{\"content\":\"你好\"},\"finish_reason\":\"stop\"}]}\r\n\r\ndata:[DONE]\r\n";
        for width in 1..wire.len() {
            let out = decode(wire.as_bytes(), width);
            assert!(out.contains("你好") && out.contains("text-end") && !out.contains("errorText"));
        }
    }
    #[test] fn never_releases_tools_on_error_or_truncation() {
        let partial = "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"x\",\"function\":{\"name\":\"list_models\",\"arguments\":\"{}\"}}]},\"finish_reason\":\"tool_calls\"}]}\n\n";
        for tail in ["", "data: {\"error\":{\"message\":\"fixture failure\"}}\n\ndata: [DONE]\n\n"] {
            let out = decode(format!("{partial}{tail}").as_bytes(), 3);
            assert!(out.contains("errorText") && !out.contains("tool-input-available"));
        }
        let out = decode(format!("{partial}data: [DONE]\n\n").as_bytes(), 2);
        assert!(out.contains("tool-input-available") && !out.contains("errorText"));
        for reason in ["length", "content_filter", "stop"] {
            let wire = format!("{}data: [DONE]\n\n", partial.replace("\"finish_reason\":\"tool_calls\"", &format!("\"finish_reason\":\"{reason}\"")));
            let out = decode(wire.as_bytes(), 2);
            assert!(out.contains("errorText") && !out.contains("tool-input-available"));
        }
    }
    #[test] fn malformed_tool_batch_is_atomic() {
        let wire = "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"ok\",\"function\":{\"name\":\"list_models\",\"arguments\":\"{}\"}},{\"index\":1,\"id\":\"bad\",\"function\":{\"name\":\"test_model\",\"arguments\":\"{\"}}]},\"finish_reason\":\"tool_calls\"}]}\n\ndata: [DONE]\n\n";
        let out = decode(wire.as_bytes(), 1);
        assert!(out.contains("errorText") && !out.contains("tool-input-available"));
    }
    #[tokio::test]
    async fn json_multiple_tools_keep_indices_and_errors_remain_visible() {
        let value = json!({"choices":[{"message":{"tool_calls":[{"id":"a","function":{"name":"list_models","arguments":"{}"}},{"id":"b","function":{"name":"list_account_balance","arguments":"{}"}}]},"finish_reason":"tool_calls"}]});
        let response = adapt(Response::new(Body::from(value.to_string()))).await;
        let bytes = axum::body::to_bytes(response.into_body(), MAX_EVENT).await.unwrap();
        let out = String::from_utf8(bytes.to_vec()).unwrap();
        assert_eq!(out.matches("tool-input-available").count(), 2);
        assert!(!out.contains("errorText"));
        let response = adapt(Response::new(Body::from(json!({"error":{"message":"json failure"}}).to_string()))).await;
        let bytes = axum::body::to_bytes(response.into_body(), MAX_EVENT).await.unwrap();
        assert!(String::from_utf8_lossy(&bytes).contains("json failure"));
    }
    #[test]
    fn reasoning_is_streamed_and_closed_on_failure() {
        let out = decode(b"data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"thinking\"}}]}\r\n\r\ndata: {\"error\":{\"message\":\"failed\"}}\r\n\r\n", 1);
        assert!(out.contains("reasoning-delta") && out.contains("reasoning-end") && out.contains("errorText"));
    }
}
