/** Isolated controller regression: no browser storage, requests or real lock state. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../../../ui/js/prefs.js', import.meta.url), 'utf8')
const KEY = 'aibuddy-prefs'
const LOCK_KEY = 'aibuddy-lockscreen-active'

function fixture(initial: Record<string, unknown> = {}, lockFlag = false) {
  const storage = new Map<string, string>([[KEY, JSON.stringify(initial)]])
  if (lockFlag) storage.set(LOCK_KEY, '1')
  const attrs = new Map<string, string>()
  const events = new Map<string, Array<(event: any) => void>>()
  const windowEvents = new Map<string, Array<(event: any) => void>>()
  const toasts: Array<[string, string]> = []
  const themes: string[] = []
  const colors: string[] = []
  const pages: string[] = []
  const writes: string[] = []
  let now = 100_000
  let sequence = 0
  const timers = new Map<number, { at: number; delay: number; interval: boolean; run: () => void }>()
  const schedule = (run: () => void, delay: number, interval = false) => {
    const id = ++sequence
    timers.set(id, { at: now + delay, delay, interval, run })
    return id
  }
  const advance = (duration: number) => {
    const end = now + duration
    while (true) {
      const next = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
      if (!next) break
      const [id, timer] = next
      now = timer.at
      if (timer.interval) timer.at += timer.delay
      else timers.delete(id)
      timer.run()
    }
    now = end
  }
  const nodes = new Map<string, any>()
  const observers: Array<{ node: any; active: boolean; notify: () => void }> = []
  const notifyChildren = (node: any) => { for (const observer of observers) if (observer.active && observer.node === node) observer.notify() }
  const makeNode = (tag: string) => ({
    tag, id: '', className: '', textContent: '', style: {} as Record<string, string>,
    parentNode: null as any, isConnected: false, children: [] as any[],
    setAttribute(name: string, value: string) { if (name === 'id') this.id = value },
    appendChild(node: any) { node.parentNode = this; node.isConnected = true; this.children.push(node); if (node.id) nodes.set(node.id, node); return node },
    insertBefore(node: any, before: any) { node.parentNode = this; node.isConnected = true; this.children.splice(before ? this.children.indexOf(before) : this.children.length, 0, node); if (node.id) nodes.set(node.id, node); return node },
    get firstChild() { return this.children[0] || null },
    removeChild(node: any) { this.children = this.children.filter(item => item !== node); node.parentNode = null; node.isConnected = false; nodes.delete(node.id) },
    remove() { this.parentNode?.removeChild(this) }, select() {},
    querySelector(selector: string) { return selector === '.aibuddy-banner' ? this.children.find(node => node.className === 'aibuddy-banner') || null : null },
    getContext() { return { translate() {}, rotate() {}, fillText() {} } },
    toDataURL() { return 'data:image/png;base64,fixture' },
  })
  const body = makeNode('body')
  body.isConnected = true
  const content = makeNode('main')
  let overview: ReturnType<typeof makeNode> | null = null
  let overviewActive = false
  const document = {
    readyState: 'loading', title: '', body,
    documentElement: { setAttribute: (name: string, value: string) => attrs.set(name, value) },
    getElementById: (id: string) => nodes.get(id) || null,
    querySelector: (selector: string) => selector === '.content-inner' ? content
      : selector === '.page[data-page="overview"]' ? overview
      : selector === '.page[data-page="overview"].active' && overviewActive ? overview : null,
    querySelectorAll: () => [], createElement: makeNode, execCommand: () => true,
    addEventListener(name: string, listener: (event: any) => void) { events.set(name, [...(events.get(name) || []), listener]) },
    dispatchEvent(event: any) { for (const listener of events.get(event.type) || []) listener(event); return true },
  }
  const window: any = {
    addEventListener(name: string, listener: (event: any) => void) { windowEvents.set(name, [...(windowEvents.get(name) || []), listener]) },
    wbToast: { show: (message: string, type: string) => { toasts.push([message, type]); return true } },
    wbTheme: { applyPrimaryColor: (color: string) => colors.push(color) },
    wbApp: {
      applyTheme: (theme: string) => {
        themes.push(theme)
        for (const listener of windowEvents.get('wb:theme') || []) listener({ detail: theme })
      },
      showPage: (page: string) => pages.push(page),
    },
  }
  class FixtureDate extends Date {
    constructor() { super(now) }
    static now() { return now }
  }
  const context = vm.createContext({
    window, document, Date: FixtureDate,
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, String(value)), removeItem: (key: string) => storage.delete(key) },
    navigator: { clipboard: { writeText: async (value: string) => { writes.push(value) }, readText: async () => writes.at(-1) || '' } },
    location: { origin: 'https://fixture.invalid' },
    fetch: () => { throw Error('Network access is forbidden in preference regression') },
    setTimeout: (run: () => void, delay: number) => schedule(run, delay), clearTimeout: (id: number) => timers.delete(id),
    setInterval: (run: () => void, delay: number) => schedule(run, delay, true), clearInterval: (id: number) => timers.delete(id),
    CustomEvent: class { type: string; detail: unknown; constructor(type: string, options: { detail?: unknown } = {}) { this.type = type; this.detail = options.detail } },
    MutationObserver: class {
      entry: typeof observers[number]
      constructor(notify: () => void) { this.entry = { node: null, active: false, notify }; observers.push(this.entry) }
      observe(node: any) { this.entry.node = node; this.entry.active = true }
      disconnect() { this.entry.active = false }
    },
  })
  vm.runInContext(source, context)
  const api = window.wbPrefs
  const boot = () => document.dispatchEvent({ type: 'DOMContentLoaded' })
  const dispatch = (type: string, target: any = {}) => document.dispatchEvent({ type, target })
  const stored = () => JSON.parse(storage.get(KEY) || '{}')
  const json = (value: unknown) => JSON.parse(JSON.stringify(value))
  const createOverview = (hasContent = false) => {
    overview = makeNode('section')
    if (hasContent) overview.appendChild(makeNode('div'))
    return overview
  }
  const mountOverview = () => { overview!.appendChild(makeNode('div')); notifyChildren(overview) }
  const enterOverview = () => { overviewActive = true; dispatch('click', { closest: () => ({ dataset: { page: 'overview' }, querySelector: () => ({ textContent: '用量' }) }) }) }
  return { api, window, document, context, boot, dispatch, storage, stored, attrs, toasts, themes, colors, pages, writes, timers, advance, json, observers, createOverview, mountOverview, enterOverview }
}

test('legacy defaults, unknown fields and independent snapshots survive partial edits', () => {
  const f = fixture({ extension: { keep: true }, lockScreen: { enabled: true, password: 'fixture-only', minutes: 8 } })
  const before = f.api.get()
  before.lockScreen.password = 'mutated-copy'
  assert.equal(f.api.get().lockScreen.password, 'fixture-only')
  f.api.set({ lockScreen: { minutes: 12 }, theme: 'invalid', density: 'invalid', notifyInterval: 999 }, { apply: false })
  assert.deepEqual(f.json(f.api.get().lockScreen), { enabled: true, password: 'fixture-only', minutes: 12 })
  assert.equal(f.api.get().theme, 'system')
  assert.equal(f.api.get().density, 'default')
  assert.equal(f.api.get().notifyInterval, 60)
  assert.equal(f.api.get().isBreadcrumb, true)
  assert.equal(f.api.get().isTagsview, true)
  assert.deepEqual(f.stored().extension, { keep: true })
  assert.equal(f.attrs.size, 0, 'password/minute edits must not trigger full UI application')
})

test('all layout attributes and the shared theme bridge still apply', () => {
  const f = fixture()
  let changes = 0
  f.document.addEventListener('aibuddy-prefs-changed', () => changes++)
  f.api.set({ theme: 'dark', darkSidebar: true, darkTopbar: true, primary: '#123456', contentWidth: 'boxed', density: 'compact', filter: 'gray', pageAnim: 'slide', isBreadcrumb: false, isShowLogo: false, isGroupLabel: false, topbarGradient: true, menuHighlight: true, isTagsview: false })
  assert.deepEqual(Object.fromEntries(f.attrs), {
    'data-theme': 'dark', 'data-pref-sidebar': 'dark', 'data-pref-topbar': 'dark', 'data-pref-width': 'boxed', 'data-pref-density': 'compact',
    'data-pref-layout': 'vertical', 'data-pref-filter': 'gray', 'data-pref-anim': 'slide', 'data-pref-crumb': 'off', 'data-pref-logo': 'off',
    'data-pref-grouplabel': 'off', 'data-pref-topbar-grad': 'on', 'data-pref-navhl': 'on', 'data-pref-tags': 'off',
  })
  assert.deepEqual(f.themes, ['dark'])
  assert.deepEqual(f.colors, ['#123456'])
  assert.equal(changes, 1, 'the shared theme event must not recurse')
  assert.equal(f.api.selectLayout('classic'), false)
  assert.equal(f.stored().layout, 'vertical')
  assert.deepEqual(f.toasts.at(-1), ['该布局形态即将支持', 'ok'])
})

test('persisted lock restores, rejects a wrong password and only clears after correct unlock', () => {
  const f = fixture({ lockScreen: { enabled: true, password: 'fixture-only', minutes: 2 } }, true)
  f.boot()
  assert.equal(f.api.isLocked(), true)
  assert.equal(f.api.tryUnlock('wrong'), false)
  assert.equal(f.api.isLocked(), true)
  assert.equal(f.storage.get(LOCK_KEY), '1')
  assert.equal(f.api.getSnapshot().lockError, '密码不正确，请重试')
  assert.equal(f.api.getSnapshot().lockAttempt, 1)
  f.api.open(); f.api.search()
  assert.equal(f.api.getSnapshot().drawerOpen, false)
  assert.equal(f.api.getSnapshot().searchOpen, false)
  assert.equal(f.api.tryUnlock('fixture-only'), true)
  assert.equal(f.api.isLocked(), false)
  assert.equal(f.storage.has(LOCK_KEY), false)
  assert.equal(f.api.getSnapshot().lockError, '')
  assert.equal([...f.timers.values()].some(timer => timer.delay === 120_000 && !timer.interval), true)
})

test('empty password permits direct unlock and disabled or zero-minute idle lock schedules nothing', () => {
  const f = fixture({ lockScreen: { enabled: false, password: '', minutes: 5 } })
  f.boot()
  assert.equal([...f.timers.values()].some(timer => timer.delay === 300_000), false)
  f.api.lock()
  assert.equal(f.api.tryUnlock(''), true)
  f.api.set({ lockScreen: { enabled: true, minutes: 0 } })
  f.advance(90_000)
  assert.equal(f.api.isLocked(), false)
  assert.equal(f.storage.has(LOCK_KEY), false)
})

test('activity resets the idle lock with the existing ten-second throttle', () => {
  const f = fixture({ lockScreen: { enabled: true, password: '', minutes: 1 } })
  f.boot()
  f.advance(12_000)
  f.dispatch('mousemove')
  f.advance(5_000)
  f.dispatch('keydown')
  f.advance(54_999)
  assert.equal(f.api.isLocked(), false)
  f.advance(1)
  assert.equal(f.api.isLocked(), true, 'throttled keydown must not extend the last activity timer')
  assert.equal(f.storage.get(LOCK_KEY), '1')
})

test('import, reset, external settings and theme updates share storage without losing defaults', () => {
  const f = fixture({ primary: '#123456' })
  assert.equal(f.api.importPreferences('{bad'), false)
  assert.equal(f.stored().primary, '#123456')
  assert.equal(f.api.importPreferences(JSON.stringify({ lockScreen: { enabled: true, password: 'fixture-only', minutes: 9000 }, notifyInterval: 0 })), true)
  assert.equal(f.api.get().lockScreen.minutes, 1440)
  assert.equal(f.api.get().notifyInterval, 1)
  f.api.reset()
  assert.deepEqual(f.json(f.api.get().lockScreen), { enabled: false, password: '', minutes: 0 })
  assert.equal(f.api.get().theme, 'system')
  const external = { ...f.stored(), density: 'relaxed', theme: 'light' }
  f.storage.set(KEY, JSON.stringify(external))
  f.document.dispatchEvent({ type: 'aibuddy-prefs-changed', detail: external })
  assert.equal(f.api.getSnapshot().prefs.density, 'relaxed')
  f.window.wbApp.applyTheme('dark')
  assert.equal(f.api.getSnapshot().prefs.theme, 'dark')
  assert.equal(f.stored().density, 'relaxed')
})

test('search navigation, clipboard and progress retain their existing routes and timing', async () => {
  const f = fixture()
  f.api.open(); assert.equal(f.api.getSnapshot().drawerOpen, true)
  f.api.close(); assert.equal(f.api.getSnapshot().drawerOpen, false)
  f.api.search(); assert.equal(f.api.getSnapshot().searchOpen, true)
  f.api.go('requests')
  assert.deepEqual(f.pages, ['requests'])
  assert.equal(f.storage.get('workbuddy-desktop-page'), 'requests')
  assert.equal(f.api.getSnapshot().searchOpen, false)
  await f.api.copy()
  assert.equal(JSON.parse(f.writes.at(-1) || '').theme, 'system')
  f.api.copyGatewayLink()
  await Promise.resolve()
  assert.equal(f.writes.at(-1), 'https://fixture.invalid/v1')
  const nav = { closest: () => ({ dataset: { page: 'requests' } }) }
  f.dispatch('click', nav)
  assert.equal(f.api.getSnapshot().progress, 30)
  f.advance(80); assert.equal(f.api.getSnapshot().progress, 82)
  f.advance(220); assert.equal(f.api.getSnapshot().progress, 100)
  f.dispatch('click', nav)
  f.advance(260)
  assert.equal(f.api.getSnapshot().progressVisible, true, 'the earlier completion timer must not hide the new navigation progress')
  f.advance(300)
  assert.equal(f.api.getSnapshot().progressVisible, false)
  f.api.set({ progressbar: false })
  f.dispatch('click', nav)
  assert.equal(f.api.getSnapshot().progressVisible, false)
})

test('subscribers receive fresh snapshots and can unsubscribe', () => {
  const f = fixture()
  const before = f.api.getSnapshot()
  assert.equal(f.api.getSnapshot(), before)
  let count = 0
  const unsubscribe = f.api.subscribe(() => count++)
  f.api.set({ watermarkText: 'fixture' }, { apply: false })
  assert.notEqual(f.api.getSnapshot(), before)
  assert.equal(count, 1)
  unsubscribe()
  f.api.set({ watermarkText: 'next' }, { apply: false })
  assert.equal(count, 1)
})

test('watermark, footer and dynamic title keep their page side effects', () => {
  const f = fixture()
  f.window.__aibuddyTitleBase = { brand: 'Fixture gateway', currentPage: '请求日志' }
  f.api.set({ watermark: true, watermarkText: 'Fixture', isFooter: true, dynamicTitle: true })
  const watermark = f.document.getElementById('pref-watermark')
  assert.ok(watermark)
  assert.equal(watermark.style.backgroundImage, 'url(data:image/png;base64,fixture)')
  assert.ok(f.document.getElementById('pref-footer'))
  assert.equal(f.document.title, '请求日志 · Fixture gateway')
  f.api.set({ watermark: false, isFooter: false, dynamicTitle: false })
  assert.equal(f.document.getElementById('pref-watermark'), null)
  assert.equal(f.document.getElementById('pref-footer'), null)
  assert.equal(f.document.title, 'Fixture gateway')
})

test('footer update check keeps its version fallback and ignores duplicate clicks while busy', async () => {
  const f = fixture()
  const requests: string[] = []
  f.context.fetch = async (path: string) => {
    requests.push(path)
    return { ok: true, json: async () => ({ data: path === '/api/update/status'
      ? { currentVersion: '1.2.3' }
      : { hasUpdate: true, latestVersion: '1.2.4' } }) }
  }
  f.api.checkUpdate()
  f.api.checkUpdate()
  assert.equal(f.api.getSnapshot().footerBusy, true)
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.deepEqual(requests, ['/api/update/status', '/api/update/check?current=1.2.3'])
  assert.equal(f.api.getSnapshot().footerBusy, false)
  assert.deepEqual(f.toasts.at(-1), ['发现新版本 v1.2.4，可在 设置→更新 下载', 'ok'])
})

test('welcome banner mounts on an inactive overview and remains after a late page visit', async () => {
  const f = fixture()
  const overview = f.createOverview(true)
  const requests: string[] = []
  f.context.fetch = async (path: string) => {
    requests.push(path)
    return { ok: true, json: async () => ({ data: { database: { available: true, accounts: 4, requests: 23 } } }) }
  }
  f.boot()
  const banner = overview.querySelector('.aibuddy-banner')
  assert.ok(banner, 'already mounted overview gets a banner even when the initial page is accounts')
  assert.equal(f.api.getSnapshot().bannerHost, banner)
  assert.equal(f.observers.some(observer => observer.active), false, 'mounted content needs no watcher')
  f.advance(45_000)
  f.enterOverview()
  assert.equal(overview.firstChild, banner)
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.deepEqual(requests, ['/api/storage'])
  assert.deepEqual(f.json(f.api.getSnapshot().pool), { accounts: 4, requests: 23 })
})

test('welcome banner waits for a first overview render beyond thirty seconds without polling', async () => {
  const f = fixture()
  const overview = f.createOverview()
  let reads = 0
  f.context.fetch = async () => { reads++; return { ok: true, json: async () => ({ data: { database: { available: true, accounts: 0, requests: 0 } } }) } }
  f.boot()
  assert.equal(overview.querySelector('.aibuddy-banner'), null)
  assert.equal(f.observers.filter(observer => observer.active).length, 1)
  assert.equal([...f.timers.values()].some(timer => timer.interval), false, 'waiting for the report must not start a poll')
  f.advance(45_000)
  f.mountOverview()
  const banner = overview.querySelector('.aibuddy-banner')
  assert.ok(banner)
  assert.equal(f.observers.some(observer => observer.active), false, 'disconnect immediately after the first banner is inserted')
  f.enterOverview()
  f.mountOverview()
  assert.equal(overview.querySelector('.aibuddy-banner'), banner)
  assert.equal(overview.children.filter(node => node.className === 'aibuddy-banner').length, 1)
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.equal(reads, 1)
})
