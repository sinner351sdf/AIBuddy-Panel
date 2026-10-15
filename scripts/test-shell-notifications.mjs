// Exercise the real notification controller without accounts, a browser or network.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const filename = new URL('../desktop-tauri/ui/js/notify-center.js', import.meta.url)
const source = readFileSync(filename, 'utf8')
const READ_KEY = 'aibuddy-notify-read'
const PREFS_KEY = 'aibuddy-prefs'
const clone = value => JSON.parse(JSON.stringify(value))

class Events {
  listeners = new Map()
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type).add(callback)
  }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback) }
  emit(type) { for (const callback of [...this.listeners.get(type) || []]) callback({ type }) }
  dispatchEvent(event) { this.emit(event.type); return true }
}

class Element extends Events {
  constructor(tagName = 'div') {
    super()
    this.tagName = tagName
    this.children = []
    this.parentNode = null
  }
  appendChild(child) {
    child.parentNode?.removeChild(child)
    child.parentNode = this
    this.children.push(child)
    return child
  }
  insertBefore(child, reference) {
    child.parentNode?.removeChild(child)
    const index = this.children.indexOf(reference)
    assert.ok(index >= 0)
    child.parentNode = this
    this.children.splice(index, 0, child)
  }
  removeChild(child) {
    this.children.splice(this.children.indexOf(child), 1)
    child.parentNode = null
  }
  get isConnected() { return this.tagName === 'body' || Boolean(this.parentNode?.isConnected) }
  findId(id) { return this.id === id ? this : this.children.map(child => child.findId(id)).find(Boolean) || null }
}

async function settle() { for (let i = 0; i < 10; i++) await Promise.resolve() }

function fixture({ watermark, prefs, tauri = false, reactReady = true, topbarReady = true } = {}) {
  const storage = new Map()
  if (watermark) storage.set(READ_KEY, JSON.stringify(watermark))
  if (prefs) storage.set(PREFS_KEY, JSON.stringify(prefs))
  const document = new Events()
  document.body = new Element('body')
  document.readyState = 'complete'
  document.hidden = false
  const topbar = document.body.appendChild(new Element())
  const status = new Element()
  status.id = 'topbar-status'
  if (topbarReady) topbar.appendChild(status)
  const created = []
  document.createElement = name => { created.push(name); return new Element(name) }
  document.getElementById = id => document.body.findId(id)
  const observers = []
  class MutationObserver {
    constructor(callback) { observers.push(callback) }
    observe() {}
  }
  let timerId = 0
  const intervals = new Map()
  const timeouts = new Map()
  const setTimer = (collection, callback, ms) => { collection.set(++timerId, { callback, ms }); return timerId }
  const requests = []
  const navigation = []
  const window = new Events()
  window.wbApp = { showPage: page => navigation.push(page) }
  const mounted = new WeakSet()
  const mounts = []
  const mountApi = {
    mount(host, bridge) {
      if (mounted.has(host)) return
      mounted.add(host)
      const view = { host, bridge, snapshots: [bridge.getSnapshot()] }
      bridge.subscribe(() => view.snapshots.push(bridge.getSnapshot()))
      mounts.push(view)
    },
  }
  if (reactReady) window.wbShellNotifications = mountApi
  function request(kind, path, options) {
    let resolve, reject
    const promise = new Promise((yes, no) => { resolve = yes; reject = no })
    const entry = { kind, path, options, resolve, reject }
    requests.push(entry)
    options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    return promise
  }
  if (tauri) {
    window.__TAURI_INTERNALS__ = {
      invoke(command, args) {
        assert.equal(command, 'api_request')
        if (tauri === 'throw') throw new Error('bridge unavailable')
        return request('tauri', args.request.path, args.request)
      },
    }
  }
  const globals = {
    window, document, MutationObserver, AbortController, Event, console,
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
    },
    fetch: (path, options) => request('fetch', path, options),
    setInterval: (callback, ms) => setTimer(intervals, callback, ms),
    clearInterval: id => intervals.delete(id),
    setTimeout: (callback, ms) => setTimer(timeouts, callback, ms),
    clearTimeout: id => timeouts.delete(id),
  }
  Object.assign(window, globals)
  const context = vm.createContext(globals)
  const run = () => vm.runInContext(source, context, { filename: filename.pathname, timeout: 1000 })
  run()
  const api = window.wbNotifyCenter
  async function respond(payload, { ok = true, status = 200 } = {}) {
    const entry = requests.at(-1)
    assert.ok(entry)
    entry.resolve(entry.kind === 'tauri' ? payload : { ok, status, json: () => Promise.resolve(payload) })
    await settle()
  }
  async function reject(error = new Error('offline')) { requests.at(-1).reject(error); await settle() }
  function timeout(ms) {
    const entry = [...timeouts].find(([, timer]) => timer.ms === ms)
    assert.ok(entry, `Expected a ${ms}ms timeout`)
    timeouts.delete(entry[0])
    entry[1].callback()
  }
  return { api, storage, requests, respond, reject, document, window, navigation, intervals, timeouts,
    mounts, created, run, timeout, status, topbar,
    mutate: () => observers.forEach(callback => callback([])),
    ready: () => { window.wbShellNotifications = mountApi; document.emit('wb:shell-notifications-ready') },
    watermark: () => JSON.parse(storage.get(READ_KEY) || 'null') }
}

// First successful load normalizes/sorts/caps events and seeds history as read.
{
  const f = fixture()
  assert.deepEqual(f.created, ['div'], 'The legacy controller creates only a React host')
  assert.equal(f.mounts.length, 1)
  assert.equal(f.mounts[0].host.id, 'nc-buttons')
  assert.equal(f.topbar.children.indexOf(f.mounts[0].host) + 1, f.topbar.children.indexOf(f.status))
  assert.equal(f.requests.length, 0, 'Boot keeps its delayed first request')
  const initial = f.api.getSnapshot()
  assert.equal(initial, f.api.getSnapshot(), 'Snapshot identity is stable between updates')
  f.timeout(1500)
  f.api.refresh()
  assert.equal(f.requests.length, 1, 'Concurrent refreshes share the inflight guard')
  assert.equal(f.api.getSnapshot().loading, true)
  assert.equal(f.requests[0].path, '/api/logs?limit=8&offset=0')
  assert.equal(f.requests[0].options.method, 'GET')
  const events = Array.from({ length: 12 }, (_, i) => ({ id: String(i + 1), time: 1700000000 + i,
    lvl: i % 2 ? 'warning' : 'err', cat: ' gateway ', text: ` event ${i + 1} ` }))
  await f.respond({ data: { entries: events } })
  assert.deepEqual(Array.from(f.api.getSnapshot().items, item => item.id), [12, 11, 10, 9, 8, 7, 6, 5])
  assert.equal(f.api.getSnapshot().items[0].level, 'warn')
  assert.equal(f.api.getSnapshot().items[0].category, 'gateway')
  assert.equal(f.api.getSnapshot().items[0].message, 'event 12')
  assert.equal(f.api.getSnapshot().items[0].ts, 1700000011000)
  assert.equal(f.api.getSnapshot().loading, false)
  assert.equal(f.api.unread(), 0)
  assert.deepEqual(f.watermark(), { id: 12, ts: 1700000011000 })
  assert.equal([...f.timeouts.values()].some(timer => timer.ms === 8000), false, 'Completed requests release their abort timer')
  assert.ok(Object.isFrozen(f.api.getSnapshot().items[0]))
}

// Alerts arriving while closed are unread; opening marks both cached and fresh events.
{
  const f = fixture({ watermark: { id: 10, ts: 1700000010000 } })
  f.api.refresh()
  await f.respond({ items: [
    { id: 11, ts: 1700000011, level: 'error', message: '<img src=x onerror=alert(1)>' },
    { id: 12, ts: 1700000012, level: 'warn' }, { id: 13, ts: 1700000013, level: 'info' },
  ] })
  assert.equal(f.api.unread(), 2)
  assert.equal(f.api.getSnapshot().unread, 2)
  assert.equal(f.api.getSnapshot().items[2].message, '<img src=x onerror=alert(1)>', 'Messages stay plain data for React text rendering')
  f.api.open()
  f.api.open()
  assert.equal(f.requests.length, 2, 'Repeated open calls do not create duplicate requests')
  assert.equal(f.api.getSnapshot().open, true)
  assert.equal(f.api.unread(), 0)
  assert.equal(f.watermark().id, 13)
  await f.respond([{ id: 14, ts: 1700000014, level: 'error' }])
  assert.equal(f.api.unread(), 0, 'Events received while open are marked read')
  assert.equal(f.watermark().id, 14)
  f.api.setOpen(false)
  f.api.refresh()
  await f.respond({ list: [{ id: 15, ts: 1700000015, level: 'warn' }] })
  assert.equal(f.api.unread(), 1)
  const count = f.requests.length
  f.api.markRead()
  assert.equal(f.api.unread(), 0)
  assert.equal(f.requests.length, count, 'Marking read does not fetch')
  f.api.viewAll()
  assert.deepEqual(f.navigation, ['logs'])
  assert.equal(f.storage.get('workbuddy-desktop-page'), 'logs')
  assert.equal(f.api.getSnapshot().open, false)
}

// Every supported envelope keeps the existing backend compatibility boundary.
for (const wrap of [list => list, list => ({ data: list }), list => ({ data: { items: list } }),
  list => ({ data: { entries: list } }), list => ({ data: { list } }), list => ({ items: list }),
  list => ({ entries: list }), list => ({ list })]) {
  const f = fixture({ watermark: { id: 1, ts: 0 } })
  f.api.refresh()
  await f.respond(wrap([{ id: 2, level: 'warning', ts: '2026-10-15T00:00:00Z', msg: 'example' }]))
  assert.equal(f.api.getSnapshot().items.length, 1)
  assert.equal(f.api.unread(), 1)
}

// Clearing logs resets an id watermark; failures and empty responses do not erase it.
{
  const f = fixture({ watermark: { id: 100, ts: 1700000100000 } })
  f.api.refresh()
  await f.respond({ entries: [{ id: 2, ts: 1700000200, level: 'error' }] })
  assert.deepEqual(f.watermark(), { id: 2, ts: 1700000200000 })
  assert.equal(f.api.unread(), 0)
  const oldItems = clone(f.api.getSnapshot().items)
  const oldWatermark = f.watermark()
  f.api.refresh()
  await f.respond(null, { ok: false, status: 401 })
  assert.deepEqual(clone(f.api.getSnapshot().items), oldItems)
  assert.deepEqual(f.watermark(), oldWatermark)
  assert.equal(f.api.getSnapshot().loading, false)
  f.api.refresh()
  await f.reject()
  assert.deepEqual(clone(f.api.getSnapshot().items), oldItems)
  f.api.refresh()
  await f.respond([])
  f.api.markRead()
  assert.deepEqual(f.watermark(), oldWatermark, 'Empty data cannot reset the read watermark')
  f.api.refresh()
  f.timeout(8000)
  await settle()
  assert.equal(f.api.getSnapshot().loading, false, 'An aborted request releases the inflight guard')
  f.api.refresh()
  await f.respond([])
}

// Timestamps are the unread fallback for providers without positive ids.
{
  const f = fixture({ watermark: { id: 0, ts: 1700000000000 } })
  f.api.refresh()
  await f.respond([{ ts: '1700000001', level: 'error' }, { ts: 1700000002, level: 'debug' }])
  assert.equal(f.api.unread(), 1)
  f.api.markRead()
  assert.deepEqual(f.watermark(), { id: 0, ts: 1700000002000 })
}

// Desktop fetches use the existing api_request bridge, including synchronous errors.
{
  const f = fixture({ tauri: true })
  f.api.refresh()
  assert.equal(f.requests[0].kind, 'tauri')
  assert.deepEqual(clone(f.requests[0].options), { method: 'GET', path: '/api/logs?limit=8&offset=0' })
  await f.respond({ data: [{ id: 5, level: 'error', ts: 1700000000 }] })
  assert.equal(f.api.getSnapshot().items.length, 1)
  assert.equal(f.api.unread(), 0)
  const unavailable = fixture({ tauri: 'throw' })
  assert.doesNotThrow(() => unavailable.api.refresh())
  await settle()
  assert.equal(unavailable.api.getSnapshot().loading, false)
  assert.equal(unavailable.api.getSnapshot().items.length, 0)
}

// Preference and visibility listeners reschedule and resume real polling callbacks.
{
  const f = fixture({ prefs: { notifyInterval: 3 } })
  assert.equal([...f.intervals.values()][0].ms, 180000)
  f.storage.set(PREFS_KEY, JSON.stringify({ notifyInterval: 2.9 }))
  f.document.emit('aibuddy-prefs-changed')
  assert.equal(f.intervals.size, 1)
  assert.equal([...f.intervals.values()][0].ms, 120000)
  f.storage.set(PREFS_KEY, JSON.stringify({ notifyInterval: 61 }))
  f.document.emit('aibuddy-prefs-changed')
  assert.equal([...f.intervals.values()][0].ms, 60000)
  f.document.hidden = true
  ;[...f.intervals.values()][0].callback()
  assert.equal(f.requests.length, 0)
  f.document.hidden = false
  f.document.emit('visibilitychange')
  assert.equal(f.requests.length, 1)
  ;[...f.intervals.values()][0].callback()
  assert.equal(f.requests.length, 1)
  await f.respond([])
}

// A late island, detached topbar host and duplicate classic script preserve state.
{
  const f = fixture({ reactReady: false, topbarReady: false })
  assert.equal(f.mounts.length, 0)
  f.topbar.appendChild(f.status)
  f.mutate()
  const host = f.document.getElementById('nc-buttons')
  assert.ok(host)
  f.ready()
  assert.equal(f.mounts.length, 1)
  f.api.setOpen(true)
  await f.respond([])
  f.topbar.removeChild(host)
  f.mutate()
  assert.equal(f.document.getElementById('nc-buttons'), host)
  assert.equal(f.mounts.length, 1, 'Host repair must preserve the mounted React root')
  assert.equal(f.api.getSnapshot().open, true)
  // Replacing an ancestor leaves parentNode set on the old host. Connectivity,
  // rather than parentNode alone, must decide whether it needs to be reattached.
  f.document.body.removeChild(f.topbar)
  const replacement = f.document.body.appendChild(new Element())
  replacement.appendChild(f.status)
  f.mutate()
  assert.equal(host.parentNode, replacement)
  assert.equal(f.mounts.length, 1)
  let updates = 0
  const unsubscribe = f.api.subscribe(() => updates++)
  f.api.close()
  assert.equal(updates, 1)
  unsubscribe()
  f.api.markRead()
  assert.equal(updates, 1)
  const timerCount = f.intervals.size
  const timeoutCount = f.timeouts.size
  f.run()
  assert.equal(f.window.wbNotifyCenter, f.api)
  assert.equal(f.intervals.size, timerCount)
  assert.equal(f.timeouts.size, timeoutCount)
  assert.deepEqual(f.created, ['div'])
}

console.log('PASS: notification bridge, watermarks, transport failures, polling and host lifecycle')
