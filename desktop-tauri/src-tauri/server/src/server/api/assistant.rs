//! AI 助手 API（侧边栏「AI 助手」页的对话入口 + 设置页「AI 助手」分类的读写）。
//!
//!   GET  /api/assistant/config   → `{ config: {...} }`（含默认值展开，见下）
//!   PUT  /api/assistant/config   `{ config: {...} }` → 校验后整块保存
//!   POST /api/assistant/chat     `{ model?: {provider,id}, messages, tools? }`
//!                                → **SSE 流**（OpenAI 格式 delta，含 tool_calls）
//!
//! ── 为什么对话不在前端直接打 /v1/chat/completions ─────────────
//! 桌面壳的页面来自 Tauri 自定义协议（`tauri://localhost`），前端 fetch 到
//! `http://127.0.0.1:{port}/v1/*` 是**跨源**请求，而网关面默认不应答 CORS
//! （见 `KEY_CORS_ENABLED` 的说明）—— 那条路要求用户先打开 CORS 开关，
//! 等于让「用助手」依赖一个与它无关的安全开关。挂到面板路由（`/api/*`，
//! 无条件 CORS）就不必动那个开关，且对话框本来就是管理面的一部分。
//!
//! ── 与 /v1/chat/completions 的关系 ─────────────────────────
//! **共用同一条转发链路**（`UpstreamService::forward`）：token 刷新、429 换号、
//! 出站脱敏、协议翻译、调试报文都在那条链路上。本文件只做三件事：
//!   ① 把「用户选的模型」解析成上游名 —— 模型是对外名（`/v1/models` 的
//!      `data[].id`，映射名也算），走公共管道的 `resolve_model`（默认模型回落 /
//!      映射别名 / 目录校验与 /v1/* 同源）；**不钉提供商**，同名在多家时按账号
//!      优先级主备 —— 助手的路由语义与普通客户端完全一致；
//!   ② 按设置拼系统提示词（开关 × 工具是否为空，口径见 `AssistantConfig::system_prompt`）；
//!   ③ 流式回传（OpenAI 格式原样，前端自己解析 delta / tool_calls）。
//!
//! ── 工具定义与执行都在前端 ───────────────────────────────────
//! 本接口不认工具语义：`tools` 是前端按勾选过滤好的 OpenAI tools 数组，
//! 原样进上游请求；上游回的 `tool_calls` 原样流回前端，由前端执行、再把
//! `role: "tool"` 的结果作为下一轮的 messages 发上来。后端因此不认识任何一个
//! 工具 —— 加工具、改工具参数都不需要动 Rust 侧（工具的实现在前端，
//! 调的是已有的 /api/* 管理接口）。
//!
//! ── 记账 ────────────────────────────────────────────────────
//! 助手使用真实账号额度，`is_test = false`、`client = "AI 助手"`，计入真实报表。
//! `uiStream: true` 只转换对外消息流，不改变下面的转发与记账链路。

use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use serde_json::{json, Map, Value};

use crate::server::config::{self, AssistantConfig, MAX_SYSTEM_PROMPT_CHARS};
use crate::server::core::upstream::cancellation;
use crate::server::core::upstream::usage::RequestTelemetry;
use crate::server::core::upstream::{ForwardOutcome, ForwardRequest};
use crate::server::errors;
use crate::server::http::{ok_json, parse_body};
use crate::server::logging;
use crate::server::ServerState;

use super::disconnect_guard::DisconnectGuard;
use super::pipeline::{self, json_response, RecordContext, RecordingStream, sse_response};

/// 对外模型名的长度上限（与 `model_test` 的 `text_field` 上限同一量级）
const MAX_MODEL_CHARS: usize = 128;
/// 单次对话里 messages 的条数上限。
///
/// 不是防用户，是防「前端 bug 把上下文堆到几千条」把网关的内存与上游的
/// 上下文窗口一起打爆：200 条足够一场长会话（每条都是完整一问一答）。
const MAX_MESSAGES: usize = 200;
/// tools 数组的长度上限（前端目前最多 9 只，留足余量）
const MAX_TOOLS: usize = 64;
/// 思考等级的长度上限（与 `model_rules::normalize_reasoning` 同一口径）
const MAX_REASONING_CHARS: usize = 32;

/* ─── 设置（设置页「AI 助手」分类）───────────────────────── */

/// GET /api/assistant/config
///
/// 出站用 `status_value`：工具表展开成完整 9 项（缺省值在后端兜底，界面不必
/// 也维护一份默认集，见 `AssistantConfig::status_value`）。
pub async fn get_config(State(_state): State<ServerState>) -> Response {
    ok_json(json!({ "config": config::assistant_config().status_value() }))
}

/// One read-only catalog for both native and web assistants; includes custom providers.
pub async fn get_models(State(state): State<ServerState>) -> Response {
    use crate::server::core::{custom_providers, providers::catalog};
    let mut view = catalog::manage_view(state.store());
    let mut models = view.get("models").and_then(Value::as_array).cloned().unwrap_or_default();
    let mut mappings = view.get("mappings").and_then(Value::as_array).cloned().unwrap_or_default();
    for provider in custom_providers::list() {
        let id = provider["id"].as_str().unwrap_or("");
        let provider_enabled = provider["enabled"].as_bool().unwrap_or(true);
        for mut row in custom_providers::models_of(id) {
            row["provider"] = json!(id);
            row["providerLabel"] = provider["name"].clone();
            row["enabled"] = json!(provider_enabled && row["enabled"].as_bool().unwrap_or(true));
            row["aliases"] = json!(custom_providers::mappings_of(id).iter()
                .filter(|m| m["target"] == row["id"])
                .filter_map(|m| m["alias"].as_str().map(str::to_string)).collect::<Vec<_>>());
            models.push(row);
        }
        for mut mapping in custom_providers::mappings_of(id) {
            mapping["provider"] = json!(id);
            mapping["enabled"] = json!(provider_enabled && mapping["enabled"].as_bool().unwrap_or(true));
            mappings.push(mapping);
        }
    }
    view["models"] = json!(models);
    view["mappings"] = json!(mappings);
    ok_json(view)
}

/// PUT /api/assistant/config
///
/// 整块替换：前端拿 GET 的响应改一改变量再发回来，所以缺字段按默认值处理
/// （**不是**「缺字段 = 保留原值」—— 前端永远发全量，两条约定混用只会让
/// 「我明明删了这一项」变成解不开的谜）。
pub async fn put_config(State(_state): State<ServerState>, body: Bytes) -> Response {
    write_config(body, false).await
}

/// Field-scoped updates; model changes never replace tools or the prompt.
pub async fn patch_config(State(_state): State<ServerState>, body: Bytes) -> Response {
    write_config(body, true).await
}

static CONFIG_WRITE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

async fn write_config(body: Bytes, partial: bool) -> Response {
    let _write = CONFIG_WRITE.lock().await;
    let payload = match parse_body(&body) {
        Ok(payload) => payload,
        Err(error) => return errors::management_error(400, error.message),
    };
    let Some(block) = payload.get("config").and_then(Value::as_object) else {
        return errors::management_error(400, "缺少 config 对象");
    };
    let saved = match config::update_assistant_config(|current| {
        let merged = if partial { merge_config(current, block)? } else { block.clone() };
        parse_config(&merged)
    }) {
        Ok(saved) => saved,
        Err(config::ConfigUpdateError::Invalid(message)) => return errors::management_error(400, message),
        Err(config::ConfigUpdateError::Persistence) => {
            logging::log("[Config]", "❌ AI 助手设置写入失败，保留原配置");
            return errors::management_error(500, "AI 助手设置保存失败，配置未改变；请检查数据库及磁盘状态后重试");
        }
    };
    // 回给前端的形态与 GET 完全一致（展开过的工具表）——「存了什么」与
    // 「界面看到什么」用同一个序列化口，免得前端保存后自己那那份与后端分叉
    ok_json(json!({ "config": saved.status_value() }))
}

fn merge_config(current: &AssistantConfig, patch: &Map<String, Value>) -> Result<Map<String, Value>, String> {
    let mut next = current.status_value().as_object().cloned().unwrap_or_default();
    for (key, value) in patch {
        if !["model", "reasoning", "systemPrompt", "systemPromptEnabled", "tools"].contains(&key.as_str()) {
            return Err(format!("未知的助手配置字段：{key}"));
        }
        if key == "tools" {
            let changes = value.as_object().ok_or("tools 必须是对象")?;
            let mut tools = next.get("tools").and_then(Value::as_object).cloned().unwrap_or_default();
            for (id, on) in changes {
                if !crate::server::config::ALL_TOOL_IDS.contains(&id.as_str()) || !on.is_boolean() {
                    return Err(format!("无效的工具设置：{id}"));
                }
                tools.insert(id.clone(), on.clone());
            }
            next.insert(key.clone(), Value::Object(tools));
        } else {
            if key == "systemPromptEnabled" && !value.is_boolean() { return Err("systemPromptEnabled 必须是布尔值".into()); }
            next.insert(key.clone(), value.clone());
        }
    }
    Ok(next)
}

#[cfg(test)]
mod patch_tests {
    use super::*;
    #[test]
    fn model_patch_preserves_revocation_and_prompt() {
        let mut current = AssistantConfig::default();
        current.system_prompt = "fresh".into();
        current.tools.insert("set_account_enabled".into(), false);
        let patch = json!({"model":"new-model"});
        let merged = merge_config(&current, patch.as_object().unwrap()).unwrap();
        let saved = parse_config(&merged).unwrap();
        assert_eq!(saved.model.as_deref(), Some("new-model"));
        assert_eq!(saved.system_prompt, "fresh");
        assert!(!saved.tool_enabled("set_account_enabled"));
        assert!(saved.tool_enabled("list_models"));
    }
    #[test]
    fn partial_tool_update_preserves_other_settings_and_rejects_bad_input() {
        let mut current = AssistantConfig::default();
        current.tools.insert("list_models".into(), false);
        for patch in [json!({"tools":{"test_model":true}}), json!({"tools":{"test_model":false}})] {
            let saved = parse_config(&merge_config(&current, patch.as_object().unwrap()).unwrap()).unwrap();
            assert!(!saved.tool_enabled("list_models"));
            assert!(saved.tool_enabled("list_account_balance"));
        }
        for patch in [json!({"unknown":true}), json!({"tools":{"invented":true}}), json!({"tools":{"test_model":"yes"}}), json!({"systemPromptEnabled":null})] {
            assert!(merge_config(&current, patch.as_object().unwrap()).is_err());
        }
    }

    #[test]
    fn persistence_failure_is_an_http_error_and_preserves_tool_permissions() {
        use crate::server::config::persistence_tests;
        const NAME: &str = "server::api::assistant::patch_tests::persistence_failure_is_an_http_error_and_preserves_tool_permissions";
        if !persistence_tests::isolated(NAME) { return; }
        let database = persistence_tests::open_database();
        if persistence_tests::is_restart() {
            assert!(!config::assistant_config().tool_enabled("set_account_enabled"));
            return;
        }
        let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        runtime.block_on(async {
            let update = |on| Bytes::from(json!({"config":{"tools":{"set_account_enabled":on}}}).to_string());
            assert_eq!(write_config(update(true), true).await.status(), StatusCode::OK);
            database.with(|conn| conn.execute_batch(
                "CREATE TRIGGER reject_assistant BEFORE INSERT ON kv
                 WHEN NEW.key = 'assistantConfig'
                 BEGIN SELECT RAISE(ABORT, 'injected persistence failure'); END;"
            )).unwrap().unwrap();
            for partial in [true, false] {
                let response = write_config(update(false), partial).await;
                assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
                let bytes = axum::body::to_bytes(response.into_body(), 4096).await.unwrap();
                let body: Value = serde_json::from_slice(&bytes).unwrap();
                assert!(body.to_string().contains("配置未改变"));
                assert!(config::assistant_config().tool_enabled("set_account_enabled"));
                config::reload();
                assert!(config::assistant_config().tool_enabled("set_account_enabled"));
            }
            database.with(|conn| conn.execute_batch("DROP TRIGGER reject_assistant;")).unwrap().unwrap();
            let response = write_config(update(false), true).await;
            assert_eq!(response.status(), StatusCode::OK);
            let bytes = axum::body::to_bytes(response.into_body(), 4096).await.unwrap();
            let body: Value = serde_json::from_slice(&bytes).unwrap();
            assert_eq!(body["data"]["config"]["tools"]["set_account_enabled"], false);
        });
        persistence_tests::assert_restart(NAME);
    }

    #[test]
    fn concurrent_patches_and_restores_preserve_latest_assistant_fields() {
        use crate::server::config::persistence_tests;
        use std::sync::mpsc;
        use std::time::Duration;
        const NAME: &str = "server::api::assistant::patch_tests::concurrent_patches_and_restores_preserve_latest_assistant_fields";
        if !persistence_tests::isolated(NAME) { return; }
        let database = persistence_tests::open_database();
        if persistence_tests::is_restart() {
            let saved = config::assistant_config();
            assert_eq!(saved.model.as_deref(), Some("after-restore"));
            assert_eq!(saved.system_prompt, "restored-prompt");
            assert!(!saved.tool_enabled("set_account_enabled"));
            return;
        }
        let runtime = tokio::runtime::Builder::new_multi_thread().worker_threads(2).enable_all().build().unwrap();
        runtime.block_on(async {
            let initial = Bytes::from(json!({"config":{
                "model":"initial", "systemPrompt":"keep-prompt", "tools":{"set_account_enabled":true}
            }}).to_string());
            assert_eq!(write_config(initial, false).await.status(), StatusCode::OK);
            let start = Arc::new(tokio::sync::Barrier::new(3));
            let model_start = start.clone();
            let model = tokio::spawn(async move {
                model_start.wait().await;
                write_config(Bytes::from(json!({"config":{"model":"patched-model"}}).to_string()), true).await.status()
            });
            let tools_start = start.clone();
            let tools = tokio::spawn(async move {
                tools_start.wait().await;
                write_config(Bytes::from(json!({"config":{"tools":{"set_account_enabled":false}}}).to_string()), true).await.status()
            });
            start.wait().await;
            assert_eq!(model.await.unwrap(), StatusCode::OK);
            assert_eq!(tools.await.unwrap(), StatusCode::OK);
            let saved = config::assistant_config();
            assert_eq!(saved.model.as_deref(), Some("patched-model"));
            assert_eq!(saved.system_prompt, "keep-prompt");
            assert!(!saved.tool_enabled("set_account_enabled"));

            let bad = Bytes::from(json!({"config":{"model":"bad-model", "tools":{"test_model":"yes"}}}).to_string());
            assert_eq!(write_config(bad, true).await.status(), StatusCode::BAD_REQUEST);
            assert_eq!(config::assistant_config(), saved);
            let replacement = Bytes::from(json!({"config":{"model":"put-model"}}).to_string());
            assert_eq!(write_config(replacement, false).await.status(), StatusCode::OK);
            assert_eq!(config::assistant_config().system_prompt, "");
            assert!(!config::assistant_config().tool_enabled("set_account_enabled"));
        });

        // A PATCH queued while a database restore owns the global gate must merge
        // with the restored assistant, not the snapshot that preceded the restore.
        let mut initial = config::assistant_config();
        initial.tools.insert("set_account_enabled".into(), true);
        assert!(config::set_assistant_config(initial));
        let (committed_tx, committed_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let restore = std::thread::spawn(move || {
            config::update_persisted_and_reload(|| {
                database.with(|conn| conn.execute(
                    "UPDATE kv SET value=?1 WHERE key='assistantConfig'",
                    [json!({"model":"restored-model", "systemPrompt":"restored-prompt", "tools":{"set_account_enabled":false}}).to_string()],
                )).unwrap().unwrap();
                committed_tx.send(()).unwrap();
                release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
                Ok(((), true))
            }).unwrap();
        });
        committed_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        let (started_tx, started_rx) = mpsc::channel();
        let (done_tx, done_rx) = mpsc::channel();
        let patch = runtime.spawn(async move {
            started_tx.send(()).unwrap();
            let response = write_config(Bytes::from(json!({"config":{"model":"after-restore"}}).to_string()), true).await;
            done_tx.send(()).unwrap();
            response.status()
        });
        started_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        let completed_early = done_rx.recv_timeout(Duration::from_millis(100)).is_ok();
        release_tx.send(()).unwrap();
        restore.join().unwrap();
        assert_eq!(runtime.block_on(patch).unwrap(), StatusCode::OK);
        assert!(!completed_early);
        let saved = config::assistant_config();
        assert_eq!(saved.model.as_deref(), Some("after-restore"));
        assert_eq!(saved.system_prompt, "restored-prompt");
        assert!(!saved.tool_enabled("set_account_enabled"));
        persistence_tests::assert_restart(NAME);
    }
}

/// 解析并校验设置体（校验失败给人话，不静默丢弃）
fn parse_config(block: &Map<String, Value>) -> Result<AssistantConfig, String> {
    let model = match block.get("model") {
        None | Some(Value::Null) => None,
        Some(Value::String(text)) => {
            let id = text.trim();
            if id.is_empty() {
                None
            } else {
                if id.chars().count() > MAX_MODEL_CHARS {
                    return Err("模型名过长".to_string());
                }
                Some(id.to_string())
            }
        }
        Some(_) => return Err("model 必须是字符串或 null".to_string()),
    };
    let reasoning = match block.get("reasoning") {
        None | Some(Value::Null) => None,
        Some(Value::String(text)) => {
            let level = text.trim();
            if level.is_empty() {
                None
            } else if level.chars().count() > MAX_REASONING_CHARS {
                return Err(format!("思考等级最长 {MAX_REASONING_CHARS} 个字符"));
            } else {
                Some(level.to_string())
            }
        }
        Some(_) => return Err("reasoning 必须是字符串或 null".to_string()),
    };
    let system_prompt = match block.get("systemPrompt") {
        None | Some(Value::Null) => String::new(),
        Some(Value::String(text)) => {
            if text.chars().count() > MAX_SYSTEM_PROMPT_CHARS {
                return Err(format!("系统提示词最长 {MAX_SYSTEM_PROMPT_CHARS} 字"));
            }
            text.clone()
        }
        Some(_) => return Err("systemPrompt 必须是字符串".to_string()),
    };
    let tools = match block.get("tools") {
        None | Some(Value::Null) => Default::default(),
        Some(Value::Object(tools)) => tools
            .iter()
            .filter_map(|(id, on)| on.as_bool().map(|on| (id.clone(), on)))
            .collect(),
        Some(_) => return Err("tools 必须是对象".to_string()),
    };
    Ok(AssistantConfig {
        model,
        reasoning,
        system_prompt_enabled: block
            .get("systemPromptEnabled")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        system_prompt,
        tools,
    })
}

/* ─── 对话（SSE）────────────────────────────────────────── */

/// POST /api/assistant/chat
pub async fn chat(State(state): State<ServerState>, body: Bytes) -> Response {
    let ui_stream = serde_json::from_slice::<Value>(&body).ok()
        .and_then(|v| v.get("uiStream").and_then(Value::as_bool)).unwrap_or(false);
    let response = chat_forward(state, body).await;
    if ui_stream { super::assistant_stream::adapt(response).await } else { response }
}

async fn chat_forward(state: ServerState, body: Bytes) -> Response {
    if body.len() > 24 * 1024 * 1024 { return errors::management_error(413, "对话与附件总量过大，请新建对话后重试"); }
    let payload = match parse_body(&body) {
        Ok(payload) => payload,
        Err(error) => return errors::management_error(400, error.message),
    };
    let Some(messages) = payload.get("messages").and_then(Value::as_array).cloned() else {
        return errors::management_error(400, "缺少 messages 数组");
    };
    if messages.is_empty() {
        return errors::management_error(400, "messages 不能为空");
    }
    if messages.len() > MAX_MESSAGES {
        return errors::management_error(400, format!("messages 最多 {MAX_MESSAGES} 条"));
    }
    if let Err(error) = super::assistant_input::validate(&messages) { return errors::management_error(400, error); }
    // 本次请求点名的模型优先；没点名用设置里的。两者都没有时说清下一步 ——
    // 「去设置里选一个」比「模型未指定」这种网关腔有用得多。
    // 这里的 model 是**对外模型名**（/v1/models 的 data[].id，映射名也算），
    // 路由交给公共管道解析 —— 同名在多家时按账号优先级主备，与普通客户端一致。
    let config = config::assistant_config();
    let model = match model_from(&payload) {
        Ok(Some(model)) => model,
        Ok(None) => match config.model.clone() {
            Some(model) => model,
            None => {
                return errors::management_error(
                    400,
                    "还没有选择对话模型：去「设置 → AI 助手」里选一个，或先在模型管理页确认有已启用的模型",
                )
            }
        },
        Err(message) => return errors::management_error(400, message),
    };
    let tools = match payload.get("tools") {
        None | Some(Value::Null) => Vec::new(),
        Some(Value::Array(tools)) => {
            if tools.len() > MAX_TOOLS {
                return errors::management_error(400, format!("tools 最多 {MAX_TOOLS} 个"));
            }
            tools.iter().filter(|tool| {
                tool.pointer("/function/name").and_then(Value::as_str)
                    .is_some_and(|id| config.tool_enabled(id))
            }).cloned().collect()
        }
        Some(_) => return errors::management_error(400, "tools 必须是数组"),
    };

    // 系统提示词：开关 × 工具是否为空的四态口径全在 config 侧（含「一只工具都
    // 没勾就不注入」这条产品约定）；这里只负责把它摆到 messages 最前面
    let system = config.system_prompt(!tools.is_empty());
    let mut outbound_messages = Vec::with_capacity(messages.len() + 1);
    if let Some(text) = system {
        outbound_messages.push(json!({ "role": "system", "content": text }));
    }
    outbound_messages.extend(messages);

    // 思考等级：本次请求点名的优先，没点名就用设置里存的（与模型同一套「本次
    // 覆盖 > 默认值」语义）。写进 `reasoning_effort` —— 那是客户端显式指定的
    // 形态，按既有口径**优先于映射上绑定的等级**（见 `model_rules::reasoning`
    // 的模块头）；各家适配器再把它翻译成本家上游认识的档位字段。
    let reasoning = reasoning_from(&payload).or_else(|| config.reasoning.clone());

    let mut upstream = json!({
        "model": model,
        "messages": outbound_messages,
        // 助手固定流式：工具调用与正文都要边到边渲染，非流式对对话界面没有意义
        "stream": true,
    });
    if !tools.is_empty() {
        upstream["tools"] = Value::Array(tools);
    }
    if let Some(level) = reasoning.as_deref() {
        upstream["reasoning_effort"] = Value::String(level.to_string());
    }

    // 模型路由：对外名 → 上游名（默认值 / 映射别名 / 目录校验与 /v1/* 同源）
    let requested_model = match pipeline::resolve_model(&state, &mut upstream, None) {
        Ok(name) => name,
        Err(error) => return errors::management_error(error.http_status().as_u16() as i32, error.message),
    };

    let started_at = logging::now_ms();
    let telemetry = Arc::new(RequestTelemetry::with_id());
    let telemetry_id = telemetry.snapshot().id;
    // 进行中行：与真实请求同一时点。`is_test = false` —— 报表计入、请求日志标记 AI 助手来源
    // （与模型测试同一口径，见模块头）；下游模型名记用户点名的那个对外名
    state.request_stats().record_started_with_client(
        &telemetry_id,
        started_at,
        &requested_model,
        &model,
        "",
        "AI 助手",
        false,
    );
    if let Some(token) = cancellation::register(&telemetry_id) {
        telemetry.set_cancel_token(token);
    }
    let mut guard = DisconnectGuard::new(state.request_stats(), telemetry_id.clone());

    let outcome = state
        .upstream()
        .forward(ForwardRequest {
            body: upstream,
            stream: true,
            // 不去重：对话不是「同 body 的快速重试」，同一句再问一次就该再发一次
            dedupe_key: String::new(),
            // 空头：助手不是某个客户端发来的，也不该把面板的管理头透传给上游
            client_headers: HeaderMap::new(),
            telemetry: telemetry.clone(),
            // **不钉提供商**：对话模型是对外名，路由语义与 /v1/chat/completions
            // 完全一致 —— 同名在多家时按账号优先级主备，失败自动落下一家
            allowed_providers: None,
            pinned_account: None,
            // 尊重模型启停：助手用的是「已启用的模型」，用户关掉的模型不该
            // 因为助手而继续消耗额度（与生产请求同一道门禁）
            ignore_model_gate: false,
            proxy_override: None,
        })
        .await;

    match outcome {
        Ok(ForwardOutcome::Stream { status, stream: source }) => {
            let status = StatusCode::from_u16(status).unwrap_or(StatusCode::OK);
            let context = RecordContext {
                stats: state.request_stats(),
                telemetry,
                started_at,
                model: requested_model,
                client_model: model.clone(),
                client_reasoning: reasoning.clone().unwrap_or_default(),
                status: i64::from(status.as_u16()),
                raw_request: None,
                raw_response: None,
                is_test: false,
                client: "AI 助手".to_string(),
                key_id: String::new(),
            };
            // 记账移交给响应流（它与流的生命周期同长）；守卫不再兜底
            guard.handoff();
            sse_response(
                status,
                Box::new(RecordingStream::with_terminals(
                    source,
                    context,
                    pipeline::terminal::CHAT,
                )),
            )
            .into_response()
        }
        // 固定要求了流式，聚合体这条理论上到不了；真到了就按 JSON 原样回，
        // 前端对非 SSE 响应也有一套降级（把整段当一条 assistant 消息）
        Ok(ForwardOutcome::Completion { body }) => {
            let raw_response = pipeline::capture_raw_json(&body);
            pipeline::record_entry(
                &RecordContext {
                    stats: state.request_stats(),
                    telemetry,
                    started_at,
                    model: requested_model,
                    client_model: model.clone(),
                    client_reasoning: reasoning.clone().unwrap_or_default(),
                    status: 200,
                    raw_request: None,
                    raw_response,
                    is_test: false,
                    client: "AI 助手".to_string(),
                key_id: String::new(),
                },
                None,
            );
            guard.complete();
            json_response(body)
        }
        Err(error) => {
            let status = i64::from(error.http_status().as_u16());
            let message = error.message.clone();
            pipeline::record_entry(
                &RecordContext {
                    stats: state.request_stats(),
                    telemetry,
                    started_at,
                    model: requested_model,
                    client_model: model.clone(),
                    client_reasoning: reasoning.clone().unwrap_or_default(),
                    status,
                    raw_request: None,
                    raw_response: None,
                    is_test: false,
                    client: "AI 助手".to_string(),
                key_id: String::new(),
                },
                Some(message.clone()),
            );
            guard.complete();
            errors::management_error(status as i32, message)
        }
    }
}

/// 从请求体读本次点名的思考等级（字符串；缺失 / null / 空串 → None）。
///
/// 只做长度与空白处理，**不校验取值**：等级表（`model_rules::REASONING_LEVELS`）
/// 是「界面上的候选」，不是白名单 —— 用户可以在模型管理页填表外的自定义等级，
/// 这里若只放行表内的值，同一个值在「映射绑定」与「本次覆盖」两条路上就会有
/// 两种命运。真正的合法性由各适配器的翻译层判定（不认识的档位不会注入）。
fn reasoning_from(payload: &Value) -> Option<String> {
    let text = payload.get("reasoning").and_then(Value::as_str)?.trim();
    if text.is_empty() || text.chars().count() > 32 {
        return None;
    }
    Some(text.to_string())
}

/// 从请求体读本次点名的模型：**对外模型名**（字符串；缺失 / null → None）。
///
/// 兼容旧版前端发来的 `{provider, id}` 对象 —— 取 `id`，provider 不再参与路由
/// （对话模型的语义已与 /v1/models 对齐，同名在多家按账号优先级）。
fn model_from(payload: &Value) -> Result<Option<String>, String> {
    match payload.get("model") {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(text)) => {
            let id = text.trim();
            if id.is_empty() {
                return Err("model 不能为空".to_string());
            }
            Ok(Some(id.to_string()))
        }
        Some(Value::Object(model)) => {
            let id = model.get("id").and_then(Value::as_str).unwrap_or("").trim();
            if id.is_empty() {
                return Err("model.id 不能为空".to_string());
            }
            Ok(Some(id.to_string()))
        }
        Some(_) => Err("model 必须是字符串".to_string()),
    }
}
