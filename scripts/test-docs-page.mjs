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
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent2api-docs-'))
// Base UI schedules delayed cleanup for its mounted triggers; release those timers with the fixture.
const timers = new Set()
const nativeSetTimeout = globalThis.setTimeout
const nativeSetInterval = globalThis.setInterval
const nativeClearTimeout = globalThis.clearTimeout
const nativeClearInterval = globalThis.clearInterval
globalThis.setTimeout = (callback, delay, ...args) => {
  const handle = nativeSetTimeout(() => { timers.delete(handle); callback(...args) }, delay)
  timers.add(handle)
  return handle
}
globalThis.setInterval = (callback, delay, ...args) => {
  const handle = nativeSetInterval(callback, delay, ...args)
  timers.add(handle)
  return handle
}
let dom
try {
  const output = path.join(temp, 'fixture.cjs')
  buildSync({ stdin: { contents: "import * as React from 'react'; import './src/islands/docs-page'; export { React };", loader: 'tsx', resolveDir: islands },
    bundle: true, platform: 'node', format: 'cjs', outfile: output, jsx: 'automatic',
    alias: { '@ui/navigation-icons': path.join(root, 'desktop-tauri/ui-kit/src/navigation-icons.ts'), '@ui': path.join(root, 'desktop-tauri/ui-kit/src/index.ts'), react: path.dirname(require.resolve('react/package.json')), 'react-dom': path.dirname(require.resolve('react-dom/package.json')) },
    nodePaths: [path.join(islands, 'node_modules'), path.join(root, 'desktop-tauri/ui-kit/node_modules')], logLevel: 'silent' })
  dom = new JSDOM('<!doctype html><html><body><section class="page" data-page="docs"></section></body></html>', { url: 'http://localhost/' })
  for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'MouseEvent', 'KeyboardEvent', 'MutationObserver', 'HTMLButtonElement', 'HTMLInputElement', 'SVGElement', 'ShadowRoot', 'NodeFilter']) globalThis[key] = dom.window[key]
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
  globalThis.localStorage = dom.window.localStorage
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window)
  globalThis.requestAnimationFrame = callback => setTimeout(callback, 0)
  globalThis.cancelAnimationFrame = clearTimeout
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  window.wbI18n = { t: (text, vars = {}) => text.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? `{${key}}`)) }
  globalThis.wbI18n = window.wbI18n
  globalThis.$ = id => document.getElementById(id)
  let copied = ''
  const notifications = []
  globalThis.toast = (...args) => notifications.push(args)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { copied = text } } })
  vm.runInThisContext(fs.readFileSync(path.join(root, 'desktop-tauri/ui/clipboard.js'), 'utf8'))
  const calls = []
  globalThis.fetch = async url => {
    calls.push(url)
    const bodies = { '/health': { status: 'ok' }, '/v1/models': { data: [{ id: 'model' }] }, '/api/update/status': { data: { currentVersion: '3.0.3' } }, '/api/storage': { data: { database: { accounts: 11, requests: 280 } } } }
    return { ok: true, status: 200, json: async () => bodies[url] }
  }
  localStorage.setItem('aibuddy-docs-client', 'python')
  const { React } = require(output)
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const page = document.querySelector('[data-page="docs"]')
  const snippet = () => document.getElementById('qs-snippet').textContent
  const click = async element => React.act(async () => { element.dispatchEvent(new MouseEvent('click', { bubbles: true })); await Promise.resolve() })
  const writePort = async base => React.act(async () => {
    for (const [id, value] of Object.entries({ 'api-base': `${base}/v1`, 'api-chat': `POST ${base}/v1/chat/completions`, 'api-responses': `POST ${base}/v1/responses`, 'api-messages': `POST ${base}/v1/messages`, 'api-models': `GET ${base}/v1/models` })) {
      const element = document.getElementById(id)
      assert.ok(element, `${id} must exist synchronously for port-panel`)
      element.textContent = value
    }
    await Promise.resolve()
  })
  assert.match(snippet(), /from openai import OpenAI/, 'restores saved client')
  assert.equal(calls.length, 0, 'hidden docs do not send health probes')
  await writePort('http://127.0.0.1:4099')
  assert.match(snippet(), /127\.0\.0\.1:4099\/v1/, 'port changes update current snippet without switching client')
  const baseNode = document.getElementById('api-base')
  for (const [kind, label, marker] of [['curl', 'curl', 'curl '], ['python', 'Python', 'from openai'], ['node', 'Node.js', 'import OpenAI'], ['claude', 'Claude Code', 'ANTHROPIC_BASE_URL'], ['codex', 'Codex CLI', 'wire_api = "responses"']]) {
    const button = [...page.querySelectorAll('[data-slot="toggle-group-item"]')].find(element => element.textContent === label)
    assert.ok(button, `client ${label} exists`)
    await click(button)
    assert.equal(localStorage.getItem('aibuddy-docs-client'), kind)
    assert.ok(snippet().includes(marker))
    assert.ok(snippet().includes('http://127.0.0.1:4099'))
    if (kind === 'claude') assert.ok(!snippet().includes('4099/v1'), 'Claude base excludes /v1')
    const copy = page.querySelector('[data-copy-from="qs-snippet"]')
    await click(copy.querySelector('svg'))
    assert.equal(copied, snippet(), `${label} copies exact multiline config`)
    assert.ok(copy.querySelector('svg'), 'clipboard feedback preserves React icon')
    assert.equal(document.getElementById('api-base'), baseNode, 'client changes retain externally populated endpoints')
  }
  for (const id of ['api-base', 'api-chat', 'api-responses', 'api-messages', 'api-models']) {
    const button = page.querySelector(`[data-copy-from="${id}"]`)
    await click(button.querySelector('svg'))
    assert.equal(copied, document.getElementById(id).textContent.replace(/^(POST|GET)\s+/i, '').trim())
    assert.ok(button.querySelector('svg'), 'endpoint copy keeps icon')
  }
  assert.equal(notifications.length, 10, 'all copy actions report success')
  assert.equal(calls.length, 0, 'client changes and copying do not trigger probes')
  await React.act(async () => { page.classList.add('active'); await Promise.resolve() })
  assert.deepEqual(calls, ['/health', '/v1/models', '/api/update/status', '/api/storage'])
  assert.match(page.textContent, /可用 · 1 个模型/)
  assert.match(page.textContent, /账号池 11 个账号 · 请求记录 280 条/)
  await click([...page.querySelectorAll('button')].find(element => element.textContent.includes('重新检测')))
  assert.equal(calls.length, 8, 'manual retry runs one complete probe round')
  await writePort('https://gateway.example.test')
  assert.ok(snippet().includes('https://gateway.example.test/v1'), 'subsequent port sync also updates persisted Codex choice')
  console.log('PASS: docs endpoint contracts, live port sync, five clients, exact clipboard content and feedback, lazy health probes and retry')
} finally {
  dom?.window.close()
  for (const timer of timers) { nativeClearTimeout(timer); nativeClearInterval(timer) }
  globalThis.setTimeout = nativeSetTimeout
  globalThis.setInterval = nativeSetInterval
  fs.rmSync(temp, { recursive: true, force: true })
}
// React's browser Scheduler retains a MessageChannel after JSDOM closes.
process.exit(0)
