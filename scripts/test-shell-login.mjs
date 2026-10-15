// Run production shell scripts and TSX with a simulated DOM, React host and desktop bridge.
// No browser, real window commands, provider requests, credentials or session changes.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'

const require = createRequire(new URL('../desktop-tauri/ui-islands/package.json', import.meta.url))
const ts = require('typescript')
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

class Element {
  constructor(tag) {
    this.tag = tag; this.children = []; this.attributes = {}; this.events = new Map()
    this.value = ''; this.style = {}; this.hidden = false; this.disabled = false; this.focused = 0
    this.classList = { add: name => { this.className = `${this.className || ''} ${name}`.trim() } }
  }
  get firstChild() { return this.children[0] || null }
  append(...children) { children.forEach(child => { child.parentNode = this; this.children.push(child) }) }
  appendChild(child) { this.append(child); return child }
  insertBefore(child, before) {
    child.parentNode = this
    const index = this.children.indexOf(before)
    if (index < 0) this.children.push(child); else this.children.splice(index, 0, child)
  }
  setAttribute(name, value) { this.attributes[name] = value }
  getAttribute(name) { return this.attributes[name] ?? null }
  addEventListener(name, callback) { const entries = this.events.get(name) || []; entries.push(callback); this.events.set(name, entries) }
  removeEventListener(name, callback) { this.events.set(name, (this.events.get(name) || []).filter(entry => entry !== callback)) }
  dispatch(name, event = {}) { for (const listener of this.events.get(name) || []) listener(event) }
  querySelector(selector) { return this.children.find(child => selector.startsWith('.') ? child.className?.split(' ').includes(selector.slice(1)) : child.tag === selector) || null }
  focus() { this.focused++ }
  set textContent(value) { this.text = value; this.children = []; this.contentWrites = (this.contentWrites || 0) + 1 }
  get textContent() { return this.text || '' }
  set innerHTML(value) { this.html = value; this.children = []; this.contentWrites = (this.contentWrites || 0) + 1 }
}

function fixture({ platform = 'windows', stored = {}, storageBlocked = false } = {}) {
  const body = new Element('body'), html = new Element('html'), docEvents = new Element('document')
  const timers = new Map(), storage = new Map(Object.entries(stored)), roots = new Map(), calls = []
  let timerId = 0, currentComponent, cursor = 0, maximized = false, resize, loginState = { active: false }
  const hooks = new Map()
  const find = (node, id) => node.id === id ? node : node.children.map(child => find(child, id)).find(Boolean)
  const document = {
    body, documentElement: html, readyState: 'complete', fullscreenElement: null,
    getElementById: id => find(body, id) || null, createElement: tag => new Element(tag),
    querySelector: selector => body.querySelector(selector),
    addEventListener: (...args) => docEvents.addEventListener(...args),
    removeEventListener: (...args) => docEvents.removeEventListener(...args),
    exitFullscreen: async () => { calls.push('exit-fullscreen'); document.fullscreenElement = null; docEvents.dispatch('fullscreenchange') },
  }
  html.requestFullscreen = async () => { calls.push('enter-fullscreen'); document.fullscreenElement = html; docEvents.dispatch('fullscreenchange') }
  const localStorage = {
    getItem(key) { if (storageBlocked) throw Error('storage blocked'); return storage.get(key) ?? null },
    setItem(key, value) { if (storageBlocked) throw Error('storage blocked'); storage.set(key, value) },
    removeItem(key) { if (storageBlocked) throw Error('storage blocked'); storage.delete(key) },
  }
  const bridge = {
    platform, title: 'Fixture title',
    windowMinimize: async () => { calls.push('minimize') },
    windowToggleMaximize: async () => { calls.push('toggle-maximize'); maximized = !maximized },
    windowClose: async () => { calls.push('close') },
    windowIsMaximized: async () => maximized,
    onWindowResize(callback) { resize = callback; return () => { resize = null } },
    onLoginState(callback) { bridge.pushLoginState = payload => { loginState = payload; callback(payload) } },
    getLoginState: async () => loginState,
    cancelLogin: async () => { calls.push('cancel-login'); bridge.pushLoginState({ active: false }) },
  }
  const window = {
    workbuddyDesktop: bridge, localStorage,
    wbApp: { toast: (...args) => calls.push(['app-toast', ...args]) },
    wbToast: { show: message => { calls.push(['toast', message]); return true } },
    wbProviders: { labelOf: id => id },
    setInterval: (callback, ms) => { const id = ++timerId; timers.set(id, { callback, ms }); return id },
    clearInterval: id => timers.delete(id),
    setTimeout: (callback, ms) => { const id = ++timerId; timers.set(id, { callback, ms }); return id },
    clearTimeout: id => timers.delete(id),
  }
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children: children.length === 1 ? children[0] : children } }),
    Fragment: Symbol('Fragment'),
    useState(initial) {
      const entries = hooks.get(currentComponent), index = cursor++
      if (!(index in entries)) entries[index] = typeof initial === 'function' ? initial() : initial
      return [entries[index], value => { entries[index] = typeof value === 'function' ? value(entries[index]) : value }]
    },
    useRef(initial) { const entries = hooks.get(currentComponent), index = cursor++; return entries[index] ??= { current: initial } },
    useCallback: callback => callback,
    useEffect(effect) { const entries = hooks.get(currentComponent), index = cursor++; if (!(index in entries)) entries[index] = { cleanup: effect() } },
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
  }
  const ui = new Proxy({ cn: (...parts) => parts.filter(part => typeof part === 'string').join(' ') }, { get: (target, name) => target[name] ?? name })
  const context = vm.createContext({
    window, document, localStorage, console, Promise, Date,
    MutationObserver: class { constructor(callback) { this.callback = callback } observe() {} disconnect() {} },
    wbI18n: { t: text => text },
    busy: false, releaseBusy() { context.busy = false },
  })
  function load(path) {
    const module = { exports: {} }
    const output = ts.transpileModule(read(path), { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
    const imports = name => {
      if (name === 'react') return react
      if (name === 'react-dom') return { flushSync: callback => callback() }
      if (name === 'react-dom/client') return { createRoot: host => ({ render: element => roots.set(host, element) }) }
      if (name === '@ui') return ui
      if (name === '../i18n') return { t: text => text }
      throw Error(`Unexpected production dependency: ${name}`)
    }
    vm.runInContext(`(function(require,module,exports){${output}\n})`, context)(imports, module, module.exports)
    return module.exports
  }
  function render(element) {
    currentComponent = element.type; cursor = 0
    if (!hooks.has(currentComponent)) hooks.set(currentComponent, [])
    return element.type(element.props)
  }
  const host = id => { const element = new Element('div'); element.id = id; body.append(element); return element }
  return { window, document, bridge, storage, timers, roots, calls, context, load, render, host,
    script: path => vm.runInContext(read(path), context),
    resize(value) { maximized = value; resize?.() },
  }
}

function allNodes(node) {
  if (Array.isArray(node)) return node.flatMap(allNodes)
  if (!node || typeof node !== 'object') return []
  return [node, ...allNodes(node.props?.render), ...allNodes(node.props?.children)]
}
const buttons = tree => allNodes(tree).filter(node => node.type === 'Button' || node.type === 'InputGroupButton')

// The real classic titlebar preserves web/macOS guards and mounts React only for desktop controls.
for (const platform of ['web', 'macos', 'windows', 'linux']) {
  const f = fixture({ platform })
  f.load('desktop-tauri/ui-islands/src/islands/shell-window-controls.tsx')
  f.script('desktop-tauri/ui/titlebar.js')
  const bar = f.document.body.children.find(node => node.tag === 'header')
  assert.equal(Boolean(bar), platform !== 'web')
  const actions = f.document.getElementById('titlebar-window-controls')
  assert.equal(Boolean(actions), platform === 'windows' || platform === 'linux')
  if (actions) {
    assert.ok(f.roots.has(actions))
    let tree = f.render(f.roots.get(actions)); await flush()
    assert.deepEqual(buttons(tree).map(button => button.props['aria-label']), ['最小化', '最大化', '关闭'])
    buttons(tree)[0].props.onClick(); await buttons(tree)[1].props.onClick(); buttons(tree)[2].props.onClick(); await flush()
    tree = f.render(f.roots.get(actions))
    assert.equal(buttons(tree)[1].props['aria-label'], '还原')
    f.resize(false); await flush(); tree = f.render(f.roots.get(actions))
    assert.equal(buttons(tree)[1].props['aria-label'], '最大化')
    assert.deepEqual(f.calls, ['minimize', 'toggle-maximize', 'close'])
    f.window.wbWindowControls.mountTitlebar(actions)
    assert.equal(f.roots.size, 1, 'mounting the same host is idempotent')
  }
}
{
  const f = fixture(); delete f.bridge.windowClose
  f.load('desktop-tauri/ui-islands/src/islands/shell-window-controls.tsx'); f.script('desktop-tauri/ui/titlebar.js')
  assert.equal(f.document.body.children.length, 0, 'old bridges without all window commands keep the original guard')
}

// Fullscreen remains available on every platform and reports unsupported environments through Toast.
for (const platform of ['web', 'macos', 'windows']) {
  const f = fixture({ platform }), host = f.host('shell-window-controls')
  f.load('desktop-tauri/ui-islands/src/islands/shell-window-controls.tsx')
  let tree = f.render(f.roots.get(host)), button = buttons(tree)[0]
  assert.equal(button.props.id, 'shell-btn-fullscreen')
  button.props.onClick(); await flush(); tree = f.render(f.roots.get(host)); button = buttons(tree)[0]
  assert.equal(button.props['aria-label'], '退出全屏'); assert.equal(button.props['aria-pressed'], true)
  button.props.onClick(); await flush(); tree = f.render(f.roots.get(host))
  assert.equal(buttons(tree)[0].props['aria-pressed'], false)
  f.document.documentElement.requestFullscreen = () => Promise.reject(Error('unsupported'))
  buttons(tree)[0].props.onClick(); await flush()
  assert.deepEqual(f.calls, ['enter-fullscreen', 'exit-fullscreen', ['toast', '当前环境不支持全屏']])
}

// Login theme keeps both preference keys, unrelated preferences and the blocked-storage fallback.
for (const storageBlocked of [false, true]) {
  const f = fixture({ stored: { 'aibuddy-prefs': JSON.stringify({ theme: 'dark', density: 'compact' }) }, storageBlocked })
  f.document.documentElement.setAttribute('data-theme', 'dark')
  const host = f.host('login-theme-toggle-host')
  f.load('desktop-tauri/ui-islands/src/islands/shell-login-extras.tsx')
  let tree = f.render(f.roots.get(host)); buttons(tree)[0].props.onClick(); tree = f.render(f.roots.get(host))
  assert.equal(f.document.documentElement.getAttribute('data-theme'), 'light')
  assert.equal(buttons(tree)[0].props.id, 'login-theme-toggle')
  assert.equal(buttons(tree)[0].props['aria-label'], '切换到深色')
  if (!storageBlocked) {
    assert.deepEqual(JSON.parse(f.storage.get('aibuddy-prefs')), { theme: 'light', density: 'compact' })
    assert.equal(f.storage.get('workbuddy-desktop-theme'), 'light')
  }
}

// Password state belongs to its own InputGroup; the imperative form/submit nodes stay outside it.
{
  const f = fixture(), host = f.host('login-app')
  f.load('desktop-tauri/ui-islands/src/islands/login-page.tsx')
  const page = f.render(f.roots.get(host)), password = allNodes(page).find(node => node.type?.name === 'PasswordInput')
  assert.ok(password)
  let tree = f.render(password), input = allNodes(tree).find(node => node.type === 'InputGroupInput')
  assert.equal(input.props.id, 'password'); assert.equal(input.props.type, 'password')
  const inputNode = new Element('input'); inputNode.value = 'fixture-only'; input.props.ref.current = inputNode
  buttons(tree)[0].props.onClick(); tree = f.render(password)
  input = allNodes(tree).find(node => node.type === 'InputGroupInput')
  assert.equal(input.props.type, 'text'); assert.equal(buttons(tree)[0].props['aria-pressed'], true)
  assert.equal(inputNode.value, 'fixture-only'); assert.equal(inputNode.focused, 1)
  buttons(tree)[0].props.onClick(); tree = f.render(password)
  assert.equal(allNodes(tree).find(node => node.type === 'InputGroupInput').props.type, 'password')
  assert.equal(allNodes(page).filter(node => node.props?.id === 'submit').length, 1)
}

// Remembered usernames still debounce/clear; the classic enhancement no longer injects password buttons.
{
  const f = fixture({ stored: { 'aibuddy-login-user': 'saved-user' } })
  f.host('login-app'); const username = f.host('username'); const password = f.host('password')
  password.value = 'fixture-only'; f.script('desktop-tauri/ui/js/login-extras.js')
  const polling = [...f.timers.values()].find(timer => timer.ms === 100); assert.ok(polling); polling.callback()
  assert.equal(username.value, 'saved-user')
  username.value = ' next-user '; username.dispatch('input')
  ;[...f.timers.values()].find(timer => timer.ms === 400).callback()
  assert.equal(f.storage.get('aibuddy-login-user'), 'next-user')
  username.value = ' '; username.dispatch('input')
  ;[...f.timers.values()].find(timer => timer.ms === 400).callback()
  assert.equal(f.storage.has('aibuddy-login-user'), false)
  assert.equal(password.value, 'fixture-only'); assert.equal(password.events.size, 0)
  assert.equal(f.document.body.children.some(node => node.className === 'login-eye'), false)
}

// Execute the actual login engine against its React content store; no DOM content mutation is allowed.
{
  const f = fixture(), pending = deferred()
  const { WebLoginButtonContent } = f.load('desktop-tauri/ui-islands/src/islands/web-login-button.tsx')
  const button = f.host('web-login-button'), cancel = f.host('web-login-cancel'); f.host('web-login-hint')
  const sibling = new Element('span'); button.append(sibling)
  const other = f.host('qoder-web-button'); f.host('qoder-web-cancel'); f.host('qoder-web-hint')
  f.script('desktop-tauri/ui/web-login.js')
  const controller = f.window.wbWebLogin.create({ provider: 'workbuddy', buttonId: button.id, cancelId: cancel.id, hintId: 'web-login-hint',
    texts: () => ({ button: '打开网页登录', hint: 'fixture' }), busyText: '等待网页登录…', start: () => pending.promise, onSuccess: () => assert.fail('the canceled fixture cannot succeed') })
  f.window.wbWebLogin.create({ provider: 'qoder', buttonId: other.id, cancelId: 'qoder-web-cancel', hintId: 'qoder-web-hint', texts: () => ({ button: 'Qoder 登录', hint: 'fixture' }) })
  const content = { type: WebLoginButtonContent, props: { buttonId: button.id, children: 'fallback' } }
  let tree = f.render(content); assert.equal(allNodes(tree).some(node => node.type === 'Spinner'), false)
  const started = controller.start(); f.bridge.pushLoginState({ active: true, provider: 'workbuddy' }); await flush()
  tree = f.render(content)
  assert.equal(allNodes(tree).filter(node => node.type === 'Spinner').length, 1)
  assert.equal(button.disabled, true); assert.equal(button.ariaBusy, 'true'); assert.equal(cancel.hidden, false)
  assert.equal(other.disabled, true); assert.equal(other.ariaBusy, 'false')
  assert.equal(button.children[0], sibling); assert.equal(button.contentWrites, undefined)
  f.bridge.pushLoginState({ active: false }); pending.resolve({ canceled: true }); await started
  tree = f.render(content)
  assert.equal(allNodes(tree).some(node => node.type === 'Spinner'), false)
  assert.equal(button.disabled, false); assert.equal(button.ariaBusy, 'false'); assert.equal(cancel.hidden, true)
  assert.equal(f.context.busy, false); assert.equal(button.children[0], sibling)
}

console.log('PASS: production login/password/theme/window/fullscreen controls with simulated React/DOM/bridge; no external operations')
