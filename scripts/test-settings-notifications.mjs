// Render both real React views against the real controller, including late startup.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
const root = path.resolve(new URL('..', import.meta.url).pathname)
const islands = path.join(root, 'desktop-tauri/ui-islands')
const require = createRequire(path.join(islands, 'package.json'))
const { buildSync } = require('esbuild')
const { JSDOM } = require('jsdom')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent2api-notify-sync-'))
let dom
try {
  const output = path.join(temp, 'fixture.cjs')
  buildSync({ stdin: { contents: `import * as React from 'react'; import { createRoot } from 'react-dom/client'; import './src/islands/shell-notifications'; import { NotificationSettingsCard } from './src/islands/settings-notifications'; export { React, createRoot, NotificationSettingsCard };`, loader: 'tsx', resolveDir: islands },
    bundle: true, platform: 'node', format: 'cjs', outfile: output, jsx: 'automatic',
    alias: { '@ui/navigation-icons': path.join(root, 'desktop-tauri/ui-kit/src/navigation-icons.ts'), '@ui': path.join(root, 'desktop-tauri/ui-kit/src/index.ts'), react: path.dirname(require.resolve('react/package.json')), 'react-dom': path.dirname(require.resolve('react-dom/package.json')) },
    nodePaths: [path.join(islands, 'node_modules'), path.join(root, 'desktop-tauri/ui-kit/node_modules')], logLevel: 'silent' })
  dom = new JSDOM('<!doctype html><html><body><header><div id="topbar-status"></div></header><main id="settings"></main></body></html>', { url: 'http://localhost/' })
  for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'MutationObserver', 'HTMLButtonElement', 'HTMLInputElement', 'SVGElement', 'ShadowRoot', 'NodeFilter']) globalThis[key] = dom.window[key]
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
  globalThis.localStorage = dom.window.localStorage
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window)
  globalThis.requestAnimationFrame = callback => setTimeout(callback, 0)
  globalThis.cancelAnimationFrame = clearTimeout
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  dom.window.Element.prototype.getAnimations = () => []
  window.ResizeObserver = globalThis.ResizeObserver
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  window.wbI18n = { t: (text, vars = {}) => text.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? `{${key}}`)) }
  const notices = []
  window.wbApp = { toast: (...args) => notices.push(args) }
  localStorage.setItem('aibuddy-notify-read', JSON.stringify({ id: 1, ts: 1700000000000 }))
  const { React, createRoot, NotificationSettingsCard } = require(output)
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  let mounted = createRoot(document.getElementById('settings'))
  const render = async () => React.act(async () => mounted.render(React.createElement(NotificationSettingsCard)))
  const click = async id => React.act(async () => document.getElementById(id).dispatchEvent(new MouseEvent('click', { bubbles: true })))
  const settingsCount = () => document.getElementById('shell-notify-unread').textContent
  const bellLabel = () => document.getElementById('nc-btn-bell').getAttribute('aria-label')
  await render()
  assert.equal(settingsCount(), '连接中', 'missing controller is a loading state, not a stale cached count')
  assert.equal(document.getElementById('btn-shell-notify-refresh').disabled, true)

  const requests = [], timeouts = new Map(), intervals = new Map()
  let timerId = 0
  const setTimer = (map, callback, delay) => { map.set(++timerId, { callback, delay }); return timerId }
  const context = vm.createContext({ window, document, localStorage, MutationObserver, AbortController, Event, console,
    setTimeout: (callback, delay) => setTimer(timeouts, callback, delay), clearTimeout: id => timeouts.delete(id),
    setInterval: (callback, delay) => setTimer(intervals, callback, delay), clearInterval: id => intervals.delete(id),
    fetch: (url, options) => new Promise((resolve, reject) => requests.push({ url, options, resolve, reject })),
  })
  await React.act(async () => {
    vm.runInContext(fs.readFileSync(path.join(root, 'desktop-tauri/ui/js/notify-center.js'), 'utf8'), context)
    if (!document.getElementById('nc-btn-bell')) document.dispatchEvent(new Event('DOMContentLoaded'))
  })
  const center = window.wbNotifyCenter
  assert.equal(settingsCount(), '0 条', 'late controller ready event connects the existing settings view')
  assert.equal(bellLabel(), '通知中心')
  assert.equal(intervals.size, 1, 'both views use only the controller polling timer')
  assert.equal(requests.length, 0, 'subscribing never creates a request')
  const respond = async items => React.act(async () => {
    requests.at(-1).resolve({ ok: true, json: async () => ({ data: { entries: items } }) })
    for (let i = 0; i < 12; i++) await Promise.resolve()
  })
  const event = (id, level = 'warn') => ({ id, ts: 1700000000 + id, level, message: `event ${id}` })
  await click('btn-shell-notify-refresh')
  assert.equal(requests.length, 1, 'settings refresh calls the actual shared fetch')
  assert.equal(document.getElementById('btn-shell-notify-refresh').disabled, true)
  await respond([event(2), event(3, 'error'), event(4, 'info')])
  assert.equal(settingsCount(), '2 条')
  assert.match(bellLabel(), /2 条未读/)
  assert.equal(document.getElementById('btn-shell-notify-refresh').disabled, false)
  const cachedItems = center.getSnapshot().items
  await click('btn-shell-notify-reset')
  assert.equal(settingsCount(), '0 条', 'mark read publishes immediately without a delay timer')
  assert.equal(bellLabel(), '通知中心')
  assert.equal(requests.length, 1, 'mark read does not depend on a successful refetch')
  assert.deepEqual(center.getSnapshot().items, cachedItems, 'mark read never deletes events')
  assert.equal(document.getElementById('btn-shell-notify-reset').disabled, true)
  assert.ok(![...timeouts.values()].some(timer => timer.delay === 2000), 'no guessed two-second synchronization timeout')

  await click('btn-shell-notify-refresh')
  await respond([event(5, 'error')])
  assert.equal(settingsCount(), '1 条')
  assert.match(bellLabel(), /1 条未读/)
  await click('btn-shell-notify-refresh')
  await click('btn-shell-notify-reset')
  assert.equal(settingsCount(), '0 条')
  await respond([event(6)])
  assert.equal(settingsCount(), '1 条', 'a new event arriving after mark-read remains unread')
  assert.match(bellLabel(), /1 条未读/)

  await click('btn-shell-notify-refresh')
  await React.act(async () => { requests.at(-1).reject(new Error('offline')); for (let i = 0; i < 12; i++) await Promise.resolve() })
  assert.equal(settingsCount(), '1 条', 'failed refresh preserves the shared unread value')
  assert.match(bellLabel(), /1 条未读/)
  assert.equal(document.getElementById('btn-shell-notify-refresh').disabled, false)

  await click('btn-shell-notify-open')
  assert.equal(center.getSnapshot().open, true)
  assert.equal(settingsCount(), '0 条')
  assert.equal(bellLabel(), '通知中心')
  assert.ok(document.getElementById('nc-pop'), 'settings opens the actual bell Popover')
  await respond([event(7, 'error')])
  assert.equal(settingsCount(), '0 条', 'events arriving while the notification center is open are read in both views')
  await React.act(async () => center.close())
  await click('btn-shell-notify-refresh')
  await respond([event(8)])
  assert.equal(settingsCount(), '1 条')
  await click('nc-btn-bell')
  assert.equal(center.getSnapshot().open, true)
  assert.equal(settingsCount(), '0 条', 'opening from the bell also updates the settings view')
  await respond([event(9)])
  await React.act(async () => center.close())

  await React.act(async () => mounted.unmount())
  await React.act(async () => center.refresh())
  await respond([event(10, 'error')])
  assert.match(bellLabel(), /1 条未读/, 'bell continues to update after settings is unmounted')
  let subscribers = 0
  const originalSubscribe = center.subscribe
  center.subscribe = callback => { subscribers++; const stop = originalSubscribe(callback); return () => { subscribers--; stop() } }
  mounted = createRoot(document.getElementById('settings'))
  await render()
  assert.equal(settingsCount(), '1 条', 'mounting after the controller uses the current snapshot')
  assert.equal(subscribers, 1)
  await React.act(async () => document.dispatchEvent(new Event('wb:notify-center-ready')))
  assert.equal(subscribers, 1, 'repeated ready does not duplicate subscriptions')
  await React.act(async () => mounted.unmount())
  assert.equal(subscribers, 0, 'unmount releases the shared subscription')
  assert.equal(intervals.size, 1)
  assert.equal(notices.length, 2)
  console.log('PASS: actual bell and settings share late-ready snapshots, unread updates, open/mark-read, concurrent arrival, failures, refresh, one poller and subscription cleanup')
} finally {
  dom?.window.close()
  fs.rmSync(temp, { recursive: true, force: true })
}
// React browser Scheduler and the other mounted root retain a MessageChannel in Node.
process.exit(0)
