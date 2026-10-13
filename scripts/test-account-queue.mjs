// In-memory DOM regression checks: no browser, real accounts or network requests.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'

const require = createRequire(new URL('../desktop-tauri/ui-islands/package.json', import.meta.url))
const ts = require('typescript')
const source = name => readFileSync(new URL(`../desktop-tauri/ui-islands/src/islands/${name}.ts`, import.meta.url), 'utf8')
function load(name, globals = {}) {
  const exports = {}
  const context = vm.createContext({ exports, ...globals })
  vm.runInContext(ts.transpileModule(source(name), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, context)
  return exports
}

const { moveQueueGroup } = load('accounts-queue-order')
const groups = ['a', 'b', 'c', 'd'].map(provider => ({ provider, members: [`${provider}1`, `${provider}2`] }))
const order = (all, visible, provider, index) => Array.from(moveQueueGroup(all, visible, provider, index), g => g.provider).join('')
assert.equal(order(groups, groups, 'a', 1), 'bacd') // first group down one
assert.equal(order(groups, groups, 'a', 3), 'bcda') // first to last
assert.equal(order(groups, groups, 'd', 0), 'dabc') // last to first
assert.equal(order(groups, groups, 'b', 2), 'acbd') // middle group down
assert.equal(order(groups, groups, 'c', 1), 'acbd') // middle group up
assert.equal(order(groups, groups, 'b', 1), 'abcd') // same slot
assert.equal(order(groups, [groups[0], groups[2]], 'a', 1), 'bcda') // hidden groups retained
assert.equal(order(groups, [groups[0], groups[2]], 'c', 0), 'cabd')
assert.equal(order(groups, groups, 'unknown', 0), 'abcd')
assert.deepEqual(Array.from(moveQueueGroup(groups, groups, 'a', 3)).flatMap(g => g.members).sort(),
  groups.flatMap(g => g.members).sort())

class Element {
  constructor(tag, classes = [], dataset = {}, top = 0, height = 20) {
    this.tag = tag; this.dataset = dataset; this.children = []; this.parentElement = null
    this.top = top; this.height = height; this.listeners = new Map()
    const values = new Set(classes)
    this.classList = { contains: x => values.has(x), add: (...xs) => xs.forEach(x => values.add(x)),
      remove: (...xs) => xs.forEach(x => values.delete(x)) }
  }
  append(child) { child.parentElement = this; this.children.push(child); return child }
  matches(selector) {
    const [tag, ...classes] = selector.trim().split('.')
    return (!tag || tag === this.tag) && classes.every(x => this.classList.contains(x))
  }
  closest(selector) {
    return selector.split(',').some(s => this.matches(s)) ? this : this.parentElement?.closest(selector) || null
  }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [
      ...(selector.split(',').some(s => child.matches(s)) ? [child] : []), ...child.querySelectorAll(selector),
    ])
  }
  getBoundingClientRect() { return { top: this.top, height: this.height } }
  addEventListener(name, cb) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set())
    this.listeners.get(name).add(cb)
  }
  removeEventListener(name, cb) { this.listeners.get(name)?.delete(cb) }
  emit(name, event) { for (const cb of [...this.listeners.get(name) || []]) cb(event) }
}
function fixture(count = 3) {
  const win = new Element('window'), body = new Element('body'), host = new Element('div')
  const table = host.append(new Element('table')), drops = []
  let locked = false, warnings = 0
  function group(provider, top) {
    const item = new Element('tbody', ['acct-group'], { provider }, top, 80)
    const band = item.append(new Element('tr', ['grp-band'], {}, top))
    band.append(new Element('span', ['queue-grip']))
    for (let i = 0; i < count; i++) {
      const row = item.append(new Element('tr', ['acct-row'], { provider, id: provider + i }, top + 20 + i * 20))
      row.append(new Element('span', ['order-grip']))
    }
    return item
  }
  table.append(group('a', 0)); table.append(group('b', 80)); table.append(group('c', 160))
  const { bindQueueDrag } = load('accounts-queue-drag', { window: win, document: { body } })
  bindQueueDrag(host, { isLocked: () => locked, onLockedAttempt: () => warnings++, onDrop: d => drops.push(JSON.parse(JSON.stringify(d))) })
  const event = (y, extra = {}) => ({ button: 0, buttons: 1, pointerId: 7, clientX: 10, clientY: y, preventDefault() {}, ...extra })
  const start = (selector, index, y) => host.emit('pointerdown', event(y, { target: host.querySelectorAll(selector)[index] }))
  const move = (y, extra) => win.emit('pointermove', event(y, extra))
  const end = y => win.emit('pointerup', event(y, { buttons: 0 }))
  const clean = () => {
    assert.equal(body.classList.contains('queue-dragging'), false)
    assert.equal(host.querySelectorAll('.drop-before, .drop-after, .dragging').length, 0)
  }
  return { win, host, table, body, drops, start, move, end, clean, group, event,
    lock: () => { locked = true }, warnings: () => warnings }
}

let f = fixture()
f.start('.queue-grip', 0, 10); f.move(220); f.end(220)
assert.deepEqual(f.drops, [{ kind: 'group', provider: 'a', index: 2 }]); f.clean()
f = fixture()
f.start('.order-grip', 0, 30); f.move(75); f.end(75)
assert.deepEqual(f.drops, [{ kind: 'row', provider: 'a', accountId: 'a0', index: 2 }]); f.clean()
f = fixture()
f.start('.order-grip', 2, 70); f.move(25); f.end(25)
assert.equal(f.drops[0].index, 0); f.clean()

// A detached node has stale geometry. Replaced nodes must be resolved by account identity.
f = fixture()
f.start('.order-grip', 0, 30)
f.table.children[0] = f.group('a', 100); f.table.children[0].parentElement = f.table
f.move(155); f.end(155)
assert.equal(f.drops[0].index, 1); f.clean()
f = fixture()
f.start('.order-grip', 0, 30); f.move(145, { pointerId: 99 }); f.end(30)
assert.equal(f.drops.length, 0); f.clean()
f = fixture()
f.start('.order-grip', 0, 30); f.end(70) // a click / release without dragging must not write order
assert.equal(f.drops.length, 0); f.clean()
f = fixture(1)
f.start('.order-grip', 0, 30); f.move(150); f.end(150)
assert.equal(f.drops.length, 0); f.clean()
f = fixture()
f.lock(); f.start('.queue-grip', 0, 10)
assert.equal(f.warnings(), 1); assert.equal(f.drops.length, 0); f.clean()
f = fixture()
f.start('.queue-grip', 0, 10); f.move(220); f.lock(); f.end(220)
assert.equal(f.drops.length, 0); f.clean()
for (const [name, extra] of [['pointercancel', {}], ['keydown', { key: 'Escape' }], ['blur', {}]]) {
  f = fixture(); f.start('.queue-grip', 0, 10); f.move(220)
  f.win.emit(name, f.event(220, extra))
  assert.equal(f.drops.length, 0); f.clean()
}
// Exercise the complete web shim with a mocked HTTP transport. This catches missing
// bridge methods even when the Rust endpoint and native desktop bridge both exist.
const shimRust = readFileSync(new URL('../desktop-tauri/src-tauri/server/src/web_shim.rs', import.meta.url), 'utf8')
const shim = shimRust.split('    r#"')[1].split('"#')[0]
const requests = [], webWindow = {}
let responseStatus = 200
vm.runInNewContext(shim, {
  window: webWindow,
  localStorage: { getItem: key => key === 'agent2api.panelAuth' ? JSON.stringify({ access: 'fixture-session' }) : null },
  setTimeout: () => 1,
  fetch: async (path, init) => {
    requests.push({ path, ...init })
    return { status: responseStatus, text: async () => JSON.stringify(responseStatus === 200
      ? { success: true, data: { saved: true } } : { success: false, error: 'fixture failure' }) }
  },
})
assert.equal(typeof webWindow.workbuddyDesktop.reorderAccounts, 'function')
assert.deepEqual(JSON.parse(JSON.stringify(await webWindow.workbuddyDesktop.reorderAccounts(['a', 2]))), { saved: true })
assert.equal(requests[0].path, '/api/accounts/reorder')
assert.equal(requests[0].method, 'POST')
assert.equal(requests[0].headers['x-panel-token'], 'fixture-session')
assert.deepEqual(JSON.parse(requests[0].body), { queue: ['a', '2'] })
await webWindow.workbuddyDesktop.reorderAccounts(undefined)
assert.deepEqual(JSON.parse(requests[1].body), { queue: [] })
for (const status of [400, 403, 500]) {
  responseStatus = status
  await assert.rejects(webWindow.workbuddyDesktop.reorderAccounts(['a']), /fixture failure/)
}
console.log('PASS: 10 queue-order cases, 12 pointer lifecycle cases and 5 web-bridge cases; no network')
