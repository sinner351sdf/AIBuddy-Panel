import { useSyncExternalStore } from 'react'
/**
 * AI 助手共享配置、模型目录与本地网关认证。
 *
 * ── 为什么这两条不走壳的桥 ───────────────────────────────────
 * 桥（`window.workbuddyDesktop.xxx`）是「一次性拿结果」的形态：没有流式，
 * 而且有 60 秒总超时（见 `src/gateway.rs` 的 REQUEST_TIMEOUT_MS）—— 对话回答
 * 动辄跑几十秒，走桥会被截断。所以这里直接 fetch 到**网关基址**：
 *   · web 形态（面板由网关自己托管）：基址 = 地址栏 origin，同源，cookie 自动带；
 *   · 桌面形态：页面来自 Tauri 自定义协议，基址只能问壳要真实端口
 *     （`getBackendStatus`），再拼 `http://127.0.0.1:{port}`。
 * 两条路都落在面板路由 `/api/*`（无条件 CORS），所以不需要用户打开网关面的
 * CORS 开关 —— 那条开关管的是 `/v1/*`，与这里无关。
 *
 * 流式消息由 assistant-chat.ts 中的 AI SDK UI 管理；Rust 将上游 OpenAI SSE
 * 转成 UI Message Stream。本模块不解析流，也不维护第二份对话历史。
 */

const FALLBACK_PORT = 3065

/** 网关基址缓存（每次进对话页最多问一次壳） */
let cachedBase: string | null = null

type BackendStatus = { port?: number }
type DesktopBridge = {
  platform?: string
  getAssistantAccess?: () => Promise<Record<string, string>>
  getBackendStatus?: () => Promise<BackendStatus | null | undefined>
}

function bridge(): DesktopBridge | undefined {
  return (window as unknown as { workbuddyDesktop?: DesktopBridge }).workbuddyDesktop
}

/**
 * 请求的凭据模式：**默认的 `same-origin`，不要改成 `include`**。
 *
 * ── 为什么不能带跨源凭据 ────────────────────────────────────
 * 面板路由回的 CORS 头固定是 `Access-Control-Allow-Origin: *`（见
 * `http::attach_cors`），而按 Fetch 规范，**带凭据的跨源请求遇到 `*` 会被浏览器
 * 直接判为 CORS 失败** —— 表现就是一句 `TypeError: Failed to fetch`，且服务端
 * 日志里什么都看不到（请求其实到过、也回过了）。桌面形态正是跨源
 * （页面 `http://tauri.localhost` → 网关 `http://127.0.0.1:{port}`），
 * 用 `include` 会让助手页一进去就报「加载助手设置失败：Failed to fetch」。
 *
 * ── 为什么也不能是 `omit` ───────────────────────────────────
 * `omit` 是「永远不带凭据」，连**同源**都不带 —— web 形态（面板由网关自己托管、
 * 需要管理员会话）会被这条打成未登录。而 `same-origin` 恰好是两全的那个：
 *   · web 形态同源 → 照常带 cookie，面板会话认证不受影响；
 *   · 桌面形态跨源 → 浏览器自动不带凭据，于是能通过 `*` 的 CORS 检查
 *     （助手仍通过 getAssistantAccess 提供的受限请求头完成鉴权）。
 */
const CREDENTIALS: RequestCredentials = 'same-origin'

/** 当前该用哪个基址发请求（见模块头两条路） */
export async function gatewayBase(force = false): Promise<string> {
  if (cachedBase && !force) return cachedBase
  const api = bridge()
  if (api?.platform === 'web') {
    const origin = typeof window === 'undefined' ? '' : window.location?.origin
    if (origin && origin !== 'null') {
      cachedBase = origin
      return cachedBase
    }
  }
  let port = 0
  try {
    const status = await api?.getBackendStatus?.()
    const value = Number(status?.port)
    if (Number.isFinite(value) && value > 0) port = value
  } catch { /* 壳没就绪：走下面的默认端口路径 */ }
  if (port > 0) {
    cachedBase = `http://127.0.0.1:${port}`
    return cachedBase
  }
  // 端口还没上报（壳仍在启动）：先用默认端口，但**不缓存** —— 下一次调用会
  // 重新问一次壳，端口一就位就自动纠正。缓存住一个猜的端口，会让「面板刚起来
  // 那几秒先点了助手页」变成此后一直打错端口的顽固故障
  return `http://127.0.0.1:${FALLBACK_PORT}`
}

/* ─── 配置读写 ─────────────────────────────────────────────── */

/** 助手配置（与后端 `AssistantConfig::to_value` 同形）。
 *  `model` 是**对外模型名**（与 /v1/models 的 `data[].id` 同一口径：原始 ID 或
 *  映射名都行），不再是「提供商 + 模型」的组合 —— 助手的路由语义与普通客户端
 *  完全一致，同名在多家时按账号优先级主备。 */
export type AssistantConfig = {
  reasoning?: string | null
  model: string | null
  systemPromptEnabled: boolean
  systemPrompt: string
  tools: Record<string, boolean>
}

/**
 * 从助手的统一模型目录组装**对外可请求的模型名列表**（选择器的数据源）。
 *
 * 口径与 `/v1/models` 对齐（那就是客户端能请求的名字）：
 *   · 已启用模型的 ID（默认绑定）；
 *   · 已启用模型之上的**已启用映射名**（用户建的 `ca/xxx` 这类，同样可请求）。
 * `/api/assistant/models` 合并内置与自定义提供商；桌面能力凭据也仅需助手权限。
 */
export async function loadModelNames(): Promise<string[]> {
  const manage = await loadAssistantModels()
  const models = Array.isArray(manage?.models) ? manage.models : []
  const mappings = Array.isArray(manage?.mappings) ? manage.mappings : []
  // 先记「provider×id 是启用的」—— 映射名能不能请求，取决于它指向的模型开没开
  const enabledKeys = new Set<string>()
  const names: string[] = []
  const seen = new Set<string>()
  for (const row of models) {
    if (row.enabled !== true) continue
    const provider = String(row.provider ?? '')
    const id = String(row.id ?? '')
    if (!provider || !id) continue
    enabledKeys.add(`${provider}\u0001${id}`)
    if (!seen.has(id)) { seen.add(id); names.push(id) }
  }
  for (const mapping of mappings) {
    if (mapping.enabled !== true || mapping.isDefault === true) continue
    const provider = String(mapping.provider ?? '')
    const target = String(mapping.target ?? '')
    const alias = String(mapping.alias ?? '')
    if (alias && !seen.has(alias) && enabledKeys.has(`${provider}\u0001${target}`)) {
      seen.add(alias)
      names.push(alias)
    }
  }
  return names
}

/** 内置默认系统提示词（与后端 `DEFAULT_SYSTEM_PROMPT` 逐字相同：编辑弹窗里的
 *  「恢复默认」与「当前是否等于默认」都按这份比对） */
export const DEFAULT_SYSTEM_PROMPT = `你是 Agent2API 的内置助手，帮用户管理本机的模型转发配置。

说话简洁，别铺垫。配置项一律用等宽字写出准确的 ID（模型名、账号名、提供商名），不要用「那个模型」这类含糊说法。

调用改动类工具之前，先用一句话说清将要改动什么；确认卡由界面渲染，不要跳过它直接执行。

拿不准的配置先去读（获取模型列表 / 查询账号余额），不要凭印象改。`

/**
 * 一次管理请求的公共部分（JSON in / JSON out）。
 *
 * ── 信封要自己拆 ────────────────────────────────────────────
 * 管理接口统一回 `{success: true, data: ...}`（失败是 `{success:false, error}`，
 * 见 `http::ok_json`）。走壳的桥那条路已经在 Rust 侧把 `data` 剥出来了，这里
 * 是**直连 HTTP**，所以得自己拆一层 —— 漏拆的话拿到的是信封本身，
 * 表现为「配置读了但全是 undefined」。
 */
/**
 * 错误体 → 可读文本。
 *
 * 管理接口的失败体是 `{success:false, error:"文本"}`，但**没走到的路由**回的是
 * axum 的兜底 404：`{error:{message:"Not found: ..."}}` —— 直接把那个对象塞进
 * `Error` 的 message 只会得到一句 `[object Object]`，所以这里把三种形态都捋一遍。
 */
function describeError(value: unknown, status: number): string {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (value && typeof value === 'object') {
    const message = (value as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message.trim()
    try { return JSON.stringify(value) } catch { /* 循环引用等：走下面的兜底 */ }
  }
  return `HTTP ${status}`
}

/** 把 fetch 的网络层失败包成带网关地址的 Error。
 *  浏览器对连接不上的回应只有一句 `TypeError: Failed to fetch`，不带任何上下文
 *  —— 把「连的是哪个地址」拼进去，用户对着侧栏的网关端口一眼就能看出对不对。 */
function wrapFetchError(error: unknown, base: string): Error {
  const message = error instanceof Error ? error.message : String(error)
  return new Error(`连接网关失败（${base}）：${message}`)
}

export async function callJson<T>(method: string, path: string, body?: unknown): Promise<T> {
  const base = await gatewayBase()
  let response: Response
  try {
    response = await fetch(base + path, {
      method,
      headers: { ...(await bridge()?.getAssistantAccess?.() || {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: CREDENTIALS,
    })
  } catch (error) {
    throw wrapFetchError(error, base)
  }
  const text = await response.text()
  let parsed: unknown = null
  try { parsed = text ? JSON.parse(text) : null } catch { parsed = null }
  const envelope = parsed as { success?: boolean; data?: unknown; error?: unknown } | null
  if (!response.ok || envelope?.success === false) {
    const raw = envelope?.error ?? (parsed as { error?: unknown } | null)?.error
    const message = describeError(raw, response.status)
    // 404 只有一种来源：这一版网关**没有助手接口**（前端比后端新）。把话说全，
    // 否则用户只会看到一句「HTTP 404」去猜是不是自己哪里配错了
    if (response.status === 404 && !path.includes('/conversations/')) {
      throw new Error(`这一版网关还没有 AI 助手接口（HTTP 404）：后端还是旧的，重新编译 / 重启客户端后再试。${message}`)
    }
    throw new Error(message)
  }
  const payload = envelope && typeof envelope === 'object' && 'data' in envelope ? envelope.data : parsed
  return payload as T
}

export async function loadAssistantConfig(): Promise<AssistantConfig> {
  const startedVersion = configVersion
  const data = await callJson<{ config?: AssistantConfig }>('GET', '/api/assistant/config')
  const config = data?.config
  if (!config || typeof config !== 'object') throw new Error('配置响应不完整')
  // model 兼容两种形态：字符串（现行）/ {provider, id}（改成对外名之前存过的）
  const model = typeof config.model === 'string'
    ? config.model
    : (config.model as { id?: unknown } | null)?.id
  const normalized: AssistantConfig = {
    model: typeof model === 'string' && model.trim() ? model : null,
    reasoning: typeof config.reasoning === 'string' ? config.reasoning : null,
    systemPromptEnabled: config.systemPromptEnabled !== false,
    systemPrompt: typeof config.systemPrompt === 'string' ? config.systemPrompt : '',
    tools: config.tools && typeof config.tools === 'object' ? config.tools : {},
  }
  if (startedVersion === configVersion) acceptConfig(normalized)
  return snapshot ?? normalized
}

/** Shared snapshot for the settings and chat islands. Saves are field-scoped and serialized. */
let snapshot: AssistantConfig | null = null
let configVersion = 0
const subscribers = new Set<() => void>()
let saves: Promise<unknown> = Promise.resolve()
function acceptConfig(config: AssistantConfig): void {
  snapshot = config
  subscribers.forEach(fn => fn())
}
export function useAssistantConfig(): AssistantConfig | null {
  return useSyncExternalStore(fn => { subscribers.add(fn); return () => { subscribers.delete(fn) } }, () => snapshot)
}
export function saveAssistantConfig(patch: Partial<AssistantConfig>): Promise<AssistantConfig> {
  configVersion += 1
  const request = saves.catch(() => {}).then(async () => {
    const data = await callJson<{ config: AssistantConfig }>('PATCH', '/api/assistant/config', { config: patch })
    if (!data?.config) throw new Error('Invalid assistant configuration response')
    configVersion += 1
    acceptConfig(data.config)
    return data.config
  })
  saves = request
  return request
}

export type ToolCall = { id: string; name: string; arguments: string }
export async function assistantHeaders(): Promise<Record<string, string>> {
  return await bridge()?.getAssistantAccess?.() || {}
}

export type AssistantCatalog = { models?: Array<Record<string, unknown>>; mappings?: Array<Record<string, unknown>> }
export function loadAssistantModels(): Promise<AssistantCatalog> {
  return callJson<AssistantCatalog>('GET', '/api/assistant/models')
}
