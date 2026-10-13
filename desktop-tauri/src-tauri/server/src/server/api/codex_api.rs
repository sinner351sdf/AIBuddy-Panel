//! Codex CLI server-side configuration. CODEX_HOME takes precedence over ~/.codex.
//! Existing TOML settings and providers are preserved; every write keeps a distinct backup.
//! In split-port deployments the fallback is the local inference port, never the panel port.
//! AGENT2API_PUBLIC_API_URL or an explicit baseUrl supports reverse proxies and remote clients.
//! The UI asks for confirmation and explains that files belong to the gateway host.

use std::path::{Path, PathBuf};

use axum::body::Bytes;
use axum::extract::State;
use axum::http::{header, HeaderMap};
use axum::response::Response;
use serde_json::{json, Value};

use crate::server::errors;
use crate::server::http::{ok_json, parse_body};
use crate::server::logging;
use crate::server::ServerState;

/// 用户主目录（Windows 优先 USERPROFILE，其余平台 HOME；与
/// `core::import_ccswitch` / `core::clash` 同一取序，不引入 dirs crate）。
fn home_dir() -> Option<PathBuf> {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

/// Codex CLI 的配置目录（`~/.codex`）。
fn codex_dir() -> Option<PathBuf> {
    std::env::var("CODEX_HOME").ok().filter(|v| !v.trim().is_empty())
        .map(PathBuf::from).or_else(|| home_dir().map(|home| home.join(".codex")))
}

/// 当前面板的 origin：从请求的 Host 头还原（HTTP/1.1 必带），反向代理形态读
/// `x-forwarded-proto` 补协议；两者都拿不到（极端形态）时退回
/// `http://127.0.0.1:{面板端口}`。
///
/// 为什么不按配置里的监听端口拼 URL：桌面形态面板与网关同端口、headless 分
/// 端口，而经反向代理访问时外部地址与监听地址本来就不一致 —— 请求头里的 Host
/// 才是「用户此刻访问面板用的地址」，Codex 用同一个地址才连得上。
fn panel_origin(state: &ServerState, headers: &HeaderMap) -> String {
    if let Ok(value) = std::env::var("AGENT2API_PUBLIC_API_URL") {
        if valid_base(&value).is_ok() { return normalize_base(&value); }
    }
    // A split panel origin does not serve /v1; the generated config lives on this server.
    if state.panel_port.is_some() { return format!("http://127.0.0.1:{}", state.port); }
    let host = headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty());
    // 多值时取第一个（X-Forwarded-* 是逐跳追加的，第一个是客户端原始协议）
    let proto = headers
        .get("x-forwarded-proto")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(',').next())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("http");
    match host {
        Some(host) => format!("{proto}://{host}"),
        None => format!("http://127.0.0.1:{}", state.panel_port.unwrap_or(state.port)),
    }
}

/// base_url 的归一：trim、去结尾斜杠，再剥掉已带的 `/v1` 后缀。
///
/// 写进 config.toml 的永远是 `{base}/v1`（Codex 在其后自己拼 /responses，
/// 与 OpenAI SDK 同一约定）。用户从别处粘贴的地址常带结尾斜杠、甚至已经带了
/// /v1（照着快速接入片段整行复制是常态），先剥掉再拼，重复粘贴也幂等。
fn normalize_base(text: &str) -> String {
    text.trim()
        .trim_end_matches('/')
        .trim_end_matches("/v1")
        .to_string()
}

fn valid_base(text: &str) -> Result<(), String> {
    let url = url::Url::parse(text.trim()).map_err(|_| "网关地址必须是完整 HTTP(S) URL".to_string())?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none()
        || !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some() {
        return Err("网关地址仅支持不含凭据、查询参数或片段的 HTTP(S) URL".to_string());
    }
    Ok(())
}

/// 生成 config.toml 的内容。经 toml crate 序列化：base_url 来自请求体，
/// 字符串转义交给库，不手拼 TOML 文本。
fn config_toml_text(base_url: &str) -> Result<String, String> {
    use toml::{Table as TomlTable, Value as TomlValue};
    let mut provider = TomlTable::new();
    provider.insert("name".to_string(), TomlValue::String("Agent2API".to_string()));
    provider.insert("base_url".to_string(), TomlValue::String(base_url.to_string()));
    provider.insert("wire_api".to_string(), TomlValue::String("responses".to_string()));
    provider.insert("requires_openai_auth".to_string(), TomlValue::Boolean(true));
    let mut providers = TomlTable::new();
    providers.insert("aibuddy".to_string(), TomlValue::Table(provider));
    let mut doc = TomlTable::new();
    doc.insert("model_provider".to_string(), TomlValue::String("aibuddy".to_string()));
    doc.insert("model_providers".to_string(), TomlValue::Table(providers));
    toml::to_string_pretty(&doc).map_err(|error| format!("生成 config.toml 内容失败: {error}"))
}

/// 写一个配置文件：目标已存在时先备份成 `<原名>.bak`（语义见模块头）。
///
/// 备份失败返回 Err（调用方立刻中止整个 setup，原文件未动）；写入失败同样。
/// `written` / `backups` 是响应清单，成功时各追加一项。
fn write_with_backup(
    path: &Path,
    text: &str,
    written: &mut Vec<String>,
    backups: &mut Vec<String>,
) -> Result<(), String> {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string());
    if path.is_file() {
        let bak_path = path.with_file_name(format!("{name}.bak"));
        let bak_path = if bak_path.exists() { path.with_file_name(format!("{name}.{}.bak", crate::server::access::random_hex(8))) } else { bak_path };
        std::fs::copy(path, &bak_path)
            .map_err(|error| format!("备份 {name} 失败（已中止写入，原文件未动）: {error}"))?;
        backups.push(bak_path.file_name().unwrap_or_default().to_string_lossy().to_string());
    }
    std::fs::write(path, text).map_err(|error| format!("写入 {name} 失败: {error}"))?;
    written.push(name);
    Ok(())
}

/// GET /api/codex/status
///
/// 定位不到主目录时三个布尔一律 false、`codexDir` 为 null：前端按「全新写入」
/// 引导即可，真正的失败由 setup 那条给出可读的 400。
pub async fn get_status(State(state): State<ServerState>, headers: HeaderMap) -> Response {
    let dir = codex_dir();
    let dir_text = dir.as_ref().map(|dir| dir.to_string_lossy().to_string());
    let exists = |name: &str| dir.as_ref().is_some_and(|dir| dir.join(name).is_file());
    ok_json(json!({
        "configExists": exists("config.toml"),
        "authExists": exists("auth.json"),
        "backupExists": exists("config.toml.bak") || exists("auth.json.bak"),
        "serverUrl": panel_origin(&state, &headers),
        "codexDir": dir_text,
    }))
}

/// POST /api/codex/setup
///
/// 顶层不是 JSON 对象的请求体按空对象处理（两个键都缺省 = 用请求 origin、
/// 只写 config）；写入成功后记一条日志（面板「日志」页可见，与其它配置类
/// 写操作同一习惯）。
pub async fn post_setup(
    State(state): State<ServerState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let object = match parse_body(&body) {
        Ok(value) => value.as_object().cloned().unwrap_or_default(),
        Err(error) => return errors::management_error(400, error.message),
    };
    let api_key = object
        .get("apiKey")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("")
        .to_string();
    let base = object
        .get("baseUrl")
        .and_then(Value::as_str)
        .map(normalize_base)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| normalize_base(&panel_origin(&state, &headers)));
    if let Err(error) = valid_base(&base) { return errors::management_error(400, error); }
    let base_url = format!("{base}/v1");

    // 目标目录：主目录定位不到 / 建不出来都不写任何文件（数据安全优先）
    let Some(dir) = codex_dir() else {
        return errors::management_error(
            400,
            "无法定位用户主目录（USERPROFILE / HOME），找不到 ~/.codex 的写入位置",
        );
    };
    if let Err(error) = std::fs::create_dir_all(&dir) {
        return errors::management_error(500, format!("创建 {} 失败: {error}", dir.display()));
    }

    let mut written: Vec<String> = Vec::new();
    let mut skipped: Vec<Value> = Vec::new();
    let mut backups: Vec<String> = Vec::new();

    // ① config.toml：model_provider 指向本网关（OpenAI 兼容，wire_api="responses"）
    let text = match config_toml_text(&base_url).and_then(|generated| {
        let path = dir.join("config.toml");
        if !path.exists() { return Ok(generated); }
        let old = std::fs::read_to_string(&path).map_err(|e| format!("读取已有配置失败: {e}"))?;
        let mut old: toml::Table = toml::from_str(&old).map_err(|e| format!("已有配置不是有效 TOML，未覆盖: {e}"))?;
        let new: toml::Table = toml::from_str(&generated).map_err(|e| format!("解析新配置失败: {e}"))?;
        old.insert("model_provider".into(), new["model_provider"].clone());
        let providers = old.entry("model_providers".to_string()).or_insert_with(|| toml::Value::Table(toml::Table::new()));
        let providers = providers.as_table_mut().ok_or_else(|| "已有 model_providers 不是表，未覆盖".to_string())?;
        providers.insert("aibuddy".into(), new["model_providers"]["aibuddy"].clone());
        toml::to_string_pretty(&old).map_err(|e| e.to_string())
    }) {
        Ok(text) => text,
        Err(message) => return errors::management_error(500, message),
    };
    let config_path = dir.join("config.toml");
    if let Err(message) = write_with_backup(&config_path, &text, &mut written, &mut backups) {
        return errors::management_error(500, message);
    }

    // ② auth.json：OPENAI_API_KEY（缺 Key 时跳过 —— 见模块头）
    if api_key.is_empty() {
        skipped.push(json!({
            "file": "auth.json",
            "reason": "未提供 API Key，保持 Codex 现有的登录方式",
        }));
    } else {
        let text = match serde_json::to_string_pretty(&json!({ "OPENAI_API_KEY": api_key })) {
            Ok(text) => text,
            Err(error) => return errors::management_error(500, format!("生成 auth.json 内容失败: {error}")),
        };
        let auth_path = dir.join("auth.json");
        if let Err(message) = write_with_backup(&auth_path, &text, &mut written, &mut backups) {
            return errors::management_error(500, message);
        }
    }

    logging::log(
        "[Codex]",
        &format!(
            "✅ Codex 配置已写入：{} → {}（base_url={base_url}）",
            written.join("、"),
            dir.display(),
        ),
    );
    ok_json(json!({
        "written": written,
        "skipped": skipped,
        "backups": backups,
        "codexDir": dir.to_string_lossy().to_string(),
        "baseUrl": base_url,
    }))
}

#[cfg(test)]
mod tests {
    use super::{config_toml_text, normalize_base};

    #[test]
    fn generated_config_uses_responses_and_api_key_auth_without_toml_injection() {
        let url = "http://127.0.0.1:3065/v1?label=\"quoted\"";
        let text = config_toml_text(url).expect("serialize fixture");
        let parsed: toml::Value = toml::from_str(&text).expect("valid TOML");
        let provider = &parsed["model_providers"]["aibuddy"];
        assert_eq!(provider["wire_api"].as_str(), Some("responses"));
        assert_eq!(provider["requires_openai_auth"].as_bool(), Some(true));
        assert_eq!(provider["base_url"].as_str(), Some(url));
    }

    #[test]
    fn copied_base_url_gets_exactly_one_v1_suffix() {
        assert_eq!(normalize_base(" https://gateway.example/v1/ "), "https://gateway.example");
        assert_eq!(normalize_base("https://gateway.example/"), "https://gateway.example");
    }
}
