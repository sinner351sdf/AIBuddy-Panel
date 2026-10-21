declare const __AIBUDDY_FEATURE_VERSION__: string
import { apiCall, readApiKey, readPanelAuth } from '../api/client'
import { store } from '../state/store'
import { isPackaged } from './servers'
export type MobileFeatureOptions = { page: string; action?: string; id?: string; close: () => void; navigate: (page: string, action?: string, id?: string) => void }
type FeatureApi = { mount(host: HTMLElement, options: MobileFeatureOptions): () => void }
type Runtime = { workbuddyDesktop?: { getAssistantAccess?: () => Promise<Record<string,string>> }; wbMobileHttp?: (method: string, path: string, body?: unknown) => Promise<unknown>; wbMobileFeatures?: FeatureApi; wbApp?: Record<string, unknown>; wbAccountsView?: { render?: () => void; syncBalancesSnapshot?: () => Promise<unknown> } }
let loading: Promise<FeatureApi> | undefined
const scripts = new Map<string, Promise<void>>()
const featureVersion = typeof __AIBUDDY_FEATURE_VERSION__ === 'string' ? __AIBUDDY_FEATURE_VERSION__ : 'dev'
const versioned = (url: string) => url + '?v=' + featureVersion
function script(src: string): Promise<void> {
  const existing = scripts.get(src)
  if (existing) return existing
  const pending = new Promise<void>((resolve, reject) => {
    const node = document.createElement('script')
    node.src = versioned(src); node.onload = () => resolve()
    node.onerror = () => { node.remove(); reject(new Error('加载失败：' + src)) }
    document.head.append(node)
  }).catch(error => { scripts.delete(src); throw error })
  scripts.set(src, pending)
  return pending
}
function stylesheet(asset: string): Promise<void> {
  const href = versioned(asset)
  return new Promise((resolve, reject) => {
    if (document.querySelector(`link[href="${href}"]`)) { resolve(); return }
    const node = document.createElement('link')
    node.rel = 'stylesheet'; node.href = href; node.onload = () => resolve()
    node.onerror = () => { node.remove(); reject(new Error('加载失败：' + href)) }
    document.head.append(node)
  })
}
export function mobileFeatureRequest(method: string, path: string, body?: unknown): Promise<unknown> {
  if (!path.startsWith('/api/')) return Promise.reject(new Error('只允许当前网关的管理接口'))
  if (method !== 'GET' && method !== 'POST' && method !== 'PUT' && method !== 'PATCH' && method !== 'DELETE') return Promise.reject(new Error('不支持的请求方法'))
  return apiCall(path, { method, body: body == null ? undefined : body })
}
export async function mobileAssistantAccess(): Promise<Record<string,string>> {
  await apiCall('/api/assistant/config')
  const headers: Record<string,string> = {}, key = readApiKey(), access = readPanelAuth()?.access
  if (key) headers['x-api-key'] = key
  if (access) { headers['x-panel-token'] = access; headers.Authorization = 'Bearer ' + access }
  return headers
}
export function loadFeatures(): Promise<FeatureApi> {
  if (loading) return loading
  loading = (async () => {
    if (isPackaged()) throw new Error('请先打开本机网关或远程服务')
    const runtime = window as unknown as Runtime
    document.documentElement.dataset.mobileUi = 'true'
    runtime.wbApp = {
      getState: () => store.get().session,
      get currentPage() { const route = store.get().route; return route.params?.page || route.screen },
      refresh: async () => { await store.refresh(true); runtime.wbAccountsView?.render?.() },
      toast: (message: string, tone?: string) => store.toast(message, tone === 'err' ? 'err' : 'ok'),
      esc: (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] || c)),
      formatTime: (value: unknown) => new Date(Number(value)).toLocaleString(),
      applyTheme: (mode: string) => { if (['system','light','dark'].includes(mode)) store.setTheme(mode as 'system'|'light'|'dark') },
      showPage: (page: string) => store.push('management', { page, title: page }),
    }
    runtime.wbMobileHttp = mobileFeatureRequest
    // One canonical HTTP transport; no desktop shell, iframe, or native JS interface.
    await script('/m-feature-bridge.js')
    if (runtime.workbuddyDesktop) runtime.workbuddyDesktop.getAssistantAccess = mobileAssistantAccess
    await stylesheet('/m-features.css')
    await script('/islands/ui.js')
    for (const name of ['theme.js','i18n.js','icons.js','units.js','filter-memory.js','providers.js','preset-providers.js','clipboard.js','web-login.js','sms-login.js','aliyun-captcha.js','autoclaw-oauth.js','zcode-claim.js','codearts-welfare.js','zcode-captcha-pool.js','custom-provider-ui.js','markdown.js','js/prefs.js','js/notify-center.js']) await script('/' + name)
    if (!runtime.wbMobileFeatures) throw new Error('手机功能组件未加载，请重试')
    let lastSnapshot = store.get().balancesSnapshot
    store.subscribe(() => {
      runtime.wbAccountsView?.render?.()
      if (lastSnapshot !== store.get().balancesSnapshot) { lastSnapshot = store.get().balancesSnapshot; void runtime.wbAccountsView?.syncBalancesSnapshot?.() }
    })
    await runtime.wbAccountsView?.syncBalancesSnapshot?.()
    return runtime.wbMobileFeatures
  })().catch(error => { loading = undefined; throw error })
  return loading
}
