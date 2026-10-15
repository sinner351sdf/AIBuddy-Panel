// Execute the real legacy tooltip controller. These stubs provide DOM events,
// geometry and a deterministic clock; they do not implement tooltip behaviour.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const filename = new URL('../desktop-tauri/ui/tooltip.js', import.meta.url)
const source = readFileSync(filename, 'utf8')

class Events {
  listeners = new Map()
  addEventListener(type, callback, options = {}) {
    const capture = typeof options === 'boolean' ? options : Boolean(options.capture)
    const all = this.listeners.get(type) || []
    if (!all.some(item => item.callback === callback && item.capture === capture)) {
      all.push({ callback, capture, once: Boolean(options?.once) })
    }
    this.listeners.set(type, all)
  }
  removeEventListener(type, callback, options = {}) {
    const capture = typeof options === 'boolean' ? options : Boolean(options.capture)
    this.listeners.set(type, (this.listeners.get(type) || []).filter(item =>
      item.callback !== callback || item.capture !== capture))
  }
  emit(type, properties = {}) {
    const event = { type, target: this, defaultPrevented: false, propagationStopped: false,
      preventDefault() { this.defaultPrevented = true },
      stopPropagation() { this.propagationStopped = true }, ...properties }
    for (const item of [...this.listeners.get(type) || []]) {
      item.callback.call(this, event)
      if (item.once) this.removeEventListener(type, item.callback, item.capture)
    }
    return event
  }
  listenerCount(type) { return this.listeners.get(type)?.length || 0 }
}

class Element extends Events {
  constructor(tagName = 'span') {
    super()
    this.tagName = tagName.toUpperCase()
    this.nodeType = 1
    this.children = []
    this.parentNode = null
    this.dataset = {}
    this.attributes = new Map()
    this.textContent = ''
    this.focusVisible = false
    this.box = { left: 100, top: 100, width: 18, height: 18 }
    const classes = new Set()
    this.classList = {
      contains: name => classes.has(name),
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      toggle: (name, force) => {
        const on = force ?? !classes.has(name)
        if (on) classes.add(name)
        else classes.delete(name)
        return on
      },
      values: () => [...classes],
    }
  }
  set className(value) {
    this.classList.remove(...this.classList.values())
    this.classList.add(...value.split(/\s+/).filter(Boolean))
  }
  get className() { return this.classList.values().join(' ') }
  set tabIndex(value) { this.setAttribute('tabindex', String(value)) }
  get tabIndex() { return Number(this.getAttribute('tabindex') ?? -1) }
  get parentElement() { return this.parentNode }
  get isConnected() { return this.tagName === 'BODY' || Boolean(this.parentNode?.isConnected) }
  setAttribute(name, value) {
    this.attributes.set(name, String(value))
    if (name === 'id') this.id = String(value)
    if (name.startsWith('data-')) this.dataset[name.slice(5)] = String(value)
  }
  getAttribute(name) { return name.startsWith('data-') ? this.dataset[name.slice(5)] ?? null : this.attributes.get(name) ?? null }
  hasAttribute(name) { return this.getAttribute(name) !== null }
  removeAttribute(name) {
    this.attributes.delete(name)
    if (name.startsWith('data-')) delete this.dataset[name.slice(5)]
  }
  appendChild(child) {
    child.remove()
    child.parentNode = this
    this.children.push(child)
    return child
  }
  append(...children) { children.forEach(child => this.appendChild(child)) }
  removeChild(child) {
    const index = this.children.indexOf(child)
    assert.ok(index >= 0)
    this.children.splice(index, 1)
    child.parentNode = null
    return child
  }
  remove() { this.parentNode?.removeChild(this) }
  contains(target) { return target === this || this.children.some(child => child.contains(target)) }
  matches(selector) {
    return selector.split(',').some(part => {
      const value = part.trim()
      if (value === ':focus-visible') return this.focusVisible
      const attributes = [...value.matchAll(/\[([^=\]]+)(?:=["']?([^\]"']+)["']?)?\]/g)]
      const rest = value.replace(/\[[^\]]+\]/g, '')
      const tag = rest.match(/^[\w-]+/)?.[0]
      const id = rest.match(/#([\w-]+)/)?.[1]
      const classes = [...rest.matchAll(/\.([\w-]+)/g)].map(match => match[1])
      return (!tag || tag.toUpperCase() === this.tagName)
        && (!id || this.id === id)
        && classes.every(name => this.classList.contains(name))
        && attributes.every(([, name, expected]) => expected === undefined
          ? this.hasAttribute(name) : this.getAttribute(name) === expected)
    })
  }
  closest(selector) { return this.matches(selector) ? this : this.parentNode?.closest(selector) || null }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [
      ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector),
    ])
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null }
  getBoundingClientRect() {
    return { ...this.box, right: this.box.left + this.box.width, bottom: this.box.top + this.box.height }
  }
  getClientRects() { return this.box.width && this.box.height ? [this.getBoundingClientRect()] : [] }
}

function fixture({ hover = true, focusVisible = true, rendererReady = true } = {}) {
  const document = new Events()
  document.readyState = 'complete'
  document.body = new Element('body')
  document.documentElement = new Element('html')
  document.documentElement.appendChild(document.body)
  const created = []
  document.createElement = name => { created.push(name); return new Element(name) }
  document.createDocumentFragment = () => ({ querySelector() {
    if (!focusVisible) throw new Error('Unsupported pseudo selector')
    return null
  } })
  document.querySelectorAll = selector => document.body.querySelectorAll(selector)
  document.querySelector = selector => document.body.querySelector(selector)
  document.getElementById = id => document.querySelector(`#${id}`)
  const first = new Element()
  first.className = 'tip-q'
  first.dataset.tip = ' First explanation '
  const second = new Element('button')
  second.dataset.tip = 'Second explanation'
  second.textContent = 'Details'
  const blank = new Element()
  blank.dataset.tip = ' '
  document.body.append(first, second, blank)

  const mutations = []
  const sizes = []
  class MutationObserver {
    constructor(callback) { this.callback = callback; mutations.push(this) }
    observe(target, options) { this.target = target; this.options = options }
  }
  class ResizeObserver {
    constructor(callback) { this.callback = callback; this.targets = []; sizes.push(this) }
    observe(target) { this.targets.push(target) }
    unobserve(target) { this.targets = this.targets.filter(item => item !== target) }
    disconnect() { this.targets = [] }
  }
  let clock = 0
  let timerId = 0
  const timers = new Map()
  const microtasks = []
  function advance(ms) {
    const until = clock + ms
    let work = 0
    while (true) {
      const next = [...timers].filter(([, timer]) => timer.due <= until)
        .sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0]
      if (!next) break
      assert.ok(++work < 100, 'Timer callbacks must not spin forever')
      timers.delete(next[0])
      clock = next[1].due
      next[1].callback()
    }
    clock = until
  }
  function flush() { while (microtasks.length) microtasks.shift()() }
  const window = new Events()
  window.innerWidth = 1280
  window.innerHeight = 720
  window.matchMedia = () => ({ matches: hover })
  const mounted = new WeakSet()
  const mounts = []
  const renderer = { mount(host, bridge) {
    if (mounted.has(host)) return
    mounted.add(host)
    const view = { host, bridge, snapshots: [bridge.getSnapshot()] }
    bridge.subscribe(() => view.snapshots.push(bridge.getSnapshot()))
    mounts.push(view)
  } }
  if (rendererReady) window.wbLegacyTooltips = renderer
  const globals = { window, document, Element, HTMLElement: Element, MutationObserver, ResizeObserver, console,
    queueMicrotask: callback => microtasks.push(callback),
    setTimeout: (callback, delay) => { timers.set(++timerId, { due: clock + delay, callback }); return timerId },
    clearTimeout: id => timers.delete(id),
    requestAnimationFrame: callback => { microtasks.push(callback); return 1 }, cancelAnimationFrame() {},
  }
  Object.assign(window, globals)
  const context = vm.createContext(globals)
  const run = () => vm.runInContext(source, context, { filename: filename.pathname, timeout: 1000 })
  run()
  const api = window.wbTooltip
  assert.ok(api?.getSnapshot, 'The legacy controller must expose its observable bridge')
  const mutate = records => { mutations.forEach(observer => observer.callback(records)); flush() }
  const resize = (element, width, height) => {
    element.box.width = width
    element.box.height = height
    sizes.filter(observer => observer.targets.includes(element)).forEach(observer =>
      observer.callback([{ target: element, contentRect: { width, height } }]))
  }
  const click = element => {
    document.emit('click', { target: element }) // document capture runs before the target's handler
    return element.emit('click', { target: element })
  }
  return { document, window, api, first, second, blank, created, mounts, mutations, sizes, timers,
    advance, flush, mutate, resize, click, run,
    ready: () => { window.wbLegacyTooltips = renderer; document.emit('wb:legacy-tooltips-ready') },
    snapshot: () => api.getSnapshot() }
}

// Existing data-tip markup is enhanced once, without replacing its content.
{
  const f = fixture()
  assert.equal(f.api.enhanced(f.first), true)
  assert.equal(f.api.enhanced(f.second), true)
  assert.equal(f.api.enhanced(f.blank), false)
  assert.equal(f.first.textContent, '?')
  assert.equal(f.first.tabIndex, 0)
  assert.equal(f.second.textContent, 'Details')
  assert.equal(f.second.hasAttribute('tabindex'), false, 'Native focusable controls retain their tab order')
  assert.equal(f.mounts.length, 1)
  assert.equal(f.mounts[0].host.id, 'legacy-tooltips-host')
  assert.deepEqual(f.created, ['div'], 'The classic controller creates a renderer host, not its own bubble')
  const initial = f.snapshot()
  assert.equal(f.snapshot(), initial)
  assert.equal(initial.anchor, null)
  assert.equal(initial.bubbleId, 'wb-tip-bubble')
  assert.equal(f.sizes.length, 1, 'Size observation is shared rather than allocated for every tip')
  assert.equal(f.sizes[0].targets.length, 0)
  f.api.open(f.first)
  assert.equal(f.snapshot().anchor, f.first)
  assert.equal(f.snapshot().text, 'First explanation')
  assert.equal(f.snapshot().pinned, false)
  assert.deepEqual(f.sizes[0].targets, [f.first], 'Only the active anchor needs size observation')
  assert.equal(f.first.classList.contains('active'), true)
  assert.ok(f.first.getAttribute('aria-describedby')?.split(/\s+/).includes('wb-tip-bubble'))
  f.api.close()
  assert.equal(f.snapshot().anchor, null)
  assert.equal(f.first.classList.contains('active'), false)
  assert.equal(f.first.getAttribute('aria-describedby'), null)
  assert.equal(f.sizes[0].targets.length, 0, 'Closing must release the active size observation')
}

// Hover delays are exercised at their boundaries, including cancellation/switching.
{
  const f = fixture()
  f.first.emit('pointerenter')
  f.advance(149)
  assert.equal(f.snapshot().anchor, null)
  f.advance(1)
  assert.equal(f.snapshot().anchor, f.first)
  f.first.emit('pointerleave')
  f.advance(79)
  assert.equal(f.snapshot().anchor, f.first)
  f.advance(1)
  assert.equal(f.snapshot().anchor, null)
  f.first.emit('pointerenter')
  f.advance(100)
  f.first.emit('pointerleave')
  f.advance(200)
  assert.equal(f.snapshot().anchor, null, 'Leaving before the delay cancels the pending show')
  f.api.open(f.first)
  f.second.emit('pointerenter')
  f.advance(0)
  assert.equal(f.snapshot().anchor, f.second, 'Moving between existing explanations switches immediately')
  f.first.emit('pointerleave')
  f.advance(80)
  assert.equal(f.snapshot().anchor, f.second, 'A previous anchor cannot hide the new one')
}

// Click pins, repeated click closes, and a public open remains an unpinned open.
{
  const f = fixture()
  f.click(f.first)
  assert.equal(f.snapshot().anchor, f.first)
  assert.equal(f.snapshot().pinned, true)
  f.first.emit('pointerleave')
  f.advance(200)
  assert.equal(f.snapshot().anchor, f.first)
  f.click(f.first)
  assert.equal(f.snapshot().anchor, null)
  f.click(f.first)
  f.api.open(f.first)
  assert.equal(f.snapshot().pinned, false, 'Public open must not inherit an earlier click pin')
  f.first.emit('pointerleave')
  f.advance(80)
  assert.equal(f.snapshot().anchor, null)
  f.click(f.first)
  f.click(f.second)
  assert.equal(f.snapshot().anchor, f.second)
  assert.equal(f.snapshot().pinned, true)
  const child = f.second.appendChild(new Element())
  const inside = f.document.emit('click', { target: child })
  assert.equal(f.snapshot().anchor, f.second)
  assert.equal(inside.defaultPrevented, false)
  const outside = f.document.emit('click', { target: f.document.body })
  assert.equal(f.snapshot().anchor, null)
  assert.equal(outside.defaultPrevented, false, 'Outside dismissal must preserve the business click')
}

// Keyboard focus opens; pointer focus does not double-toggle the following click.
{
  const f = fixture()
  f.first.emit('focus')
  assert.equal(f.snapshot().anchor, null)
  f.click(f.first)
  assert.equal(f.snapshot().pinned, true)
  f.first.emit('blur')
  assert.equal(f.snapshot().anchor, null, 'Blur dismisses pinned explanations too')
  f.first.focusVisible = true
  f.first.emit('focus')
  assert.equal(f.snapshot().anchor, f.first)
  assert.equal(f.snapshot().pinned, false)
  const ignored = f.first.emit('keydown', { key: 'Enter' })
  assert.equal(f.snapshot().anchor, f.first)
  assert.equal(ignored.defaultPrevented, false)
  const escape = f.first.emit('keydown', { key: 'Escape' })
  assert.equal(f.snapshot().anchor, null)
  assert.equal(escape.defaultPrevented, true)
  assert.equal(escape.propagationStopped, false, 'Escape must still bubble to an enclosing dialog')
  const fallback = fixture({ focusVisible: false })
  fallback.first.emit('focus')
  assert.equal(fallback.snapshot().anchor, fallback.first, 'Old engines keep keyboard access without :focus-visible')
}

// Touch devices keep click access without starting hover timers.
{
  const f = fixture({ hover: false })
  f.first.emit('pointerenter')
  f.advance(200)
  assert.equal(f.snapshot().anchor, null)
  f.click(f.first)
  assert.equal(f.snapshot().pinned, true)
  f.first.emit('pointerleave')
  f.advance(200)
  assert.equal(f.snapshot().anchor, f.first)
}

// Added subtrees and data-tip changes share the actual MutationObserver path.
{
  const f = fixture()
  assert.equal(f.mutations[0].options.attributes, true)
  assert.ok(Array.from(f.mutations[0].options.attributeFilter).includes('data-tip'))
  const root = new Element('div')
  root.dataset.tip = 'Container explanation'
  const nested = root.appendChild(new Element())
  nested.dataset.tip = 'Nested explanation'
  f.document.body.appendChild(root)
  f.mutate([{ type: 'childList', target: f.document.body, addedNodes: [root], removedNodes: [] }])
  assert.equal(f.api.enhanced(root), true)
  assert.equal(f.api.enhanced(nested), true)
  f.mutate([{ type: 'childList', target: root, addedNodes: [nested], removedNodes: [] }])
  assert.equal(nested.listenerCount('click'), 1, 'Overlapping mutation scans cannot double-bind')
  f.blank.setAttribute('data-tip', 'Now dynamic')
  f.mutate([{ type: 'attributes', attributeName: 'data-tip', target: f.blank, addedNodes: [] }])
  assert.equal(f.api.enhanced(f.blank), true)
  f.api.open(f.blank)
  f.blank.setAttribute('data-tip', ' Updated while visible ')
  f.mutate([{ type: 'attributes', attributeName: 'data-tip', target: f.blank, addedNodes: [] }])
  assert.equal(f.snapshot().text, 'Updated while visible')
  f.blank.removeAttribute('data-tip')
  f.mutate([{ type: 'attributes', attributeName: 'data-tip', target: f.blank, addedNodes: [] }])
  assert.equal(f.snapshot().anchor, null, 'Removing visible help text dismisses its explanation')
}

// The shared bubble adds its description without erasing pre-existing help text.
{
  const f = fixture()
  f.first.setAttribute('aria-describedby', 'existing-help alternate-help')
  f.api.open(f.first)
  f.api.open(f.first)
  assert.equal(f.first.getAttribute('aria-describedby'), 'existing-help alternate-help wb-tip-bubble')
  f.api.close()
  assert.equal(f.first.getAttribute('aria-describedby'), 'existing-help alternate-help')
}

// Anchor removal, hiding and scrolling out of view cannot leave an orphan bubble.
{
  const f = fixture()
  f.api.open(f.first)
  f.first.remove()
  f.mutate([{ type: 'childList', target: f.document.body, addedNodes: [], removedNodes: [f.first] }])
  assert.equal(f.snapshot().anchor, null)
  f.api.open(f.second)
  f.resize(f.second, 0, 0)
  assert.equal(f.snapshot().anchor, null)
  f.resize(f.second, 18, 18)
  f.api.open(f.second)
  f.second.box.top = -30
  f.window.emit('scroll')
  f.flush()
  assert.equal(f.snapshot().anchor, null)
  f.second.box.top = 100
  f.api.open(f.second)
  f.second.box.top = 800
  f.window.emit('resize')
  f.flush()
  assert.equal(f.snapshot().anchor, null)
}

// Removing an anchor during its hover delay must not open a detached element later.
{
  const f = fixture()
  f.first.emit('pointerenter')
  f.advance(100)
  f.first.remove()
  f.mutate([{ type: 'childList', target: f.document.body, addedNodes: [], removedNodes: [f.first] }])
  f.advance(50)
  assert.ok(f.snapshot().anchor === null, 'A pending hover must not reopen an anchor removed during the delay')
}

// In-view movement keeps the same anchor; subscriptions and repeated boot stay intact.
{
  const f = fixture({ rendererReady: false })
  assert.equal(f.mounts.length, 0)
  f.ready()
  assert.equal(f.mounts.length, 1)
  f.api.open(f.first)
  f.first.box.left = 300
  f.first.box.top = 250
  const beforeScroll = f.mounts[0].snapshots.length
  f.window.emit('scroll')
  f.flush()
  assert.equal(f.snapshot().anchor, f.first)
  assert.ok(f.mounts[0].snapshots.length > beforeScroll, 'Scrolling notifies the renderer to follow the anchor')
  const beforeResize = f.mounts[0].snapshots.length
  f.window.emit('resize')
  f.flush()
  assert.equal(f.snapshot().anchor, f.first)
  assert.ok(f.mounts[0].snapshots.length > beforeResize, 'Resizing notifies the renderer to follow the anchor')
  let updates = 0
  const unsubscribe = f.api.subscribe(() => updates++)
  f.api.close()
  assert.ok(updates > 0)
  unsubscribe()
  const previous = updates
  f.api.open(f.second)
  assert.equal(updates, previous)
  const scrollListeners = f.window.listenerCount('scroll')
  const resizeListeners = f.window.listenerCount('resize')
  const observerCount = f.mutations.length
  f.run()
  assert.equal(f.window.wbTooltip, f.api, 'Repeated script load retains the existing controller')
  assert.equal(f.mounts.length, 1)
  assert.equal(f.snapshot().anchor, f.second)
  assert.equal(f.window.listenerCount('scroll'), scrollListeners)
  assert.equal(f.window.listenerCount('resize'), resizeListeners)
  assert.equal(f.mutations.length, observerCount)
  assert.equal(f.second.listenerCount('click'), 1)
  assert.deepEqual(f.created, ['div'])
}

console.log('PASS: legacy-tooltip delays, pins, focus, dynamic tips, viewport cleanup and lifecycle')
