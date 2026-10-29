pub mod growth;
pub mod report;
pub mod streak;
pub mod travel;
pub mod gift;
pub mod trial;
pub mod expert;
pub mod growth_accept;
pub(crate) mod request;
use serde_json::{json, Map, Value};

use crate::http::{send_raw, ApiResponse};
use crate::workbuddy_shared::endpoints::{normalize_endpoint, resolve_edition, RESPONSE_CODE_OK};
use agent2api_provider_protocol::WireProxy as ResolvedProxy;
use crate::logging;

// 请求构造素材对同层子模块可见（`super::X`），对外仍是模块私有
use request::{
    build_headers, whitelist_headers, BillingCall, BillingSpec, CallOptions,
    BILLING_ACTIVITY_CHECKIN_STATUS, BILLING_CHECKIN_STATUS, BILLING_CLAIM_COMPENSATION,
    BILLING_CLAIM_GIFT, BILLING_DAILY_CHECKIN,
};
/// 计费接口单请求总超时（对照 Node 版 REQUEST_TIMEOUT_MS）
const REQUEST_TIMEOUT_MS: u64 = 20_000;

/// 计费/活动接口的错误（对应 Node 版 WorkBuddyBillingError）。
///
/// `status_code` 会原样变成 HTTP 状态码（504 超时 / 401 登录态过期 /
/// 上游 HTTP 状态码），所以它必须是 Option 之外的一个确定值 ——
/// Node 版构造函数默认 502。
#[derive(Clone, Debug)]
pub struct BillingError {
    pub message: String,
    pub status_code: i32,
    pub upstream_code: Option<i64>,
}

impl BillingError {
    pub fn new(message: impl Into<String>, status_code: i32) -> Self {
        Self { message: message.into(), status_code, upstream_code: None }
    }

    pub fn with_code(
        message: impl Into<String>,
        status_code: i32,
        upstream_code: Option<i64>,
    ) -> Self {
        Self { message: message.into(), status_code, upstream_code }
    }

    /// 转成统一的网关错误。
    ///
    /// 计费路由的失败 body 走 OpenAI 风格（`/api/usage` 那几条在 server.mjs
    /// 的最外层大 try 里 → errorPayload）—— 由路由层决定用哪个信封，
    /// 这里只提供转换。
    pub fn to_gateway_error(&self) -> crate::errors::GatewayError {
        let mut error = crate::errors::GatewayError::with_status(
            self.status_code,
            self.message.clone(),
        );
        if let Some(code) = self.upstream_code {
            error = error.upstream_code(code);
        }
        error
    }
}

impl std::fmt::Display for BillingError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}", self.message)
    }
}

/// 计费客户端句柄：持有鉴权服务（取会话用）。
///
/// Node 版是 `createWorkBuddyBilling({ auth, ... })`，靠 `auth.getCurrentSession()`
/// 拿默认会话。按账号查询（/api/accounts/usage、/api/accounts/checkin）需要
/// **指定账号**的会话，那条路径由 `billing::checkin` 的入参显式传入 store，
/// 因此这里不再持有账号存储句柄。
#[derive(Clone)]
pub struct BillingService {
    session: Value,
    #[cfg(test)]
    mock_transport:Option<std::sync::Arc<dyn Fn(&str,Option<&Value>,&[(String,String)])->Result<Value,BillingError>+Send+Sync>>,
}

impl BillingService {
    pub fn new(session: Value) -> Self {
        Self { session, #[cfg(test)] mock_transport:None }
    }

    /// 计费接口语言（Accept-Language）：zh | en。
    ///
    /// Node 版 `resolveAcceptLanguage`：认 zh*/en* 前缀，其余（含空）一律 zh。
    /// 传入的 locale 来自 config.locale（默认 zh-CN）。不缓存（config 可热改），
    /// 每次读内存快照。
    fn accept_language(locale: Option<&str>) -> String {
        let Some(locale) = locale else {
            return "zh".to_string();
        };
        let normalized = locale.to_lowercase();
        if normalized.starts_with("zh") {
            return "zh".to_string();
        }
        if normalized.starts_with("en") {
            return "en".to_string();
        }
        "zh".to_string()
    }

    /// 当前配置里的 locale（/api/usage 与 claim-and-report 用）
    fn current_locale() -> String {
        "zh-CN".to_string()
    }

    /// 取默认会话（当前账号）；没有可用登录态时报 401。
    ///
    /// 文案照抄 Node 版，但去掉了「node server.mjs --login」那半句 ——
    /// 壳内 Rust 版没有那个命令行入口，指向不存在的命令会误导用户。
    async fn require_session(&self) -> Result<Value, BillingError> { Ok(self.session.clone()) }

    /// 会话里的出口（`session.proxy` → ResolvedProxy）。
    ///
    /// 会话里的 proxy 由账号存储组装，形态与 ResolvedProxy 的 JSON 完全一致；
    /// 数据坏了（缺主机/端口非法）时按直连处理并记一条 warn ——
    /// 出网代理是可选配置，它的故障不该让整条链路失败。
    fn proxy_of(session: &Value) -> Option<ResolvedProxy> {
        match crate::proxy_util::wire_proxy_from_json(session.get("proxy").unwrap_or(&Value::Null)) {
            Ok(proxy) => proxy,
            Err(reason) => {
                logging::log(
                    "[Upstream]",
                    &format!("⚠️ 账号代理不可用（{reason}），本次回退直连"),
                );
                None
            }
        }
    }

    // ─── 核心请求 ───────────────────────────────────────────

    /// 调用计费/活动接口。
    ///
    /// 对照 Node 版 `callBilling(spec, { body, session, query, expectCodeOk, locale })`：
    ///   ① URL = normalizeEndpoint(session.endpoint) + spec.path + query
    ///   ② 头 = buildHeaders(session, extra)，extra 含 Accept-Language 与白名单头
    ///   ③ 非 GET/HEAD 一律带 body（spec.body 兜底，序列化成 JSON）
    ///   ④ 走 session.proxy 出口，超时 20 秒
    ///   ⑤ 解包：非 2xx → 抛错；code !== 0 且 expectCodeOk → 抛错
    ///
    /// 私有：只给本模块与其子模块（usage.rs / activity.rs）用 ——
    /// Rust 的私有项对**后代模块**可见，所以子模块能直接调它，
    /// 而 api/ 层看不到（它只该走那些语义化方法）。
    async fn call_billing(
        &self,
        spec: BillingSpec,
        options: CallOptions<'_>,
    ) -> Result<BillingCall, BillingError> {
        if spec.method != "GET" && crate::providers::workbuddy::legacy_workbuddy::task_execution::should_stop() {
            return Err(BillingError::new("任务已停止，未发送后续请求", 409));
        }
        let session = match options.session {
            Some(session) => session.clone(),
            None => self.require_session().await?,
        };
        // 账户级端点：国内版/国际版账号各走自己的站点。
        // 会话缺 endpoint 时回落到 auth 的默认 baseUrl（Node 的
        // `normalizeEndpoint(activeSession.endpoint || baseUrl)`）。
        // growth 域端点（spec.base != Session）改挂**固定域**——成长任务/连登/
        // 旅行只存在国内版三域上，打错域即 400（refs client.go:693-695、tasks.go:223-225）。
        let endpoint = match spec.base {
            request::BillingBase::Session => session
                .get("endpoint")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
                .map(normalize_endpoint)
                .unwrap_or_else(|| normalize_endpoint(crate::workbuddy_shared::endpoints::DEFAULT_ENDPOINT)),
            request::BillingBase::Chat => request::CHAT_BASE.to_string(),
            request::BillingBase::Billing => request::BILLING_BASE.to_string(),
            request::BillingBase::Web => request::WEB_BASE.to_string(),
        };
        let url = format!("{endpoint}{}{}", spec.path, options.query.unwrap_or(""));

        let mut extra: Vec<(String, String)> = options.extra.clone();
        if let Some(locale) = options.locale {
            extra.push((
                "Accept-Language".to_string(),
                Self::accept_language(Some(locale)),
            ));
        }
        if spec.whitelist_headers {
            extra.extend(whitelist_headers(&session));
        }
        // 头顺序与 Node 的 `{...base, ...extra, X-Enterprise-Id, ...}` 一致：
        // 条件头在 extra 之后（同名时后者胜，Node 的对象展开也是这个顺序）
        let headers = build_headers(&session, &extra);
        #[cfg(test)]
        if let Some(mock) = &self.mock_transport {
            let data = mock(&url, options.body, &headers)?;
            return Ok(BillingCall {
                code: Some(0),
                msg: None,
                request_id: None,
                data,
                raw: None,
            });
        }

        let body = if spec.method == "GET" || spec.method == "HEAD" {
            None
        } else {
            // Node 是 `JSON.stringify(body ?? spec.body ?? {})` ——
            // 缺省体一律是空对象，不能省掉（上游对缺 body 的 POST 会报 400）
            Some(options.body.cloned().unwrap_or_else(|| spec.body()))
        };

        let proxy = Self::proxy_of(&session);
        logging::verbose(
            "[Billing]",
            &format!(
                "{} {url}{}",
                spec.method,
                match &proxy {
                    Some(proxy) => format!(" 经代理 {}", proxy.host),
                    None => String::new(),
                }
            ),
        );

        let response: ApiResponse = send_raw(
            spec.method,
            &url,
            body.as_ref(),
            &headers,
            proxy.as_ref(),
            Some(REQUEST_TIMEOUT_MS),
        )
        .await
        .map_err(|error| {
            if error.is_timeout() {
                BillingError::new("计费接口请求超时", 504)
            } else {
                // 文案对齐 Node：`计费接口请求失败: ${error.message}`
                BillingError::new(format!("计费接口请求失败: {error}"), 502)
            }
        })?;

        let payload = response.payload;
        let code = payload
            .as_ref()
            .and_then(|value| value.get("code"))
            .and_then(Value::as_i64);
        // Node: `payload?.msg || payload?.message` —— 空串也当「没有」，
        // 所以这里要过滤空串，不能拿到 Some("") 就当命中了
        let msg = payload
            .as_ref()
            .and_then(|value| {
                value
                    .get("msg")
                    .and_then(Value::as_str)
                    .filter(|text| !text.is_empty())
                    .or_else(|| {
                        value
                            .get("message")
                            .and_then(Value::as_str)
                            .filter(|text| !text.is_empty())
                    })
            })
            .map(str::to_string);
        // Node 的 `requestId: payload?.requestId` 在缺失时是 undefined，
        // JSON 化会**丢掉这个键**；用 Option 表达同一语义（None = 不出键）
        let request_id = payload
            .as_ref()
            .and_then(|value| value.get("requestId"))
            .cloned();

        if response.status == 401 || response.status == 403 {
            return Err(BillingError::with_code(
                "登录态已过期或被拒绝，无法调用计费接口",
                401,
                code,
            ));
        }
        if !response.ok {
            // Node: `计费接口返回 HTTP ${status}${payload?.msg || payload?.message ? `: ...` : ''}`
            let detail = payload
                .as_ref()
                .and_then(|value| {
                    value
                        .get("msg")
                        .and_then(Value::as_str)
                        .or_else(|| value.get("message").and_then(Value::as_str))
                })
                .unwrap_or("");
            // 「今天已签到」不是错误：WorkBuddy 国内版在当日已领过时，`daily-checkin`
            // 返回的是 **HTTP 400 + 文案「今天已签到，请明天再来」**，而不是
            // HTTP 200 + 非 0 code（后者才是 `checkin.rs` 原先设想的形态，见
            // `checkin_completed_today` 的注释）。不放行的话，这条正常终态会被
            // 整条丢成 `Err`，于是 `claim` 为 null，导致：
            //   1. `checkin_completed_today` 永远判不出「今天已签」，`mark_checkin`
            //      不被调用 → 面板的「已签到」标识永远不亮、`checkinAt` 恒为 null；
            //   2. 定时签到的 `lastResult` 恒定「成功领取 0/N」，用户看不出其实签成了，
            //      会反复重试或去查凭证。
            //
            // 判据刻意收得很紧，只放行**明确说「今天已领过」**的那一种：
            //   · 只认 400 / 409 —— 400 是实测的，409 是防御性放行（详见
            //     `is_duplicate_claim` 的说明）；
            //   · 只认 `msg` 文案含「已签到 / 已领取」—— 与 `checkin_completed_today`
            //     的第 3 条判据同源，两处必须一致，否则放行了却仍判不出「已完成」；
            //   · 只在签到领取那条调用点上开（`tolerate_duplicate_claim`）。
            // 不满足任何一条就照旧报错：`checkin.rs` 特意强调过**不能宽到「只要
            // 没报错就算已签到」**，否则网络错误、凭证失效会被误判成已签到而白丢
            // 一天（实测见过批次撞风控全部未领取的情形）。
            if options.tolerate_duplicate_claim {
                if is_duplicate_claim(response.status, detail) {
                    logging::verbose(
                        "[Billing]",
                        &format!(
                            "签到重复领取（HTTP {}），按「今日已完成」处理: {detail}",
                            response.status
                        ),
                    );
                    return Ok(BillingCall {
                        code,
                        msg,
                        request_id,
                        data: Value::Null,
                        raw: payload,
                    });
                }
                // 开了容错却**没**命中：最可能是上游改了文案（判据是文案匹配，
                // 见 `is_duplicate_claim`）。留一条现场 —— 否则「面板又不像 #137
                // 那样亮了」会查无实据：没有这条日志，文案漂移与真故障在日志里
                // 长得一模一样，排查要从头再来一遍。verbose 级，正常运行时不出声。
                logging::verbose(
                    "[Billing]",
                    &format!(
                        "签到领取返回 HTTP {}，未命中「重复领取」文案，按错误处理: {detail}",
                        response.status
                    ),
                );
            }

            let message = if detail.is_empty() {
                format!("计费接口返回 HTTP {}", response.status)
            } else {
                format!("计费接口返回 HTTP {}: {detail}", response.status)
            };
            return Err(BillingError::with_code(
                message,
                response.status as i32,
                code,
            ));
        }
        if let Some(code_value) = code {
            if code_value != RESPONSE_CODE_OK && options.expect_code_ok {
                // Node: `${payload.msg || payload.message || `计费接口返回 code=${code}`}`
                let message = msg
                    .clone()
                    .filter(|text| !text.is_empty())
                    .unwrap_or_else(|| format!("计费接口返回 code={code_value}"));
                return Err(BillingError::with_code(
                    message,
                    response.status as i32,
                    Some(code_value),
                ));
            }
        }

        let data = payload
            .as_ref()
            .and_then(|value| value.get("data"))
            .cloned()
            .unwrap_or(Value::Null);
        Ok(BillingCall {
            code,
            msg,
            request_id,
            data,
            raw: payload,
        })
    }

}

fn is_duplicate_claim(status:u16,detail:&str)->bool { matches!(status,400|409) && (detail.contains("已签到")||detail.contains("已领取")) }

#[cfg(test)] impl BillingService {
 pub(crate) fn mock(h:impl Fn(&str,Option<&Value>)->Result<Value,BillingError>+Send+Sync+'static)->Self {Self::mock_headers(move|u,b,_|h(u,b))}
 pub(crate) fn mock_headers(h:impl Fn(&str,Option<&Value>,&[(String,String)])->Result<Value,BillingError>+Send+Sync+'static)->Self {Self {session:serde_json::json!({}),mock_transport:Some(std::sync::Arc::new(h))}}
}
