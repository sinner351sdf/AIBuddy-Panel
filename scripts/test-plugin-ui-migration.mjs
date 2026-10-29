// Local synthetic fixtures only: no listener, real account, provider call or outbound fetch.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('..', import.meta.url))
const islands = path.join(root, 'desktop-tauri/ui-islands')
const require = createRequire(path.join(islands, 'package.json'))
const { JSDOM } = require('jsdom')
const { buildSync } = require('esbuild')
const ts = require('typescript')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aibuddy-plugin-ui-'))
const dom = new JSDOM('<!doctype html><html><body><section id="plugin"><iframe src="http://127.0.0.1:3165/plugins/aibuddy-providers/ui/checkin/index.html"></iframe></section></body></html>', { url: 'http://127.0.0.1:3165', runScripts: 'outside-only' })
try {
  for (const key of ['window','document','HTMLElement','Element','Node','Event','CustomEvent','MutationObserver','HTMLButtonElement','HTMLInputElement','HTMLTextAreaElement','SVGElement','DocumentFragment','ShadowRoot']) globalThis[key] = dom.window[key]
  globalThis.localStorage = dom.window.localStorage
  globalThis.getComputedStyle = window.getComputedStyle.bind(window)
  globalThis.requestAnimationFrame = callback => setTimeout(callback,0)
  globalThis.cancelAnimationFrame = clearTimeout
  window.requestAnimationFrame = globalThis.requestAnimationFrame;window.cancelAnimationFrame = clearTimeout
  globalThis.ResizeObserver = window.ResizeObserver = class {observe(){}unobserve(){}disconnect(){}}
  window.matchMedia = () => ({matches:false,addEventListener(){},removeEventListener(){}})
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
  globalThis.fetch = async () => { throw new Error('fixture forbids network') }
  const requests = []
  window.wbI18n = { t: (s, values = {}) => s.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? `{${key}}`)) }
  window.__TAURI_INTERNALS__ = { invoke: async (command, {request}) => { assert.equal(command, 'api_request'); requests.push(request); return request.method === 'GET' ? { layout: null } : { saved: true } } }
  window.eval(fs.readFileSync(path.join(root, 'desktop-tauri/ui/sidebar-layout.js'), 'utf8'))
  const layoutApi = window.wbSidebarLayout
  const keys = () => Array.from(layoutApi.renderGroups(layoutApi.readLayout())).flatMap(group => Array.from(group.items).map(item => item.key))
  const defaults = keys()
  assert.deepEqual([...defaults].sort(), ['assistant','overview','accounts','credits','checkin','gateway','agent','proxies','keys','docs','requests','logs','tasks','plugins','settings'].sort())
  assert.deepEqual(Array.from(layoutApi.defaultLayout().groups).map(group => group.id), ['intelligence','pool','forward','ops'], 'retain local group identity')
  const damaged = layoutApi.normalizeLayout({ groups: [{ id:'custom', label:'My group', custom:true, hidden:false, items:['credits','credits','unknown','settings'] }], hidden:['settings','credits'] })
  assert.equal(damaged.groups.flatMap(group => group.items).filter(key => key === 'credits').length, 1)
  assert(!damaged.hidden.includes('settings'), 'fixed settings cannot disappear')
  assert(!damaged.groups.flatMap(group => group.items).includes('unknown'))
  layoutApi.writeLayout(damaged)
  assert.equal(requests.at(-1).path, '/api/sidebar-layout')
  assert.equal(requests.at(-1).method, 'PUT')
  assert(requests.at(-1).body.layout, 'web/native fallback uses the server layout envelope')
  layoutApi.setDynamicMenus([{key:'plugin:aibuddy-providers:fixtures',label:'Fixtures',icon:'plugins',url:'/plugins/aibuddy-providers/ui/test.html'}])
  assert(keys().includes('plugin:aibuddy-providers:fixtures'), 'new plugin page is restored into a visible group')
  layoutApi.setDynamicMenus([])
  assert(!keys().includes('plugin:aibuddy-providers:fixtures'), 'uninstalled plugin page disappears')
  localStorage.setItem(layoutApi.STORAGE_KEY, '{broken')
  assert(keys().includes('credits') && keys().includes('plugins'), 'corrupt cache falls back without dropping local features')

  const output = path.join(temp, 'migration.cjs')
  buildSync({ stdin:{contents:"export {ruleOfDraft,applyEditedLimiter} from './src/islands/accounts-dialog-limiter';export {pluginName} from './src/islands/plugins-shared';export {hasAssistantReply} from './src/islands/assistant-chat';export {getSnapshot,confirmDbRestore,resolveDbBackupConfirm,dismissDbRestore} from './src/islands/settings-state';export {shared} from './src/islands/settings-model';export {saveCaptcha} from './src/islands/settings-state';export {HiddenAccountsNotice} from './src/islands/accounts-hidden-notice';export {createElement} from 'react';export {renderToStaticMarkup} from 'react-dom/server';export {usesDurableGrowth} from './src/islands/checkin-center-tab';export {CreditsPage} from './src/islands/credits-page';export {createRoot} from 'react-dom/client';export {act} from 'react'",loader:'ts',resolveDir:islands}, bundle:true,platform:'node',format:'cjs',outfile:output,jsx:'automatic',alias:{'@ui':path.join(root,'desktop-tauri/ui-kit/src'),react:path.dirname(require.resolve('react/package.json')),'react-dom':path.dirname(require.resolve('react-dom/package.json'))},nodePaths:[path.join(islands,'node_modules'),path.join(root,'desktop-tauri/ui-kit/node_modules')],logLevel:'silent' })
  const api = require(output)
  assert(api.usesDurableGrowth('workbuddy'));assert(api.usesDurableGrowth('workbuddy-intl'));assert(!api.usesDurableGrowth('fixture-provider'))
  assert.equal(api.pluginName('aibuddy-providers', 'Upstream'), 'AIBuddy 提供商增强')
  assert.equal(api.pluginName('agent2api-providers', 'Upstream'), 'Agent2API 提供商插件', 'official and customized packs must not share a misleading identity')
  for (const [reason,label] of Object.entries({not_installed:'插件未安装',pack_disabled:'插件包已停用',provider_disabled:'提供商已停用',not_loaded:'插件未加载'})) {
    const html = api.renderToStaticMarkup(api.createElement(api.HiddenAccountsNotice,{hidden:{total:2,providers:[{id:'fixture',label:'Fixture',count:2,reason}]}}))
    assert(html.includes(label));assert(html.includes('账号数据仍然保留'),'hidden account state never implies deletion')
  }
  window.workbuddyDesktop = {saveCaptchaSetting:async value => {assert.equal(typeof value,'boolean','preserve the legacy captcha write contract');return {captchaEnabled:value}}}
  await api.saveCaptcha('web',true)
  assert.equal(api.getSnapshot().captcha.web,true);assert.equal(api.getSnapshot().captcha.desktop,true)
  await api.shared().workbuddyDesktop.getBackupProgress()
  assert.equal(requests.at(-1).path,'/api/backup/progress','new progress bridge is available on an old native shell')
  const draft = { type:'token',action:'skip',thresholdInput:'1',tokenUnit:'wan',reset:'daily',periodInput:'30',periodUnit:'minutes' }
  assert.equal(api.ruleOfDraft(draft).rule.threshold, 10000)
  for (const input of ['0','-1','Infinity','9007199254740992','NaN']) assert(api.ruleOfDraft({...draft,thresholdInput:input,tokenUnit:'unit'}).error, `reject unsafe token threshold ${input}`)
  const disabled = { type:'token',action:'skip',threshold:100,enabled:false,reset:'daily' }
  const changed = api.applyEditedLimiter([disabled], {...disabled,threshold:1000,enabled:true}, 0)
  assert.equal(changed[0].enabled, false, 'editing a deliberately disabled rule must not enable it')
  assert.equal(changed[0].threshold, 1000)
  assert.equal(disabled.threshold, 100, 'editing is immutable')
  assert.equal(api.applyEditedLimiter([], {...disabled,enabled:true}, -1)[0].enabled, true)
  assert(!api.hasAssistantReply({id:'empty',role:'assistant',parts:[{type:'step-start'},{type:'text',text:'  '}]}))
  assert(!api.hasAssistantReply({id:'user',role:'user',parts:[{type:'text',text:'question'}]}))
  assert(api.hasAssistantReply({id:'tool',role:'assistant',parts:[{type:'dynamic-tool',toolName:'list_models',toolCallId:'call',state:'output-available',input:{},output:'ok'}]}))

  // Execute the actual message handlers against known/rogue frames and origins.
  const app = fs.readFileSync(path.join(root,'desktop-tauri/ui/app.js'),'utf8')
  const source = ts.createSourceFile('app.js',app,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS)
  const functionText = name => source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(source)
  let credentialReads = 0
  const sent = []
  const frame = document.querySelector('iframe')
  frame.contentWindow.postMessage = (data,origin) => sent.push({data,origin})
  const context = vm.createContext({window,document,location:window.location,URL,api:{directCredentials:async()=>{credentialReads++;return {'x-panel-token':'synthetic'}}},pluginPageHost:()=>document.getElementById('plugin'),pushPanelTheme:()=>{},console})
  vm.runInContext(functionText('pushPanelToken')+'\n'+functionText('onPluginMessage')+'\nglobalThis.handlers={pushPanelToken,onPluginMessage}',context)
  context.handlers.onPluginMessage({data:{type:'agent2api:request-credentials'},source:{postMessage(){}},origin:'https://rogue.invalid'})
  context.handlers.onPluginMessage({data:{type:'agent2api:request-credentials'},source:frame.contentWindow,origin:'https://rogue.invalid'})
  await Promise.resolve();assert.equal(credentialReads,0)
  context.handlers.onPluginMessage({data:{type:'agent2api:request-credentials'},source:frame.contentWindow,origin:'http://127.0.0.1:3165'})
  await new Promise(resolve=>setTimeout(resolve,0));assert.equal(credentialReads,1);assert.equal(sent[0].origin,'http://127.0.0.1:3165')

  // A disconnected restore request must follow the real background progress to completion.
  const startedAt = Date.now() + 1
  let completed = false
  window.workbuddyDesktop = new Proxy({importDatabase:async()=>{throw new Error('synthetic connection lost')},getBackupProgress:async()=>completed?{active:false,failed:false,startedAt,finishedAt:Date.now(),result:{tables:['accounts'],safetyBackup:'fixture.db'}}:{active:true,startedAt,phase:'synthetic restore',percent:65}}, { get: (target,key) => key in target ? target[key] : async()=>({}) })
  window.wbApp = {toast() {},refresh:async()=>{}}
  api.confirmDbRestore();api.resolveDbBackupConfirm(true)
  for(let count=0;count<50 && !api.getSnapshot().dbRestore?.active;count++) await new Promise(resolve=>setTimeout(resolve,10))
  assert(api.getSnapshot().dbRestore.active)
  assert.equal(api.getSnapshot().dbRestore.failed,false)
  completed = true
  for(let count=0;count<100 && !api.getSnapshot().dbRestore?.done;count++) await new Promise(resolve=>setTimeout(resolve,10))
  assert.equal(api.getSnapshot().dbRestore.done,true)
  assert.equal(api.getSnapshot().dbRestore.tables,1)
  assert.equal(api.getSnapshot().dbRestore.safetyBackup,'fixture.db')
  api.dismissDbRestore();assert.equal(api.getSnapshot().dbRestore,null)

  // Pausing the isolated credit query is neutral and never erases a prior successful snapshot.
  const pausedText = '隔离验收已暂停积分包刷新，保留原有账号与余额记录'
  const creditHost = document.createElement('section');creditHost.className='page';creditHost.dataset.page='credits';document.body.appendChild(creditHost)
  const creditToasts = []
  window.wbApp = {toast:(...args)=>creditToasts.push(args)}
  let creditResponse = {results:[],skipped:0,pauseReason:pausedText}
  window.__TAURI_INTERNALS__.invoke = async (command,{request}) => {assert.equal(command,'api_request');assert.equal(request.path,'/api/accounts/usage/packages');return creditResponse}
  const creditRoot = api.createRoot(creditHost)
  await api.act(async()=>{creditRoot.render(api.createElement(api.CreditsPage));await Promise.resolve()})
  assert(creditHost.querySelector('[role="status"]')?.textContent.includes(pausedText))
  assert(!creditHost.textContent.includes('没有启用中的 WorkBuddy 账号'), 'an isolated pause must not claim accounts are absent')
  assert.equal(creditToasts.length,0,'a paused read is not an error toast')
  const normalCredits = name => ({at:Date.now(),results:[{id:'credit-fixture',name,usageLeft:'42',usageUsed:'58',usageTotal:'100',resources:[{id:'package-fixture',packageCode:'fixture',name:'Fixture package',total:100,used:58,left:42,startAt:Date.now()-86400000,expireAt:Date.now()+86400000*7}]}],skipped:0})
  creditResponse = normalCredits('Previous successful credit snapshot')
  await api.act(async()=>{creditHost.querySelector('#btn-credits-query').click();await Promise.resolve()})
  assert(creditHost.textContent.includes('Previous successful credit snapshot'));assert(!creditHost.textContent.includes(pausedText))
  creditResponse = {results:[],skipped:0,pauseReason:pausedText}
  await api.act(async()=>{creditHost.querySelector('#btn-credits-query').click();await Promise.resolve()})
  assert(creditHost.textContent.includes(pausedText));assert(creditHost.textContent.includes('Previous successful credit snapshot'),'paused empty results must not overwrite cached packages')
  creditResponse = normalCredits('Resumed credit snapshot')
  await api.act(async()=>{creditHost.querySelector('#btn-credits-query').click();await Promise.resolve()})
  assert(creditHost.textContent.includes('Resumed credit snapshot'));assert(!creditHost.textContent.includes(pausedText));assert.equal(creditToasts.length,0)
  await api.act(()=>creditRoot.unmount())

  console.log('PASS: plugin UI migration: local/dynamic sidebar, fixed/hidden/corrupt layout, native/web persistence bridge, custom pack identity, hidden account causes, legacy captcha, durable WorkBuddy routing, safe Token thresholds, disabled-rule editing, empty response semantics, frame credential isolation, disconnected restore completion and paused credit snapshot retention')
} finally { dom.window.close();fs.rmSync(temp,{recursive:true,force:true}) }

// Base UI scheduling retains a Node handle after all roots are explicitly unmounted.
process.exit(0)
