// Real mobile auth/client sources, deterministic HTTP fixtures, no live credentials or server writes.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import test from 'node:test'

const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(new URL('../desktop-tauri/ui-islands/package.json', import.meta.url))
const { buildSync } = require('esbuild')
const source = buildSync({
  stdin: {
    contents: "export * as client from './desktop-tauri/mobile/src/api/client'; export * as auth from './desktop-tauri/mobile/src/api/auth'; export * as servers from './desktop-tauri/mobile/src/lib/servers'",
    resolveDir: root,
  },
  bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent',
}).outputFiles[0].text

const settle = () => new Promise(resolve => setImmediate(resolve))
const denied = { success: false, error: { type: 'panel_login_required', message: 'Login required' } }
const tokens = (suffix = 'fresh') => ({ accessToken: `${suffix}-access`, refreshToken: `${suffix}-refresh` })

function fixture(mode) {
  const storage = new Map(), calls = [], lost = []
  const module = { exports: {} }
  let cookie = 'old-cookie'
  vm.runInNewContext(source, {
    module, exports: module.exports, URL, AbortController, DOMException, TextEncoder,
    window: mode === 'body' ? { Capacitor: { isNativePlatform: () => true } } : {},
    location: { origin: 'https://gateway.test' },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key),
    },
    fetch: (url, init = {}) => new Promise((resolve, reject) => {
      calls.push({
        url, init, cookie, reject,
        respond(status, payload, nextCookie) {
          if (nextCookie) cookie = nextCookie
          resolve(Response.json(payload, { status }))
        },
      })
    }),
  }, { filename: 'mobile-auth-fixture.cjs' })
  const { client, auth, servers } = module.exports
  if (mode === 'body') {
    const server = servers.saveServer({ base: 'https://gateway.test' })
    servers.setActiveServer(server.id)
    client.storePanelTokens('old-access', 'old-refresh')
  }
  client.setAuthLostHandler(value => lost.push(value))
  return {
    client, auth, calls, lost,
    requests: path => calls.filter(call => call.url.endsWith(path)),
    refreshes: () => calls.filter(call => call.url.endsWith('/api/panel/refresh')),
    refreshSuccess(call, suffix = 'fresh') {
      call.respond(200, { success: true, data: mode === 'body' ? tokens(suffix) : {} }, `${suffix}-cookie`)
    },
    assertFresh(call) {
      if (mode === 'body') {
        assert.equal(call.init.headers['x-panel-token'], 'fresh-access')
        assert.equal(call.init.headers.Authorization, 'Bearer fresh-access')
      } else assert.equal(call.cookie, 'fresh-cookie')
    },
  }
}

for (const mode of ['cookie', 'body']) {
  test(`${mode}: concurrent and late 401 responses share one token rotation`, { timeout: 3000 }, async () => {
    const f = fixture(mode)
    const results = Promise.all(['/one', '/two', '/late'].map(path => f.client.apiCall(path)))
    f.requests('/one')[0].respond(401, denied)
    f.requests('/two')[0].respond(401, denied)
    await settle()
    assert.equal(f.refreshes().length, 1)
    const refresh = f.refreshes()[0]
    assert.equal(refresh.init.signal, undefined, 'refresh is not owned by one request abort signal')
    if (mode === 'body') {
      assert.equal(refresh.init.headers['x-panel-refresh'], 'old-refresh')
      assert.equal(refresh.init.headers['x-panel-auth-mode'], 'body')
    } else assert.equal(refresh.init.headers['x-panel-refresh'], undefined)
    f.refreshSuccess(refresh)
    await settle()
    for (const path of ['/one', '/two']) {
      f.assertFresh(f.requests(path)[1])
      f.requests(path)[1].respond(200, { success: true, data: path })
    }
    // This request was sent before rotation but its 401 arrives after refresh has completed.
    f.requests('/late')[0].respond(401, denied)
    await settle()
    assert.equal(f.refreshes().length, 1, 'a stale 401 must not replay the old refresh token')
    f.assertFresh(f.requests('/late')[1])
    f.requests('/late')[1].respond(200, { success: true, data: '/late' })
    assert.deepEqual(await results, ['/one', '/two', '/late'])
    assert.equal(f.lost.length, 0)
  })

  test(`${mode}: refresh failure rejects all callers and notifies only once`, { timeout: 3000 }, async () => {
    const f = fixture(mode)
    const results = Promise.allSettled(['/one', '/two', '/late'].map(path => f.client.apiCall(path)))
    f.requests('/one')[0].respond(401, denied)
    f.requests('/two')[0].respond(401, denied)
    await settle()
    f.refreshes()[0].respond(401, denied)
    await settle()
    f.requests('/late')[0].respond(401, denied)
    const failures = await results
    assert(failures.every(result => result.status === 'rejected' && result.reason.status === 401))
    assert.equal(f.refreshes().length, 1)
    assert.deepEqual(f.lost, ['login'])
    assert.equal(f.client.readPanelAuth(), null)
  })

  test(`${mode}: a second 401 ends the original request without another refresh`, { timeout: 3000 }, async () => {
    const f = fixture(mode)
    const result = Promise.allSettled([f.client.apiCall('/one')])
    f.requests('/one')[0].respond(401, denied)
    await settle()
    f.refreshSuccess(f.refreshes()[0])
    await settle()
    f.requests('/one')[1].respond(401, denied)
    assert.equal((await result)[0].status, 'rejected')
    assert.equal(f.requests('/one').length, 2)
    assert.equal(f.refreshes().length, 1)
    assert.deepEqual(f.lost, ['login'])
  })

  test(`${mode}: aborting one waiter leaves the shared refresh usable`, { timeout: 3000 }, async () => {
    const f = fixture(mode), controller = new AbortController()
    const cancelled = Promise.allSettled([f.client.apiCall('/cancelled', { signal: controller.signal })])
    const survivor = f.client.apiCall('/survivor')
    f.requests('/cancelled')[0].respond(401, denied)
    f.requests('/survivor')[0].respond(401, denied)
    await settle()
    controller.abort()
    assert.equal((await cancelled)[0].reason.name, 'AbortError', 'cancelled waiter settles before refresh')
    assert.equal(f.refreshes().length, 1)
    assert.equal(f.refreshes()[0].init.signal, undefined)
    f.refreshSuccess(f.refreshes()[0])
    await settle()
    assert.equal(f.requests('/cancelled').length, 1)
    f.requests('/survivor')[1].respond(200, { success: true, data: 'ok' })
    assert.equal(await survivor, 'ok')
    assert.equal(f.lost.length, 0)
  })

  for (const refreshStatus of [200, 401]) {
    test(`${mode}: old refresh ${refreshStatus} cannot replace or clear a new login`, { timeout: 3000 }, async () => {
      const f = fixture(mode)
      const oldRequest = Promise.allSettled([f.client.apiCall('/old')])
      f.requests('/old')[0].respond(401, denied)
      await settle()
      const login = f.auth.authenticate({ mode: 'login', username: 'fixture', password: 'fixture', captcha: null })
      f.requests('/api/panel/login')[0].respond(200, { success: true, data: tokens('login') })
      assert.equal((await login).access, 'login-access')
      if (refreshStatus === 200) f.refreshSuccess(f.refreshes()[0], 'stale')
      else f.refreshes()[0].respond(401, denied)
      assert.equal((await oldRequest)[0].status, 'rejected')
      assert.equal(f.client.readPanelAuth().access, 'login-access')
      assert.equal(f.client.readPanelAuth().refresh, 'login-refresh')
      assert.equal(f.lost.length, 0)
      const current = f.client.apiCall('/new')
      assert.equal(f.requests('/new')[0].init.headers['x-panel-token'], 'login-access')
      f.requests('/new')[0].respond(200, { success: true, data: 'new session' })
      assert.equal(await current, 'new session')
    })
  }

  test(`${mode}: quiet and pre-aborted requests do not refresh or notify`, { timeout: 3000 }, async () => {
    const f = fixture(mode), controller = new AbortController()
    controller.abort()
    await assert.rejects(f.client.apiCall('/abort', { signal: controller.signal }), { name: 'AbortError' })
    assert.equal(f.calls.length, 0)
    const quiet = Promise.allSettled([f.client.apiCall('/quiet', { quiet: true })])
    f.requests('/quiet')[0].respond(401, denied)
    assert.equal((await quiet)[0].reason.status, 401)
    assert.equal(f.refreshes().length, 0)
    assert.equal(f.lost.length, 0)
  })

  test(`${mode}: later expiry can refresh again after a successful rotation`, { timeout: 3000 }, async () => {
    const f = fixture(mode)
    for (const suffix of ['first', 'second']) {
      const result = f.client.apiCall(`/${suffix}`)
      f.requests(`/${suffix}`)[0].respond(401, denied)
      await settle()
      const refresh = f.refreshes().at(-1)
      if (mode === 'body' && suffix === 'second') assert.equal(refresh.init.headers['x-panel-refresh'], 'first-refresh')
      f.refreshSuccess(refresh, suffix)
      await settle()
      f.requests(`/${suffix}`)[1].respond(200, { success: true, data: suffix })
      assert.equal(await result, suffix)
    }
    assert.equal(f.refreshes().length, 2)
    assert.equal(f.lost.length, 0)
  })

  test(`${mode}: login already in progress suppresses stale refresh failure`, { timeout: 3000 }, async () => {
    const f = fixture(mode)
    const old = Promise.allSettled([f.client.apiCall('/old')])
    f.requests('/old')[0].respond(401, denied)
    await settle()
    const login = f.auth.authenticate({ mode: 'login', username: 'fixture', password: 'fixture', captcha: null })
    f.refreshes()[0].respond(401, denied)
    assert.equal((await old)[0].status, 'rejected')
    assert.equal(f.lost.length, 0, 'old requests must not reopen the login screen while authenticating')
    if (mode === 'body') assert.equal(f.client.readPanelAuth().access, 'old-access')
    f.requests('/api/panel/login')[0].respond(200, { success: true, data: tokens('login') })
    assert.equal((await login).access, 'login-access')
  })
}

test('body: successful HTTP without replacement tokens cannot masquerade as a refresh', { timeout: 3000 }, async () => {
  const f = fixture('body')
  const result = Promise.allSettled([f.client.apiCall('/one')])
  f.requests('/one')[0].respond(401, denied)
  await settle()
  f.refreshes()[0].respond(200, { success: true, data: {} })
  assert.equal((await result)[0].reason.status, 401)
  assert.equal(f.requests('/one').length, 1)
  assert.deepEqual(f.lost, ['login'])
})
