// Exercise the real report with backend-shaped responses; no live requests or account mutations.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
const root = path.resolve(new URL('..', import.meta.url).pathname)
const islands = root + '/desktop-tauri/ui-islands'
const require = createRequire(islands + '/package.json')
const { buildSync } = require('esbuild'), { JSDOM } = require('jsdom')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'a2a-report-'))
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/m#report', pretendToBeVisual: true })
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'MouseEvent', 'KeyboardEvent', 'Event', 'MutationObserver', 'HTMLButtonElement', 'HTMLInputElement', 'SVGElement', 'ShadowRoot', 'NodeFilter', 'DocumentFragment', 'localStorage', 'location', 'history']) globalThis[key] = dom.window[key]
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
window.wbI18n = { t: (text, vars = {}) => text.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? `{${key}}`)) }
globalThis.getComputedStyle = window.getComputedStyle.bind(window)
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0)
globalThis.cancelAnimationFrame = clearTimeout
HTMLElement.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 350, bottom: 208, width: 350, height: 208 })
globalThis.ResizeObserver = window.ResizeObserver = class {
  constructor(callback) { this.callback = callback }
  observe(target) { this.callback([{ target, contentRect: target.getBoundingClientRect() }]) }
  unobserve() {} disconnect() {}
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const calls = [], intervals = new Map()
let timerId = 0
window.setInterval = callback => { intervals.set(++timerId, callback); return timerId }
window.clearInterval = id => intervals.delete(id)
globalThis.fetch = async (url, options = {}) => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  calls.push({ url: String(url), options, resolve: data => resolve(Response.json({ success: true, data })), reject })
  // Intentionally ignore abort so stale-response protection is tested independently of transport support.
  return promise
}
const empty = { startDate: '2026-10-19', endDate: '2026-10-19', overview: { requests: 0, successful: 0, tokens: 0 }, dailyTrend: [{ date: '2026-10-19', tokens: 0, requests: 0 }] }
let reactRoot
try {
  const out = tmp + '/fixture.cjs'
  buildSync({ stdin: { contents: "export {ReportPage} from './desktop-tauri/mobile/src/pages/ReportPage';export {act,createElement} from 'react';export {createRoot} from 'react-dom/client'", resolveDir: root, loader: 'tsx' }, bundle: true, platform: 'node', format: 'cjs', outfile: out, jsx: 'automatic', alias: { '@ui': root + '/desktop-tauri/ui-kit/src', react: path.dirname(require.resolve('react/package.json')), 'react-dom': path.dirname(require.resolve('react-dom/package.json')) }, nodePaths: [islands + '/node_modules', root + '/desktop-tauri/mobile/node_modules', root + '/desktop-tauri/ui-kit/node_modules'], logLevel: 'silent' })
  const f = require(out)
  const settle = () => new Promise(resolve => setTimeout(resolve, 25))
  async function act(task) { await f.act(async () => { await task?.(); await settle() }) }
  async function click(label, role) {
    const node = [...document.querySelectorAll(role ? `[role="${role}"]` : 'button')].find(button => (button.textContent.trim() || button.getAttribute('aria-label')) === label)
    assert.ok(node, 'control: ' + label)
    await act(() => node.click())
  }
  async function respond(index, data) { await act(() => calls[index].resolve(data)) }
  reactRoot = f.createRoot(document.getElementById('root'))
  await act(() => reactRoot.render(f.createElement(f.ReportPage)))
  assert(document.querySelector('[role=status]'), 'initial loading skeleton has an accessible status')
  assert.equal(calls.length, 1)
  assert(calls[0].url.endsWith('range=today'))
  await click('7 天')
  assert.equal(calls.length, 2, 'new range loads immediately even when previous request is pending')
  assert(calls[0].options.signal.aborted, 'old transport receives cancellation')
  await respond(1, { ...empty, startDate: '2026-10-13' })
  await respond(0, { ...empty, overview: { requests: 999, tokens: 999999 } })
  assert.equal(document.querySelector('.report-total').textContent, '0Tokens', 'late response cannot overwrite the selected range')
  assert(document.querySelector('.m-sub').textContent.includes('2026-10-13'))
  assert(!document.body.textContent.includes('完整报表与趋势'), 'redundant desktop report entry removed')
  assert(!document.querySelector('[data-slot=chart]'), 'zero-only trend does not draw fake bars or a baseline')
  assert(document.body.textContent.includes('这段时间还没有 Token 用量'))
  await click('30 天')
  assert(document.querySelector('[role=status]'), 'new range does not relabel stale data as current')
  assert(!document.querySelector('.report-summary'))
  await act(() => calls[2].reject(new Error('fixture connection lost')))
  assert(document.querySelector('[role=alert]').textContent.includes('报表加载失败'))
  await click('重试')
  assert(calls[3].url.endsWith('range=30'))
  const populated = {
    startDate: '2026-09-20', endDate: '2026-10-19',
    overview: { requests: 1250, successful: 1200, tokens: 1000, activeDays: 9, streak: 5, topModel: { model: 'fixture-model-1' } },
    cacheRates: { last24h: 1.25 },
    models: Array.from({ length: 6 }, (_, index) => ({ id: 'model-' + index, label: 'fixture-model-' + index, requests: 50, totalTokens: [400, 200, 150, 100, 80, 70][index] })),
    providers: [{ id: 'catpaw', label: 'CatPaw', requests: 1250, totalTokens: 1000 }],
    accounts: [{ id: 'account-1', label: 'Phone fixture account', requests: 1250, totalTokens: 1000 }],
    dailyTrend: Array.from({ length: 365 }, (_, i) => ({ date: new Date(Date.UTC(2025, 9, 20 + i)).toISOString().slice(0, 10), tokens: i === 364 ? 1000 : 0, requests: i % 7 })),
  }
  await respond(3, populated)
  assert(document.querySelector('.report-metrics').textContent.includes('1,250'))
  assert(document.querySelector('.report-metrics').textContent.includes('96.0%'))
  assert(document.querySelector('.report-metrics').textContent.includes('125.0%'), 'valid cache ratio over 100% is preserved')
  assert.equal(document.querySelectorAll('.report-ranking-list li').length, 5)
  assert.equal(document.querySelector('[role=progressbar]').getAttribute('aria-valuenow'), '40', 'model share uses the entire selected range, not just the top five')
  const bars = [...document.querySelectorAll('.recharts-rectangle')]
  assert(bars.length, 'real shadcn/Recharts graph renders for populated data')
  assert(bars.every(bar => !bar.getAttribute('d')?.includes('NaN')), 'year-long chart has finite geometry')
  await click('提供商', 'tab')
  assert(document.querySelector('[role=tabpanel]').textContent.includes('CatPaw'))
  await click('账号', 'tab')
  assert(document.querySelector('[role=tabpanel]').textContent.includes('Phone fixture account'))
  await click('请求')
  assert.equal(document.querySelector('[data-slot=chart]').getAttribute('aria-label'), '请求次数')
  await click('刷新报表')
  await act(() => calls[4].reject(new Error('fixture refresh failed')))
  assert(document.querySelector('[role=alert]').textContent.includes('正在显示上次结果'), 'refresh failure keeps and labels the last successful snapshot')
  assert(document.querySelector('.report-summary'))
  await click('今天')
  await respond(5, { ...empty, cacheRates: { last1h: 0.5 }, dailyTrend: [{ date: '2026-10-19', requests: 2, tokens: 0 }] })
  assert.equal(document.querySelector('[data-slot=chart]').getAttribute('aria-label'), '请求次数', 'requests-only days still have a working request graph')
  const cacheCell = [...document.querySelectorAll('.report-metrics > div')].find(node => node.textContent.includes('缓存命中率'))
  assert.equal(cacheCell.querySelector('dd').textContent, '—', '24-hour label never silently substitutes a 1-hour cache rate')
  await click('Token')
  assert(!document.querySelector('[data-slot=chart]'))
  await click('本月')
  await respond(6, empty)
  await click('全部')
  await respond(7, empty)
  assert.equal(calls.filter(call => call.url.includes('range=month')).length, 1)
  assert.equal(calls.filter(call => call.url.includes('range=all')).length, 1)
  assert.equal(intervals.size, 1, 'only the current range owns a polling timer')
  const timer = [...intervals.values()][0]
  await act(timer)
  assert.equal(calls.length, 9, 'periodic refresh still works')
  await respond(8, empty)
  Object.defineProperty(document, 'hidden', { configurable: true, value: true })
  await act(timer)
  assert.equal(calls.length, 9, 'background page does not poll')
  Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  await act(() => document.dispatchEvent(new Event('visibilitychange')))
  assert.equal(calls.length, 10, 'returning to foreground refreshes report')
  const pending = calls[9]
  await act(() => reactRoot.unmount()); reactRoot = null
  assert(pending.options.signal.aborted)
  assert.equal(intervals.size, 0)
  await act(() => pending.resolve(populated))
  assert(calls.every(call => (call.options.method || 'GET') === 'GET' && call.url.includes('/api/stats/summary?range=')), 'report interactions are exclusively statistics reads')
  console.log('PASS mobile report: all five ranges, stale responses, retry, refresh, zero/populated/year-long trends, metric switching, all rankings, whole-range shares, cache windows, polling cleanup')
} finally {
  if (reactRoot) await require(tmp + '/fixture.cjs').act(async () => reactRoot.unmount())
  dom.window.close()
  fs.rmSync(tmp, { recursive: true, force: true })
}

// React's browser Scheduler retains its MessageChannel after the isolated DOM closes.
process.exit(0)
