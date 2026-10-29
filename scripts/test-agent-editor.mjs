// Real React editor/store with a synthetic management bridge; no client files or accounts.
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'a2a-agent-editor-'))
const intervals = new Set(), nativeSetInterval = globalThis.setInterval, nativeClearInterval = globalThis.clearInterval
const timeouts = new Set(), nativeSetTimeout = globalThis.setTimeout, nativeClearTimeout = globalThis.clearTimeout
globalThis.setInterval = (...args) => { const timer = nativeSetInterval(...args); intervals.add(timer); return timer }
globalThis.clearInterval = timer => { intervals.delete(timer); nativeClearInterval(timer) }
globalThis.setTimeout = (callback, delay, ...args) => { const timer = nativeSetTimeout(() => { timeouts.delete(timer); callback(...args) }, delay); timeouts.add(timer); return timer }
globalThis.clearTimeout = timer => { timeouts.delete(timer); nativeClearTimeout(timer) }
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/' })
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'MutationObserver', 'HTMLInputElement', 'HTMLButtonElement', 'SVGElement', 'ShadowRoot', 'NodeFilter']) globalThis[key] = dom.window[key]
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
Object.assign(globalThis, {
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  requestAnimationFrame: callback => setTimeout(callback, 0),
  cancelAnimationFrame: clearTimeout,
  IS_REACT_ACT_ENVIRONMENT: true,
})
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
window.PointerEvent = window.MouseEvent
globalThis.PointerEvent = window.PointerEvent
window.wbI18n = { t: (text, values = {}) => text.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? key)) }
window.wbApp = { toast() {} }

const makeProfile = (id, enabled) => ({ id, name: id, kind: 'gateway', protocol: 'openai_chat', baseUrl: 'http://fixture/v1', model: '', provider: '', effort: 'default', enabled, default: enabled, note: '' })
let payload = { clients: [], gateway: { baseUrl: 'http://fixture', keys: [] } }
let writes = [], failNext = false, holdNext = false, releaseSave
window.workbuddyDesktop = {
  getAgents: async () => structuredClone(payload),
  saveAgentProfiles: async request => {
    writes.push(structuredClone(request))
    if (holdNext) { holdNext = false; await new Promise(resolve => { releaseSave = resolve }) }
    if (failNext) { failNext = false; throw new Error('synthetic save failure') }
    payload.clients[0].profiles = structuredClone(request.profiles)
    return structuredClone(payload)
  },
  previewAgentProfile: async () => ({ text: 'synthetic preview' }),
}

let reactRoot, f
try {
  const outfile = path.join(tmp, 'fixture.cjs')
  buildSync({
    stdin: { contents: `import * as React from 'react'; import {ProfileEditor} from './src/islands/agent-editor'; import * as state from './src/islands/agent-state'; export * from './src/islands/agent-state'; export {act} from 'react'; export {createRoot} from 'react-dom/client'; export function renderEditor(){return React.createElement(Editor)} function Editor(){const store=React.useSyncExternalStore(state.subscribeAgentStore,state.getAgentStore,state.getAgentStore);return store.clients[0]?React.createElement(ProfileEditor,{client:store.clients[0]}):null}`, resolveDir: islands, loader: 'tsx' },
    bundle: true, platform: 'node', format: 'cjs', outfile, jsx: 'automatic',
    alias: { '@ui': root + '/desktop-tauri/ui-kit/src', react: path.dirname(require.resolve('react/package.json')), 'react-dom': path.dirname(require.resolve('react-dom/package.json')) },
    nodePaths: [islands + '/node_modules', root + '/desktop-tauri/ui-kit/node_modules'], logLevel: 'silent',
  })
  f = require(outfile)
  reactRoot = f.createRoot(document.getElementById('root'))
  const settle = async action => f.act(async () => { action?.(); await new Promise(resolve => setTimeout(resolve, 0)) })
  const input = index => index === 2 ? document.querySelector('.agent-form input[placeholder="模型 id"]') : document.querySelectorAll('.agent-form input:not([type=hidden])')[index]
  const setInput = async (index, value) => settle(() => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input(index), value)
    input(index).dispatchEvent(new Event('input', { bubbles: true }))
  })
  const blur = async index => settle(() => input(index).dispatchEvent(new Event('focusout', { bubbles: true })))
  const profile = id => f.getAgentStore().clients[0].profiles.find(item => item.id === id)
  const row = id => [...document.querySelectorAll('.agent-profile')].find(node => node.querySelector('.agent-profile-name > span')?.textContent === id)
  const click = async element => { assert.ok(element); await settle(() => element.click()) }
  const reset = async (mode = 'single') => {
    payload = { clients: [{ id: 'fixture-' + mode, name: 'Fixture', configMode: mode, profiles: [makeProfile('A', true), makeProfile('B', mode === 'multi')], installed: false, profilesAreLive: false, activeId: 'A' }], gateway: { baseUrl: 'http://fixture', keys: [] } }
    if (mode === 'multi') payload.clients[0].profiles[1].default = false
    writes = []; releaseSave = undefined
    await f.act(async () => { await f.loadPanel(); f.startEditing('B'); reactRoot.render(f.renderEditor()) })
  }

  await reset()
  await click(row('B').querySelector('[role=switch]'))
  assert.equal(profile('B').enabled, true)
  const beforeBlur = writes.length
  await blur(0)
  assert.equal(writes.length, beforeBlur, 'unchanged blur does not write')
  assert.equal(profile('A').enabled, false)
  assert.equal(profile('B').enabled, true, 'unchanged blur cannot restore the old active profile')
  await setInput(0, 'B renamed'); await blur(0)
  assert.equal(profile('B').name, 'B renamed')
  assert.equal(profile('B').enabled, true, 'name save preserves active state')

  await reset()
  await setInput(2, 'draft-model')
  await click(row('B').querySelector('[role=switch]'))
  assert.equal(input(2).value, 'draft-model', 'switch response preserves unsaved model input')
  await blur(2)
  assert.equal(profile('B').model, 'draft-model')
  assert.equal(profile('B').enabled, true)

  await reset('multi')
  await setInput(0, 'B default')
  await click([...row('B').querySelectorAll('button')].find(button => button.textContent === '设为默认'))
  await blur(0)
  assert.equal(profile('B').default, true, 'form save preserves the new default')
  assert.equal(profile('A').default, false)

  await reset()
  await setInput(0, 'first name'); holdNext = true; await blur(0)
  assert.equal(typeof releaseSave, 'function')
  await setInput(2, 'typed while saving')
  await settle(() => releaseSave())
  assert.equal(input(2).value, 'typed while saving', 'late save cannot erase new draft fields')
  assert.ok(document.body.textContent.includes('保存修改'))
  await blur(2)
  assert.equal(profile('B').model, 'typed while saving')

  await reset()
  await setInput(0, 'first'); holdNext = true; await blur(0)
  await setInput(0, 'second'); await blur(0)
  await click(row('B').querySelector('[role=switch]'))
  await settle(() => releaseSave())
  await settle()
  assert.equal(profile('B').name, 'second', 'queued blur saves later edits')
  assert.equal(profile('B').enabled, true, 'queued form edit merges with the latest switch state')
  assert.equal(profile('A').enabled, false)

  await reset()
  await setInput(0, 'first committed'); holdNext = true; await blur(0)
  await setInput(0, 'second committed'); await blur(0)
  await click([...row('A').querySelectorAll('button')].find(button => button.textContent === '编辑'))
  await settle(() => releaseSave())
  await settle()
  assert.equal(profile('B').name, 'second committed', 'switching profile must not cancel a save already requested by blur')
  assert.equal(input(0).value, 'A', 'old save cannot replace the new form')

  await reset()
  failNext = true; await setInput(0, 'retry name'); await blur(0)
  assert.equal(profile('B').name, 'B')
  assert.equal(input(0).value, 'retry name', 'failed save retains the draft')
  assert.ok(document.body.textContent.includes('保存修改'))
  await blur(0)
  assert.equal(profile('B').name, 'retry name', 'failed save does not poison the queue')
  await setInput(2, 'B draft only')
  await click([...row('A').querySelectorAll('button')].find(button => button.textContent === '编辑'))
  assert.equal(input(2).value, '', 'switching profile does not reuse another profile draft')
  console.log('PASS: Agent editor preserves enabled/default state, skips unchanged writes, merges queued updates, retains in-flight drafts, and retries failed saves')
} finally {
  if (reactRoot) await f.act(async () => reactRoot.unmount())
  dom.window.close()
  for (const timer of intervals) nativeClearInterval(timer)
  for (const timer of timeouts) nativeClearTimeout(timer)
  globalThis.setInterval = nativeSetInterval
  globalThis.clearInterval = nativeClearInterval
  globalThis.setTimeout = nativeSetTimeout
  globalThis.clearTimeout = nativeClearTimeout
  fs.rmSync(tmp, { recursive: true, force: true })
}
process.exit(0)
