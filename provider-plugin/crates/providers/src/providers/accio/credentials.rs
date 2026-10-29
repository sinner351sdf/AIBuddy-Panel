//! Accio 凭证格式：`accessToken` / `refreshToken` / `expiresAt` + 账号标识。
//!
//! ── 上游给的东西（桌面端 `/api/oauth/token` 与 `/api/auth/refresh_token`
//!    的返回）──────────────────────────────────────────────────
//! ```jsonc
//! { "accessToken": "…", "refreshToken": "…", "expiresAt": 1789…, "sid": "…", "sgcookie": "…" }
//! ```
//! `sgcookie` 随合法授权结果保存，用于原生 SDK 的会话初始化。
//! 会话字段属于颁发它们的账号；重新授权时不继承旧会话的安全上下文。
//!
//! ── 身份用什么标识 ──────────────────────────────────────────
//! Accio 的 token 是**不透明串**（不是 JWT，解不出 userId），因此账号身份由
//! `/api/auth/userinfo` 查回的资料里的 id 决定（见 `login_http::profile`）。
//! 「粘贴凭证」与 OAuth 换码均须查回并验证身份，再保存账号；
//! 资料查询失败不能被当成登录成功。
//!
//! ── `deviceId`（utdid）是干嘛的 ─────────────────────────────
//! 推理请求要带 `utdid`（设备指纹）。桌面端每台机器一个（装机时生成、落盘）。
//! 本网关保留账号记录中的稳定设备标识；缺失时生成本地标识。
//! 设备标识与动态 SDK 因子都不构成服务器放行或免于账号限制的保证。

use serde_json::{json, Value};

const MAX_TOKEN_LENGTH: usize = 1_000_000;
use crate::ids::uuid_v4;
use crate::errors::GatewayError;
use crate::logging;

use super::endpoints::Region;

/// 提前多久认为 token 该续期（与另外几家同一量级）
pub const REFRESH_MARGIN_MS: i64 = 5 * 60 * 1000;

#[derive(Clone)]
pub struct Credentials {
    pub region: Region,
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: Option<i64>,
    /// 上游账号标识（userinfo 的 id / userId）
    pub user_id: String,
    pub email: String,
    pub name: String,
    /// 推理请求的设备指纹（本网关按账号生成）
    pub device_id: String,
    pub sgcookie: String,
    pub sid: String,
    pub route_region: String,
    pub team_id: String,
    pub client_timezone: String,
}

impl Credentials {
    /// 从账号记录 / 添加请求解析凭证。
    ///
    /// 接受的键名与其它家保持一致的宽口径（`accessToken` / `access_token` /
    /// `token`），前端「填写凭证」与前端的导入路径都可能给不同形态。
    pub fn from_payload(payload: &Value) -> Result<Self, GatewayError> {
        if !payload.is_object() {
            return Err(GatewayError::with_status(
                400,
                "Accio 账号内容必须是 JSON 对象",
            ));
        }
        let region = Region::from_payload(payload)?;
        let access_token = secret(payload, &["accessToken", "access_token", "token"])?;
        if access_token.is_empty() {
            return Err(GatewayError::with_status(400, "缺少 Accio accessToken"));
        }
        let refresh_token = secret(payload, &["refreshToken", "refresh_token"])?;
        let expires_at = ["expiresAt", "expires_at", "expires"]
            .iter()
            .find_map(|key| timestamp(payload.get(*key)));
        Ok(Self {
            region,
            access_token,
            refresh_token,
            expires_at,
            user_id: text(payload, &["userId", "user_id", "uid"]),
            email: text(payload, &["email"]).chars().take(320).collect(),
            name: text(payload, &["nickname", "name"])
                .chars()
                .take(100)
                .collect(),
            device_id: text(payload, &["deviceId", "device_id"]),
            sgcookie: security_cookie(payload)?,
            sid: secret(payload, &["sid"])?,
            route_region: context_text(payload, &["routeRegion", "route_region"])?,
            team_id: context_text(payload, &["teamId", "team_id"])?,
            client_timezone: context_text(payload, &["clientTimezone", "client_timezone"])?,
        })
    }

    /// 补充本机可确定的时区和稳定设备标识；不生成上游用户身份或路由。
    pub fn ensure_identity(&mut self) {
        if self.client_timezone.is_empty() {
            let zone = std::env::var("TZ").ok().or_else(|| {
                std::fs::read_link("/etc/localtime").ok().and_then(|p| {
                    p.to_str()
                        .and_then(|s| s.split_once("zoneinfo/").map(|(_, z)| z.to_string()))
                })
            });
            if let Some(zone) = zone.filter(|z| {
                z.len() <= 128
                    && z.bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"/_+-".contains(&b))
            }) {
                self.client_timezone = zone;
            }
        }
        if self.device_id.is_empty() {
            self.device_id = format!("desktop-{}", uuid_v4().replace('-', ""));
        }
    }

    /// 有刷新凭证 + 有到期时间，且快到点了
    pub fn expiring(&self) -> bool {
        self.can_refresh()
            && self
                .expires_at
                .is_some_and(|expiry| expiry <= logging::now_ms() + REFRESH_MARGIN_MS)
    }

    pub fn can_refresh(&self) -> bool {
        !self.refresh_token.is_empty()
    }

    /// 落进账号记录的形态。空串按 null 落（`add_accio_account` 的合并规则是
    /// 「空值不覆盖」，缺项不该把既有值洗成空）。
    pub fn to_value(&self) -> Value {
        let text_or_null = |value: &str| -> Value {
            if value.is_empty() {
                Value::Null
            } else {
                Value::String(value.to_string())
            }
        };
        json!({
            "mode": self.region.edition(),
            "accessToken": text_or_null(&self.access_token),
            "refreshToken": text_or_null(&self.refresh_token),
            "expiresAt": self.expires_at,
            "userId": text_or_null(&self.user_id),
            "email": text_or_null(&self.email),
            "nickname": text_or_null(&self.name),
            "deviceId": text_or_null(&self.device_id),
            "sgcookie": text_or_null(&self.sgcookie),
            "sid": text_or_null(&self.sid),
            "routeRegion": text_or_null(&self.route_region),
            "teamId": text_or_null(&self.team_id),
            "clientTimezone": text_or_null(&self.client_timezone),
        })
    }
}

/// 取一个文本字段（空串按缺失处理）
pub fn text(payload: &Value, keys: &[&str]) -> String {
    keys.iter()
        .find_map(|key| match payload.get(*key) {
            Some(Value::String(value)) if !value.trim().is_empty() => {
                Some(value.trim().to_string())
            }
            Some(Value::Number(value)) => Some(value.to_string()),
            _ => None,
        })
        .unwrap_or_default()
}

/// 取一个密钥字段：去 `Bearer ` 前缀、限长、拒绝控制字符。
pub fn secret(payload: &Value, keys: &[&str]) -> Result<String, GatewayError> {
    let mut value = keys
        .iter()
        .find_map(|key| {
            payload
                .get(*key)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
        })
        .unwrap_or("");
    if value
        .get(..7)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("Bearer "))
    {
        value = value[7..].trim();
    }
    if value.len() > MAX_TOKEN_LENGTH || value.chars().any(char::is_control) {
        return Err(GatewayError::with_status(
            400,
            "Accio 凭证过长或包含非法控制字符",
        ));
    }
    Ok(value.to_string())
}

/// 时间戳（毫秒）；接受秒级数字与 RFC3339 字符串。0 / 负数 / 解析不出 → None。
pub fn timestamp(value: Option<&Value>) -> Option<i64> {
    let value = value?;
    let number = value
        .as_i64()
        .or_else(|| value.as_str()?.trim().parse::<i64>().ok());
    if let Some(number) = number.filter(|value| *value > 0) {
        return if number < 100_000_000_000 {
            number.checked_mul(1000)
        } else {
            Some(number)
        };
    }
    chrono::DateTime::parse_from_rfc3339(value.as_str()?)
        .ok()
        .map(|time| time.timestamp_millis())
}

/// Values copied into HTTP headers must be bounded and ASCII; never forward
/// arbitrary client headers as an authorization route.
fn context_text(payload: &Value, keys: &[&str]) -> Result<String, GatewayError> {
    let value = text(payload, keys);
    if value.len() > 256 || !value.is_ascii() || value.chars().any(char::is_control) {
        return Err(GatewayError::bad_request("Accio 会话路由字段无效"));
    }
    Ok(value)
}

/// sgcookie is opaque SDK input, not a Bearer token. Preserve its bytes and bound
/// bridge input to 64 KiB instead of applying the shorter access-token limit.
pub fn security_cookie(payload: &Value) -> Result<String, GatewayError> {
    let value = payload.get("sgcookie").or_else(|| payload.get("sgCookie"));
    let cookie = match value {
        None | Some(Value::Null) => "",
        Some(Value::String(s)) => s.as_str(),
        _ => return Err(GatewayError::bad_request("Accio 安全会话字段格式无效")),
    };
    if cookie.len() > 65536 || cookie.chars().any(char::is_control) {
        return Err(GatewayError::bad_request(
            "Accio 安全会话字段过长或包含控制字符",
        ));
    }
    Ok(cookie.to_string())
}
