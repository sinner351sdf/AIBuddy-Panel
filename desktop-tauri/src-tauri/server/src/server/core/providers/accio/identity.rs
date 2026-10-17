//! Task identity is separate from OAuth/SDK identity. No tokens or prompts here.
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use reqwest::header::HeaderMap;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::server::core::upstream::{request::new_request_id, usage::RequestTelemetry};
use crate::server::errors::GatewayError;

#[derive(Clone, Serialize, Deserialize)]
struct Turn {
    message_id: String,
    user_request_id: String,
    conversation_id: Option<String>,
    session_key: Option<String>,
    conversation_name: Option<String>,
    agent_id: Option<String>,
    parent_agent_id: Option<String>,
    parent_span_id: Option<String>,
    round_number: u32,
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct Call {
    pub local_request_id: String,
    pub message_id: String,
    pub user_request_id: String,
    pub llm_request_id: String,
    pub conversation_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_key: Option<String>,
    #[serde(skip_serializing)]
    pub conversation_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_agent_id: Option<String>,
    pub span_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_span_id: Option<String>,
    pub round_number: u32,
}

fn invalid() -> GatewayError {
    GatewayError::bad_request("Accio 上下文字段无效或相互冲突").with_code("accio_context_invalid")
}

fn context_text(
    body: &Value,
    headers: &HeaderMap,
    snake: &str,
    camel: &str,
    name: bool,
) -> Result<Option<String>, GatewayError> {
    let metadata = body.pointer("/metadata/accio");
    let header = format!("x-accio-{}", snake.replace('_', "-"));
    let limit = if name {
        256
    } else if snake == "session_key" {
        512
    } else {
        128
    };
    let mut result: Option<String> = None;
    for value in [
        metadata.and_then(|v| v.get(snake)),
        metadata.and_then(|v| v.get(camel)),
        body.get(snake),
    ] {
        if let Some(value) = value.filter(|v| !v.is_null()) {
            let value = value.as_str().ok_or_else(invalid)?.trim();
            if value.is_empty() {
                continue;
            }
            if value.len() > limit
                || value.chars().any(char::is_control)
                || (!name
                    && !value
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"-_.:/@#".contains(&b)))
            {
                return Err(invalid());
            }
            if result.as_deref().is_some_and(|r| r != value) {
                return Err(invalid());
            }
            result = Some(value.into());
        }
    }
    if let Some(value) = headers.get(header) {
        let value = value.to_str().map_err(|_| invalid())?.trim();
        if value.is_empty()
            || value.len() > limit
            || !value
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-_.:/@#".contains(&b))
        {
            return Err(invalid());
        }
        if result.as_deref().is_some_and(|r| r != value) {
            return Err(invalid());
        }
        result = Some(value.into());
    }
    Ok(result)
}

pub(crate) fn message_id() -> String {
    format!(
        "AI_AccioWork_{}_{}",
        new_request_id().replace('-', ""),
        crate::server::logging::now_ms()
    )
}

impl Turn {
    fn parse(body: &Value, headers: &HeaderMap) -> Result<Self, GatewayError> {
        if body
            .pointer("/metadata/accio")
            .is_some_and(|v| !v.is_object())
        {
            return Err(invalid());
        }
        let text = |snake, camel| context_text(body, headers, snake, camel, false);
        let session_key = text("session_key", "sessionKey")?;
        let mut conversation_id = text("conversation_id", "conversationId")?;
        let mut agent_id = text("agent_id", "agentId")?;
        // Same conditional derivation as the official Not(sessionKey).
        if let Some(key) = session_key
            .as_deref()
            .and_then(|s| s.strip_prefix("agent:"))
        {
            if let Some((prefix, cid)) = key.split_once(":cid:") {
                // For the direct agent:...:cid:... form, do not pair a supplied
                // session with an unrelated generated conversation.
                if !cid.contains(':') {
                    if cid.is_empty()
                        || cid.len() > 128
                        || conversation_id.as_deref().is_some_and(|v| v != cid)
                    {
                        return Err(invalid());
                    }
                    conversation_id = Some(cid.into());
                } else if conversation_id.is_none() {
                    return Err(invalid());
                }
                if let Some(derived) = prefix.split(':').next().filter(|v| !v.is_empty()) {
                    if agent_id.as_deref().is_some_and(|v| v != derived) {
                        return Err(invalid());
                    }
                    agent_id = Some(derived.into());
                }
            }
        }
        let mut round = None;
        for value in [
            body.pointer("/metadata/accio/round_number"),
            body.pointer("/metadata/accio/roundNumber"),
            body.get("round_number"),
        ] {
            if let Some(value) = value {
                let n = value
                    .as_u64()
                    .filter(|n| (1..=1_000_000).contains(n))
                    .ok_or_else(invalid)?;
                if round.is_some_and(|old| old != n) {
                    return Err(invalid());
                }
                round = Some(n);
            }
        }
        let round_number = match round {
            Some(n) => n as u32,
            None => {
                // A tool/continuation call after the last user message advances
                // the LLM round; earlier conversation turns do not affect it.
                let prior = body
                    .get("messages")
                    .and_then(Value::as_array)
                    .map(|messages| {
                        messages
                            .iter()
                            .rev()
                            .take_while(|m| m.get("role").and_then(Value::as_str) != Some("user"))
                            .filter(|m| m.get("role").and_then(Value::as_str) == Some("assistant"))
                            .count()
                    })
                    .unwrap_or(0);
                (prior.min(999_999) + 1) as u32
            }
        };
        Ok(Self {
            message_id: text("message_id", "messageId")?.unwrap_or_else(message_id),
            user_request_id: text("user_request_id", "userRequestId")?.unwrap_or_else(message_id),
            conversation_id,
            conversation_name: context_text(
                body,
                headers,
                "conversation_name",
                "conversationName",
                true,
            )?,
            session_key,
            agent_id,
            parent_agent_id: text("parent_agent_id", "parentAgentId")?,
            parent_span_id: text("parent_span_id", "parentSpanId")?,
            round_number,
        })
    }
}

// Explicit conversation/session references are pinned to one account/region.
// Bounded TTL protects memory; it is not a durable authorization mechanism.
static BINDINGS: LazyLock<Mutex<HashMap<String, (String, Instant)>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
fn bind(turn: &Turn, scope: &str) -> Result<(), GatewayError> {
    let mut bindings = BINDINGS.lock().unwrap_or_else(|p| p.into_inner());
    bindings.retain(|_, (_, at)| at.elapsed() < Duration::from_secs(3600));
    let keys: Vec<String> = [turn.conversation_id.as_ref(), turn.session_key.as_ref()]
        .into_iter()
        .flatten()
        .map(|id| format!("{:x}", Sha256::digest(id.as_bytes())))
        .collect();
    if keys
        .iter()
        .any(|key| bindings.get(key).is_some_and(|(owner, _)| owner != scope))
    {
        return Err(
            GatewayError::with_status(409, "Accio 会话上下文已绑定其他账号或地区")
                .with_code("accio_context_binding")
                .with_details(json!({"error_metadata":{"retryable":false,"replay_safe":false}})),
        );
    }
    if bindings.len() + keys.iter().filter(|k| !bindings.contains_key(*k)).count() > 2048 {
        return Err(
            GatewayError::with_status(503, "Accio 会话上下文缓存已满，请稍后重试")
                .with_code("accio_context_capacity"),
        );
    }
    for key in keys {
        bindings.insert(key, (scope.into(), Instant::now()));
    }
    Ok(())
}

impl Call {
    /// One logical LLM invocation. The caller keeps this object across token
    /// refresh/replay; a new invocation gets a new LLM ID and span.
    pub(crate) fn for_request(
        body: &Value,
        headers: &HeaderMap,
        telemetry: &RequestTelemetry,
        scope: &str,
    ) -> Result<Self, GatewayError> {
        let parsed = Turn::parse(body, headers)?;
        if telemetry.id().is_empty() {
            telemetry.ensure_id(&new_request_id());
        }
        let round_number = parsed.round_number;
        let value = telemetry.provider_context("accio.turn", || {
            serde_json::to_value(parsed).unwrap_or(Value::Null)
        });
        let turn: Turn = serde_json::from_value(value).map_err(|_| invalid())?;
        bind(&turn, scope)?;
        let namespace = format!("accio.conversation.{:x}", Sha256::digest(scope.as_bytes()));
        let conversation = turn.conversation_id.clone().unwrap_or_else(|| {
            telemetry
                .provider_context(&namespace, || json!(new_request_id()))
                .as_str()
                .unwrap_or_default()
                .into()
        });
        Ok(Self {
            local_request_id: telemetry.id(),
            message_id: turn.message_id,
            user_request_id: turn.user_request_id,
            llm_request_id: new_request_id(),
            conversation_id: conversation,
            session_key: turn.session_key,
            conversation_name: turn.conversation_name,
            agent_id: turn.agent_id,
            parent_agent_id: turn.parent_agent_id,
            span_id: new_request_id().replace('-', "").chars().take(16).collect(),
            parent_span_id: turn.parent_span_id,
            round_number,
        })
    }

    pub(crate) fn fresh() -> Self {
        Self {
            local_request_id: String::new(),
            message_id: message_id(),
            user_request_id: message_id(),
            llm_request_id: new_request_id(),
            conversation_id: new_request_id(),
            session_key: None,
            conversation_name: None,
            agent_id: None,
            parent_agent_id: None,
            span_id: new_request_id().replace('-', "").chars().take(16).collect(),
            parent_span_id: None,
            round_number: 1,
        }
    }

    /// Clients carry this into metadata.accio on a tool continuation, increment
    /// round_number, and omit message/user IDs when starting a new user turn.
    pub(crate) fn response_context(&self) -> Value {
        let mut value = json!({"message_id":self.message_id,"user_request_id":self.user_request_id,
            "conversation_id":self.conversation_id,"round_number":self.round_number});
        for (key, item) in [
            ("session_key", &self.session_key),
            ("agent_id", &self.agent_id),
            ("parent_agent_id", &self.parent_agent_id),
        ] {
            if let Some(item) = item {
                value[key] = json!(item);
            }
        }
        value
    }

    pub(crate) fn annotate(&self, mut error: GatewayError) -> GatewayError {
        let mut details = error.details.take().unwrap_or_else(|| json!({}));
        if let Some(object) = details.as_object_mut() {
            object.insert("accio_identity".into(), json!(self));
        }
        error.with_details(details)
    }

    pub(crate) fn apply(&self, body: &mut serde_json::Map<String, Value>) {
        body.insert("request_id".into(), json!(self.llm_request_id));
        body.insert("user_request_id".into(), json!(self.user_request_id));
        body.insert("message_id".into(), json!(self.message_id));
        body.insert("conversation_id".into(), json!(self.conversation_id));
        body.insert("round_number".into(), json!(self.round_number));
        // Official streamFromTransport creates a span, then le() uses that span
        // as the wire parent_span_id. Its parent is kept in local diagnostics.
        body.insert("parent_span_id".into(), json!(self.span_id));
        for (key, value) in [
            ("session_key", &self.session_key),
            ("conversation_name", &self.conversation_name),
            ("agent_id", &self.agent_id),
            ("parent_agent_id", &self.parent_agent_id),
        ] {
            if let Some(value) = value {
                body.insert(key.into(), json!(value));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn telemetry() -> RequestTelemetry {
        let telemetry = RequestTelemetry::with_id();
        telemetry.note_attempt_started("accio", "synthetic");
        telemetry
    }

    #[test]
    fn task_ids_have_official_shape_and_do_not_collapse_into_llm_ids() {
        let telemetry = telemetry();
        let call =
            Call::for_request(&json!({}), &HeaderMap::new(), &telemetry, "scope-one").unwrap();
        for id in [&call.message_id, &call.user_request_id] {
            let parts: Vec<_> = id
                .strip_prefix("AI_AccioWork_")
                .unwrap()
                .split('_')
                .collect();
            assert_eq!(parts[0].len(), 32);
            assert!(parts[0].bytes().all(|b| b.is_ascii_hexdigit()));
            assert!(parts[1].parse::<i64>().unwrap() > 0);
        }
        assert_ne!(call.message_id, call.user_request_id);
        assert_ne!(call.user_request_id, call.llm_request_id);
        assert_eq!(call.local_request_id, telemetry.id());
        let retry = call.clone(); // token replay is the same logical call
        assert_eq!(json!(retry), json!(call));
        let next =
            Call::for_request(&json!({}), &HeaderMap::new(), &telemetry, "scope-one").unwrap();
        assert_eq!(next.message_id, call.message_id);
        assert_eq!(next.user_request_id, call.user_request_id);
        assert_eq!(next.conversation_id, call.conversation_id);
        assert_ne!(next.llm_request_id, call.llm_request_id);
        assert_ne!(next.span_id, call.span_id);
        let continued = Call::for_request(&json!({"messages":[{"role":"user","content":"hello"},{"role":"assistant","tool_calls":[]},{"role":"tool","content":"done"}]}), &HeaderMap::new(), &telemetry, "scope-one").unwrap();
        assert_eq!(continued.round_number, 2);
        assert_eq!(continued.message_id, call.message_id);
        assert_eq!(continued.user_request_id, call.user_request_id);
        let fallback =
            Call::for_request(&json!({}), &HeaderMap::new(), &telemetry, "scope-two").unwrap();
        assert_eq!(fallback.user_request_id, call.user_request_id);
        assert_ne!(fallback.conversation_id, call.conversation_id);
        let independent = Call::for_request(
            &json!({}),
            &HeaderMap::new(),
            &self::telemetry(),
            "scope-one",
        )
        .unwrap();
        assert_ne!(independent.message_id, call.message_id);
        assert_ne!(independent.conversation_id, call.conversation_id);
    }

    #[test]
    fn explicit_conversation_survives_turns_and_tool_followups_but_not_account_switch() {
        let conversation = new_request_id();
        let first_body = json!({"metadata":{"accio":{"conversationId":conversation,"sessionKey":format!("agent:local-agent:cid:{conversation}"),"roundNumber":1}}});
        let first =
            Call::for_request(&first_body, &HeaderMap::new(), &telemetry(), "scope-tools").unwrap();
        assert_eq!(first.agent_id.as_deref(), Some("local-agent"));
        let session_only = Call::for_request(&json!({"metadata":{"accio":{"session_key":format!("agent:local-agent:cid:{conversation}")}}}), &HeaderMap::new(), &telemetry(), "scope-tools").unwrap();
        assert_eq!(session_only.conversation_id, conversation);
        let mut continuation = first.response_context();
        continuation["round_number"] = json!(2);
        let second = Call::for_request(
            &json!({"metadata":{"accio":continuation}}),
            &HeaderMap::new(),
            &telemetry(),
            "scope-tools",
        )
        .unwrap();
        assert_eq!(first.message_id, second.message_id);
        assert_eq!(first.user_request_id, second.user_request_id);
        assert_eq!(first.conversation_id, second.conversation_id);
        assert_eq!(second.round_number, 2);
        assert_ne!(first.llm_request_id, second.llm_request_id);
        let next_turn =
            Call::for_request(&first_body, &HeaderMap::new(), &telemetry(), "scope-tools").unwrap();
        assert_eq!(next_turn.conversation_id, first.conversation_id);
        assert_ne!(next_turn.message_id, first.message_id);
        assert_ne!(next_turn.user_request_id, first.user_request_id);
        let error = Call::for_request(
            &first_body,
            &HeaderMap::new(),
            &telemetry(),
            "different-region-account",
        )
        .unwrap_err();
        assert_eq!(error.status_code, 409);
        assert!(!super::super::adk_error::allows_replay(&error));
    }

    #[test]
    fn invalid_or_conflicting_context_is_rejected_without_echoing_it() {
        for value in [
            json!({"message_id":"private value\n"}),
            json!({"conversation_id":123}),
            json!({"round_number":0}),
            json!({"roundNumber":2,"round_number":3}),
            json!({"session_key":"agent:one:cid:two","agent_id":"other"}),
            json!({"session_key":"agent:one:cid:two","conversation_id":"different"}),
        ] {
            let error = Call::for_request(
                &json!({"metadata":{"accio":value}}),
                &HeaderMap::new(),
                &telemetry(),
                "validation",
            )
            .unwrap_err();
            assert_eq!(error.status_code, 400);
            assert!(!error.payload().to_string().contains("private"));
        }
        let mut headers = HeaderMap::new();
        headers.insert("x-accio-conversation-id", "header-value".parse().unwrap());
        assert!(Call::for_request(
            &json!({"conversation_id":"body-value"}),
            &headers,
            &telemetry(),
            "validation"
        )
        .is_err());
    }

    #[test]
    fn wire_matches_official_identity_mapping_and_omits_legacy_fields() {
        let call = Call::fresh();
        let wire = super::super::protocol::build_upstream_body_with_context(
            &json!({"messages":[{"role":"user","content":"hello"}]}),
            "synthetic-model",
            "synthetic-token",
            None,
            super::super::models::EffortPlacement::Top,
            &call,
        )
        .body;
        assert_eq!(wire["request_id"], call.llm_request_id);
        assert_eq!(wire["user_request_id"], call.user_request_id);
        assert_eq!(wire["message_id"], call.message_id);
        assert_eq!(wire["parent_span_id"], call.span_id);
        assert_eq!(wire["conversation_id"], call.conversation_id);
        assert_eq!(wire["round_number"], 1);
        assert_eq!(wire["max_output_tokens"], 16384);
        for key in [
            "tenant",
            "iai_tag",
            "empid",
            "trace_id",
            "agent_id",
            "session_key",
        ] {
            assert!(wire.get(key).is_none(), "{key}");
        }
    }
}
