// Render the actual navigation island and ui-kit in jsdom. All page changes,
// identity/status roots, storage and media queries belong to this fixture only.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const islands = path.join(root, 'desktop-tauri/ui-islands')
const require = createRequire(path.join(islands, 'package.json'))
const { buildSync } = require('esbuild')
const { JSDOM } = require('jsdom')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent2api-navigation-'))
const nativeSetTimeout = globalThis.setTimeout
const nativeClearTimeout = globalThis.clearTimeout
const nativeSetInterval = globalThis.setInterval
const nativeClearInterval = globalThis.clearInterval
const scheduled = new Set()
globalThis.setTimeout = (callback, delay, ...args) => {
  const handle = nativeSetTimeout(() => { scheduled.delete(handle); callback(...args) }, delay)
  scheduled.add(handle)
  return handle
}
globalThis.clearTimeout = handle => { scheduled.delete(handle); nativeClearTimeout(handle) }
globalThis.setInterval = (callback, delay, ...args) => {
  const handle = nativeSetInterval(callback, delay, ...args)
  scheduled.add(handle)
  return handle
}
globalThis.clearInterval = handle => { scheduled.delete(handle); nativeClearInterval(handle) }

let dom
let fixture
let retainedRoots = []
try {
  const output = path.join(temp, 'navigation.cjs')
  buildSync({
    stdin: {
      contents: `
        import * as React from 'react';
        import { createRoot } from 'react-dom/client';
        import './src/islands/shell-navigation';
        export { React, createRoot };
        export function RetainedCounter({kind}) {
          const [count,setCount]=React.useState(0);
          return <><button data-retained-counter={kind} onClick={()=>setCount(value=>value+1)}>{count}</button><input data-retained-input={kind} defaultValue={kind+' draft'}/></>;
        }
      `,
      loader: 'tsx', resolveDir: islands,
    },
    bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', outfile: output,
    alias: {
      '@ui/navigation-icons': path.join(root, 'desktop-tauri/ui-kit/src/navigation-icons.ts'),
      '@ui': path.join(root, 'desktop-tauri/ui-kit/src/index.ts'),
      react: path.dirname(require.resolve('react/package.json')),
      'react-dom': path.dirname(require.resolve('react-dom/package.json')),
    },
    nodePaths: [path.join(islands, 'node_modules'), path.join(root, 'desktop-tauri/ui-kit/node_modules')],
    logLevel: 'silent',
  })

  const pages = ['overview', 'accounts', 'credits', 'checkin', 'gateway', 'proxies', 'keys', 'docs', 'requests', 'logs', 'tasks', 'settings']
  dom = new JSDOM(`<!doctype html><html><body>
    <div id="shell-sidebar-trigger-host"></div><div id="shell-sidebar-root"></div>
    <div id="shell-sidebar-assets" hidden><div id="shell-brand"><span>Fixture brand</span></div><div id="sidebar-status"></div><div id="sidebar-user"></div></div>
    <main>${pages.map((page, index) => `<section class="page${index === 0 ? ' active' : ''}" data-page="${page}"></section>`).join('')}</main>
    <input id="outside-input"><textarea id="outside-textarea"></textarea><div id="outside-editable" contenteditable="true"><span id="nested-editable">edit</span></div><button id="outside-button">outside</button>
  </body></html>`, { url: 'http://navigation.fixture.invalid/', pretendToBeVisual: true })
  for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'DocumentFragment', 'ShadowRoot', 'MouseEvent', 'KeyboardEvent', 'Event', 'CustomEvent', 'FocusEvent', 'MutationObserver', 'HTMLButtonElement', 'HTMLInputElement', 'HTMLTextAreaElement']) {
    globalThis[key] = dom.window[key]
  }
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: dom.window.localStorage })
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window)
  globalThis.requestAnimationFrame = callback => setTimeout(callback, 0)
  globalThis.cancelAnimationFrame = clearTimeout
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.requestAnimationFrame = globalThis.requestAnimationFrame
  window.cancelAnimationFrame = globalThis.cancelAnimationFrame
  window.ResizeObserver = globalThis.ResizeObserver
  window.wbI18n = { t: text => text }
  Object.defineProperty(document, 'readyState', { configurable: true, value: 'loading' })
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1400 })
  const media = new Map()
  const matches = query => {
    const max = query.match(/max-width:\s*(\d+)px/)
    const min = query.match(/min-width:\s*(\d+)px/)
    return max ? window.innerWidth <= Number(max[1]) : min ? window.innerWidth >= Number(min[1]) : false
  }
  window.matchMedia = query => {
    if (!media.has(query)) {
      const listeners = new Set()
      media.set(query, {
        media: query, matches: matches(query), listeners,
        addEventListener: (type, listener) => { if (type === 'change') listeners.add(listener) },
        removeEventListener: (type, listener) => { if (type === 'change') listeners.delete(listener) },
        addListener: listener => listeners.add(listener), removeListener: listener => listeners.delete(listener),
      })
    }
    return media.get(query)
  }
  localStorage.setItem('aibuddy-sidebar-collapsed', '1')
  localStorage.setItem('nav-group-forward', 'closed')
  localStorage.setItem('nav-group-ops', 'closed')
  localStorage.setItem('workbuddy-desktop-theme', 'light')
  const routes = []
  window.wbApp = {
    showPage(page) {
      assert.ok(pages.includes(page), `unknown route: ${page}`)
      routes.push(page)
      document.querySelectorAll('.page').forEach(node => node.classList.toggle('active', node.dataset.page === page))
      window.wbShell.syncPage()
    },
    applyTheme(mode) {
      localStorage.setItem('workbuddy-desktop-theme', mode)
      window.dispatchEvent(new CustomEvent('wb:theme', { detail: mode }))
    },
  }
  fixture = require(output)
  const { React, createRoot, RetainedCounter } = fixture
  const act = async run => { await React.act(async () => { await run(); await Promise.resolve() }) }
  const click = async node => {
    assert.ok(node, 'click target must exist')
    await act(() => node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))
  }
  const key = async (target, options = {}) => {
    const event = new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true, cancelable: true, ...options })
    await act(() => target.dispatchEvent(event))
    return event
  }
  const viewport = async width => {
    await act(() => {
      window.innerWidth = width
      for (const mql of media.values()) {
        const next = matches(mql.media)
        if (next === mql.matches) continue
        mql.matches = next
        for (const listener of mql.listeners) listener({ matches: next, media: mql.media })
      }
      window.dispatchEvent(new Event('resize'))
    })
  }
  const trigger = () => document.getElementById('shell-sidebar-trigger')
  const group = id => document.getElementById('nav-group-toggle-' + id)
  const nav = page => document.querySelector(`#nav .nav-item[data-page="${page}"]`)
  const assets = document.getElementById('shell-sidebar-assets')
  const brand = document.getElementById('shell-brand')
  const account = document.getElementById('sidebar-user')
  const status = document.getElementById('sidebar-status')
  retainedRoots = [createRoot(account), createRoot(status)]
  await act(() => {
    retainedRoots[0].render(React.createElement(RetainedCounter, { kind: 'account' }))
    retainedRoots[1].render(React.createElement(RetainedCounter, { kind: 'status' }))
  })
  const accountButton = account.querySelector('button')
  const statusButton = status.querySelector('button')
  const accountInput = account.querySelector('input')
  accountInput.value = 'retained account draft'
  await click(accountButton)
  await click(statusButton)
  await act(() => document.dispatchEvent(new Event('DOMContentLoaded')))

  assert.equal(document.body.classList.contains('shell-collapsed'), true, 'restore the existing collapsed storage key')
  assert.equal(trigger().getAttribute('aria-expanded'), 'false')
  assert.equal(document.querySelectorAll('#nav .nav-item[data-page]').length, 14, 'collapsed rail renders all routes including the assistant')
  assert.equal(group('forward').getAttribute('aria-expanded'), 'true')
  assert.equal(localStorage.getItem('nav-group-forward'), 'closed', 'rail expansion must not overwrite the saved group state')
  assert.equal(document.querySelector('#shell-sidebar #sidebar-user'), account)
  assert.equal(document.querySelector('#shell-sidebar #sidebar-status'), status)

  await click(trigger())
  assert.equal(localStorage.getItem('aibuddy-sidebar-collapsed'), '0')
  assert.match(document.cookie, /sidebar_state=true/)
  assert.equal(document.body.classList.contains('shell-collapsed'), false)
  assert.equal(group('forward').getAttribute('aria-expanded'), 'false', 'restoring full width restores the saved closed group')
  for (const id of ['outside-input', 'outside-textarea', 'outside-editable', 'nested-editable']) {
    const event = await key(document.getElementById(id))
    assert.equal(event.defaultPrevented, false, `editing in ${id} must keep its shortcut`)
    assert.equal(trigger().getAttribute('aria-expanded'), 'true')
  }
  const prevented = new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true, cancelable: true })
  prevented.preventDefault()
  await act(() => document.getElementById('outside-button').dispatchEvent(prevented))
  assert.equal(trigger().getAttribute('aria-expanded'), 'true')
  await key(document.getElementById('outside-button'))
  assert.equal(localStorage.getItem('aibuddy-sidebar-collapsed'), '1')
  assert.equal(group('forward').getAttribute('aria-expanded'), 'true')
  await key(document.getElementById('outside-button'), { ctrlKey: false, metaKey: true })
  assert.equal(trigger().getAttribute('aria-expanded'), 'true')
  assert.equal(group('forward').getAttribute('aria-expanded'), 'false')
  const overlay = document.createElement('div')
  overlay.setAttribute('data-slot', 'dialog-content'); overlay.setAttribute('data-open', '')
  document.body.append(overlay)
  await key(document.getElementById('outside-button'))
  assert.equal(trigger().getAttribute('aria-expanded'), 'true', 'an open overlay must prevent the sidebar shortcut')
  overlay.remove()

  await click(group('forward'))
  assert.equal(localStorage.getItem('nav-group-forward'), 'open')
  assert.equal(document.getElementById(group('forward').getAttribute('aria-controls')).id, 'nav-group-forward')
  await click(group('forward'))
  assert.equal(localStorage.getItem('nav-group-forward'), 'closed')
  await act(() => window.wbApp.showPage('proxies'))
  assert.equal(group('forward').getAttribute('aria-expanded'), 'true', 'syncPage opens the active route group')
  assert.equal(localStorage.getItem('nav-group-forward'), 'open')

  const requestsBadge = window.wbShell.badgeHandle('nav-count-requests')
  const logsBadge = window.wbShell.badgeHandle('nav-count-logs')
  const updateBadge = window.wbShell.badgeHandle('nav-count-update')
  assert.equal(window.wbShell.badgeHandle('nav-count-requests'), requestsBadge)
  await act(() => {
    requestsBadge.textContent = '128'
    requestsBadge.title = 'fixture request count'
    requestsBadge.style.display = 'inline-flex'
    requestsBadge.classList.add('is-running')
    logsBadge.textContent = '3'
    logsBadge.title = 'fixture system log count'
    logsBadge.style.display = ''
    updateBadge.textContent = '1'
    updateBadge.title = 'fixture update available'
    updateBadge.style.display = ''
  })
  assert.equal(requestsBadge.textContent, '128', 'badge state exists even while its group is unmounted')
  assert.equal(requestsBadge.title, 'fixture request count')
  await click(group('ops'))
  const assertBadge = () => {
    const badge = document.getElementById('nav-count-requests')
    assert.ok(badge)
    assert.equal(badge.textContent, '128')
    assert.equal(badge.getAttribute('title'), 'fixture request count')
    assert.equal(badge.getAttribute('data-tone'), 'success')
    for (const [id, handle, text] of [['nav-count-logs', logsBadge, '3'], ['nav-count-update', updateBadge, '1']]) {
      assert.equal(window.wbShell.badgeHandle(id), handle)
      assert.equal(document.getElementById(id)?.textContent, text)
      assert.equal(document.getElementById(id)?.getAttribute('title'), handle.title)
    }
  }
  assertBadge()
  const start = routes.length
  for (const page of pages) {
    await click(nav(page))
    assert.equal(document.querySelector('#nav .nav-item[aria-current="page"]')?.dataset.page, page)
    assert.equal(document.querySelectorAll('#nav .nav-item.active').length, 1)
    assert.equal(document.querySelector('.page.active')?.dataset.page, page)
  }
  assert.deepEqual(routes.slice(start), pages)
  await act(() => { requestsBadge.style.display = 'none' })
  assert.equal(document.getElementById('nav-count-requests'), null)
  assert.equal(requestsBadge.textContent, '128')
  await act(() => { requestsBadge.style.display = ''; requestsBadge.classList.remove('is-running') })
  assert.equal(document.getElementById('nav-count-requests').getAttribute('data-tone'), 'destructive')
  await act(() => { requestsBadge.classList.add('is-running') })
  assertBadge()

  await click(document.querySelector('#theme-switch [data-mode="dark"]'))
  assert.equal(localStorage.getItem('workbuddy-desktop-theme'), 'dark')
  assert.equal(document.querySelector('#theme-switch [data-mode="dark"]').getAttribute('aria-pressed'), 'true')
  await act(() => window.wbApp.applyTheme('system'))
  assert.equal(document.querySelector('#theme-switch [data-mode="system"]').getAttribute('aria-pressed'), 'true')

  const assertRetained = (parent = '#shell-sidebar') => {
    assert.equal(document.getElementById('shell-brand'), brand)
    assert.equal(document.querySelector(`${parent} #sidebar-user`), account)
    assert.equal(document.querySelector(`${parent} #sidebar-status`), status)
    assert.equal(account.querySelector('button'), accountButton)
    assert.equal(status.querySelector('button'), statusButton)
    assert.equal(accountButton.textContent, '1')
    assert.equal(statusButton.textContent, '1')
    assert.equal(account.querySelector('input'), accountInput)
    assert.equal(accountInput.value, 'retained account draft')
  }
  await viewport(1001)
  assert.equal(document.getElementById('shell-sidebar').hasAttribute('data-mobile'), false, '1001px remains desktop')
  await viewport(1000)
  assert.equal(document.getElementById('shell-sidebar'), null, '1000px starts with the mobile Sheet closed')
  assertRetained('#shell-sidebar-assets')
  assert.equal(account.parentElement, assets)
  await click(trigger())
  assert.equal(document.getElementById('shell-sidebar').getAttribute('data-mobile'), 'true')
  assert.equal(document.getElementById('shell-sidebar').getAttribute('role'), 'dialog')
  assert.equal(document.body.classList.contains('pref-mobile-open'), true)
  assertRetained()
  assertBadge()
  await click(document.getElementById('shell-sidebar-close'))
  assert.equal(document.getElementById('shell-sidebar'), null)
  assertRetained('#shell-sidebar-assets')
  await click(trigger())
  assertRetained()
  await click(nav('accounts'))
  assert.equal(document.getElementById('shell-sidebar'), null, 'mobile route selection closes the Sheet')
  assert.equal(document.body.classList.contains('pref-mobile-open'), false)
  assertRetained('#shell-sidebar-assets')
  await click(trigger())
  assertRetained()
  await viewport(1400)
  assert.equal(document.getElementById('shell-sidebar').hasAttribute('data-mobile'), false)
  assertRetained()
  assertBadge()
  assert.equal(localStorage.getItem('aibuddy-sidebar-collapsed'), '0', 'mobile Sheet toggles must not rewrite desktop collapse preference')
  await click(accountButton)
  await click(statusButton)
  assert.equal(accountButton.textContent, '2', 'the retained account React root remains interactive')
  assert.equal(statusButton.textContent, '2', 'the retained status React root remains interactive')
  await act(() => retainedRoots.forEach(root => root.unmount()))
  retainedRoots = []
  console.log('PASS: real shell navigation: 14 routes, collapsed persistence/cookie, keyboard editing and overlay guards, group persistence/active reveal, badge handle retention, theme bridge, 1000px mobile Sheet and retained live account/status roots')
} finally {
  if (fixture && retainedRoots.length) await fixture.React.act(async () => retainedRoots.forEach(root => root.unmount()))
  dom?.window.close()
  for (const handle of scheduled) { nativeClearTimeout(handle); nativeClearInterval(handle) }
  globalThis.setTimeout = nativeSetTimeout
  globalThis.clearTimeout = nativeClearTimeout
  globalThis.setInterval = nativeSetInterval
  globalThis.clearInterval = nativeClearInterval
  fs.rmSync(temp, { recursive: true, force: true })
}
// React's browser Scheduler retains a MessageChannel in Node after jsdom closes.
process.exit(0)
