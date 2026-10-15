// Run the real shell-tabs controller in a Node VM. The DOM below only supplies
// browser mechanics; tab state, persistence, wrappers and pointer sorting come
// from desktop-tauri/ui/js/tags-view.js.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const filename = new URL('../desktop-tauri/ui/js/tags-view.js', import.meta.url)
const source = readFileSync(filename, 'utf8')
const STORAGE_KEY = 'aibuddy-tags'
const PAGE_KEY = 'workbuddy-desktop-page'

class EventTargetStub {
  listeners = new Map()

  addEventListener(type, callback, options = {}) {
    const capture = typeof options === 'boolean' ? options : Boolean(options.capture)
    const listeners = this.listeners.get(type) || []
    if (!listeners.some(item => item.callback === callback && item.capture === capture)) {
      listeners.push({ callback, capture, once: Boolean(options?.once) })
    }
    this.listeners.set(type, listeners)
  }

  removeEventListener(type, callback, options = {}) {
    const capture = typeof options === 'boolean' ? options : Boolean(options.capture)
    this.listeners.set(type, (this.listeners.get(type) || []).filter(item =>
      item.callback !== callback || item.capture !== capture))
  }

  dispatchEvent(event) {
    event.target ||= this
    event.currentTarget = this
    event.preventDefault ||= function () { this.defaultPrevented = true }
    event.stopPropagation ||= function () { this.propagationStopped = true }
    event.stopImmediatePropagation ||= function () { this.immediatePropagationStopped = true }
    const listeners = [...this.listeners.get(event.type) || []]
      .sort((a, b) => Number(b.capture) - Number(a.capture))
    for (const item of listeners) {
      item.callback.call(this, event)
      if (item.once) this.removeEventListener(event.type, item.callback, item.capture)
      if (event.immediatePropagationStopped) break
    }
    return !event.defaultPrevented
  }

  emit(type, properties = {}) {
    const event = { type, ...properties }
    this.dispatchEvent(event)
    return event
  }

  listenerCount(type) { return this.listeners.get(type)?.length || 0 }
}

class ElementStub extends EventTargetStub {
  constructor(tagName = 'div') {
    super()
    this.tagName = tagName.toUpperCase()
    this.children = []
    this.parentElement = null
    this.dataset = {}
    this.attributes = new Map()
    this.style = { setProperty(name, value) { this[name] = value }, removeProperty(name) { delete this[name] } }
    this.classes = new Set()
    this.classList = {
      contains: name => this.classes.has(name),
      add: (...names) => names.forEach(name => this.classes.add(name)),
      remove: (...names) => names.forEach(name => this.classes.delete(name)),
      toggle: (name, force) => {
        const next = force === undefined ? !this.classes.has(name) : force
        if (next) this.classes.add(name)
        else this.classes.delete(name)
        return next
      },
    }
    this.scrollLeft = 0
    this.clientWidth = 1000
    this.offsetLeft = 0
    this.offsetWidth = 90
    this.captured = []
    this.released = []
    this.pointerIds = new Set()
    this.textContent = ''
  }

  set className(value) { this.classes = new Set(value.split(/\s+/).filter(Boolean)) }
  get className() { return [...this.classes].join(' ') }
  set textContent(value) { this.text = value; this.replaceChildren() }
  get textContent() { return this.text + this.children.map(child => child.textContent).join('') }
  get parentNode() { return this.parentElement }
  get firstChild() { return this.children[0] || null }
  get scrollWidth() { return this.children.length * 100 }
  get isConnected() { return Boolean(this.parentElement) }

  appendChild(child) {
    child.parentElement?.removeChild(child)
    child.parentElement = this
    this.children.push(child)
    return child
  }

  append(...children) { children.forEach(child => this.appendChild(child)) }
  insertBefore(child, reference) {
    const index = this.children.indexOf(reference)
    if (index < 0) return this.appendChild(child)
    child.parentElement?.removeChild(child)
    child.parentElement = this
    this.children.splice(index, 0, child)
    return child
  }

  removeChild(child) {
    const index = this.children.indexOf(child)
    if (index >= 0) this.children.splice(index, 1)
    child.parentElement = null
    return child
  }

  replaceChildren(...children) {
    for (const child of this.children) child.parentElement = null
    this.children = []
    this.append(...children)
  }

  remove() { this.parentElement?.removeChild(this) }
  contains(target) { return target === this || this.children.some(child => child.contains(target)) }
  setAttribute(name, value) {
    this.attributes.set(name, String(value))
    if (name === 'class') this.className = String(value)
    else if (name === 'id') this.id = String(value)
    else if (name.startsWith('data-')) {
      this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = String(value)
    }
  }
  getAttribute(name) { return this.attributes.get(name) ?? null }
  removeAttribute(name) { this.attributes.delete(name) }

  matches(selector) {
    selector = selector.trim()
    const attrs = [...selector.matchAll(/\[([^=\]]+)(?:=["']?([^\]"']+)["']?)?\]/g)]
    selector = selector.replace(/\[[^\]]+\]/g, '')
    const id = selector.match(/#([\w-]+)/)?.[1]
    const classes = [...selector.matchAll(/\.([\w-]+)/g)].map(match => match[1])
    const tag = selector.match(/^[\w-]+/)?.[0]
    return (!tag || tag.toUpperCase() === this.tagName)
      && (!id || this.id === id)
      && classes.every(name => this.classList.contains(name))
      && attrs.every(([, name, value]) => {
        const actual = name.startsWith('data-')
          ? this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())]
          : this.getAttribute(name)
        return value === undefined ? actual != null : actual === value
      })
  }

  closest(selector) {
    return selector.split(',').some(part => this.matches(part))
      ? this : this.parentElement?.closest(selector) || null
  }

  querySelectorAll(selector) {
    const descendants = this.children.flatMap(child => [child, ...child.querySelectorAll('*')])
    return descendants.filter(child => selector.split(',').some(part => {
      const chain = part.trim().split(/\s+/)
      if (!child.matches(chain.pop())) return false
      let ancestor = child.parentElement
      while (chain.length) {
        const next = chain.pop()
        while (ancestor && !ancestor.matches(next)) ancestor = ancestor.parentElement
        if (!ancestor) return false
        ancestor = ancestor.parentElement
      }
      return true
    }))
  }

  querySelector(selector) { return this.querySelectorAll(selector)[0] || null }
  getBoundingClientRect() {
    const left = this.offsetLeft + (this.parentElement
      ? this.parentElement.getBoundingClientRect().left - this.parentElement.scrollLeft : 0)
    return { left, right: left + this.offsetWidth, width: this.offsetWidth,
      top: 0, bottom: 30, height: 30 }
  }
  setPointerCapture(id) { this.captured.push(id); this.pointerIds.add(id) }
  hasPointerCapture(id) { return this.pointerIds.has(id) }
  releasePointerCapture(id) { this.released.push(id); this.pointerIds.delete(id) }
  focus() { this.focused = true }
}

function fixture({ stored = [], current = 'overview', storage = new Map() } = {}) {
  if (!storage.has(STORAGE_KEY)) storage.set(STORAGE_KEY, JSON.stringify(stored))
  if (!storage.has(PAGE_KEY)) storage.set(PAGE_KEY, current)
  const document = new EventTargetStub()
  document.body = new ElementStub('body')
  document.documentElement = new ElementStub('html')
  document.documentElement.appendChild(document.body)
  document.readyState = 'complete'
  document.createElement = name => new ElementStub(name)
  document.querySelectorAll = selector => document.body.querySelectorAll(selector)
  document.querySelector = selector => document.body.querySelector(selector)
  document.getElementById = id => document.querySelector(`#${id}`)
  const main = document.body.appendChild(new ElementStub('main'))
  main.className = 'main'
  const content = main.appendChild(new ElementStub('div'))
  content.className = 'content'
  const page = content.appendChild(new ElementStub('section'))
  page.className = 'page active'
  page.dataset.page = current

  const window = new EventTargetStub()
  const calls = []
  window.innerWidth = 1280
  window.innerHeight = 720
  window.wbApp = {}
  window.showPage = function (...args) {
    const [next, options] = args
    calls.push({ args, receiver: this })
    page.dataset.page = next
    if (options?.persist !== false) storage.set(PAGE_KEY, next)
    return `shown:${next}`
  }
  window.wbApp.showPage = window.showPage

  // This is the React mount boundary, not a second implementation of tabs.
  // It renders exactly the controller snapshot and subscribes to real changes.
  let mounted = null
  let mounts = 0
  window.wbShellTabs = {
    mount(host, bridge) {
      mounts++
      assert.equal(bridge, window.wbTagsView)
      const viewport = host.appendChild(new ElementStub('div'))
      viewport.className = 'tags-scroll'
      viewport.offsetWidth = viewport.clientWidth
      function render() {
        const snapshot = bridge.getSnapshot()
        viewport.replaceChildren(...Array.from(snapshot.tags, (tab, index) => {
          const element = new ElementStub('div')
          element.className = `tag${tab.page === snapshot.current ? ' active' : ''}`
          element.dataset.page = tab.page
          element.offsetLeft = index * 100
          const label = element.appendChild(new ElementStub('span'))
          label.className = 'tag-label'
          label.textContent = tab.label
          if (tab.page !== snapshot.home) {
            const close = element.appendChild(new ElementStub('button'))
            close.className = 'tag-close'
          }
          return element
        }))
      }
      bridge.setViewport(viewport)
      render()
      const unsubscribe = bridge.subscribe(render)
      mounted = { host, bridge, viewport, unsubscribe }
    },
  }
  document.elementFromPoint = (x, y) => mounted?.viewport.children.find(element => {
    const rect = element.getBoundingClientRect()
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
  }) || null

  const timers = new Map()
  let timerId = 0
  const setTimer = callback => { timers.set(++timerId, callback); return timerId }
  const globals = {
    window, document, console, HTMLElement: ElementStub, Element: ElementStub,
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key),
    },
    setInterval: setTimer, clearInterval: id => timers.delete(id),
    setTimeout: setTimer, clearTimeout: id => timers.delete(id),
    requestAnimationFrame: callback => { callback(0); return 1 }, cancelAnimationFrame() {},
  }
  Object.assign(window, globals)
  const context = vm.createContext(globals)
  const run = () => vm.runInContext(source, context, { filename: filename.pathname, timeout: 1000 })
  run()
  assert.ok(mounted, 'The controller must mount its React shell-tabs host')
  const api = window.wbTagsView
  const list = () => Array.from(api.list())
  const pointer = (type, x, extra = {}) => ({ type, button: 0, buttons: type === 'pointerup' ? 0 : 1,
    isPrimary: true, pointerType: 'mouse', pointerId: 17, clientX: x, clientY: 12, ...extra })
  const tag = name => mounted.viewport.querySelector(`.tag[data-page="${name}"]`)
  const down = (name, extra = {}) => {
    const target = tag(name)
    mounted.host.dispatchEvent(pointer('pointerdown', target.offsetLeft + 20, { target, ...extra }))
    return target
  }
  const move = x => window.dispatchEvent(pointer('pointermove', x))
  const up = x => window.dispatchEvent(pointer('pointerup', x))
  return { api, list, run, storage, window, document, calls, tag, down, move, up,
    mounted: () => mounted, mounts: () => mounts }
}

// Old archive data is sanitized without losing the check-in page.
{
  const f = fixture({ stored: ['accounts', 'checkin', 'accounts', 'unknown', null, 'keys'] })
  assert.deepEqual(f.list(), ['overview', 'accounts', 'checkin', 'keys'])
  assert.deepEqual(JSON.parse(f.storage.get(STORAGE_KEY)), f.list())
  f.api.close('overview')
  assert.deepEqual(f.list(), ['overview', 'accounts', 'checkin', 'keys'], 'Home cannot be closed')
  const snapshot = f.api.getSnapshot()
  assert.equal(f.api.getSnapshot(), snapshot, 'Unchanged snapshots must have stable identity')
  assert.equal(snapshot.home, 'overview')
  assert.ok(Array.from(snapshot.pages).includes('checkin'))
  assert.equal(Array.from(snapshot.tags).find(tab => tab.page === 'checkin').label.length > 0, true)
  const copy = f.api.list()
  copy.length = 0
  assert.equal(f.list().length, 4, 'The legacy list API must return a defensive copy')
}

// Closing the current tab prefers its right neighbour, then the left one.
{
  const f = fixture({ stored: ['overview', 'accounts', 'checkin', 'keys', 'settings'], current: 'accounts' })
  f.api.close('accounts')
  assert.equal(f.api.getSnapshot().current, 'checkin')
  assert.equal(f.calls.at(-1).args[0], 'checkin')
  const calls = f.calls.length
  f.api.close('settings')
  assert.equal(f.calls.length, calls, 'Closing an inactive tab must not navigate')
  f.api.close('checkin')
  assert.equal(f.api.getSnapshot().current, 'keys')
  f.api.close('keys')
  assert.equal(f.api.getSnapshot().current, 'overview')
  assert.deepEqual(f.list(), ['overview'])
}

// The context-menu action is exercised through its real public bridge method.
{
  const f = fixture({ stored: ['overview', 'accounts', 'checkin', 'keys'], current: 'checkin' })
  f.api.closeOthers('checkin')
  assert.deepEqual(f.list(), ['overview', 'checkin'])
  assert.equal(f.api.getSnapshot().current, 'checkin')
  f.api.open('keys')
  f.api.closeOthers('checkin')
  assert.equal(f.api.getSnapshot().current, 'checkin', 'Closing other tabs must activate the retained target')
  assert.equal(f.calls.at(-1).args[0], 'checkin')
  f.api.closeAll()
  assert.deepEqual(f.list(), ['overview'])
  assert.equal(f.api.getSnapshot().current, 'overview')
  let updates = 0
  const unsubscribe = f.api.subscribe(() => updates++)
  f.api.open('keys')
  assert.ok(updates > 0, 'Mutations must notify the mounted React consumer')
  unsubscribe()
  const previousUpdates = updates
  f.api.open('docs')
  assert.equal(updates, previousUpdates, 'Unsubscribed consumers must stay detached')
}

// Refresh delegates navigation, while maximize and viewport actions retain state.
{
  const f = fixture({ stored: ['overview', 'accounts', 'checkin', 'keys'], current: 'keys' })
  const previousOrder = f.list()
  f.api.refresh('keys')
  assert.equal(f.calls.at(-1).args[0], 'keys')
  assert.deepEqual(f.list(), previousOrder)
  assert.equal(f.api.getSnapshot().contentMax, false)
  f.api.toggleContentMax()
  assert.equal(f.document.body.classList.contains('pref-content-max'), true)
  assert.equal(f.api.getSnapshot().contentMax, true)
  assert.equal(f.storage.get('aibuddy-content-max'), '1')
  f.document.emit('keydown', { key: 'Escape' })
  assert.equal(f.document.body.classList.contains('pref-content-max'), false)
  assert.equal(f.api.getSnapshot().contentMax, false)
  assert.equal(f.storage.get('aibuddy-content-max'), '0')
  f.api.toggleContentMax()
  const refreshed = fixture({ current: 'keys', storage: f.storage })
  assert.equal(refreshed.api.getSnapshot().contentMax, true, 'Content maximize survives a new VM')
  const viewport = f.mounted().viewport
  viewport.clientWidth = viewport.offsetWidth = 150
  f.api.revealCurrent()
  assert.equal(viewport.scrollLeft, 240, 'The active tag must be revealed horizontally')
  f.api.revealCurrent()
  assert.equal(viewport.scrollLeft, 240, 'An already-visible tag must not keep scrolling')
  f.api.open('overview')
  f.api.revealCurrent()
  assert.equal(viewport.scrollLeft, 0, 'The first tag must reveal back to the left')
  f.api.setViewport(null)
  assert.doesNotThrow(() => f.api.revealCurrent(), 'Unmounted viewports are safe')
  f.api.setViewport(viewport)
}

// Actual pointer listeners own threshold/capture, hit testing, order and storage.
{
  const f = fixture({ stored: ['overview', 'accounts', 'checkin', 'keys'], current: 'keys' })
  const dragged = f.down('accounts')
  assert.deepEqual(dragged.captured, [], 'A press must leave an ordinary tab click available')
  f.move(125)
  assert.deepEqual(dragged.captured, [], 'A 5px move is below the 6px drag threshold')
  f.move(126)
  assert.deepEqual(dragged.captured, [17], 'Pointer capture begins at the drag threshold')
  f.move(370)
  assert.ok(f.tag('keys').classList.contains('drop-after'))
  f.up(370)
  assert.deepEqual(f.list(), ['overview', 'checkin', 'keys', 'accounts'])
  assert.equal(f.api.getSnapshot().current, 'keys', 'Sorting must not navigate')
  assert.equal(f.calls.length, 0)
  assert.equal(f.document.body.classList.contains('tags-dragging'), false)
  assert.equal(f.mounted().host.querySelectorAll('.dragging, .drop-before, .drop-after').length, 0)
  for (const type of ['pointermove', 'pointerup', 'pointercancel']) {
    assert.equal(f.window.listenerCount(type), 0, `${type} must be removed after a completed drag`)
  }
  const click = f.mounted().host.emit('click', { target: f.tag('accounts') })
  assert.equal(click.defaultPrevented, true, 'A drag must suppress its following synthetic click')
  assert.equal(click.propagationStopped, true)
  assert.equal(f.mounted().host.emit('click', { target: f.tag('accounts') }).defaultPrevented, undefined,
    'Only the synthetic click is suppressed')
  const refreshed = fixture({ current: 'keys', storage: f.storage })
  assert.deepEqual(refreshed.list(), ['overview', 'checkin', 'keys', 'accounts'],
    'A new VM must restore the pointer-sorted archive')
}

// Canceled gestures and touch scrolling cannot rewrite the archive.
{
  const f = fixture({ stored: ['overview', 'accounts', 'keys'] })
  const initial = f.storage.get(STORAGE_KEY)
  f.down('accounts')
  f.move(270)
  f.window.emit('pointercancel', { pointerId: 17 })
  assert.equal(f.storage.get(STORAGE_KEY), initial)
  assert.equal(f.document.body.classList.contains('tags-dragging'), false)
  assert.equal(f.mounted().host.querySelectorAll('.dragging, .drop-before, .drop-after').length, 0)
  for (const type of ['pointermove', 'pointerup', 'pointercancel']) assert.equal(f.window.listenerCount(type), 0)
  const captures = f.tag('accounts').captured.length
  const touch = f.down('accounts', { pointerType: 'touch' })
  assert.equal(touch.captured.length, captures, 'Touch must not acquire another pointer capture')
  assert.equal(f.window.listenerCount('pointermove'), 0, 'Touch must retain native scrolling')
}

// A normal click and a press on the close button must not start pointer sorting.
{
  const f = fixture({ stored: ['overview', 'accounts', 'keys'] })
  const initial = f.storage.get(STORAGE_KEY)
  const tag = f.down('accounts')
  f.move(124)
  f.up(124)
  assert.deepEqual(tag.captured, [])
  assert.equal(f.storage.get(STORAGE_KEY), initial)
  const close = f.tag('accounts').querySelector('.tag-close')
  f.down('accounts', { target: close })
  assert.equal(f.window.listenerCount('pointermove'), 0)
  const nativeDrag = f.mounted().host.emit('dragstart', { target: f.tag('accounts') })
  assert.equal(nativeDrag.defaultPrevented, true, 'HTML drag ghosts must stay disabled')
}

// Both showPage entry points retain one wrapper through assignments and reloads.
{
  const f = fixture()
  const wrapped = f.window.showPage
  assert.equal(f.window.wbApp.showPage, wrapped)
  assert.equal(f.window.showPage('checkin', { persist: false }), 'shown:checkin')
  assert.equal(f.calls.length, 1)
  assert.equal(f.api.getSnapshot().current, 'checkin')
  f.window.showPage = wrapped
  f.window.wbApp.showPage = wrapped
  assert.equal(f.window.showPage('accounts'), 'shown:accounts')
  assert.equal(f.calls.length, 2, 'Reassigning the wrapper must not create recursive wrapping')
  const replacementCalls = []
  f.window.wbApp.showPage = function (...args) { replacementCalls.push({ receiver: this, args }); return 73 }
  assert.equal(f.window.showPage('keys', { force: true }), 73)
  assert.equal(replacementCalls.length, 1)
  assert.equal(replacementCalls[0].receiver, f.window)
  assert.deepEqual(replacementCalls[0].args, ['keys', { force: true }])
  const count = f.mounts()
  f.run()
  assert.equal(f.window.showPage, wrapped, 'Reloading the script must preserve the installed wrapper')
  assert.equal(f.window.wbTagsView, f.api, 'Reloading must retain the existing bridge and subscribers')
  assert.equal(f.mounts(), count, 'Reloading the script must not mount a second React root')
  assert.equal(f.window.wbApp.showPage('docs'), 73)
  assert.equal(replacementCalls.length, 2)
  assert.equal(f.document.querySelectorAll('.tags-view').length, 1)
  f.window.showPage = function (page) { return `replacement:${page}` }
  assert.equal(f.window.wbApp.showPage('tasks'), 'replacement:tasks',
    'Assigning the window route must also update the wbApp route')
  assert.equal(f.api.getSnapshot().current, 'tasks')
}

console.log('PASS: shell-tabs archive, close actions, subscriptions, pointer sorting and showPage wrappers')
