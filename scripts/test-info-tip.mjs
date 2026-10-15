// Exercise the actual composed help control; no task APIs or settings are touched.
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
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent2api-info-tip-'))
const dom = new JSDOM('<!doctype html><div id="fixture"></div>', { url: 'http://localhost/' })
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'MouseEvent', 'KeyboardEvent', 'MutationObserver', 'HTMLButtonElement']) globalThis[key] = dom.window[key]
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window)
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0)
globalThis.cancelAnimationFrame = clearTimeout
globalThis.IS_REACT_ACT_ENVIRONMENT = true
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
window.wbI18n = { t: text => text }
let mounted, React
try {
  const file = path.join(temp, 'fixture.cjs')
  buildSync({ stdin: { contents: `export * as React from 'react'; export { createRoot } from 'react-dom/client'; export { InfoTip } from './src/components/info-tip';`, loader: 'tsx', resolveDir: islands },
    bundle: true, platform: 'node', format: 'cjs', outfile: file, jsx: 'automatic',
    alias: { '@ui': path.join(root, 'desktop-tauri/ui-kit/src'), react: path.dirname(require.resolve('react/package.json')), 'react-dom': path.dirname(require.resolve('react-dom/package.json')) },
    nodePaths: [path.join(islands, 'node_modules'), path.join(root, 'desktop-tauri/ui-kit/node_modules')], logLevel: 'silent' })
  const fixture = require(file)
  React = fixture.React
  const host = document.getElementById('fixture')
  mounted = fixture.createRoot(host)
  const text = '完整说明：只刷新已过期或临期的凭证。'
  const render = async content => React.act(async () => mounted.render(React.createElement(fixture.InfoTip, null, content)))
  const click = async el => React.act(async () => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))
  await render(text)
  const trigger = host.querySelector('button[aria-label="说明"]')
  assert.ok(trigger)
  assert.equal(host.querySelectorAll('button').length, 1, 'composed triggers share one real button')
  assert.equal(document.querySelector('[data-slot="popover-content"]'), null)
  await React.act(async () => {
    trigger.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }))
    trigger.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 10, clientY: 10 }))
    await new Promise(resolve => setTimeout(resolve, 180))
  })
  assert.equal(document.querySelector('[data-slot="tooltip-content"]').textContent, text, 'hover shows original text after the short delay')
  await click(trigger)
  assert.equal(document.querySelector('[data-slot="popover-content"]').textContent, text, 'click opens the original help text')
  assert.equal(trigger.getAttribute('aria-expanded'), 'true')
  assert.equal(document.querySelector('[data-slot="tooltip-content"]'), null, 'click does not stack hover and pinned bubbles')
  await click(trigger)
  assert.equal(trigger.getAttribute('aria-expanded'), 'false', 'second click closes pinned help')
  await click(trigger)
  await React.act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  assert.equal(trigger.getAttribute('aria-expanded'), 'false', 'Escape dismisses pinned help')
  await render(null)
  assert.equal(host.querySelector('button'), null, 'empty descriptions do not create dead help buttons')
  console.log('PASS: InfoTip hover, click, original text, shared trigger, Escape, toggle and empty-content handling')
} finally {
  if (mounted) await React.act(async () => mounted.unmount())
  dom.window.close()
  fs.rmSync(temp, { recursive: true, force: true })
}

// React's browser Scheduler retains its MessageChannel after the isolated DOM closes.
process.exit(0)
