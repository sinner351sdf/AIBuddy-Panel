import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import vm from 'node:vm'
const root = path.resolve(new URL('..', import.meta.url).pathname)
const islands = path.join(root, 'desktop-tauri/ui-islands')
const require = createRequire(path.join(islands, 'package.json'))
const { buildSync } = require('esbuild')
const ts = require('typescript')
const { JSDOM } = require('jsdom')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent2api-business-ui-'))
const scheduled = new Set()
const nativeSetTimeout = globalThis.setTimeout
const nativeClearTimeout = globalThis.clearTimeout
const nativeSetInterval = globalThis.setInterval
const nativeClearInterval = globalThis.clearInterval
globalThis.setTimeout = (callback, delay, ...args) => {
  const handle = nativeSetTimeout(() => { scheduled.delete(handle); callback(...args) }, delay)
  scheduled.add(handle)
  return handle
}
globalThis.clearTimeout = handle => { scheduled.delete(handle); nativeClearTimeout(handle) }
globalThis.setInterval = (callback, delay, ...args) => { const handle = nativeSetInterval(callback, delay, ...args); scheduled.add(handle); return handle }
globalThis.clearInterval = handle => { scheduled.delete(handle); nativeClearInterval(handle) }

try {
  const file = path.join(islands, 'src/islands/credits-page.tsx')
  const text = fs.readFileSync(file, 'utf8')
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const packageGroup = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'PackageGroup')
  assert.ok(packageGroup, 'real credit table group component exists')
  const output = path.join(temp, 'fixture.cjs')
  buildSync({ stdin: { contents: `
    import * as React from 'react';
    import { createRoot } from 'react-dom/client';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { ConversationView } from './src/components/conversation-preview';
    import './src/islands/table-col-settings';
    import { phaseOf, phaseElapsedText, phaseElapsedMsOf, phaseBadgeHtml, RequestPhaseBadge } from './src/islands/request-phase';
    import { Collapsible, CollapsibleTrigger, CollapsibleContent, Button, Tabs, TabsList, TabsTrigger, TabsContent } from '@ui';
    ${packageGroup.getText(ast)}
    export { React, createRoot, ConversationView, renderToStaticMarkup, phaseOf, phaseElapsedText, phaseElapsedMsOf, phaseBadgeHtml, RequestPhaseBadge };
    export function TableFixture() { const [open,setOpen]=React.useState(false);return <table><tbody><tr><td>visible</td></tr></tbody><PackageGroup label='more' expanded={open} onToggle={()=>setOpen(value=>!value)}><tr data-record='retained'><td><input defaultValue='draft'/></td></tr></PackageGroup></table>; }
    export function TabsFixture() { const [value,setValue]=React.useState('one');return <Tabs value={value} onValueChange={setValue}><TabsList><TabsTrigger value='one'>One</TabsTrigger><TabsTrigger value='two'>Two</TabsTrigger></TabsList><TabsContent value='one' keepMounted><input data-retain='one' defaultValue='one'/></TabsContent><TabsContent value='two' keepMounted><input data-retain='two' defaultValue='two'/></TabsContent></Tabs>; }
  `, loader: 'tsx', resolveDir: islands }, bundle: true, platform: 'node', format: 'cjs', outfile: output,
    jsx: 'automatic', alias: { '@ui/navigation-icons': path.join(root, 'desktop-tauri/ui-kit/src/navigation-icons.ts'), '@ui': path.join(root, 'desktop-tauri/ui-kit/src/index.ts'), react: path.dirname(require.resolve('react/package.json')), 'react-dom': path.dirname(require.resolve('react-dom/package.json')) },
    nodePaths: [path.join(islands, 'node_modules'), path.join(root, 'desktop-tauri/ui-kit/node_modules')], logLevel: 'silent' })
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' })
  for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'MouseEvent', 'KeyboardEvent', 'MutationObserver', 'HTMLButtonElement', 'HTMLInputElement', 'SVGElement', 'ShadowRoot', 'NodeFilter']) globalThis[key] = dom.window[key]
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
  globalThis.localStorage = dom.window.localStorage
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window)
  globalThis.requestAnimationFrame = callback => setTimeout(callback, 0)
  globalThis.cancelAnimationFrame = clearTimeout
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  window.wbI18n = { t: (text, vars = {}) => text.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? `{${key}}`)) }
  vm.runInThisContext(fs.readFileSync(path.join(root, 'desktop-tauri/ui/conversation-preview.js'), 'utf8'))
  const fixture = require(output)
  const { React, createRoot } = fixture
  assert.equal(fixture.phaseOf({ phase: ' STREAMING ' }), 'streaming')
  assert.equal(fixture.phaseOf({ phase: 'unknown' }), '')
  for (const value of [null, undefined, '', -1, 'invalid']) assert.equal(fixture.phaseElapsedText(value), '')
  assert.equal(fixture.phaseElapsedText(0), '1秒')
  assert.equal(fixture.phaseElapsedText(60999), '1分0秒')
  assert.equal(fixture.phaseElapsedMsOf({ phaseElapsedMs: 0, phaseStartedAt: Date.now() - 30000 }), 0)
  assert.equal(fixture.phaseElapsedMsOf({ phaseElapsedMs: null, phaseStartedAt: 0 }), null)
  assert.ok(fixture.phaseBadgeHtml({ phase: 'queued' }).includes('data-slot="badge"'))
  assert.ok(fixture.renderToStaticMarkup(React.createElement(fixture.RequestPhaseBadge, { entry: { phase: 'queued' } })).includes('排队中'))
  const toolbar = document.createElement('div')
  toolbar.id = 'colset-test-toolbar'
  toolbar.innerHTML = '<span data-existing="true">existing</span>'
  document.body.append(toolbar)
  let columnChanges = 0
  const spec = { id: 'fixture-columns', label: 'Fixture table', mount: () => toolbar, columns: [{ key: 'one', label: 'One' }, { key: 'two', label: 'Two' }], onChange: () => { columnChanges++ } }
  let columnHandle
  await React.act(async () => { columnHandle = window.wbColSettings.register(spec) })
  assert.equal(columnHandle.apply(spec.columns).length, 2)
  assert.equal(columnHandle.config().length, 2)
  const colsetButton = toolbar.querySelector('#btn-colset-fixture-columns')
  assert.ok(colsetButton.matches('button[data-slot="button"]'))
  assert.ok(colsetButton.querySelector('svg[data-icon="inline-start"]'))
  assert.equal(toolbar.firstElementChild.dataset.colsetTrigger, spec.id)
  assert.equal(colsetButton.getAttribute('aria-haspopup'), 'dialog')
  colsetButton.getBoundingClientRect = () => ({ x: 40, y: 40, top: 40, left: 40, right: 220, bottom: 70, width: 180, height: 30 })
  const colClick = async () => { await React.act(async () => { colsetButton.dispatchEvent(new MouseEvent('click', { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 25)) }) }
  await colClick()
  assert.equal(colsetButton.getAttribute('aria-expanded'), 'true')
  assert.ok(document.querySelector('[data-slot="popover-content"]'))
  await colClick()
  assert.equal(colsetButton.getAttribute('aria-expanded'), 'false', 'second click closes instead of reopening')
  assert.equal(document.querySelector('[data-slot="popover-content"]'), null)
  await React.act(async () => { window.wbColSettings.register({ ...spec, buttonPlacement: 'last' }) })
  assert.equal(toolbar.querySelectorAll('#btn-colset-fixture-columns').length, 1, 'repeat registration disposes old root')
  assert.equal(toolbar.lastElementChild.dataset.colsetTrigger, spec.id)
  assert.equal(columnChanges, 0, 'register and open/close do not change columns')
  const replacement = toolbar.querySelector('#btn-colset-fixture-columns')
  replacement.getBoundingClientRect = colsetButton.getBoundingClientRect
  await React.act(async () => { replacement.dispatchEvent(new MouseEvent('click', { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 25)) })
  assert.equal(replacement.getAttribute('aria-expanded'), 'true')
  await React.act(async () => { toolbar.remove(); await Promise.resolve() })
  assert.equal(document.querySelector('[data-slot="popover-content"]'), null, 'removing the registered anchor destroys its panel')
  assert.equal(document.getElementById('btn-colset-fixture-columns'), null)
  const host = document.getElementById('root')
  const mounted = createRoot(host)
  const click = async element => { await React.act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true }))) }
  await React.act(async () => mounted.render(React.createElement(fixture.TableFixture)))
  assert.equal(host.querySelectorAll('table > tbody').length, 3, 'valid sibling table sections')
  assert.equal(host.querySelectorAll('table > div').length, 0)
  const tableButton = host.querySelector('button')
  const record = host.querySelector('[data-record]')
  const draft = record.querySelector('input')
  draft.value = 'retained edit'
  assert.equal(tableButton.getAttribute('aria-expanded'), 'false')
  await click(tableButton)
  assert.equal(tableButton.getAttribute('aria-expanded'), 'true')
  const controls = tableButton.getAttribute('aria-controls')
  assert.ok(controls && document.getElementById(controls), 'trigger controls a real table panel')
  await click(tableButton)
  assert.equal(tableButton.getAttribute('aria-expanded'), 'false')
  assert.equal(host.querySelector('[data-record]'), record)
  assert.equal(draft.value, 'retained edit')
  await React.act(async () => mounted.render(React.createElement(fixture.TabsFixture)))
  const first = host.querySelector('[data-retain=one]')
  first.value = 'retained tab draft'
  const triggers = [...host.querySelectorAll('[role=tab]')]
  await click(triggers[1])
  assert.equal(triggers[1].getAttribute('aria-selected'), 'true')
  assert.ok(document.getElementById(triggers[1].getAttribute('aria-controls')))
  await click(triggers[0])
  assert.equal(host.querySelector('[data-retain=one]'), first)
  assert.equal(first.value, 'retained tab draft')
  const data = window.wbConversationPreview.parse(JSON.stringify({ system: 'system prompt', messages: [
    { role: 'user', content: '<script>untrusted</script>' },
    { role: 'assistant', content: [{ type: 'thinking', thinking: 'reason only' }, { type: 'tool_use', name: 'lookup', input: { q: 'value' } }] },
    { role: 'tool', content: 'tool output' },
  ] }), JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'answer' } }] }))
  await React.act(async () => mounted.render(React.createElement(fixture.ConversationView, { data })))
  for (const slot of ['message', 'bubble', 'trace', 'code-block', 'marker']) assert.ok(host.querySelector(`[data-slot="${slot}"]`), slot)
  assert.equal(host.querySelector('script'), null)
  assert.ok(host.textContent.includes('<script>untrusted</script>'))
  assert.ok(host.querySelector('[data-copy="tool output"]'))
  const thought = [...host.querySelectorAll('[data-slot=trace-collapsible-trigger]')].find(node => node.textContent.includes('思考过程'))
  assert.ok(thought)
  await click(thought)
  assert.equal(thought.getAttribute('aria-expanded'), 'true')
  assert.ok(document.getElementById(thought.getAttribute('aria-controls')).textContent.includes('reason only'))
  assert.ok(window.wbConversationPreview.render(data.raw[0].source, '').includes('data-slot="message"'))
  await React.act(async () => mounted.unmount())
  dom.window.close()
  console.log('business UI: actual credit table Collapsible, retained inputs, Tabs relations/retention, Message/Bubble/Trace/CodeBlock/Marker, tool copy, thought expansion, safe text, shared phase timing/Badge, imperative column Button/register/toggle/dispose, legacy render passed')
} finally {
  for (const handle of scheduled) { nativeClearTimeout(handle); nativeClearInterval(handle) }
  globalThis.setTimeout = nativeSetTimeout
  globalThis.clearTimeout = nativeClearTimeout
  globalThis.setInterval = nativeSetInterval
  globalThis.clearInterval = nativeClearInterval
  fs.rmSync(temp, { recursive: true, force: true })
}
// The browser Scheduler keeps a MessageChannel alive in Node after the DOM closes.
process.exit(0)
