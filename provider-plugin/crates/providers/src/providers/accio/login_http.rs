//! Two-stage login transport. Never log request values or raw upstream bodies.
use super::{
    adk_error, auth,
    credentials::Credentials,
    endpoints::{self, Region},
};
use crate::{http as egress, errors::GatewayError, logging, ids::uuid_v4 as new_request_id};
use agent2api_provider_protocol::WireProxy as ResolvedProxy;
use serde_json::{json, Value};
use std::{fs::OpenOptions, io::Write};

const MAX_RESPONSE_BYTES: usize = 1024 * 1024;

#[derive(Clone, Copy)]
pub(super) enum Stage {
    TokenExchange,
    UserInfo,
}
impl Stage {
    fn id(self) -> &'static str {
        match self {
            Self::TokenExchange => "token_exchange",
            Self::UserInfo => "userinfo",
        }
    }
    fn label(self) -> &'static str {
        match self {
            Self::TokenExchange => "授权码换令牌",
            Self::UserInfo => "用户资料查询",
        }
    }
    fn path(self) -> &'static str {
        match self {
            Self::TokenExchange => endpoints::OAUTH_TOKEN_PATH,
            Self::UserInfo => endpoints::USER_INFO_PATH,
        }
    }
}

pub(super) struct Context {
    pub region: Region,
    pub device: String,
    flow: String,
}
pub(super) struct Reply {
    pub data: Value,
    pub diagnostic: Value,
}

/// An installation-owned identifier, not copied from the official app. The same
/// value is used for exchange, userinfo, and the resulting stored credentials.
fn installation_device() -> Result<String, GatewayError> {
    let path = crate::paths::data_dir().join("accio-device-id");
    let failure = || {
        GatewayError::with_status(500, "Accio 登录设备上下文不可用，尚未发送请求")
            .with_code("accio_login_device_unavailable")
    };
    let valid = |s: &str| {
        !s.is_empty()
            && s.len() <= 128
            && s.bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
    };
    if let Ok(value) = std::fs::read_to_string(&path) {
        return if valid(value.trim()) {
            Ok(value.trim().into())
        } else {
            Err(failure())
        };
    }
    let parent = path.parent().ok_or_else(failure)?;
    std::fs::create_dir_all(parent).map_err(|_| failure())?;
    let value = format!(
        "utd-{}-{}",
        logging::now_ms(),
        new_request_id().replace('-', "")
    );
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    match options.open(&path) {
        Ok(mut f) => {
            f.write_all(value.as_bytes()).map_err(|_| failure())?;
            Ok(value)
        }
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            let saved = std::fs::read_to_string(path).map_err(|_| failure())?;
            if valid(saved.trim()) {
                Ok(saved.trim().into())
            } else {
                Err(failure())
            }
        }
        Err(_) => Err(failure()),
    }
}

impl Context {
    pub fn new(region: Region, device: Option<&str>) -> Result<Self, GatewayError> {
        let device = match device.filter(|s| !s.is_empty()) {
            Some(s) => s.to_string(),
            None => installation_device()?,
        };
        if device.len() > 128
            || !device
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
        {
            return Err(GatewayError::bad_request("Accio 登录设备标识格式无效"));
        }
        Ok(Self {
            region,
            device,
            flow: new_request_id().replace('-', ""),
        })
    }

    fn diagnostic(&self, stage: Stage) -> Value {
        json!({"flow_id":self.flow,"stage":stage.id(),"method":"POST","path":stage.path(),"region":self.region.package_region(),"http_status":null})
    }

    fn log(&self, mut diagnostic: Value, outcome: &str) {
        diagnostic["outcome"] = json!(outcome);
        logging::log("[Accio Login]", &diagnostic.to_string());
    }

    pub fn complete(&self, reply: &Reply) {
        self.log(reply.diagnostic.clone(), "success");
    }

    pub fn invalid(
        &self,
        stage: Stage,
        diagnostic: Value,
        reason: &str,
        status: i32,
    ) -> GatewayError {
        self.failure(stage, diagnostic, reason, status, None)
    }

    fn failure(
        &self,
        stage: Stage,
        mut diagnostic: Value,
        reason: &str,
        status: i32,
        code: Option<&str>,
    ) -> GatewayError {
        diagnostic["reason"] = json!(reason);
        diagnostic["business_code"] = code.map(|s| json!(s)).unwrap_or(Value::Null);
        let message = match reason {
            "account_restricted" => "官方明确提示账号受限，请按官方渠道处理",
            "not_login" => "官方拒绝当前会话，需重新完成授权",
            "invalid_grant" => "授权码无效、已过期或已使用",
            "pkce_mismatch" => "PKCE 校验失败",
            "redirect_mismatch" => "授权回调地址不匹配",
            "invalid_client" => "OAuth 客户端参数被拒绝",
            "quota" => "请求受到限流或额度限制",
            "security_challenge" => "官方返回安全验证要求",
            "forbidden" => "上游拒绝访问，未提供可确认的账号限制原因",
            "transport_timeout" => "连接或读取响应超时",
            "transport_failure" => "无法连接上游",
            "response_too_large" => "响应超过本地大小上限",
            "invalid_json" => "上游未返回有效 JSON 对象",
            "invalid_envelope" => "上游响应缺少成功标记或有效 data 对象",
            "incomplete_token" => "授权响应缺少完整且有效的令牌字段，账号未保存",
            "missing_user_id" => "资料缺少用户标识，账号未保存",
            "identity_mismatch" => "授权身份与用户资料不一致，账号未保存",
            "invalid_session_fields" => "授权或资料中的会话字段无效，账号未保存",
            "upstream_failure" => "上游服务请求失败",
            _ => "上游业务请求失败，未取得可识别的具体原因",
        };
        let http = diagnostic["http_status"]
            .as_u64()
            .map(|n| n.to_string())
            .unwrap_or_else(|| "未收到响应".into());
        let code_hint = code.map(|c| format!("，业务码 {c}")).unwrap_or_default();
        // Only controlled text is exposed. Upstream free text may echo tokens,
        // PKCE verifier, cookie, user PII or signed URLs, even under `message`.
        let text = format!(
            "Accio {}失败（上游 HTTP {http}{code_hint}）：{message} [阶段 {}，追踪 {}]",
            stage.label(),
            stage.id(),
            self.flow
        );
        self.log(diagnostic.clone(), "failed");
        GatewayError::with_status(status, text)
            .with_code(if reason == "account_restricted" { "accio_account_restricted" } else { "accio_login_failed" })
            .with_details(json!({"provider":"accio","login_diagnostic":diagnostic,"error_metadata":{"retryable":false,"replay_safe":false,"action":"login"}}))
    }

    /// Official business interceptor: POST JSON, shared utdid/version, no bearer
    /// header or automatic login retry. Headers and URL values are never logged.
    pub async fn post(
        &self,
        stage: Stage,
        body: &Value,
        proxy: Option<&ResolvedProxy>,
    ) -> Result<Reply, GatewayError> {
        let mut diagnostic = self.diagnostic(stage);
        self.log(diagnostic.clone(), "started");
        let mut payload = body.clone();
        payload["utdid"] = json!(self.device);
        payload["version"] = json!(endpoints::app_version());
        let mut request = egress::client(proxy, "direct")
            .post(format!("{}{}", endpoints::gateway_base(), stage.path()))
            .timeout(std::time::Duration::from_millis(auth::REQUEST_TIMEOUT_MS))
            .header("EagleEye-TraceId", &self.flow);
        for (name, value) in endpoints::login_headers(self.region, &self.device) {
            request = request.header(name, value);
        }
        let response = request.body(payload.to_string()).send().await;
        let mut response = match response {
            Ok(r) => r,
            Err(e) => {
                return Err(self.invalid(
                    stage,
                    diagnostic,
                    if e.is_timeout() {
                        "transport_timeout"
                    } else {
                        "transport_failure"
                    },
                    if e.is_timeout() { 504 } else { 502 },
                ))
            }
        };
        let status = response.status().as_u16();
        diagnostic["http_status"] = json!(status);
        // Only bounded, identifier-shaped request IDs are retained; not headers.
        for key in ["eagleeye-traceid", "x-request-id", "x-eagleeye-traceid"] {
            if let Some(id) = response
                .headers()
                .get(key)
                .and_then(|v| v.to_str().ok())
                .filter(|s| safe_id(s))
            {
                if !contains_secret(id, body, true) {
                    diagnostic["upstream_request_id"] = json!(id);
                    break;
                }
            }
        }
        let mut bytes = Vec::new();
        loop {
            let chunk = response.chunk().await.map_err(|e| {
                self.invalid(
                    stage,
                    diagnostic.clone(),
                    if e.is_timeout() {
                        "transport_timeout"
                    } else {
                        "transport_failure"
                    },
                    if e.is_timeout() { 504 } else { 502 },
                )
            })?;
            let Some(chunk) = chunk else {
                break;
            };
            if bytes.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
                return Err(self.invalid(stage, diagnostic, "response_too_large", 502));
            }
            bytes.extend_from_slice(&chunk);
        }
        self.parse(stage, status, &bytes, diagnostic, body)
    }

    pub(super) fn parse(
        &self,
        stage: Stage,
        status: u16,
        bytes: &[u8],
        mut diagnostic: Value,
        sent: &Value,
    ) -> Result<Reply, GatewayError> {
        diagnostic["http_status"] = json!(status);
        diagnostic["response_bytes"] = json!(bytes.len());
        let value = serde_json::from_slice::<Value>(bytes)
            .ok()
            .filter(Value::is_object);
        let Some(value) = value else {
            let text = String::from_utf8_lossy(bytes).to_lowercase();
            let challenge =
                text.contains("bixi-intl.alicdn.com/punish") || text.contains("security challenge");
            diagnostic["response_format"] = json!(if bytes.is_empty() {
                "empty"
            } else if text.trim_start().starts_with('<') {
                "html"
            } else {
                "non_json"
            });
            return Err(self.invalid(
                stage,
                diagnostic,
                if challenge {
                    "security_challenge"
                } else {
                    "invalid_json"
                },
                if challenge { 403 } else { 502 },
            ));
        };
        diagnostic["response_format"] = json!("json");
        if diagnostic.get("upstream_request_id").is_none() {
            if let Some(id) = value
                .get("request_id")
                .and_then(Value::as_str)
                .filter(|id| {
                    safe_id(id)
                        && !contains_secret(id, sent, true)
                        && !contains_secret(id, &value, false)
                })
            {
                diagnostic["upstream_request_id"] = json!(id);
            }
        }
        if diagnostic
            .get("upstream_request_id")
            .and_then(Value::as_str)
            .is_some_and(|id| contains_secret(id, sent, true) || contains_secret(id, &value, false))
        {
            diagnostic
                .as_object_mut()
                .map(|m| m.remove("upstream_request_id"));
        }
        diagnostic["success_flag"] = value
            .get("success")
            .and_then(Value::as_bool)
            .map(|b| json!(b))
            .unwrap_or(Value::Null);
        let code = adk_error::error_code(&value);
        if !(200..300).contains(&status)
            || value.get("success").and_then(Value::as_bool) != Some(true)
        {
            let raw_message = adk_error::error_message(&value);
            let (reason, mapped) = classify(status, &code, raw_message);
            let safe_code = safe_code(&code)
                .filter(|s| !contains_secret(s, sent, true) && !contains_secret(s, &value, false));
            return Err(self.failure(stage, diagnostic, reason, mapped, safe_code));
        }
        let data = value
            .get("data")
            .filter(|d| d.is_object())
            .cloned()
            .ok_or_else(|| self.invalid(stage, diagnostic.clone(), "invalid_envelope", 502))?;
        Ok(Reply { data, diagnostic })
    }
}

// Deliberately narrow: no raw headers, response snippets or arbitrary JSON keys.
fn safe_id(s: &str) -> bool {
    (8..=128).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-')
}
fn safe_code(s: &str) -> Option<&str> {
    if (1..=80).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_') {
        Some(s)
    } else {
        None
    }
}
fn contains_secret(text: &str, v: &Value, include_auth_code: bool) -> bool {
    match v {
        Value::Object(m) => m.iter().any(|(k, v)| {
            let sensitive = (include_auth_code && k.eq_ignore_ascii_case("code"))
                || [
                    "codeVerifier",
                    "code_verifier",
                    "accessToken",
                    "access_token",
                    "refreshToken",
                    "refresh_token",
                    "token",
                    "sgcookie",
                    "sid",
                    "password",
                    "cookie",
                    "redirectUri",
                ]
                .iter()
                .any(|s| k.eq_ignore_ascii_case(s));
            (sensitive
                && v.as_str()
                    .is_some_and(|s| !s.is_empty() && text.contains(s)))
                || contains_secret(text, v, include_auth_code)
        }),
        Value::Array(items) => items
            .iter()
            .any(|v| contains_secret(text, v, include_auth_code)),
        _ => false,
    }
}

fn classify(status: u16, code: &str, message: &str) -> (&'static str, i32) {
    let upper = code.to_ascii_uppercase();
    let lower = message.to_lowercase();
    if matches!(
        upper.as_str(),
        "423" | "ACCOUNT_LOCKED" | "ACCOUNT_RESTRICTED" | "ACCOUNT_BANNED"
    ) || status == 423
        || super::session::restricted(&GatewayError::with_status(i32::from(status), message))
    {
        return ("account_restricted", 403);
    }
    if upper.contains("PKCE")
        || lower.contains("pkce")
        || lower.contains("code_verifier")
        || lower.contains("codeverifier")
    {
        return ("pkce_mismatch", 400);
    }
    if upper.contains("REDIRECT") || lower.contains("redirect_uri") || lower.contains("redirecturi")
    {
        return ("redirect_mismatch", 400);
    }
    if upper == "INVALID_GRANT"
        || lower.contains("code expired")
        || lower.contains("code already used")
    {
        return ("invalid_grant", 400);
    }
    if upper == "INVALID_CLIENT" {
        return ("invalid_client", 400);
    }
    if matches!(
        upper.as_str(),
        "401" | "402" | "NOT_LOGIN" | "TOKEN_EXPIRED" | "SESSION_EXPIRED"
    ) || status == 401
        || lower.contains("unauthorized")
    {
        return ("not_login", 401);
    }
    if upper == "SECURITY_CHALLENGE"
        || lower.contains("security challenge")
        || lower.contains("sentinel")
    {
        return ("security_challenge", 403);
    }
    if status == 429 || matches!(upper.as_str(), "429" | "6004") {
        return ("quota", 429);
    }
    if status == 403 {
        return ("forbidden", 403);
    }
    if status >= 500 {
        return ("upstream_failure", 502);
    }
    ("business_failure", 502)
}

/// Validated profile parsing shares the exact transport context with exchange.
pub(super) async fn profile(
    context: &Context,
    credentials: &mut Credentials,
    proxy: Option<&ResolvedProxy>,
) -> Result<(), GatewayError> {
    let reply = context
        .post(
            Stage::UserInfo,
            &json!({"accessToken":credentials.access_token}),
            proxy,
        )
        .await?;
    if let Err(error) = auth::verify_profile(credentials, &reply.data) {
        let reason = if error.status_code == 409 {
            "identity_mismatch"
        } else if !["id", "userId", "user_id", "uid"]
            .iter()
            .any(|k| reply.data.get(k).is_some_and(|v| !v.is_null()))
        {
            "missing_user_id"
        } else {
            "invalid_session_fields"
        };
        return Err(context.invalid(
            Stage::UserInfo,
            reply.diagnostic,
            reason,
            if reason == "identity_mismatch" {
                409
            } else {
                502
            },
        ));
    }
    context.complete(&reply);
    Ok(())
}
