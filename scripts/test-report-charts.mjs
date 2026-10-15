// Real chart components + synthetic report data. No live API, database or credentials.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const root = path.resolve(new URL('..', import.meta.url).pathname)
const islands = path.join(root, 'desktop-tauri/ui-islands')
const require = createRequire(path.join(islands, 'package.json'))
const { buildSync } = require('esbuild')
const { JSDOM } = require('jsdom')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent2api-report-chart-'))
const dom = new JSDOM('<!doctype html><div id="fixture"></div>', { url: 'http://localhost/' })
for (const key of ['window', 'document', 'HTMLElement', 'SVGElement', 'Element', 'Node', 'MouseEvent', 'KeyboardEvent', 'MutationObserver', 'HTMLButtonElement']) globalThis[key] = dom.window[key]
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window)
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0)
globalThis.cancelAnimationFrame = clearTimeout
globalThis.IS_REACT_ACT_ENVIRONMENT = true
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
window.wbI18n = { t: (text, vars = {}) => text.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? `{${key}}`)) }
// Supply layout only; Recharts and the production components compute all chart geometry.
let layoutWidth = 680
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => layoutWidth })
HTMLElement.prototype.getBoundingClientRect = function () {
  const height = this.classList.contains('recharts-legend-wrapper') ? 24 : 260
  return { x: 0, y: 0, left: 0, top: 0, right: layoutWidth, bottom: height, width: layoutWidth, height: layoutWidth ? height : 0 }
}
globalThis.ResizeObserver = window.ResizeObserver = class {
  constructor(callback) { this.callback = callback }
  observe() { this.callback([{ contentRect: { width: layoutWidth, height: layoutWidth ? 260 : 0 } }]) }
  disconnect() {}
  unobserve() {}
}

let mounted, React
try {
  const file = path.join(temp, 'fixture.cjs')
  buildSync({ stdin: { contents: `export * as React from 'react'; export { createRoot } from 'react-dom/client'; export * from './src/islands/report-chart-components'; export * from './src/islands/report-chart-data'; export { rankRows, donutView, heatmapView } from './src/islands/report-charts';`, loader: 'tsx', resolveDir: islands },
    bundle: true, platform: 'node', format: 'cjs', outfile: file, jsx: 'automatic',
    alias: { '@ui': path.join(root, 'desktop-tauri/ui-kit/src'), recharts: path.dirname(require.resolve('recharts/package.json')), react: path.dirname(require.resolve('react/package.json')), 'react-dom': path.dirname(require.resolve('react-dom/package.json')) },
    nodePaths: [path.join(islands, 'node_modules'), path.join(root, 'desktop-tauri/ui-kit/node_modules')], logLevel: 'silent' })
  const f = require(file)
  React = f.React
  const historicalId = 'accio-intl-' + 'a'.repeat(64)
  assert.deepEqual(f.reportAccountProvider(historicalId), { provider: 'accio', edition: 'intl' })
  assert.deepEqual(f.reportAccountProvider('accio-cn-' + 'b'.repeat(64)), { provider: 'accio-cn', edition: 'cn' })
  const currentAccount = { provider: 'custom-provider', edition: 'cn', editionLabel: '自定义' }
  assert.equal(f.reportAccountProvider(historicalId, currentAccount), currentAccount, 'current account metadata takes precedence over historical IDs')
  const archivedAccount = { provider: 'qoder-intl', providerLabel: 'Qoder 国际版', edition: 'intl' }
  assert.equal(f.reportAccountProvider('deleted-account', undefined, archivedAccount), archivedAccount, 'deleted accounts use their persisted provider and region')
  assert.equal(f.reportAccountProvider('same-id', currentAccount, archivedAccount), archivedAccount, 'a later live account change cannot override historical provider metadata')
  assert.equal(f.reportAccountProvider('accio-intl-not-a-generated-id'), null)
  assert.equal(f.reportAccountProvider('unknown-account'), null, 'unknown historical accounts are not assigned a guessed provider')
  const list = [
    { id: 'same1', label: '重复名字', totalTokens: 100, requests: 7 },
    { id: 'same2', label: '重复名字', tokens: 300, requests: 2 },
    { id: 'zero', totalTokens: 0 },
    { id: 'negative', totalTokens: -100 },
  ]
  const ranks = f.rankChartData(list)
  assert.deepEqual(ranks.map(row => row.id), ['same2', 'same1'])
  assert.deepEqual(ranks.map(row => row.share), [75, 25])
  const archivedRanks = f.rankChartData([{ id: 'deleted-account', tokens: 3, ...archivedAccount }])
  assert.equal(archivedRanks[0].provider, 'qoder-intl')
  assert.equal(archivedRanks[0].edition, 'intl')
  assert.deepEqual(ranks.map(row => row.tip), f.rankRows(list).map(row => row.tip), 'identities and original tooltips remain unchanged')
  const slices = f.donutChartData(list, '未知')
  const original = f.donutView(list, '未知')
  assert.deepEqual(slices.map(row => row.tip), original.legend.map(row => row.tip))
  assert.deepEqual(slices.map(row => row.percentText), original.legend.map(row => row.percentText))
  assert.equal(new Set(slices.map(row => row.key)).size, 2, 'duplicate names retain distinct sectors')
  assert.equal(f.donutChartData([{ tokens: 4 }], '未知')[0].percent, 1)
  assert.deepEqual(f.donutChartData([{ tokens: 0 }], '未知'), [])
  assert.equal(f.donutChartData(Array.from({ length: 25 }, (_, i) => ({ model: String(i), tokens: i + 1 })), '未知').length, 25, 'all series survive beyond the palette size')
  const hours = [{ hour: '2026-10-15T01', rate: 1.25, totalTokens: 1000, hitTokens: 125, inputTokens: 100 }]
  assert.equal(f.cacheChartData(hours)[0].rate, 1.25, 'cache rates above 100% are not clamped')
  assert.ok(f.cacheChartData(hours)[0].tip.includes('125.0%'))
  const days = [{ date: '2026-10-14', tokens: 10, requests: 2 }, { date: '2026-10-15', tokens: 0, requests: 3 }]
  assert.equal(f.dailyChartData(days)[1].requests, 3, 'zero-token dates retain their request counts')
  assert.equal(f.dailyChartData(Array.from({ length: 1000 }, () => days[0])).length, 1000, 'long ranges are not truncated or aggregated')
  assert.ok(f.chartLabelIndices([1, 3, 8, 20, 4, 3, 2], 240).has(3), 'dense labels retain the peak')
  const year = Array.from({ length: 365 }, (_, i) => ({ date: new Date(Date.UTC(2025, 9, 16 + i)).toISOString().slice(0, 10), tokens: i, requests: i }))
  assert.equal(f.heatmapView(year, 680).cells.length, 365, 'the original yearly heatmap remains intact')
  window.wbUnits = { formatTokens: value => `${value} units` }
  assert.equal(f.donutChartData([{ tokens: 100 }], '未知')[0].tokensText, '100 units', 'unit changes remain dynamic')
  delete window.wbUnits

  const host = document.getElementById('fixture')
  mounted = f.createRoot(host)
  const render = async (component, props) => {
    await React.act(async () => mounted.render(React.createElement(component, props)))
    await React.act(async () => new Promise(resolve => setTimeout(resolve, 25)))
  }
  await render(f.UsageRankChart, { list, ariaLabel: '排名', renderName: row => row.name })
  assert.equal(host.querySelectorAll('foreignObject').length, 2)
  assert.ok([...host.querySelectorAll('foreignObject')].every(el => Number(el.getAttribute('x')) >= 0), 'rank names do not clip at the left edge')
  await render(f.UsageDonutChart, { list: [{ tokens: 100, label: '完整一圈' }], unknownLabel: '未知', ariaLabel: '环形图' })
  assert.equal(host.querySelectorAll('.recharts-sector').length, 1, 'one positive series renders a complete donut')
  assert.ok(host.textContent.includes('100.0%'))
  await React.act(async () => host.querySelector('.recharts-sector').dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
  assert.ok(host.querySelector('.recharts-tooltip-wrapper').textContent.includes('完整一圈 · 100 tokens'), 'hovering a sector shows its original full reading')
  await React.act(async () => host.querySelector('.recharts-sector').dispatchEvent(new MouseEvent('click', { bubbles: true })))
  assert.ok(document.querySelector('[data-slot="popover-content"]').textContent.includes('完整一圈 · 100 tokens'), 'click pins a complete reading')
  await React.act(async () => host.querySelector('.recharts-sector').dispatchEvent(new MouseEvent('click', { bubbles: true })))
  assert.equal(document.querySelector('[data-slot="popover-content"][data-open]'), null, 'a second click closes the pinned reading')
  await React.act(async () => host.querySelector('.recharts-sector').dispatchEvent(new MouseEvent('click', { bubbles: true })))
  await render(f.UsageDonutChart, { list: [{ tokens: 200, label: '完整一圈' }], unknownLabel: '未知', ariaLabel: '环形图' })
  assert.ok(document.querySelector('[data-slot="popover-content"]').textContent.includes('200 tokens'), 'pinned readings update with refreshed data')
  await React.act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  assert.equal(document.querySelector('[data-slot="popover-content"][data-open]'), null, 'Escape dismisses the pinned reading')
  await render(f.CacheHistoryChart, { series: hours })
  assert.equal(host.querySelectorAll('.recharts-area-dot').length, 1, 'single-hour history remains a visible point')
  assert.equal(host.querySelectorAll('.recharts-yAxis').length, 1, 'both token series share a comparable quantity scale')
  assert.ok(host.textContent.includes('缓存命中 Token'))
  const tokenLabels = [...host.querySelectorAll('.recharts-label-list')].map(labels => labels.textContent)
  assert.ok(tokenLabels.some(label => label.includes('125')), 'the blue line labels actual cache hit tokens')
  assert.ok(tokenLabels.every(label => !label.includes('%')), 'curve labels display token quantities, never percentages')
  await render(f.CacheHistoryChart, { series: [{ hour: '2026-10-15T01', rate: 0 }] })
  assert.equal(host.querySelectorAll('.recharts-area-dot, .recharts-area-curve').length, 0)
  assert.equal(host.querySelectorAll('.recharts-yAxis').length, 1, 'missing token history does not fabricate a second series')
  await render(f.DailyTokensChart, { series: days })
  assert.ok(host.querySelector('[data-slot="chart"] .recharts-surface'))
  await render(f.DailyTokensChart, { series: [days[1]] })
  assert.ok(host.textContent.includes('所选范围内暂无 Token 用量'))
  layoutWidth = 0
  const oldWarn = console.warn
  const warnings = []
  console.warn = (...args) => warnings.push(args.join(' '))
  try {
    await render(f.CacheHistoryChart, { series: hours, key: 'hidden' })
  } finally { console.warn = oldWarn }
  assert.ok(!warnings.some(message => message.includes('should be greater than 0')), 'hidden islands do not produce zero-size chart warnings')
  layoutWidth = 680
  await render(f.CacheHistoryChart, { series: hours, key: 'shown' })
  assert.equal(host.querySelectorAll('.recharts-yAxis').length, 1, 'charts restore their quantity axis after becoming visible')
  console.log('PASS: real shadcn/Recharts rendering; ranking identity/order/shares; donut parity/one/many/empty and hover; cache hit and total token quantities on a shared axis; missing token series; zero dates; long ranges; unit changes; yearly heatmap; hidden-page sizing and restore')
} finally {
  if (mounted) await React.act(async () => mounted.unmount())
  dom.window.close()
  fs.rmSync(temp, { recursive: true, force: true })
}
// React's browser Scheduler retains its MessageChannel after the isolated DOM closes.
process.exit(0)
