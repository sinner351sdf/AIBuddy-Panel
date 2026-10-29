/**
 * 移动端与网关之间的 HTTP 客户端。
 *
 * ── 两种运行形态，一套代码 ────────────────────────────────────
 *   · **PWA / 浏览器**：页面由网关出，`/api/*` 是同源相对路径，服务端用
 *     HttpOnly cookie 认会话 —— 与桌面网页端完全一致。
 *   · **APK**：界面打进包里，页面 origin 是 `http://localhost`，请求网关
 *     必然跨源。跨源请求浏览器不会带 cookie，所以必须显式把令牌放进请求头
 *     （`x-panel-token` / `x-panel-refresh`），并且登录时要让服务端把令牌
 *     放进响应体（`x-panel-auth-mode: body`，见服务端 `tokens_in_body`）。
 *
 * 两条路径的差别只在「地址怎么拼」与「令牌从哪来」，收敛在 `request()`
 * 一处，业务层不必区分。
 *
 * ── 凭证按服务器隔离 ──────────────────────────────────────────
 * 见 lib/servers.ts：令牌是按服务器签发的，混着存会让切换后立刻 401。
 *
 * ── 401 的两种语义 ────────────────────────────────────────────
 *   · `error.type === 'panel_login_required'` → 管理员已注册但会话没了：
 *     先静默 refresh，失败才交给界面弹登录；
 *   · 其余 401 → 兼容模式没配 Key：交给界面提示输入。
 */

import {
  activeServerId,
  apiBase,
  clearServerAuth,
  isPackaged,
  readServerAuth,
  readServerKey,
  storeServerAuth,
  storeServerKey,
  type PanelAuth,
} from '../lib/servers'

/** 管理 API 的统一错误 */
export class ApiError extends Error {
  status: number
  /** 后端 `error.type`（`panel_login_required` 之类），没有则为空串 */
  type: string
  constructor(message: string, status: number, type = '') {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.type = type
  }
}

/** 把相对路径拼成完整地址（PWA 下原样返回，交给浏览器按同源处理） */
export function url(path: string): string {
  if (!isPackaged()) return path
  const base = apiBase()
  if (!base) throw new ApiError('还没有配置服务器地址', 0)
  return `${base}${path}`
}

export function readApiKey(): string {
  return readServerKey(activeServerId())
}

export function storeApiKey(value: string): void {
  storeServerKey(activeServerId(), value)
}

export function readPanelAuth(): PanelAuth | null {
  return readServerAuth(activeServerId())
}

export function storePanelTokens(access: string, refresh: string): void {
  storeServerAuth(activeServerId(), access, refresh)
  invalidatePanelSession()
}

export function clearPanelAuth(): void {
  clearServerAuth(activeServerId())
  invalidatePanelSession()
}

/** 会话是否还有效（只用于界面提示，不阻塞渲染） */
export function hasStoredCredential(): boolean {
  const auth = readPanelAuth()
  return Boolean(readApiKey() || auth?.access)
}

/** 401 时由界面接管（弹登录 / 输入 Key）；客户端自己不做跳转 */
let onAuthLost: ((mode: 'login' | 'key') => void) | null = null
export function setAuthLostHandler(handler: ((mode: 'login' | 'key') => void) | null): void {
  onAuthLost = handler
}

type PanelSession = {
  key: string
  serverId: string
  base: string
  auth: PanelAuth | null
  apiKey: string
  version: number
  refresh?: Promise<boolean>
  refreshFailed: boolean
  loginLost: boolean
  keyLost: boolean
}

const panelSessions = new Map<string, PanelSession>()

function panelSession(): PanelSession {
  const serverId = activeServerId()
  const base = apiBase()
  const key = JSON.stringify([serverId, base])
  const auth = readServerAuth(serverId)
  const apiKey = readServerKey(serverId)
  let session = panelSessions.get(key)
  if (!session || session.auth?.access !== auth?.access || session.auth?.refresh !== auth?.refresh || session.apiKey !== apiKey) {
    session = {
      key, serverId, base: isPackaged() ? base : '', auth, apiKey,
      version: 0, refreshFailed: false, loginLost: false, keyLost: false,
    }
    panelSessions.set(key, session)
  }
  return session
}

/** 登录 / 退出开始时废弃旧请求的快照，防止迟到的续期覆盖新会话。 */
export function invalidatePanelSession(): void {
  panelSessions.delete(panelSession().key)
}

function isCurrentSession(session: PanelSession): boolean {
  return panelSession() === session
}

function buildHeaders(session: PanelSession): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (session.apiKey) headers['x-api-key'] = session.apiKey
  const auth = session.auth
  if (auth?.access) {
    headers['x-panel-token'] = auth.access
    // Authorization 是标准头：连自定义头都剥的中转也会放它过去
    headers.Authorization = `Bearer ${auth.access}`
  }
  return headers
}

/** 一条会话共享一次续期；请求取消不能撤销其他请求正在等待的轮换。 */
function tryRefresh(session: PanelSession): Promise<boolean> {
  if (session.refreshFailed || session.loginLost || !isCurrentSession(session)) return Promise.resolve(false)
  if (session.refresh) return session.refresh
  session.refresh = refreshSession(session).then(success => {
    session.refreshFailed = !success
    return success
  }).finally(() => { session.refresh = undefined })
  return session.refresh
}

async function refreshSession(session: PanelSession): Promise<boolean> {
  const auth = session.auth
  const headers = buildHeaders(session)
  if (auth?.refresh) {
    headers['x-panel-refresh'] = auth.refresh
    // 要求令牌进响应体：APK 下没有可用的 cookie 通道，只认 body
    headers['x-panel-auth-mode'] = 'body'
  }
  try {
    const response = await fetch(`${session.base}/api/panel/refresh`, {
      method: 'POST',
      headers,
      body: '{}',
    })
    if (!response.ok) return false
    const payload = await response.json().catch(() => null)
    if (payload?.success === false) return false
    const data = payload?.data
    if (!isCurrentSession(session)) return false
    const hasTokens = typeof data?.accessToken === 'string' && data.accessToken.length > 0
      && typeof data?.refreshToken === 'string' && data.refreshToken.length > 0
    if (auth?.refresh && !hasTokens) return false
    if (hasTokens) {
      storeServerAuth(session.serverId, data.accessToken, data.refreshToken)
      session.auth = readServerAuth(session.serverId)
    }
    // Cookie 不可读，必须另外记录轮换版本，让迟到的旧 401 使用新 Cookie 重试。
    session.version += 1
    return true
  } catch {
    return false
  }
}

function waitForRefresh(refresh: Promise<boolean>, signal?: AbortSignal): Promise<boolean> {
  if (!signal) return refresh
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason)
    signal.addEventListener('abort', aborted, { once: true })
    refresh.then(value => {
      signal.removeEventListener('abort', aborted)
      resolve(value)
    }, error => {
      signal.removeEventListener('abort', aborted)
      reject(error)
    })
  })
}

function reportAuthLost(session: PanelSession, mode: 'login' | 'key'): void {
  if (!isCurrentSession(session)) return
  if (mode === 'login') {
    if (session.loginLost) return
    session.loginLost = true
    clearServerAuth(session.serverId)
    session.auth = null
  } else {
    if (session.keyLost) return
    session.keyLost = true
  }
  onAuthLost?.(mode)
}

type RequestInitLite = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  /** 不触发 401 接管（探活类请求用） */
  quiet?: boolean
  signal?: AbortSignal
}

/**
 * 发一条管理 API 请求并解开 `{success, data}` 信封。
 *
 * 返回值是 `data` 本身；失败抛 {@link ApiError}，取消保留 AbortSignal 的原因。
 */
export async function apiCall<T = unknown>(path: string, init: RequestInitLite = {}): Promise<T> {
  const requestUrl = url(path)
  const session = panelSession()
  // 每个原请求最多重发一次，刷新成功后仍是 401 时不能递归续期。
  for (let attempt = 0; attempt < 2; attempt += 1) {
    init.signal?.throwIfAborted()
    const version = session.version
    const method = init.method || 'GET'
    const headers = buildHeaders(session)
    const requestInit: RequestInit = { method, headers, signal: init.signal }
    if (init.body !== undefined || method !== 'GET') {
      headers['Content-Type'] = 'application/json'
      requestInit.body = JSON.stringify(init.body ?? {})
    }

    let response: Response
    try {
      response = await fetch(requestUrl, requestInit)
    } catch (error) {
      init.signal?.throwIfAborted()
      throw new ApiError(`无法连接网关：${error instanceof Error ? error.message : String(error)}`, 0)
    }

    const text = await response.text()
    init.signal?.throwIfAborted()
    let payload: unknown = null
    try {
      payload = text ? JSON.parse(text) : null
    } catch {
      throw new ApiError(text.trim() || `网关返回了空响应（HTTP ${response.status}）`, response.status)
    }

    if (response.status === 401 && !init.quiet && isCurrentSession(session)) {
      const type = readErrorType(payload)
      if (type === 'panel_login_required') {
        if (attempt === 0) {
          const refreshed = session.version !== version || await waitForRefresh(tryRefresh(session), init.signal)
          init.signal?.throwIfAborted()
          if (refreshed && isCurrentSession(session)) continue
        }
        reportAuthLost(session, 'login')
      } else {
        reportAuthLost(session, 'key')
      }
    }

    const envelope = payload as { success?: boolean; data?: unknown; error?: unknown } | null
    const ok = response.status >= 200 && response.status < 300
    const failed = envelope?.success === false
    if (!ok || failed) {
      throw new ApiError(errorMessage(envelope?.error, response.status), response.status, readErrorType(payload))
    }
    return (envelope && 'data' in envelope ? envelope.data : envelope) as T
  }
  throw new ApiError('登录会话已失效', 401, 'panel_login_required')
}

function readErrorType(payload: unknown): string {
  const error = (payload as { error?: unknown } | null)?.error
  if (error && typeof error === 'object' && 'type' in error) {
    const type = (error as { type?: unknown }).type
    return typeof type === 'string' ? type : ''
  }
  return ''
}

function errorMessage(error: unknown, status: number): string {
  if (typeof error === 'string' && error) return error
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message) return message
  }
  return `HTTP ${status}`
}

/** 探活：不带凭证也能打（`/health` 免鉴权） */
export async function ping(): Promise<boolean> {
  try {
    const response = await fetch(url('/health'), { headers: { Accept: 'application/json' } })
    return response.ok
  } catch {
    return false
  }
}

/** 探活并带回版本信息（配置服务器时用，能顺便显示是不是本产品） */
export async function probe(base: string): Promise<{ ok: boolean; version?: string }> {
  try {
    const response = await fetch(`${base}/health`, { headers: { Accept: 'application/json' } })
    if (!response.ok) return { ok: false }
    const payload = (await response.json().catch(() => null)) as { version?: string; data?: { version?: string } } | null
    return { ok: true, version: payload?.version || payload?.data?.version }
  } catch {
    return { ok: false }
  }
}

/** 面板登录状态（决定「登录」还是「创建管理员」） */
export type PanelStatus = { registered?: boolean; captchaEnabled?: boolean }
export async function panelStatus(): Promise<PanelStatus> {
  const response = await fetch(url('/api/panel/status'), { headers: { Accept: 'application/json' } })
  const payload = (await response.json().catch(() => null)) as { data?: PanelStatus } | null
  return payload?.data || {}
}
