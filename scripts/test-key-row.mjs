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
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent2api-key-row-'))
const dom = new JSDOM('<!doctype html><div id="fixture"></div>', { url: 'http://localhost/' })
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'MouseEvent', 'KeyboardEvent', 'MutationObserver', 'HTMLButtonElement']) globalThis[key] = dom.window[key]
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window)
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0)
globalThis.cancelAnimationFrame = clearTimeout
globalThis.IS_REACT_ACT_ENVIRONMENT = true
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
window.wbI18n = { t: (text, vars = {}) => text.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? `{${key}}`)) }
let mounted, reactRef
try {
  const file = path.join(temp, 'fixture.cjs')
  buildSync({ stdin: { contents: `import * as React from 'react'; import { createRoot } from 'react-dom/client'; import { renderToStaticMarkup } from 'react-dom/server'; import { KeyValue, KeyRowActions } from './src/islands/keys-page'; import { Pager } from '@ui'; import { TableFooter } from './src/islands/table-shell'; export { React, createRoot, KeyRowActions, Pager, TableFooter, renderToStaticMarkup }; export function ValueFixture(){ const [shown,setShown]=React.useState(false);return <KeyValue value='fixture-secret-not-a-real-key' masked='fixture…masked' shown={shown} onToggle={()=>setShown(value=>!value)}/> }`, loader: 'tsx', resolveDir: islands },
    bundle: true, platform: 'node', format: 'cjs', outfile: file, jsx: 'automatic',
    alias: { '@ui': path.join(root, 'desktop-tauri/ui-kit/src'), react: path.dirname(require.resolve('react/package.json')), 'react-dom': path.dirname(require.resolve('react-dom/package.json')) },
    nodePaths: [path.join(islands, 'node_modules'), path.join(root, 'desktop-tauri/ui-kit/node_modules')], logLevel: 'silent' })
  const { React, createRoot, KeyRowActions, ValueFixture, Pager, TableFooter, renderToStaticMarkup } = require(file)
  reactRef = React
  const host = document.getElementById('fixture')
  mounted = createRoot(host)
  const click = async el => React.act(async () => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))
  await React.act(async () => mounted.render(React.createElement(ValueFixture)))
  assert.equal(host.querySelector('code').textContent, 'fixture…masked')
  const reveal = host.querySelector('[aria-label="显示 Key 明文"]')
  const copy = host.querySelector('[aria-label="复制 Key"]')
  assert.ok(reveal.querySelector('svg[data-icon]') && copy.querySelector('svg[data-icon]'))
  assert.equal(copy.textContent, '')
  assert.equal(copy.dataset.copy, 'fixture-secret-not-a-real-key', 'copy always delegates the full value without touching clipboard')
  await click(reveal)
  assert.equal(host.querySelector('code').textContent, 'fixture-secret-not-a-real-key')
  assert.equal(reveal.getAttribute('aria-pressed'), 'true')
  await click(reveal)
  assert.equal(host.querySelector('code').textContent, 'fixture…masked')
  const calls = []
  const props = { disabled: false, onQuickAccess: () => calls.push('quick'), onRestrictions: () => calls.push('scope'), onQuota: () => calls.push('quota'), onRemove: () => calls.push('remove') }
  await React.act(async () => mounted.render(React.createElement(KeyRowActions, props)))
  await click([...host.querySelectorAll('button')].find(n => n.textContent === '快速接入'))
  for (const [label, expected] of [['可用范围', 'scope'], ['额度管理', 'quota'], ['删除', 'remove']]) {
    await click(host.querySelector('[aria-label="更多操作"]'))
    const item = [...document.querySelectorAll('[role=menuitem]')].find(n => n.textContent === label)
    assert.ok(item, label + ' remains available')
    await click(item)
    assert.equal(calls.at(-1), expected)
  }
  assert.deepEqual(calls, ['quick', 'scope', 'quota', 'remove'])
  await React.act(async () => mounted.render(React.createElement(KeyRowActions, { ...props, disabled: true })))
  assert.ok([...host.querySelectorAll('button')].every(n => n.disabled), 'pending row guards both actions')
  const pageCalls = []
  await React.act(async () => mounted.render(React.createElement(Pager, { page: 2, pageCount: 3, onPageChange: value => pageCalls.push(value) })))
  assert.ok(host.querySelector('nav[data-slot="pagination"] ul[data-slot="pagination-content"]'))
  const pagerButtons = [...host.querySelectorAll('[data-slot="pagination"] button')]
  assert.deepEqual(pagerButtons.map(button => button.getAttribute('aria-label')), ['上一页', '下一页'])
  assert.ok(pagerButtons.every(button => button.textContent === '' && button.querySelector('svg[data-icon]')), 'both navigation buttons are icons only')
  assert.equal(host.querySelector('[data-slot="pager-info"]').textContent, '第 2 / 3 页')
  assert.ok(host.querySelector('[data-slot="pager-info"]').classList.contains('sr-only'), 'page summary is separate from clickable numeric pages')
  const pageLinks = [...host.querySelectorAll('[data-slot="pagination-link"]')]
  assert.deepEqual(pageLinks.map(link => link.textContent), ['1', '2', '3'])
  assert.equal(host.querySelector('[aria-current="page"]').textContent, '2', 'active page uses the official PaginationLink state')
  await click(pagerButtons[0]); await click(pagerButtons[1])
  assert.deepEqual(pageCalls, [1, 3], 'page actions keep their offset-facing page contract')
  await click(pageLinks[1])
  assert.deepEqual(pageCalls, [1, 3], 'clicking the active page does not reload it')
  await click(pageLinks[2])
  assert.deepEqual(pageCalls, [1, 3, 3], 'numeric pages navigate directly')
  assert.equal(window.location.hash, '', 'page clicks do not navigate the document hash')
  for (const props of [{page:1,pageCount:1}, {page:0,pageCount:0}, {page:2,pageCount:3,disabled:true}]) {
    await React.act(async () => mounted.render(React.createElement(Pager, { ...props, onPageChange: value => pageCalls.push(value) })))
    assert.ok([...host.querySelectorAll('[data-slot="pagination"] button')].every(button => button.disabled))
    if (props.disabled) {
      assert.ok([...host.querySelectorAll('[data-slot="pagination-link"]')].every(link => link.getAttribute('aria-disabled') === 'true'))
      const before = pageCalls.length
      await click(host.querySelector('[data-slot="pagination-link"]'))
      assert.equal(pageCalls.length, before, 'pending numbered links cannot change pages')
    }
  }
  for (const page of [1, 50, 100]) {
    const container = document.createElement('div')
    container.innerHTML = renderToStaticMarkup(React.createElement(Pager, { page, pageCount: 100, onPageChange() {} }))
    const numbers = [...container.querySelectorAll('[data-slot="pagination-link"]')].map(link => Number(link.textContent))
    assert.equal(numbers[0], 1)
    assert.equal(numbers.at(-1), 100)
    assert.ok(numbers.includes(page) && numbers.length <= 7, 'large page counts retain first, last and current pages in a bounded range')
    assert.equal(container.querySelector('[aria-current="page"]').textContent, String(page))
    assert.ok(container.querySelector('[data-slot="pagination-ellipsis"]'))
  }
  const footerProps = { page: 1, pageCount: 1, size: 50, onSizeChange() {}, onPageChange() {} }
  const footer = props => {
    const container = document.createElement('div')
    container.innerHTML = renderToStaticMarkup(React.createElement(TableFooter, { ...footerProps, ...props }))
    return container
  }
  for (const total of [0, 1, 20]) {
    const result = footer({ total, leading: '保留说明' })
    assert.equal(result.querySelector('.table-foot-count').textContent, `共 ${total} 条`)
    assert.ok(result.querySelector('[role="combobox"]'), 'row size remains available on empty and single pages')
    assert.ok([...result.querySelectorAll('[data-slot="pagination"] button')].every(button => button.disabled), 'single-page icon actions are disabled')
    const trigger = result.querySelector('[role="combobox"]')
    assert.equal(result.querySelector('label').htmlFor, trigger.id)
    assert.ok(result.textContent.includes('保留说明'))
  }
  for (const size of [50, 'all']) {
    const result = footer({ total: 40, size })
    assert.ok(result.querySelector('[role="combobox"]'), 'large single pages can still reduce the page size')
    assert.equal(result.querySelectorAll('[data-slot="pagination"] button').length, 2)
  }
  const multi = footer({ total: 280, page: 2, pageCount: 6, range: {start:51,end:100} })
  assert.equal(multi.querySelector('.table-foot-count').textContent, '共 280 条')
  assert.ok(multi.querySelector('.table-foot-count').title.includes('51–100'), 'range remains available as a hint')
  assert.equal(multi.querySelector('.table-foot-jump input'), null, 'short page lists do not need a jump field')
  assert.equal(multi.querySelectorAll('[data-slot="pagination"] button').length, 2)
  const long = footer({ total: 500, pageCount: 10, disabled: true })
  assert.equal(long.querySelector('.table-foot-jump'), null, 'icons-only pagination has no separate jump field')
  assert.ok([...long.querySelectorAll('button')].every(button => button.disabled))
  console.log('PASS: Key controls, numeric page navigation/current state, hash prevention, pending guards, large-page ellipses and row sizes (fixture data only)')
} finally {
  if (mounted) await reactRef.act(async () => { mounted.unmount(); dom.window.close() })
  else dom.window.close()
  fs.rmSync(temp, { recursive: true, force: true })
}

// React's browser Scheduler retains its MessageChannel after this isolated DOM closes.
process.exit(0)
