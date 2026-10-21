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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'a2a-request-list-'))
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/m#requests', pretendToBeVisual: true })
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
const entry = (id, status = 429) => ({id,model:'fixture-model-'+id,status,provider:'workbuddy',accountName:'Fixture account with a long display name',ts:Date.now(),durationMs:1234,totalTokens:98765,attempts:2,attemptDetails:[{provider:'workbuddy',status:429}],error:status===429?'fixture quota warning':undefined})
let reactRoot
try {
  const out = tmp + '/fixture.cjs'
  buildSync({ stdin: { contents: "export {RequestsPage} from './desktop-tauri/mobile/src/pages/RequestsPage';export {act,createElement} from 'react';export {createRoot} from 'react-dom/client'", resolveDir: root, loader: 'tsx' }, bundle: true, platform: 'node', format: 'cjs', outfile: out, jsx: 'automatic', alias: { '@ui': root + '/desktop-tauri/ui-kit/src', react: path.dirname(require.resolve('react/package.json')), 'react-dom': path.dirname(require.resolve('react-dom/package.json')) }, nodePaths: [islands + '/node_modules', root + '/desktop-tauri/mobile/node_modules', root + '/desktop-tauri/ui-kit/node_modules'], logLevel: 'silent' })
  const f = require(out)
  const settle = () => new Promise(resolve => setTimeout(resolve, 35))
  async function act(task) { await f.act(async () => { await task?.(); await settle() }) }
  async function click(label) {
    const node = [...document.querySelectorAll('button')].find(button => (button.textContent.trim() || button.getAttribute('aria-label')) === label)
    assert(node,'control '+label); await act(()=>node.click())
  }
  async function respond(index,data) { await act(()=>calls[index].resolve(data)) }
  reactRoot=f.createRoot(document.getElementById('root'));await act(()=>reactRoot.render(f.createElement(f.RequestsPage)))
  await click('失败');assert.equal(calls.length,2,'filter starts a new request while the first request is in flight')
  assert(calls[0].options.signal.aborted);assert(calls[1].url.includes('status=error'))
  await respond(1,{entries:[entry('error-1')],total:99,matched:3})
  await respond(0,{entries:[entry('stale',200)],total:1,matched:1})
  assert(!document.body.textContent.includes('fixture-model-stale'),'stale filter cannot overwrite newer results')
  assert.equal(document.querySelectorAll('.m-request-card').length,1)
  await click('加载更早的请求');assert(calls[2].url.includes('status=error'),'pagination preserves the failed filter')
  assert(calls[2].url.includes('offset=1'))
  await respond(2,{entries:[entry('error-2')],total:99,matched:3})
  assert.equal(document.querySelectorAll('.m-request-card').length,2)
  await act(()=>document.querySelector('.m-request-card').click())
  assert(document.querySelector('[role=dialog]'),'request details use a real shadcn Sheet')
  assert(document.querySelector('[role=dialog]').textContent.includes('fixture-model-error-1'))
  await click('关闭')
  await click('加载更早的请求');const oldPage=calls[3]
  await click('全部');assert(oldPage.options.signal.aborted,'switching filters cancels pagination')
  await respond(4,{entries:[entry('success',200)],total:1,matched:1})
  await respond(3,{entries:[entry('late-error-page')],total:99,matched:3})
  assert.equal(document.querySelectorAll('.m-request-card').length,1);assert(!document.body.textContent.includes('late-error-page'))
  await click('在途');await respond(5,{entries:[entry('running',0),entry('finished',200)],running:1,total:2,matched:2})
  assert.equal(document.querySelectorAll('.m-request-card').length,1);assert(document.querySelector('.m-request-card').textContent.includes('在途'))
  await click('有重试');await respond(6,{entries:[{...entry('plain',200),attempts:1},entry('retry',200)],total:2,matched:2})
  assert.equal(document.querySelectorAll('.m-request-card').length,1);assert(document.querySelector('.m-request-card').textContent.includes('重试 1'))
  await click('刷新');await act(()=>calls[7].reject(new Error('fixture request list offline')))
  assert(document.querySelector('[role=alert]').textContent.includes('fixture request list offline'))
  await click('刷新');await respond(8,{entries:[],total:0,matched:0})
  assert(document.body.textContent.includes('当前筛选下没有记录'))
  await act(()=>[...intervals.values()][0]());assert.equal(calls.length,10,'foreground polling remains available')
  await act(()=>reactRoot.unmount());reactRoot=null;assert(calls[9].options.signal.aborted);assert.equal(intervals.size,0)
  await respond(9,{entries:[entry('unmounted')],total:1,matched:1})
  assert(calls.every(call=>(call.options.method||'GET')==='GET'),'all request browsing is read-only')
  console.log('PASS mobile request list: semantic filters, in-flight switching, exact failed pagination, canceled old pages, shared status cards/detail Sheet, running/retry views, refresh errors and lifecycle cleanup')
} finally {
  if(reactRoot) await require(tmp+'/fixture.cjs').act(async()=>reactRoot.unmount())
  dom.window.close();fs.rmSync(tmp,{recursive:true,force:true})
}
process.exit(0)
