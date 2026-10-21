import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import {createRequire} from 'node:module'
const root=path.resolve(new URL('..',import.meta.url).pathname), islands=root+'/desktop-tauri/ui-islands'
const require=createRequire(islands+'/package.json'), {buildSync}=require('esbuild'), {JSDOM}=require('jsdom')
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'a2a-phone-features-')), out=temp+'/fixture.cjs'
buildSync({stdin:{contents:"import './src/mobile-features';import './src/islands/shell-preferences';export {act} from 'react';export {BUILTIN_CONFIGS,methodsOf} from './src/islands/add-account-configs';export {afterAdd,closeAddModals} from './src/islands/add-account-bridge'",loader:'tsx',resolveDir:islands},bundle:true,platform:'node',format:'cjs',outfile:out,jsx:'automatic',alias:{'@ui':root+'/desktop-tauri/ui-kit/src',react:path.dirname(require.resolve('react/package.json')),'react-dom':path.dirname(require.resolve('react-dom/package.json'))},nodePaths:[islands+'/node_modules',root+'/desktop-tauri/ui-kit/node_modules'],logLevel:'silent'})
const dom=new JSDOM('<!doctype html><html data-mobile-ui="true"><body><div id="host" class="mobile-feature-host"></div></body></html>',{url:'http://localhost/m/'})
for(const k of ['window','document','HTMLElement','Element','Node','Event','CustomEvent','MouseEvent','KeyboardEvent','MutationObserver','HTMLButtonElement','HTMLInputElement','HTMLTextAreaElement','SVGElement','ShadowRoot','NodeFilter','DocumentFragment','localStorage','location'])globalThis[k]=dom.window[k]
Object.defineProperty(globalThis,'navigator',{configurable:true,value:dom.window.navigator})
window.PointerEvent=window.MouseEvent;globalThis.PointerEvent=window.PointerEvent
globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window)
globalThis.requestAnimationFrame=cb=>setTimeout(()=>cb(performance.now()),0);globalThis.cancelAnimationFrame=clearTimeout
window.requestAnimationFrame=requestAnimationFrame;window.cancelAnimationFrame=clearTimeout
class Observer{observe(){}unobserve(){}disconnect(){}}
globalThis.ResizeObserver=window.ResizeObserver=Observer;globalThis.IntersectionObserver=window.IntersectionObserver=Observer
URL.createObjectURL=()=> 'blob:phone-fixture-'+Math.random();URL.revokeObjectURL=()=>{}
window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}})
Element.prototype.scrollTo=function(opts){this.scrollTop=opts?.top||0};Element.prototype.scrollIntoView=function(){};Element.prototype.getAnimations=()=>[]
window.wbI18n={t:(s,v={})=>s.replace(/\{(\w+)\}/g,(_,k)=>String(v[k]??`{${k}}`))};globalThis.wbI18n=window.wbI18n
let account={id:'fixture',name:'Fixture account',provider:'catpaw',enabled:true,maxConcurrent:2}, closed=0, activePage='',failSave=false
let providerGate;const calls=[], notices=[];let providerSummaries=[{id:'catpaw',label:'CatPaw',count:1},{id:'workbuddy',label:'WorkBuddy',count:0}]
window.wbApp={getState:()=>({accounts:{accounts:[account],providers:providerSummaries}}),get currentPage(){return activePage},toast:(text,tone)=>notices.push({text,tone}),refresh:async()=>{},formatTime:v=>String(v)}
globalThis.wbApp=window.wbApp
const models={models:[{id:'fixture-model',provider:'catpaw',enabled:true}],mappings:[],providers:[]}
let retry={retryCount:3,retryCrossProviderCount:5,retryIntervalSeconds:5,noRetryCodes:[402]},failRetry=false
let config={model:'fixture-model',systemPromptEnabled:false,systemPrompt:'',tools:{list_models:true}}, routing={strategy:'order',sticky:'auto',failoverBackoff:true,sink:true,breakerEnabled:false}
globalThis.fetch=window.fetch=async(url,init={})=>{
 const u=new URL(url,'http://localhost'),method=init.method||'GET',body=init.body?JSON.parse(init.body):undefined
 calls.push({path:u.pathname,method,body})
 let data={}
 if(u.pathname==='/api/session/login/start')data={state:'fixture-workbuddy-login',authUrl:'https://example.test/authorize?state=fixture-workbuddy-login',expiresAt:Date.now()+300000}
 else if(u.pathname==='/api/session/login/wait')data={pending:true}
 else if(u.pathname==='/api/session/login/cancel')data={canceled:true}
 else if(u.pathname==='/api/session'){if(providerGate)await providerGate;data=window.wbApp.getState()}
 else if(u.pathname==='/api/accounts')data={accounts:[account]}
 else if(u.pathname==='/api/accounts/fixture'&&method==='PATCH'){
  if(failSave){failSave=false;return Response.json({success:false,error:'fixture-save-failed'},{status:500})}
  account={...account,...body};data={account}
 }
 else if(u.pathname==='/api/accounts/usage/snapshot')data={results:[],tokenUsage:{}}
 else if(u.pathname==='/api/custom-providers')data={providers:[]}
 else if(u.pathname==='/api/models/manage'||u.pathname==='/api/assistant/models')data=models
 else if(u.pathname==='/api/retry'){if(method==='PUT'){if(failRetry){failRetry=false;return Response.json({success:false,error:'fixture retry save rejected'},{status:500})}retry={...retry,...body}}data=retry}
 else if(u.pathname==='/api/assistant/config')data={config}
 else if(u.pathname==='/api/assistant/conversations')data={items:[]}
 else if(u.pathname==='/api/agents')data={clients:[]}
 else if(u.pathname==='/api/routing'){if(method==='PUT')routing={...routing,...body,strategy:body.routingStrategy??routing.strategy};data=routing}
 else if(u.pathname==='/api/proxies/pool')data={items:[],groups:[]}
 else if(u.pathname==='/api/keys')data={keys:[],settings:{},modelsByProvider:{}}
 else if(u.pathname==='/api/scheduled-tasks')data={tasks:[]}
 else if(u.pathname.startsWith('/api/stats/'))data={entries:[],total:0,matched:0,overview:{},timeline:[],models:[],accounts:[],providers:[]}
 else if(u.pathname.startsWith('/api/checkin-center'))data={daily:{todayEligible:0,todayDone:0,providers:[],outOfScope:[]},extras:{onboarding:[],plans:[]}}
 else if(u.pathname==='/api/logs')data={entries:[],total:0}
 else if(u.pathname==='/api/cline/headers')data={defaults:{},overrides:{}}
 else if(u.pathname==='/api/notifications/channels')data={channels:[]}
 return Response.json({success:true,data})
}
vm.runInThisContext(fs.readFileSync(root+'/desktop-tauri/ui/m-feature-bridge.js','utf8'))
globalThis.workbuddyDesktop=window.workbuddyDesktop;globalThis.__TAURI_INTERNALS__=window.__TAURI_INTERNALS__
for(const file of ['providers.js','preset-providers.js','web-login.js','sms-login.js','custom-provider-ui.js'])vm.runInThisContext(fs.readFileSync(root+'/desktop-tauri/ui/'+file,'utf8'))
const api=require(out), host=document.getElementById('host')
providerSummaries=[{id:'workbuddy',label:'WorkBuddy',count:0},...api.BUILTIN_CONFIGS.map(c=>({id:c.provider,label:c.label,count:c.provider==='catpaw'?1:0}))]
let cleanup
async function settle(){await new Promise(resolve=>setTimeout(resolve,55))}
async function until(predicate){for(let i=0;i<60;i++){if(predicate())return;await settle()}throw new Error('Timeout: '+document.body.textContent.slice(-2000))}
function button(text){return [...document.querySelectorAll('button')].find(b=>(b.textContent.trim()||b.getAttribute('aria-label'))===text)}
async function mount(page,action='',id='') {cleanup?.();await settle();activePage=page;host.dataset.page=page;cleanup=window.wbMobileFeatures.mount(host,{page,action,id,close:()=>closed++,navigate:()=>{}});await settle()}
async function click(node){assert(node,'click target');node.click();await settle()}
async function phoneBack(){const event=new Event('aibuddy:mobile-back',{cancelable:true});document.dispatchEvent(event);await settle();assert(event.defaultPrevented,'top navigation handles the form step before leaving the page')}
function input(node,value){Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}))}
try {
 let adapterCall;window.wbMobileHttp=async(method,path,body)=>{adapterCall={method,path,body};return {fixture:true}}
 assert.deepEqual(await window.workbuddyDesktop.getState(),{fixture:true});assert.equal(adapterCall.path,'/api/session');delete window.wbMobileHttp
 const prompt=window.wbMobilePrompt('Fixture callback','<div>Paste callback</div><input placeholder="callback URL">','Continue');await settle();assert(document.querySelector('.mobile-bridge-prompt [data-slot=input]'));await click(button('取消'));assert.equal(await prompt,false)
 const readyProviders=providerSummaries;providerSummaries=[];let releaseProviders;providerGate=new Promise(resolve=>releaseProviders=resolve)
 await mount('accounts','add')
 providerSummaries=readyProviders;releaseProviders();await until(()=>document.querySelector('[data-provider=catpaw]'));providerGate=undefined
 assert(document.querySelector('.mobile-add-flow[data-step=pick] .mobile-add-picker'))
 assert.equal(document.querySelectorAll('[role=dialog],[data-slot=dialog-overlay]').length,0,'phone picker is an in-page flow, not nested desktop dialogs')
 assert(document.querySelector('.mobile-provider-list.flex-col'),'phone provider list is single-column')
 assert(document.querySelector('.mobile-provider-types'),'full-width phone category control')
 assert(document.querySelectorAll('#add-provider-grid [data-provider]').length>0,'real registered provider cards')
 assert.equal(document.querySelectorAll('iframe').length,0)
 assert(!document.querySelector('[aria-label="返回选择"]'),'only the shell navigation supplies Back')
 const catpaw=[...document.querySelectorAll('#add-provider-grid [data-provider]')].find(n=>n.textContent.includes('CatPaw'))
 await click(catpaw);assert(document.querySelector('.mobile-add-flow[data-step=form]'))
 assert.equal(document.querySelectorAll('[role=dialog],[data-slot=dialog-overlay]').length,0,'provider form stays in the phone page')
 assert(document.querySelector('.mobile-add-form input'),'real provider credential form')
 assert([...document.querySelectorAll('.mobile-add-form input')].every(n=>n.dataset.slot||n.hidden||n.type==='hidden'||n.type==='checkbox'||n.getAttribute('aria-hidden')==='true'),'shared inputs: '+[...document.querySelectorAll('.mobile-add-form input')].filter(n=>!n.dataset.slot&&n.type!=='hidden'&&n.type!=='checkbox'&&n.getAttribute('aria-hidden')!=='true').map(n=>n.outerHTML).join(''))
 const credential=[...document.querySelectorAll('.mobile-add-form .add-provider-block:not([hidden]) input')].find(n=>!n.hidden&&n.type!=='hidden'&&n.type!=='checkbox')
 assert(credential,'selected provider has real credential input');input(credential,'phone-draft-kept');await settle()
 const backEvent=new Event('aibuddy:mobile-back',{cancelable:true});document.dispatchEvent(backEvent);await settle()
 assert(backEvent.defaultPrevented);assert.equal(document.querySelector('.mobile-add-flow').dataset.step,'pick');assert.equal(closed,0)
 await click(catpaw);assert.equal(credential.value,'phone-draft-kept','Back preserves provider draft and the same mounted input')
 await phoneBack();assert.equal(document.querySelector('.mobile-add-flow').dataset.step,'pick')
 const search=document.getElementById('add-provider-search');input(search,'no-such-provider');await settle();assert(document.querySelector('.add-provider-empty'))
 input(search,'');await settle();assert(document.querySelector('[data-provider=catpaw]'))
 await click(button('预置 API'));assert(document.querySelector('[data-provider^="preset:"]'),'preset providers remain reachable')
 await click(button('自定义'));await click(document.querySelector('[data-provider="__new__"]'));assert.equal(document.querySelector('.mobile-add-flow').dataset.step,'form');assert(document.querySelector('.mobile-add-actions button'),'custom submission remains reachable');assert.equal(document.getElementById('custom-name-input').closest('[data-slot=field]').dataset.orientation,'vertical','phone custom fields stack labels above full-width controls')
 assert(calls.every(c=>c.method==='GET'),'opening provider flow is read-only')
 await phoneBack();await click(button('Agent'));await click(document.querySelector('[data-provider=workbuddy]'))
 const wb=document.querySelector('.mobile-workbuddy'), wbButton=text=>[...wb.querySelectorAll('button')].find(n=>n.textContent.trim()===text)
 assert(wb.querySelector('[data-slot=card]'),'phone auth uses a composed shadcn Card')
 assert.equal(wb.querySelectorAll('[data-slot=field-set]').length,2,'version and method use semantic fieldsets')
 assert(!calls.some(c=>c.path==='/api/session/login/start'),'opening phone provider waits for a deliberate login choice')
 const importToggle=wb.querySelector('[data-slot=collapsible-trigger]');assert.equal(importToggle.getAttribute('aria-expanded'),'false')
 await click(importToggle);const importName=document.getElementById('workbuddy-file-name');input(importName,'Phone import draft');await settle();await click(importToggle);await click(importToggle);assert.equal(document.getElementById('workbuddy-file-name'),importName,'disclosure keeps the same file/input nodes mounted');assert.equal(importName.value,'Phone import draft')
 await click(wbButton('国际版'));assert.equal(wbButton('系统浏览器').getAttribute('aria-pressed'),'true','international edition keeps its external-browser default');assert(!document.getElementById('workbuddy-social-restore'),'unavailable social option stays out of the phone flow')
 await click(wbButton('内嵌窗口'));assert(document.getElementById('workbuddy-social-restore'),'available social option remains reachable');await click(wb.querySelector('[data-slot=switch]'));assert.equal(wb.querySelector('[data-slot=switch]').getAttribute('aria-checked'),'true')
 const popup={closed:false,location:{href:'about:blank'},close(){this.closed=true}}, popupCalls=[]
 window.open=(...args)=>{popupCalls.push(args);return popup}
 assert.equal(typeof globalThis.busy,'undefined','fixture deliberately has no desktop app.js globals')
 const beforeWeb=calls.length
 await click(document.getElementById('web-login-button'));await until(()=>popup.location.href.startsWith('https://example.test/authorize'))
 assert.equal(popupCalls.length,1,'click reaches popup creation in the user action');assert(calls.slice(beforeWeb).some(c=>c.path==='/api/session/login/start'),'real phone button reaches /start')
 const starts=calls.filter(c=>c.path==='/api/session/login/start').length
 await click(document.getElementById('web-login-button'));assert.equal(calls.filter(c=>c.path==='/api/session/login/start').length,starts,'double click cannot create a second login')
 assert.equal(document.getElementById('web-login-button').disabled,true)
 await click(document.getElementById('web-login-cancel'));await until(()=>!document.getElementById('web-login-button').disabled)
 assert(popup.closed,'cancel closes the authorization popup');assert(calls.slice(beforeWeb).some(c=>c.path==='/api/session/login/cancel'))
 assert(!document.getElementById('web-login-button').getAttribute('aria-busy')||document.getElementById('web-login-button').getAttribute('aria-busy')==='false')
 await click(wbButton('扫码登录'));await until(()=>wb.querySelector('.wb-qr-link'))
 const loginCall=calls.filter(c=>c.path==='/api/session/login/start').at(-1);assert.equal(loginCall.body.provider,'workbuddy-intl');assert.equal(loginCall.body.edition,'intl')
 await phoneBack();await until(()=>calls.some(c=>c.path==='/api/session/login/cancel'))
 assert.equal(document.querySelector('.mobile-add-flow').dataset.step,'pick','back cancels QR and returns to the list')
 const writesBeforeBrowse=calls.filter(c=>c.method!=='GET'&&c.path!=='/api/session/login/cancel').length
 let providerCases=0, methodCases=0, presetCases=0
 const methodLabels={web:'网页登录',oauth:'授权登录',sms:'短信登录',manual:'填写凭证',file:'导入文件',desktop:'读取本机',guest:'访客模式'}
 for(const provider of api.BUILTIN_CONFIGS.filter(c=>c.provider!=='cline-pass'&&c.provider!=='workbuddy-intl')) {
  const card=document.querySelector(`#add-provider-grid [data-provider="${provider.provider}"]`);assert(card,'registered provider '+provider.provider);await click(card)
  const block=document.querySelector(`[data-provider-form="${provider.provider}"]`);assert(block&&!block.hidden,'active phone provider '+provider.provider)
  assert(document.querySelector('.mobile-provider-identity img,.mobile-provider-fallback'),'every provider has an identity mark')
  const methods=api.methodsOf(provider,provider.regionOptions?.[0]?.value||'')
  for(const method of methods) {
   const choice=[...block.querySelectorAll('.mobile-provider-choice')].find(n=>n.querySelector('legend')?.textContent==='添加方式')
   const select=[...choice.querySelectorAll('button')].find(n=>n.textContent.trim()===methodLabels[method]);assert(select,provider.provider+' method '+method);await click(select)
   const visibleCards=[...block.querySelectorAll('.mobile-provider-card')].filter(n=>!n.closest('[hidden]'))
   assert.equal(visibleCards.length,1,provider.provider+' shows one active action Card for '+method);assert(visibleCards[0].querySelector('[data-slot=card-header] [data-slot=card-title]'));assert(visibleCards[0].querySelector('[data-slot=card-content]'))
   if(method==='sms'){assert.equal(document.getElementById(provider.provider+'-sms-phone').type,'tel');assert.equal(document.getElementById(provider.provider+'-sms-code').autocomplete,'one-time-code')}
   methodCases++
  }
  await phoneBack();providerCases++
 }
 await click(button('预置 API'))
 const presetIds=[...document.querySelectorAll('#add-provider-grid [data-provider]')].map(n=>n.dataset.provider)
 for(const id of presetIds) {
  await click(document.querySelector(`#add-provider-grid [data-provider="${id}"]`))
  const create=document.getElementById('custom-name-input');assert(create.value,'preset name populated: '+id);assert(create.closest('.mobile-provider-card'),'preset uses the shared phone Card');assert.equal(create.closest('[data-slot=field]').dataset.orientation,'vertical')
  const preset=window.wbPresetProviders.presetOf(id.slice('preset:'.length));assert.equal(document.getElementById('custom-baseurl-input').value,preset.baseUrl||'','preset URL follows its registry; self-hosted templates remain editable: '+id)
  await phoneBack();presetCases++
 }
 assert.equal(calls.filter(c=>c.method!=='GET'&&c.path!=='/api/session/login/cancel').length,writesBeforeBrowse,'browsing must be read-only: '+JSON.stringify(calls.filter(c=>c.method!=='GET').slice(writesBeforeBrowse).map(c=>({path:c.path,method:c.method}))))
 console.log(`PASS: shared phone cards for ${providerCases} providers / ${methodCases} method entries / ${presetCases} API presets; no writes during navigation`)
 await api.afterAdd('Fixture','CatPaw');assert.equal(closed,1,'successful shared provider callbacks close the inline phone flow');closed=0
 await mount('accounts','edit','fixture')
 const editor=document.querySelector('.mobile-account-editor');assert(editor)
 assert.equal(editor.dataset.layout,'fullscreen');assert(!editor.className.includes('translate-'),'fullscreen editor cannot inherit centered-popup translation')
 api.closeAddModals();assert.equal(closed,0,'inline success handler removed on unmount')
 for(const text of ['基本','凭证与套餐','查询设置','限制器','网络']) {await click(button(text));assert(document.querySelector('.acct-dlg-main').textContent.trim().length>0,text+' has content')}
 await click(button('基本'));input(document.getElementById('account-name-input'),'Phone edited');await settle()
 failSave=true;await click(button('保存'));assert(document.body.textContent.includes('fixture-save-failed'));assert.equal(document.getElementById('account-name-input').value,'Phone edited','failed save retains draft');assert.equal(closed,0)
 await click(button('保存'));assert.equal(account.name,'Phone edited');assert.equal(closed,1)
 const patch=calls.filter(c=>c.path==='/api/accounts/fixture'&&c.method==='PATCH').at(-1)
 assert.equal(patch.body.name,'Phone edited');assert(!JSON.stringify(patch).includes('apiKey'))
 await mount('settings');assert(document.querySelector('.mobile-settings-layout'))
 assert(!document.querySelector('.settings-pane [data-slot=card]'),'phone categories mount business editors only on first visit')
 const searchSettings=document.querySelector('[aria-label="搜索设置"]')
 input(searchSettings,'路由');await settle();assert.equal(document.querySelectorAll('#settings-nav [data-cat]').length,1,'settings search matches labels and descriptions')
 input(searchSettings,'no such mobile setting');await settle();assert(document.body.textContent.includes('没有找到相关设置'))
 input(searchSettings,'');await settle()
 const categoryTitles=[];document.addEventListener('aibuddy:mobile-title',event=>categoryTitles.push(event.detail))
 const cats=[...document.querySelectorAll('#settings-nav [data-cat]')].map(n=>n.dataset.cat)
 assert(cats.includes('backup')&&cats.includes('assistant')&&cats.includes('security'))
 for(const cat of cats) {
  await click(document.querySelector(`#settings-nav [data-cat="${cat}"]`))
  assert.equal(document.querySelector('.mobile-settings-layout').dataset.mobileDetail,cat)
  assert.equal(categoryTitles.at(-1).page,'settings');assert(!document.querySelector('.mobile-settings-heading button'),'only the phone top bar owns Back')
  if(cat==='retry')assert(document.getElementById('settings-retry-count').closest('[data-slot=input-group]'),'numeric phone fields compose the official unit addon')
  const pane=document.querySelector(`.settings-pane[data-cat="${cat}"]`)
  assert(pane?.classList.contains('active'),'active mobile setting category '+cat)
  assert(pane.textContent.trim().length>0,'category is not an empty mount point: '+cat)
  const backEvent = new Event('aibuddy:mobile-back',{cancelable:true});document.dispatchEvent(backEvent);await settle();assert(backEvent.defaultPrevented,'native/back bar returns to category list first');assert(!document.querySelector('.mobile-settings-layout').dataset.mobileDetail)
 }
 await click(document.querySelector('#settings-nav [data-cat="retry"]'))
 const retryInput=document.getElementById('settings-retry-count')
 retryInput.focus();input(retryInput,'4');await settle();retryInput.blur();await settle()
 assert.equal(retry.retryCount,4,'phone numeric field commits the exact backend setting on blur')
 assert.deepEqual(calls.filter(call=>call.path==='/api/retry'&&call.method==='PUT').at(-1).body,{retryCount:4})
 failRetry=true;retryInput.focus();input(retryInput,'6');await settle();retryInput.blur();await settle()
 assert.equal(retry.retryCount,4);assert.equal(retryInput.value,'4','failed numeric save restores the backend value')
 await phoneBack();await click(document.querySelector('#settings-nav [data-cat="routing"]'))
 await click([...document.querySelectorAll('.settings-pane.active button')].find(node=>node.textContent==='负载均衡'))
 assert.equal(routing.strategy,'rotate');assert.deepEqual(calls.filter(call=>call.path==='/api/routing'&&call.method==='PUT').at(-1).body,{routingStrategy:'rotate'})
 await phoneBack()
 // Phone controllers reuse the production preferences/notification views without a desktop topbar host.
 document.documentElement.dataset.theme='dark';document.title='Phone fixture'
 localStorage.setItem('aibuddy-prefs',JSON.stringify({theme:'light'}))
 vm.runInThisContext(fs.readFileSync(root+'/desktop-tauri/ui/js/prefs.js','utf8'))
 vm.runInThisContext(fs.readFileSync(root+'/desktop-tauri/ui/js/notify-center.js','utf8'))
 await settle();assert.equal(document.documentElement.dataset.theme,'dark','controller boot preserves the current phone theme')
 assert.equal(document.title,'Phone fixture','desktop preference controller cannot replace the mobile router title')
 await click(document.querySelector('#settings-nav [data-cat="prefs"]'));await click(document.getElementById('prefs-open-drawer'))
 await until(()=>document.querySelector('.pref-sheet'))
 assert(document.querySelector('.pref-sheet [data-slot=sheet-title]'),'full preference editor is a titled shadcn phone Sheet')
 assert.equal(document.querySelectorAll('.pref-sheet [role=tab]').length,4,'all preference pages remain reachable')
 await click(document.querySelector('.pref-sheet [aria-label="关闭"]'))
 await phoneBack();await click(document.querySelector('#settings-nav [data-cat="shell"]'))
 assert(!document.querySelector('.settings-pane.active #btn-shell-tags-clear'),'desktop-only tab controls do not appear as dead phone actions')
 window.wbNotifyCenter.refresh();await settle()
 await click(document.getElementById('btn-shell-notify-open'));await until(()=>document.querySelector('.mobile-notifications-sheet'))
 assert(!document.querySelector('#nc-pop'),'phone notifications use a bounded bottom Sheet, not the desktop anchor popup')
 assert(document.querySelector('.mobile-notifications-sheet').textContent.includes('查看全部'))
 await click(document.querySelector('.mobile-notifications-sheet [data-slot=sheet-close]'))
 await phoneBack()
 await mount('assistant');await until(()=>document.querySelector('textarea')&&document.querySelector('[aria-label="对话模型"]'))
 assert(document.querySelector('.mobile-assistant'))
 assert(document.querySelector('.asst-mobile-toggle'),'history opens a sheet')
 await click(document.querySelector('[aria-label="看看哪些模型在多家重复了"]'))
 assert.equal(document.querySelector('textarea').value,'看看哪些模型在多家重复了')
 const fileInput=document.querySelector('input[type=file]');Object.defineProperty(fileInput,'files',{configurable:true,value:[new window.File(['draft'],'phone-draft.txt',{type:'text/plain'})]});fileInput.dispatchEvent(new Event('change',{bubbles:true}));await settle();assert(document.body.textContent.includes('phone-draft.txt'))
 await mount('accounts');await mount('assistant');await until(()=>document.querySelector('textarea'))
 assert.equal(document.querySelector('textarea').value,'看看哪些模型在多家重复了','draft survives tab changes');assert(document.body.textContent.includes('phone-draft.txt'),'attachment selection survives tab changes')
 for(const page of ['accounts','keys','gateway','agent','proxies','checkin','overview','requests','logs','tasks','docs','credits']) {
  await mount(page);assert(host.textContent.trim(),page+' mounts');assert.equal(document.querySelectorAll('iframe').length,0)
  assert(!host.querySelector('[data-feature-error]'),page+' renders without boundary error: '+host.textContent)
  if(page==='docs')assert.equal(document.getElementById('api-base').textContent,'http://localhost/v1','new document nodes always get the current gateway address')
  if(page==='proxies')assert(calls.some(c=>c.path==='/api/proxies/pool'),'proxy page loads its pool on every mount')
  if(page==='agent')assert(calls.some(c=>c.path==='/api/agents'),'Agent page loads clients on every mount')
 }
 assert(!calls.some(c=>c.path.includes('/checkin')&&c.method!=='GET'),'navigation never starts real check-in')
 assert(!calls.some(c=>c.path==='/api/assistant/chat'),'opening/typing does not send prompts')
 assert(!calls.some(c=>c.path.includes('/agents/')&&c.method!=='GET'),'opening Agent does not apply config')
 console.log(`PASS: mobile provider flow; all 5 account editor panes and exact save/error/draft contracts; ${cats.length} settings categories including update/backup; full assistant/history/model controls and tab draft retention; 14 in-document feature surfaces; no automatic provider/config writes`)
} finally {cleanup?.();await settle();dom.window.close();fs.rmSync(temp,{recursive:true,force:true})}
process.exit(0)
