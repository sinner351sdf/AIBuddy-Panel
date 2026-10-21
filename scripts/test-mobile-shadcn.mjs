// Exercise the real mobile UI with backend-shaped fixtures, without live provider actions.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
const root = path.resolve(new URL('..', import.meta.url).pathname),
  islands = root + '/desktop-tauri/ui-islands'
const require = createRequire(islands + '/package.json'),
  { buildSync } = require('esbuild'),
  { JSDOM } = require('jsdom'),
  ts = require('typescript')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'a2a-mobile-shadcn-'))
const dom = new JSDOM('<!doctype html><base href="/"><div id="root"></div>', {
  url: 'http://localhost/m',
  pretendToBeVisual: true,
})
for (const key of [
  'window',
  'document',
  'HTMLElement',
  'Element',
  'Node',
  'MouseEvent',
  'KeyboardEvent',
  'Event',
  'MutationObserver',
  'HTMLButtonElement',
  'HTMLInputElement',
  'SVGElement',
  'ShadowRoot',
  'NodeFilter',
  'DocumentFragment',
])
  globalThis[key] = dom.window[key]
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: dom.window.navigator,
})
for (const key of ['localStorage', 'location', 'history'])
  globalThis[key] = dom.window[key]
window.matchMedia = () => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
})
window.wbI18n = {
  t: (s, v = {}) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? `{${k}}`)),
}
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window)
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0)
globalThis.cancelAnimationFrame = clearTimeout
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let reactRoot
try {
  const out = path.join(tmp, 'fixture.cjs')
  buildSync({
    stdin: {
      contents:
        "export {mobileFeatureRequest,mobileAssistantAccess} from './desktop-tauri/mobile/src/lib/features';export * as servers from './desktop-tauri/mobile/src/lib/servers';export {App} from './desktop-tauri/mobile/src/App'; export {GatewayLauncher} from './desktop-tauri/mobile/src/pages/GatewayLauncher';export {ConfirmHost} from './desktop-tauri/mobile/src/components/confirm';export {Fragment} from 'react';export {store} from './desktop-tauri/mobile/src/state/store';export * as mobile from './desktop-tauri/mobile/src/lib/accountLimits';export * as desktop from './desktop-tauri/ui-islands/src/islands/accounts-domain';export {act,createElement} from 'react';export {createRoot} from 'react-dom/client';",
      resolveDir: root,
      loader: 'tsx',
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: out,
    jsx: 'automatic',
    alias: {
      '@ui/navigation-icons':
        root + '/desktop-tauri/ui-kit/src/navigation-icons.ts',
      '@ui': root + '/desktop-tauri/ui-kit/src',
      '@agent2api/ui': root + '/desktop-tauri/ui-kit/src',
      react: path.dirname(require.resolve('react/package.json')),
      'react-dom': path.dirname(require.resolve('react-dom/package.json')),
    },
    nodePaths: [
      islands + '/node_modules',
      root + '/desktop-tauri/mobile/node_modules',
      root + '/desktop-tauri/ui-kit/node_modules',
    ],
    logLevel: 'silent',
  })
  const f = require(out),
    now = Date.now(),
    balanceRule = {
      type: 'balance',
      action: 'skip',
      threshold: 1,
      enabled: true,
    },
    tokenRule = {
      type: 'token',
      action: 'skip',
      threshold: 100,
      reset: 'daily',
      enabled: true,
    }
  const base = { id: 'test', provider: 'catpaw', enabled: true },
    day = f.desktop.kindWindowStart(0)
  const cases = [
    [
      'expired cooldown',
      { rateLimits: { m: { resetAt: now - 1000 } } },
      null,
      false,
    ],
    [
      'future cooldown',
      { rateLimits: { m: { resetAt: now + 60000 } } },
      null,
      true,
    ],
    [
      'invalid cooldown',
      { rateLimits: { m: { resetAt: 'invalid' } } },
      null,
      false,
    ],
    [
      'balance zero',
      { limiters: [balanceRule] },
      { usage: { available: 0 } },
      true,
    ],
    [
      'balance at threshold',
      { limiters: [balanceRule] },
      { usage: { available: 1 } },
      false,
    ],
    [
      'unknown balance',
      { limiters: [balanceRule] },
      { usage: { available: null } },
      false,
    ],
    ['failed balance', { limiters: [balanceRule] }, { error: 'failed' }, false],
    [
      'unlimited balance',
      { limiters: [balanceRule] },
      { usage: { available: 0, unlimited: true } },
      false,
    ],
    [
      'disabled balance rule',
      { limiters: [{ ...balanceRule, enabled: false }] },
      { usage: { available: 0 } },
      false,
    ],
    [
      'disable action not skip',
      { limiters: [{ ...balanceRule, action: 'disable' }] },
      { usage: { available: 0 } },
      false,
    ],
    [
      'current token window',
      { limiters: [tokenRule] },
      null,
      true,
      [{ kind: 0, windowStart: day, used: 100 }],
    ],
    [
      'old token window',
      { limiters: [tokenRule] },
      null,
      false,
      [{ kind: 0, windowStart: day - 86400000, used: 101 }],
    ],
    ['unknown tokens', { limiters: [tokenRule] }, null, false],
    [
      'zcode bucket',
      {
        provider: 'zcode',
        zcodePlan: 'AUTO',
        rateLimits: { 'coding::m': { resetAt: now + 60000 } },
      },
      null,
      true,
    ],
    [
      'disabled account',
      { enabled: false, rateLimits: { m: { resetAt: now + 60000 } } },
      null,
      false,
    ],
  ]
  for (const [label, props, row, expected, readings] of cases) {
    const account = { ...base, ...props },
      snapshot = {
        results: row ? [{ id: account.id, ...row }] : [],
        tokenUsage: { [account.id]: readings },
      }
    const actual = f.mobile.accountLimitState(account, snapshot)
    assert.equal(actual.limited, expected, label)
    assert.equal(
      actual.limited,
      f.desktop.isEnabled(account) &&
        f.desktop.isLimitedNow(account, row?.usage, readings),
      label + ' matches desktop',
    )
  }
  const accounts = [
    {
      id: 'workbuddy-expired',
      provider: 'workbuddy',
      name: 'WorkBuddy expired',
      enabled: true,
      rateLimits: { m: { resetAt: now - 60000 } },
    },
    {
      id: 'zcode-expired',
      provider: 'zcode',
      name: 'ZCode expired',
      enabled: true,
      rateLimits: { m: { resetAt: now - 60000 } },
    },
    {
      id: 'catpaw-zero',
      provider: 'catpaw',
      name: 'CatPaw zero',
      enabled: true,
      limiters: [balanceRule],
    },
    {
      id: 'disabled',
      provider: 'catpaw',
      name: 'Disabled future',
      enabled: false,
      rateLimits: { m: { resetAt: now + 60000 } },
    },
  ]
  let remaining = 0,
    failSession = false,
    failSnapshot = false
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    const route = String(url),
      method = init.method || 'GET'
    calls.push({ url: route, method, body: init.body })
    let data = {}
    if (route === '/api/session' && failSession) return {status:503,ok:false,text:async()=>JSON.stringify({success:false,error:'fixture connection interrupted'})}
    if (route === '/api/session')
      data = {
        health: { upstreamConfigured: true },
        accounts: {
          accounts,
          providers: [
            { id: 'workbuddy', count: 1 },
            { id: 'zcode', count: 1 },
            { id: 'catpaw', count: 2 },
          ],
        },
      }
    else if (route === '/api/accounts/usage/snapshot') {
      if (failSnapshot)
        return {
          status: 503,
          ok: false,
          text: async () =>
            JSON.stringify({ success: false, error: 'offline snapshot' }),
        }
      data = {
        results: [
          { id: 'catpaw-zero', at: now, usage: { available: remaining } },
        ],
        tokenUsage: {},
      }
    } else if (route === '/api/accounts') data = { accounts }
    else if (route.startsWith('/api/checkin-center'))
      data = {
        daily: {
          todayEligible: 0,
          todayDone: 0,
          providers: [],
          outOfScope: [],
        },
      }
    else if (route.startsWith('/api/stats/requests'))
      data = { entries: [], total: 0, matched: 0 }
    else if (route.startsWith('/api/stats/summary'))
      data = {
        overview: {},
        timeline: [],
        models: [],
        accounts: [],
        providers: [],
      }
    else if (route.startsWith('/api/logs')) data = { entries: [], total: 0 }
    else if (route === '/api/keys')
      data = {
        keys: [{ id: 'key1', name: 'Test key', enabled: true }],
        settings: {},
      }
    else if (route === '/api/proxies/pool') data = { items: [] }
    else if (route === '/api/models/manage')
      data = { models: [], providers: [], accounts: [] }
    else if (route === '/api/scheduled-tasks') data = { tasks: [] }
    else if (route === '/api/agents') data = { clients: [] }
    return {
      status: 200,
      ok: true,
      text: async () => JSON.stringify({ success: true, data }),
    }
  }
  localStorage.setItem('agent2api.panelAuth', JSON.stringify({access:'fresh-fixture'}))
  localStorage.setItem('agent2api.panelAuth.origin', JSON.stringify({access:'stale-fixture'}))
  assert.equal(f.servers.readServerAuth('origin').access,'fresh-fixture','mobile and full features use login page tokens')
  f.servers.clearServerAuth('origin')
  assert.equal(f.servers.readServerAuth('origin'),null,'clearing auth cannot resurrect legacy tokens')
  localStorage.setItem('agent2api.webKey.origin','legacy-fixture')
  assert.equal(f.servers.readServerKey('origin'),'legacy-fixture','legacy mobile web key migrates once')
  assert.equal(localStorage.getItem('agent2api.webKey'),'legacy-fixture')
  f.servers.storeServerKey('origin','')
  assert.equal(f.servers.readServerKey('origin'),'')
  f.servers.storeServerKey('remote-fixture','remote-only')
  assert.equal(f.servers.readServerKey('origin'),'','native remote profile keys stay isolated')
  f.servers.storeServerKey('remote-fixture','')
  f.servers.storeServerKey('origin','assistant-fixture')
  f.servers.storeServerAuth('origin','access-fixture','refresh-fixture')
  const assistantHeaders = await f.mobileAssistantAccess()
  assert.equal(assistantHeaders['x-api-key'],'assistant-fixture')
  assert.equal(assistantHeaders['x-panel-token'],'access-fixture')
  f.servers.storeServerKey('origin','');f.servers.clearServerAuth('origin')
  const beforeGuard = calls.length
  await assert.rejects(f.mobileFeatureRequest('GET','https://external.invalid/api/session'), /当前网关/)
  await assert.rejects(f.mobileFeatureRequest('TRACE','/api/session'), /请求方法/)
  assert.equal(calls.length,beforeGuard,'invalid bridge paths never transmit auth headers')
  const wait = () => new Promise((r) => setTimeout(r, 30))
  const click = async (element) => {
    assert.ok(element, 'click target exists')
    await f.act(async () => {
      element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await wait()
    })
  }
  const findButton = (text) =>
    [...document.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === text,
    )
  reactRoot = f.createRoot(document.getElementById('root'))
  await f.act(async () => {
    reactRoot.render(f.createElement(f.App))
    await wait()
  })
  assert.ok(
    document.body.textContent.includes('3 个账号启用 · 1 个限流中'),
    'homepage excludes expired/disabled cooldowns and includes balance skip',
  )
  assert.ok(
    document.querySelector('[data-slot=card]'),
    'homepage uses shared Card',
  )
  assert.ok(
    document.querySelector('[data-slot=progress]'),
    'homepage uses shared Progress',
  )
  assert.equal(
    document.querySelector('nav [aria-label="1 个受限账号"]')?.textContent,
    '1',
    'bottom badge shares the same policy',
  )
  await click(findButton('查看'))
  assert.ok(document.body.textContent.includes('CatPaw zero'))
  assert.ok(!document.body.textContent.includes('WorkBuddy expired'), 'homepage notice opens the limited filter')
  assert.ok(document.querySelector('.m-navbar button'), 'filtered account drilldown has a visible Back control')
  await click(document.querySelector('.m-navbar button'))
  assert.equal(f.store.get().route.screen, 'home', 'Back returns from the homepage restriction notice')
  await click(
    [...document.querySelectorAll('nav [role=tab]')].find(
      (b) => b.textContent === '账号',
    ),
  )
  assert.ok(document.body.textContent.includes('4 个账号 · 3 启用 · 1 限流'))
  await click(
    [...document.querySelectorAll('[role=tab]')].find(
      (b) => b.textContent === '限流1',
    ),
  )
  assert.ok(
    document.body.textContent.includes('CatPaw zero'),
    'limited filter includes balance account',
  )
  assert.ok(
    !document.body.textContent.includes('WorkBuddy expired'),
    'limited filter excludes expired workbuddy',
  )
  assert.ok(
    !document.body.textContent.includes('ZCode expired'),
    'limited filter excludes expired zcode',
  )
  assert.ok(
    !document.body.textContent.includes('Disabled future'),
    'limited filter excludes disabled accounts',
  )
  assert.ok(
    document.body.textContent.includes('余额不足'),
    'row explains balance restriction',
  )
  assert.ok(
    document.querySelector('[data-slot=switch]'),
    'account toggles use Base UI Switch',
  )
  // Open details: expired model records must not be displayed as current cooldowns.
  await click(
    [...document.querySelectorAll('[role=tab]')].find(
      (b) => b.textContent === '全部4',
    ),
  )
  await click(
    [...document.querySelectorAll('button')].find((b) =>
      b.textContent.includes('WorkBuddy expired'),
    ),
  )
  assert.ok(
    document.querySelector('[role=dialog]'),
    'account details use shared Sheet',
  )
  assert.ok(
    !document.querySelector('[role=dialog]').textContent.includes('恢复'),
    'expired model rows are absent',
  )
  await click(findButton('删除'))
  assert.ok(document.querySelector('[role=alertdialog]').classList.contains('z-[1100]'), 'confirmation covers the account sheet')
  assert.ok(document.querySelector('[data-slot=alert-dialog-overlay]').classList.contains('z-[1099]'), 'confirmation backdrop covers the account sheet')
  await click(findButton('取消'))
  assert.ok(document.querySelector('[data-slot=sheet-content]'), 'cancel preserves account details')
  assert.ok(calls.every(call=>call.method==='GET'), 'cancel does not delete the account')
  await f.act(async () => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        bubbles: true,
      }),
    )
    await wait()
  })
  // Fresh cached readings update all three consumers. Failed reads retain the previous snapshot.
  remaining = 5
  await f.act(async () => {
    await f.store.refresh(true)
    await wait()
  })
  assert.ok(
    !document.querySelector('nav [aria-label="1 个受限账号"]'),
    'bottom badge clears when current cached balance recovers',
  )
  failSnapshot = true
  await f.act(async () => {
    await f.store.refresh(true)
    await wait()
  })
  assert.equal(
    f.store.get().balancesSnapshot.results[0].usage.available,
    5,
    'temporary snapshot failures retain last successful read',
  )
  failSnapshot = false
  assert.equal(location.pathname, '/m', 'navigation preserves mobile path despite root asset base')
  // The More hub keeps every destination in the phone shell and labels its live badge.
  await f.act(async () => { f.store.go('more'); await wait() })
  assert.equal(document.querySelectorAll('.m-more button[aria-label="设置"]').length, 1, 'one settings entry without duplicate toolbar action')
  assert(document.querySelector('.more-connection').textContent.includes('已连接'))
  failSession = true
  await f.act(async () => { await f.store.refresh(true); await wait() })
  assert(document.querySelector('.more-connection').textContent.includes('连接异常'), 'a failed refresh cannot present a stale session as currently connected')
  failSession = false
  await f.act(async () => { await f.store.refresh(true); await wait() })
  assert(document.querySelector('.more-connection').textContent.includes('已连接'), 'connection status recovers after a successful read')
  const menu = [
    ['签到中心','checkin'], ['模型管理','models'], ['Agent 接管','agent'], ['网络代理','proxies'],
    ['网关 Key','keys'], ['接口文档','docs'], ['账号','accounts'], ['积分构成','credits'],
    ['请求日志','requests'], ['运行日志','logs'], ['定时任务','tasks'], ['设置','settings'], ['报表','report'], ['网关状态','settings'],
  ]
  for (const [label, target] of menu) {
    const control = document.querySelector(`.m-more button[aria-label="${label}"]`)
    assert(control, 'More entry: ' + label)
    assert.equal(control.dataset.slot, 'item', 'shared shadcn Item owns the action')
    await click(control)
    assert.equal(f.store.get().route.screen, target, 'More destination: ' + label)
    assert.equal(location.pathname, '/m', 'More entry preserves mobile document')
    assert.equal(document.querySelectorAll('iframe').length, 0)
    await f.act(async () => { f.store.back(); await wait() })
    assert.equal(f.store.get().route.screen, 'more', 'More Back: ' + label)
  }
  for (const [label, mode] of [['深色','dark'], ['浅色','light'], ['跟随系统','system']]) {
    const control = [...document.querySelectorAll('.more-theme button')].find(button => button.textContent === label)
    await click(control)
    assert.equal(f.store.get().theme, mode)
    assert.equal(document.documentElement.dataset.theme, mode)
    assert.equal(localStorage.getItem('workbuddy-desktop-theme'), mode, 'theme preference persists locally')
    assert.equal(document.querySelectorAll('.more-theme [aria-pressed=true]').length, 1)
    await click(control)
    assert.equal(f.store.get().theme, mode, 'selected theme cannot toggle to an empty selection')
  }
  remaining = 0
  await f.act(async () => { await f.store.refresh(true); await wait() })
  const limitedMenu = document.querySelector('.m-more button[aria-label="账号"]')
  assert(limitedMenu.textContent.includes('1 个受限'), 'More badge gives count and meaning')
  assert(limitedMenu.textContent.includes('限流或额度限制'), 'More explains why the account needs attention')
  assert(limitedMenu.getAttribute('aria-describedby').includes('more-accounts-badge'), 'screen readers can discover the restriction count')
  remaining = 5
  await f.act(async () => { await f.store.refresh(true); await wait() })
  assert(!document.querySelector('.m-more button[aria-label="账号"] [data-slot=badge]'), 'More badge clears after cached balance recovery')
  // Every route mounts with the real shared UI; read-only navigation sends no mutation requests.
  const routes = [
    'home',
    'report',
    'accounts',
    'assistant',
    'more',
    'checkin',
    'models',
    'keys',
    'proxies',
    'tasks',
    'requests',
    'logs',
    'settings',
    'device-settings',
    'docs',
    'agent',
    'servers',
  ]
  for (const route of routes) {
    const previous = f.store.get().route.screen
    document.querySelector('.m-scroll').scrollTop = 200
    await f.act(async () => {
      f.store.go(route)
      await wait()
    })
    if (previous !== route) assert.equal(document.querySelector('.m-scroll').scrollTop, 0, 'navigation resets content scroll: ' + route)
    assert.ok(
      document.querySelector('.m-page,.m-feature-surface') || route === 'servers',
      'route mounts: ' + route,
    )
    for (const icon of document.querySelectorAll('svg[viewBox="0 0 24 24"]')) assert.ok(icon.hasAttribute('width') && icon.hasAttribute('height'), 'icons have intrinsic dimensions: ' + route)
    for (const control of document.querySelectorAll(
      'button,input,select,textarea',
    )) {
      assert.ok(
        control.dataset.slot ||
          (control.tagName === 'INPUT' &&
            control.id.startsWith('base-ui-') &&
            control.style.clipPath === 'inset(50%)') ||
          control.getAttribute('role') === 'tab' ||
          control.closest('[data-slot=select-content]'),
        'shared component owns ' +
          route +
          ' ' +
          control.outerHTML.slice(0, 120),
      )
    }
  }
  assert.ok(
    calls.every((call) => call.method === 'GET'),
    'navigation and usage reads do not trigger live/provider mutations',
  )
  await f.act(async () => { f.store.go('settings'); await wait() })
  await f.act(async () => { document.dispatchEvent(new window.CustomEvent('aibuddy:mobile-title',{detail:{page:'settings',title:'路由'}})); await wait() })
  assert.equal(document.querySelector('.m-navbar-title').textContent,'路由')
  assert(document.title.startsWith('路由'),'mobile detail updates the task-switcher title')
  assert(!document.querySelector('[aria-label="管理"]'),'settings has one navigation path without a duplicate management entry')
  await f.act(async () => { f.store.go('more'); await wait() })
  // Every formerly reduced feature opens a working editor inside the original
  // mobile navigation shell, never a top-level redirect or a placeholder toast.
  for (const [route, label, panel, action] of [
    ['accounts', '添加账号', 'accounts', 'add'],
    ['accounts', '管理账号', 'accounts', ''],
    ['keys', '新建 Key / 编辑范围与额度', 'keys', ''],
    ['models', '编辑模型 / 映射与能力', 'gateway', ''],
    ['agent', '配置与应用接管', 'agent', ''],
    ['proxies', '新增出口 / 编辑与订阅', 'proxies', ''],
    ['checkin', '自动签到 / 福利与套餐', 'checkin', ''],
  ]) {
    await f.act(async () => {f.store.go(route); await wait()})
    const control = [...document.querySelectorAll('button')].find(button =>
      button.textContent.includes(label) || button.getAttribute('aria-label') === label)
    assert.ok(control, 'working mobile action: ' + label)
    await click(control)
    assert.equal(document.querySelectorAll('iframe').length, 0, 'mobile features never use the desktop document')
    const editor = document.querySelector('.mobile-feature-host')
    assert.ok(editor, 'feature mounts in the phone document: ' + label)
    assert.equal(editor.dataset.page, panel)
    assert.equal(f.store.get().route.params.action || '', action)
    assert.equal(location.pathname, '/m')
    assert.ok(!document.querySelector('nav.m-tabbar'), 'secondary screen has a Back bar')
    assert.ok(location.hash.includes('management?'), 'editor survives a bookmarked/reloaded route')
    await click(document.querySelector('.m-navbar button'))
    assert.equal(f.store.get().route.screen, route, 'Back restores the mobile page')
    assert.ok(!document.querySelector('iframe'))
  }
  assert.ok(calls.every(call => call.method === 'GET'), 'opening editors never applies changes automatically')
  await f.act(async () => {f.store.go('accounts'); await wait()})
  await click([...document.querySelectorAll('button')].find(button => button.textContent.includes('WorkBuddy expired')))
  await click(findButton('编辑账号'))
  assert.equal(f.store.get().route.params.id, f.store.get().session.accounts.accounts.find(account => account.name === 'WorkBuddy expired').id)
  assert.equal(f.store.get().route.params.action, 'edit')
  await click(document.querySelector('.m-navbar button'))
  // Destructive dialogs cancel without requests; confirmation still sends the original payload.
  await f.act(async () => {
    f.store.go('keys')
    await wait()
  })
  await click(findButton('删除'))
  assert.ok(
    document.querySelector('[role=alertdialog]'),
    'destructive actions use shared AlertDialog',
  )
  await click(findButton('取消'))
  assert.ok(
    !calls.some((call) => call.method === 'DELETE'),
    'cancel is non-mutating',
  )
  await click(findButton('删除'))
  await click(findButton('确认'))
  assert.ok(
    calls.some(
      (call) => call.method === 'DELETE' && call.url === '/api/keys/key1',
    ),
    'confirmation preserves the existing action',
  )
  // Catch future regressions to hand-built native controls and independent palettes.
  // Packaged APK service selection uses native local runtime and the SAME full web panel.
  const nativeCalls=[]
  let localRunning=false
  const bridge={
    status:async()=>({running:localRunning,base:'http://127.0.0.1:3065',version:'3.1.0'}),
    start:async options=>{nativeCalls.push(['start',options]);localRunning=true;return {running:true,base:'http://127.0.0.1:3065',version:'3.1.0'}},
    stop:async()=>{nativeCalls.push(['stop']);localRunning=false;return {running:false}},
    openDashboard:async options=>{nativeCalls.push(['open',options])},
  }
  await f.act(async()=>{reactRoot.render(f.createElement(f.Fragment,null,f.createElement(f.GatewayLauncher,{bridge}),f.createElement(f.ConfirmHost)));await wait()})
  await click(findButton('启动本机网关'))
  assert.deepEqual(nativeCalls[0],['start',{port:3065}])
  assert.ok(document.body.textContent.includes('http://127.0.0.1:3065/v1'))
  await click(findButton('打开管理面板'))
  assert.deepEqual(nativeCalls[1],['open',{url:'http://127.0.0.1:3065',name:'本机网关'}])
  await click(findButton('停止'))
  assert.ok(findButton('启动本机网关'),'local stop restores the start action')
  const change=async(id,value)=>{await f.act(async()=>{const input=document.getElementById(id);Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));await wait()})}
  await change('remote-gateway-address','192.168.1.50:3065/m')
  await change('remote-gateway-name','Home')
  await click(findButton('保存远程连接'))
  await change('remote-gateway-address','https://gateway.example.com')
  await change('remote-gateway-name','Cloud')
  await click(findButton('保存远程连接'))
  assert.ok(document.body.textContent.includes('Home')&&document.body.textContent.includes('Cloud'),'multiple remote services are preserved')
  await click([...document.querySelectorAll('button')].find(b=>b.textContent.includes('Home')&&b.textContent.includes('192.168.1.50')))
  assert.deepEqual(nativeCalls.at(-1),['open',{url:'http://192.168.1.50:3065',name:'Home'}],'remote opens its own full same-origin panel, without exporting credentials')
  await change('local-gateway-port','0');await click(findButton('启动本机网关'))
  assert.ok(document.body.textContent.includes('端口需为 1024–65535 的整数'))
  assert.equal(nativeCalls.filter(c=>c[0]==='start').length,1,'invalid port does not start native code')
  for (const directory of ['pages', 'components'])
    for (const name of fs.readdirSync(
      root + '/desktop-tauri/mobile/src/' + directory,
    )) {
      if (!name.endsWith('.tsx')) continue
      const filename =
          root + '/desktop-tauri/mobile/src/' + directory + '/' + name,
        source = fs.readFileSync(filename, 'utf8'),
        ast = ts.createSourceFile(
          filename,
          source,
          ts.ScriptTarget.Latest,
          true,
          ts.ScriptKind.TSX,
        )
      function walk(node) {
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
          // Base UI's documented render prop changes the semantic tag while Item still owns behavior/styles.
          const expression = node.parent, attribute = expression?.parent, owner = attribute?.parent?.parent
          const composedItem = node.tagName.getText(ast) === 'button' && ts.isJsxExpression(expression) &&
            ts.isJsxAttribute(attribute) && attribute.name.getText(ast) === 'render' &&
            (ts.isJsxOpeningElement(owner) || ts.isJsxSelfClosingElement(owner)) && owner.tagName.getText(ast) === 'Item'
          assert.ok(
            composedItem || !['button', 'input', 'select', 'textarea', 'progress'].includes(node.tagName.getText(ast)),
            name + ' must consume shared controls',
          )
        }
        ts.forEachChild(node, walk)
      }
      walk(ast)
      assert.ok(
        !/Object\.keys\([^)]*rateLimits/.test(source),
        name + ' must share the desktop limiter',
      )
    }
  const css = fs.readFileSync(
    root + '/desktop-tauri/mobile/src/styles/mobile.css',
    'utf8',
  )
  assert.ok(
    !/oklch\(|#[\da-f]{3}|rgba?\(/i.test(css),
    'mobile consumes shared theme instead of independent colors',
  )
  console.log(
    `PASS: ${cases.length} desktop/mobile limiter cases; homepage, filter, details and bottom badge; ${routes.length} real routes, 7 in-document management flows with Back navigation; shared controls; confirmation cancel/submit; read-only snapshot refresh; native local start/stop/open and multiple remote services`,
  )
} finally {
  if (reactRoot) {
    globalThis.IS_REACT_ACT_ENVIRONMENT = false
    reactRoot.unmount()
  }
  dom.window.close()
  fs.rmSync(tmp, { recursive: true, force: true })
}
process.exit(0)
