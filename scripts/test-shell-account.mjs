// Execute the actual account controller. Requests are VM stubs; this never
// changes a real password, signs in, or logs out of the running application.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../desktop-tauri/ui/js/user-menu.js', import.meta.url), 'utf8')
class Element {
  children = []
  parentNode = null
  inert = false
  hidden = false
  constructor(id = '') { this.id = id }
  appendChild(child) {
    child.remove()
    child.parentNode = this
    this.children.push(child)
    return child
  }
  insertBefore(child, target) {
    child.remove()
    child.parentNode = this
    this.children.splice(this.children.indexOf(target), 0, child)
  }
  remove() {
    if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1)
    this.parentNode = null
  }
  get nextElementSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1] || null }
  closest(selector) {
    if (selector === '[inert]') return this.inert ? this : this.parentNode?.closest(selector) || null
    if (selector === '[hidden]') return this.hidden ? this : this.parentNode?.closest(selector) || null
    if (selector === 'aside') return this.id === 'sidebar' ? this : this.parentNode?.closest(selector) || null
    return null
  }
}
const all = root => [root, ...root.children.flatMap(all)]
const json = value => JSON.parse(JSON.stringify(value))
const tick = () => new Promise(resolve => setImmediate(resolve))
function response(payload, ok = true) {
  return { ok, json: async () => payload, text: async () => JSON.stringify(payload) }
}
function fixture({ tauri = false, status = { data: { username: 'cached-admin' } } } = {}) {
  const body = new Element('body')
  let sidebar = body.appendChild(new Element('sidebar'))
  let sidebarUser = sidebar.appendChild(new Element('sidebar-user'))
  const topbar = body.appendChild(new Element('topbar'))
  const statusHost = topbar.appendChild(new Element('topbar-status'))
  const storage = new Map([['agent2api-user', 'cached-admin']])
  const events = new Map()
  const requests = []
  const toasts = []
  const mounted = new WeakSet()
  let mountCount = 0
  let observer
  let nextRequest = async () => ({ data: { revokedSessions: 2 } })
  const document = {
    body,
    readyState: 'complete',
    getElementById: id => all(body).find(element => element.id === id) || null,
    querySelector: selector => selector === '.sidebar' ? sidebar : null,
    createElement: () => new Element(),
    addEventListener: (name, fn) => events.set(name, fn),
  }
  const window = {
    location: { href: '/panel' },
    wbApp: { toast: (message, kind) => toasts.push({ message, kind }) },
    wbShellAccount: { mount(host, bridge) { assert.equal(bridge, window.wbAccountMenu); if (!mounted.has(host)) { mounted.add(host); mountCount++ } } },
  }
  if (tauri) window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
    assert.equal(command, 'api_request')
    const request = args.request
    requests.push(json(request))
    if (request.path === '/api/panel/status') return status
    const result = await nextRequest(request)
    return Object.hasOwn(result, 'data') ? result.data : result
  } }
  const context = vm.createContext({ window, document, localStorage: {
    getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)),
  }, fetch: async (path, options = {}) => {
    const request = { path, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null }
    requests.push(request)
    if (path === '/api/panel/status') return response(status)
    const result = await nextRequest(request)
    return result?.response || response(result)
  }, MutationObserver: class { constructor(callback) { this.callback = callback; observer = this } observe() {} } })
  vm.runInContext(source, context)
  return {
    get api() { return window.wbAccountMenu }, window, requests, storage, toasts,
    setRequest(fn) { nextRequest = fn },
    evalAgain() { vm.runInContext(source, context) },
    get mountCount() { return mountCount },
    get host() { return document.getElementById('um-holder') },
    get sidebar() { return sidebar }, statusHost,
    rebuildSidebar() { sidebar.remove(); sidebar = body.appendChild(new Element('sidebar')); sidebarUser = sidebar.appendChild(new Element('sidebar-user')); observer.callback(); return sidebarUser },
    rebuildSidebarHost() { sidebarUser.remove(); sidebarUser = sidebar.appendChild(new Element('sidebar-user')); observer.callback(); return sidebarUser },
    removeSidebarHost() { sidebarUser.remove(); observer.callback() },
    notifyMutation() { observer.callback() },
  }
}
const draft = (patch = {}) => ({ oldUser: ' cached-admin ', oldPassword: 'old-test-password', newUsername: '', newPassword: 'new-test-password', ...patch })

{
  const f = fixture({ status: { data: { username: '管理员甲' } } })
  await tick()
  assert.equal(f.api.getSnapshot().username, '管理员甲')
  assert.equal(f.storage.get('agent2api-user'), '管理员甲')
  const stable = f.api.getSnapshot()
  assert.equal(f.api.getSnapshot(), stable)
  let updates = 0
  const unsubscribe = f.api.subscribe(() => updates++)
  f.api.setMenuOpen(true)
  assert.equal(f.api.getSnapshot().menuOpen, true)
  f.api.openChangeDialog()
  assert.equal(f.api.getSnapshot().menuOpen, false)
  assert.equal(f.api.getSnapshot().dialogOpen, true)
  assert(updates >= 2)
  unsubscribe()
  const count = updates
  f.api.closeChangeDialog()
  assert.equal(updates, count)
  const host = f.host
  assert.equal(f.rebuildSidebarHost(), host.parentNode)
  assert.equal(f.host, host)
  assert.equal(f.mountCount, 1)
  assert.equal(f.rebuildSidebar(), host.parentNode)
  assert.equal(f.host, host)
  assert.equal(f.mountCount, 1)
  f.api.setMenuOpen(true)
  f.sidebar.inert = true
  f.notifyMutation()
  assert.equal(f.api.getSnapshot().menuOpen, false)
  f.sidebar.inert = false
  f.api.setMenuOpen(true)
  f.sidebar.hidden = true
  f.notifyMutation()
  assert.equal(f.api.getSnapshot().menuOpen, false)
  f.sidebar.hidden = false
  f.removeSidebarHost()
  assert.equal(f.host.nextElementSibling, f.statusHost)
  assert.equal(f.api.getSnapshot().inSidebar, false)
  const api = f.api
  const requests = f.requests.length
  f.evalAgain()
  assert.equal(f.api, api)
  assert.equal(f.requests.length, requests)
  assert.equal(f.mountCount, 1)
}

{
  const f = fixture()
  await tick()
  f.api.openChangeDialog()
  assert.equal(await f.api.save(draft({ oldUser: '', oldPassword: '' })), false)
  assert.deepEqual(json(f.api.getSnapshot().invalidFields), ['oldUser', 'oldPassword'])
  assert.equal(await f.api.save(draft({ newPassword: '' })), false)
  assert.match(f.api.getSnapshot().error, /至少填一项/)
  assert.equal(await f.api.save(draft({ newPassword: 'short' })), false)
  assert.deepEqual(json(f.api.getSnapshot().invalidFields), ['newPassword'])
  assert.equal(f.requests.filter(request => request.method === 'POST').length, 0)
  let resolve
  f.setRequest(() => new Promise(done => { resolve = done }))
  const saving = f.api.save(draft())
  assert.equal(f.api.getSnapshot().busy, true)
  assert.equal(await f.api.save(draft()), false)
  await tick()
  assert.deepEqual(f.requests.at(-1), { path: '/api/panel/password', method: 'POST', body: { username: 'cached-admin', oldPassword: 'old-test-password', newPassword: 'new-test-password' } })
  resolve({ data: { revokedSessions: 2 } })
  assert.equal(await saving, true)
  assert.equal(f.api.getSnapshot().dialogOpen, false)
  assert.equal(f.api.getSnapshot().busy, false)
  assert.match(f.toasts.at(-1).message, /2 台设备/)
  f.api.openChangeDialog()
  f.setRequest(async () => ({ data: {} }))
  assert.equal(await f.api.save(draft({ newUsername: ' renamed-admin ', newPassword: '' })), true)
  assert.equal(f.api.getSnapshot().username, 'renamed-admin')
  assert.equal(f.storage.get('agent2api-user'), 'renamed-admin')
  assert.equal(Object.hasOwn(f.requests.at(-1).body, 'newPassword'), false)
}

{
  const f = fixture()
  await tick()
  f.api.openChangeDialog()
  f.setRequest(async () => ({ response: response({ success: false, error: { message: 'current password rejected' } }, false) }))
  assert.equal(await f.api.save(draft()), false)
  assert.equal(f.api.getSnapshot().dialogOpen, true)
  assert.equal(f.api.getSnapshot().busy, false)
  assert.match(f.api.getSnapshot().error, /修改失败：current password rejected/)
  let reject
  f.setRequest(() => new Promise((_, fail) => { reject = fail }))
  const saving = f.api.save(draft())
  await tick()
  f.api.closeChangeDialog()
  f.api.openChangeDialog()
  const newEpoch = f.api.getSnapshot().dialogEpoch
  reject(new Error('old request failed'))
  assert.equal(await saving, false)
  assert.equal(f.api.getSnapshot().dialogEpoch, newEpoch)
  assert.equal(f.api.getSnapshot().dialogOpen, true)
  assert.equal(f.api.getSnapshot().error, '')
  // Logout is mocked as well; both server outcomes keep the existing redirect contract.
  f.setRequest(async () => { throw new Error('mock network error') })
  await f.api.logout()
  assert.equal(f.window.location.href, '/login')
}

{
  const f = fixture({ tauri: true })
  await tick()
  f.api.openChangeDialog()
  assert.equal(await f.api.save(draft({ newUsername: 'desktop-admin' })), true)
  assert.deepEqual(f.requests.at(-1), { method: 'POST', path: '/api/panel/password', body: { username: 'cached-admin', oldPassword: 'old-test-password', newUsername: 'desktop-admin', newPassword: 'new-test-password' } })
  await f.api.logout()
  assert.equal(f.window.location.href, '/login')
}
console.log('PASS: account controller validation, request contracts, session outcomes, subscriptions and host recovery (mock requests only)')
