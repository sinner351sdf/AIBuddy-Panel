// Real assistant page/controller, synthetic SSE and synthetic management bridge only.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createRequire} from 'node:module'
const mobileMode=process.argv.includes('--mobile')
if(mobileMode){const nativeCrypto=globalThis.crypto;Object.defineProperty(globalThis,'crypto',{configurable:true,value:{getRandomValues:nativeCrypto.getRandomValues.bind(nativeCrypto),subtle:nativeCrypto.subtle}})}
const root=path.resolve(new URL('..',import.meta.url).pathname)
const require=createRequire(path.join(root,'desktop-tauri/ui-islands/package.json'))
const {buildSync}=require('esbuild'); const {JSDOM}=require('jsdom')
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'a2a-assistant-'))
const out=path.join(dir,'fixture.cjs')
buildSync({stdin:{contents:"import './src/islands/assistant-page'; export * from './src/islands/assistant-state'; export * from './src/islands/assistant-tools'; export * from './src/islands/assistant-chat'; export * from './src/islands/assistant-files'; export * from './src/islands/assistant-models'; export * from './src/islands/assistant-context';export {AssistantPage} from './src/islands/assistant-page';export {createRoot} from 'react-dom/client';export {createElement} from 'react'",loader:'tsx',resolveDir:path.join(root,'desktop-tauri/ui-islands')},bundle:true,platform:'node',format:'cjs',outfile:out,jsx:'automatic',alias:{'@ui':path.join(root,'desktop-tauri/ui-kit/src/index.ts'),react:path.dirname(require.resolve('react/package.json')),'react-dom':path.dirname(require.resolve('react-dom/package.json'))},nodePaths:[path.join(root,'desktop-tauri/ui-islands/node_modules'),path.join(root,'desktop-tauri/ui-kit/node_modules')],logLevel:'silent'})
const dom=new JSDOM(mobileMode?'<html><body><section data-page="assistant"></section></body></html>':'<html><body><section class="page active" data-page="assistant"></section></body></html>',{url:'http://localhost/'})
for(const k of ['window','document','HTMLElement','Element','Node','Event','MouseEvent','KeyboardEvent','MutationObserver','HTMLButtonElement','HTMLInputElement','HTMLTextAreaElement','SVGElement','ShadowRoot','NodeFilter','DocumentFragment'])globalThis[k]=dom.window[k]
Object.defineProperty(globalThis,'navigator',{configurable:true,value:dom.window.navigator})
// JSDOM 26 lacks PointerEvent, which Base UI dispatches for switch clicks.
window.PointerEvent=window.MouseEvent;globalThis.PointerEvent=window.PointerEvent
globalThis.FileReader=dom.window.FileReader
const objectUrls=new Set();let objectId=0,copied=''
URL.createObjectURL=()=>{const url='blob:fixture-'+(++objectId);objectUrls.add(url);return url}
URL.revokeObjectURL=url=>objectUrls.delete(url)
Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{copied=text}}})
globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window)
globalThis.requestAnimationFrame=cb=>setTimeout(()=>cb(performance.now()),0);globalThis.cancelAnimationFrame=clearTimeout;window.requestAnimationFrame=globalThis.requestAnimationFrame;window.cancelAnimationFrame=globalThis.cancelAnimationFrame
class Observer{observe(){}unobserve(){}disconnect(){}}
globalThis.ResizeObserver=Observer;globalThis.IntersectionObserver=Observer;window.ResizeObserver=Observer;window.IntersectionObserver=Observer
window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}})
Element.prototype.scrollTo=function(opts){this.scrollTop=opts?.top||0};Element.prototype.scrollIntoView=function(){};Element.prototype.getAnimations=()=>[]
const noModel=process.argv.includes('--no-model')
let config={model:noModel?null:'fixture',systemPromptEnabled:true,systemPrompt:'',tools:{list_models:true,list_account_balance:true,set_account_enabled:false,test_model:false}}
let modelUnavailable=false
let changes=0,chatCalls=0,mode='write',releaseRead=null,releaseWrite=null,releaseConfig=null,holdConfig=false,failConfig=false
const requests=[]
const conversations=new Map();let historyId=0
window.wbI18n={t:(s,v={})=>s.replace(/\{(\w+)\}/g,(_,k)=>String(v[k]??`{${k}}`))}
const originalState=async()=>({accounts:[{id:'account',name:'Fixture',provider:'fixture',enabled:true}]})
window.workbuddyDesktop={platform:'web',getAssistantAccess:async()=>({'x-panel-token':'synthetic'}),getModelManage:async()=>({models:modelUnavailable?[]:[{provider:'fixture',id:'fixture',enabled:true},{provider:'fixture',id:'second',enabled:true}],mappings:[{provider:'fixture',target:'fixture',alias:'',enabled:true}]}),getState:originalState,updateAccount:async()=>{changes++},getAllBalances:async()=>({results:[{id:'account',usage:{available:7,unit:'USD',raw:{token:'must-not-leave'}},apiKey:'must-not-leave'}]})}
function sse(parts){return new Response(parts.map(p=>'data: '+(typeof p==='string'?p:JSON.stringify(p))+'\n\n').join(''),{headers:{'Content-Type':'text/event-stream','x-vercel-ai-ui-message-stream':'v1'}})}
globalThis.fetch=async(url,init={})=>{
 const headers=new Headers(init.headers)
 assert.equal(headers.get('x-panel-token'),'synthetic','current auth headers required')
 if(String(url).includes('/conversations')){
  const method=init.method||'GET',id=String(url).split('/conversations/')[1],body=init.body?JSON.parse(init.body):{}
  let conversation=conversations.get(id)
  if(!id&&method==='GET')return Response.json({success:true,data:{items:[...conversations.values()].filter(row=>!row.deleted).map(({messages,...row})=>row)}})
  if(!id&&method==='POST'){conversation={id:'history-'+(++historyId),title:'新对话',messages:[],revision:0,createdAt:Date.now(),updatedAt:Date.now()};conversations.set(conversation.id,conversation)}
  else if(method==='DELETE'&&!id){for(const key of body.ids)conversations.get(key).deleted=true;return Response.json({success:true,data:{deleted:body.ids.length}})}
  else if(method==='DELETE'){conversation.deleted=true;return Response.json({success:true,data:{deleted:true}})}
  else if(method==='PUT'||method==='PATCH'){assert.equal(body.revision,conversation.revision);conversation={...conversation,...body,revision:conversation.revision+1,updatedAt:Date.now()};conversations.set(id,conversation)}
  return Response.json({success:true,data:{conversation}})
 }
 if(String(url).endsWith('/models'))return Response.json({success:true,data:await window.workbuddyDesktop.getModelManage()})
 if(String(url).endsWith('/config')){
  if(init.method==='PATCH'){if(holdConfig)await new Promise(r=>releaseConfig=r);if(failConfig){failConfig=false;return Response.json({success:false,error:'fixture save failed'},{status:500})}const patch=JSON.parse(init.body).config;config={...config,...patch,tools:{...config.tools,...patch.tools}};requests.push(patch)}
  return Response.json({success:true,data:{config}})
 }
 chatCalls++;const body=JSON.parse(init.body);requests.push(body);assert.equal(body.uiStream,true)
 const toolDone=body.messages.at(-1)?.role==='tool'
 const start=[{type:'start'},{type:'start-step'}]
 if(mode==='empty')return sse([...start,{type:'finish-step'},{type:'finish',finishReason:'stop'},'[DONE]'])
 if(mode==='error')return sse([...start,{type:'error',errorText:'fixture upstream failure'},'[DONE]'])
 if(mode==='text'||(toolDone&&mode!=='loop'))return sse([...start,{type:'text-start',id:'text'},{type:'text-delta',id:'text',delta:'done'},{type:'text-end',id:'text'},{type:'finish-step'},{type:'finish',finishReason:'stop'},'[DONE]'])
 const name=mode==='loop'?'list_models':mode==='test'?'test_model':'set_account_enabled'
 const input=name==='list_models'?{}:name==='test_model'?{provider:'fixture',id:'fixture',prompt:'x'.repeat(300)+'完整提示词尾部'}:{items:[{account:'account',enabled:false},...(['batch','batchfail'].includes(mode)?[{account:'account',enabled:true}]:[])]}
 return sse([...start,{type:'tool-input-start',toolCallId:'tool'+chatCalls,toolName:name,dynamic:true},{type:'tool-input-available',toolCallId:'tool'+chatCalls,toolName:name,input,dynamic:true},{type:'finish-step'},{type:'finish',finishReason:'tool-calls'},'[DONE]'])
}
const api=require(out)
if(mobileMode)api.createRoot(document.querySelector('section')).render(api.createElement(api.AssistantPage,{mobile:true}))
async function until(pred){for(let i=0;i<400;i++){if(pred())return;await new Promise(r=>setTimeout(r,5))}throw new Error('timeout: '+document.body.textContent)}
const button=text=>[...document.querySelectorAll('button')].find(el=>el.textContent.trim()===text)
const menuItem=text=>[...document.querySelectorAll('[role=menuitem]')].find(el=>el.textContent.trim()===text)
const sendButton=()=>document.querySelector('button[aria-label="发送"]')
const stopButton=()=>document.querySelector('button[aria-label="停止"]')
const attachInput=()=>document.querySelector('input[type="file"]')
function attach(files,kind='change'){
 if(kind==='change'){Object.defineProperty(attachInput(),'files',{configurable:true,value:files});attachInput().dispatchEvent(new Event('change',{bubbles:true}))}
 else {const event=new Event(kind,{bubbles:true,cancelable:true});Object.defineProperty(event,kind==='paste'?'clipboardData':'dataTransfer',{value:{files,types:['Files']}});document.querySelector(kind==='paste'?'textarea':'form').dispatchEvent(event)}
}
async function send(){const el=document.querySelector('textarea');Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set.call(el,'fixture');el.dispatchEvent(new Event('input',{bubbles:true}));await until(()=>sendButton()&&!sendButton().disabled);sendButton().click()}
async function clear(){await until(()=>button('新聊天记录')&&!button('新聊天记录').disabled);button('新聊天记录').click();await until(()=>document.querySelector('[data-slot="empty"]'))}
try{
 await until(()=>document.querySelector('[aria-label="已启用工具详情"]')?.textContent.includes('2 / 9'))
 assert(document.querySelector('[data-slot="empty"]'))
 assert(document.querySelector('[data-slot="input-group"] textarea[aria-label]'))
 assert(document.body.textContent.includes('我能帮您什么？'))
 assert(!document.body.textContent.includes('点击填入输入框'))
 assert(!document.body.textContent.includes('对话保存在当前服务'))
 assert(sendButton().className.includes('rounded-full'))
 const toolsTrigger=()=>document.querySelector('[aria-label="已启用工具详情"]')
 assert.equal(document.querySelectorAll('[aria-label="已启用工具详情"]').length,1)
 assert(!document.querySelector('[aria-label="工具权限说明"]'))
 assert(toolsTrigger().closest('[data-slot="input-group-addon"]')?.querySelector('[aria-label="对话模型"]'))
 assert.equal(toolsTrigger().getAttribute('type'),'button')
 assert(document.querySelector('[aria-label="上下文用量"]').closest('[data-slot="input-group-addon"]'))
 assert.equal(document.querySelector('[aria-label="上下文用量"]').getAttribute('type'),'button')
 document.querySelector('[aria-label="上下文用量"]').click()
 await until(()=>document.querySelector('[aria-label="上下文用量详情"]'))
 assert(document.body.textContent.includes('上限未知'));assert(document.body.textContent.includes('非累计用量'))
 assert.equal(document.querySelectorAll('[data-context-category]').length,4);assert.equal(chatCalls,0)
 document.querySelector('[aria-label="上下文用量"]').click()
 assert(toolsTrigger().textContent.includes('只读'))
 document.querySelector('[aria-label="已启用工具详情"]').click()
 await until(()=>document.querySelectorAll('[data-tool-id]').length===9)
 assert.equal(document.querySelectorAll('[data-tool-id][data-enabled="true"]').length,2)
 assert(document.querySelector('[data-tool-id="list_models"]').textContent.includes('已启用'))
 assert(document.querySelector('[data-tool-id="test_model"]').textContent.includes('未启用'))
 // A permission switch saves exactly one flag and publishes the server result to both islands.
 const toolSwitch=id=>document.querySelector(`[data-tool-id="${id}"] [role="switch"]`)
 assert.equal(document.querySelectorAll('[data-tool-id] [role="switch"]').length,9)
 const originalConfig=JSON.parse(JSON.stringify(config))
 failConfig=true;toolSwitch('set_account_enabled').click()
 await until(()=>document.querySelector('[role="alert"]')?.textContent.includes('fixture save failed'))
 assert.equal(toolSwitch('set_account_enabled').getAttribute('aria-checked'),'false')
 assert.deepEqual(config,originalConfig)
 assert(document.querySelector('[aria-label="已启用工具详情"]').textContent.includes('2 / 9'))
 holdConfig=true;toolSwitch('set_account_enabled').click();await until(()=>releaseConfig&&document.querySelectorAll('[data-tool-id] [role="switch"][data-disabled]').length===9)
 assert.equal(document.querySelectorAll('[data-tool-id] [role="switch"][data-disabled]').length,9)
 assert.equal(toolSwitch('set_account_enabled').getAttribute('aria-checked'),'false')
 toolSwitch('set_account_enabled').click();holdConfig=false;releaseConfig()
 await until(()=>toolSwitch('set_account_enabled').getAttribute('aria-checked')==='true'&&!toolSwitch('set_account_enabled').hasAttribute('data-disabled'))
 assert.deepEqual(requests.at(-1),{tools:{set_account_enabled:true}})
 assert.equal((await api.loadAssistantConfig()).tools.set_account_enabled,true)
 assert.equal(config.systemPrompt,originalConfig.systemPrompt);assert.equal(config.model,originalConfig.model)
 assert.equal(config.tools.list_models,true);assert.equal(config.tools.list_account_balance,true)
 assert(document.querySelector('[aria-label="已启用工具详情"]').textContent.includes('3 / 9'));assert(toolsTrigger().textContent.includes('操作前确认'));assert.equal(changes,0)
 toolSwitch('set_account_enabled').click()
 await until(()=>toolSwitch('set_account_enabled').getAttribute('aria-checked')==='false'&&!toolSwitch('set_account_enabled').hasAttribute('data-disabled'))
 assert(document.querySelector('[aria-label="已启用工具详情"]').textContent.includes('2 / 9'))
 assert(toolsTrigger().textContent.includes('只读'));assert.equal(chatCalls,0)
 document.querySelector('[aria-label="已启用工具详情"]').click()
 document.querySelector('[aria-label="对话模型"]').click()
 await until(()=>document.querySelector('[aria-label="搜索模型"]'))
 const modelSearch=document.querySelector('[aria-label="搜索模型"]')
 Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(modelSearch,'absent-model');modelSearch.dispatchEvent(new Event('input',{bubbles:true}))
 await until(()=>document.body.textContent.includes('没有匹配的模型'))
 Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(modelSearch,'fixture');modelSearch.dispatchEvent(new Event('input',{bubbles:true}))
 await until(()=>document.querySelector('[role="option"]'));document.querySelector('[role="option"]').click()
 await until(()=>!document.querySelector('[aria-label="搜索模型"]'))
 // Context budget counts only transmitted content and never base64 image length or hidden reasoning.
 const none={...config,tools:{}}
 assert.equal(api.assistantContextUsage(none,[]).total,0)
 const baseUsage=api.assistantContextUsage(config,[])
 assert(baseUsage.system>0&&baseUsage.definitions>0)
 assert.equal(api.assistantContextUsage({...config,systemPromptEnabled:false},[]).system,0)
 assert(api.assistantContextUsage(config,[],'hello').pending>0)
 const imageUsage=url=>api.assistantContextUsage(none,[{id:'im',role:'user',parts:[{type:'file',mediaType:'image/png',url}]}])
 assert.equal(imageUsage('data:image/png;base64,a').total,imageUsage('data:image/png;base64,'+'a'.repeat(200000)).total)
 assert.equal(imageUsage('data:image/png;base64,a').images,1)
 const withReply=[{id:'r',role:'assistant',parts:[{type:'text',text:'answer'}]}]
 assert.equal(api.assistantContextUsage(none,withReply).total,api.assistantContextUsage(none,[{...withReply[0],parts:[...withReply[0].parts,{type:'reasoning',text:'private'.repeat(1000)}]}]).total)
 const caps=api.assistantModelOptions({models:[{provider:'a',id:'shared',enabled:true,capabilities:{maxInputTokens:128000}},{provider:'b',id:'shared',enabled:true,capabilities:{maxInputTokens:32000}}],mappings:[{provider:'a',target:'shared',alias:'only-a',enabled:true}]})
 assert.equal(caps.find(row=>row.id==='shared').capabilities.maxInputTokens,32000)
 assert.equal(caps.find(row=>row.id==='only-a').capabilities.maxInputTokens,128000)
 assert.equal(caps.find(row=>row.id==='shared').contextWindowVaries,true)
 const unknown=api.assistantModelOptions({models:[{provider:'a',id:'shared',enabled:true,capabilities:{maxInputTokens:128000}},{provider:'b',id:'shared',enabled:true}],mappings:[]})
 assert.equal(unknown[0].capabilities.maxInputTokens,undefined)
 const options=api.assistantModelOptions({models:[{id:'vision',provider:'a',providerLabel:'Alpha',enabled:true,capabilities:{supportsImages:true,supportsReasoning:true,supportsToolCall:true}},{id:'vision',provider:'b',providerLabel:'Beta',enabled:true,capabilities:{supportsImages:false,supportsReasoning:true}},{id:'disabled',provider:'a',enabled:false}],mappings:[{alias:'a-vision',provider:'a',target:'vision',enabled:true},{alias:'off',provider:'a',target:'vision',enabled:false}]})
 assert.equal(options.length,2);assert.equal(options[0].capabilities.supportsImages,undefined);assert.equal(options[0].capabilities.supportsReasoning,true);assert.equal(options[0].mixed,true);assert.equal(options[1].capabilities.supportsImages,true)

 document.querySelector('button[aria-label="看看哪些模型在多家重复了"]').click()
 await until(()=>document.querySelector('textarea').value==='看看哪些模型在多家重复了');assert.equal(chatCalls,0)
 if(noModel)await api.saveAssistantConfig({model:null})
 assert.deepEqual(await api.loadModelNames(),['fixture','second'])
 assert(!(await api.toolById('list_account_balance').run({})).text.includes('must-not-leave'))
 // Actual file conversion and validation: no remote storage or synthetic protocol shortcuts.
 const file=new window.File(['你好，附件\nexport const answer = 42;'],'sample.ts',{type:'application/typescript'})
 const image=new window.File([Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jw1EAAAAASUVORK5CYII=','base64'))],'pixel.png',{type:'image/png'})
 const prepared=await api.prepareAttachments([file,image]);assert(api.assistantContextUsage(none,[],'',prepared).pending>api.assistantContextUsage(none,[],'',[prepared[1]]).pending);assert.equal(api.textAttachment(prepared[0]),'你好，附件\nexport const answer = 42;')
 const filesWire=api.toWireMessages([{id:'files',role:'user',parts:prepared}]);assert(filesWire[0].content[0].text.includes('sample.ts'));assert(filesWire[0].content[0].text.includes('你好'));assert.equal(filesWire[0].content[1].image_url.url,prepared[1].url)
 assert.throws(()=>api.attachmentContent({type:'file',mediaType:'application/pdf',url:'data:application/pdf;base64,eA=='}),/不支持附件/)
 assert.throws(()=>api.validateSelection([],Array(7).fill(file)),/最多添加/)
 assert.throws(()=>api.validateSelection([],[{name:'huge.txt',type:'text/plain',size:5*1024*1024}]),/4 MB/)
 assert.throws(()=>api.validateSelection([],[{name:'a.txt',type:'text/plain',size:3*1024*1024},{name:'b.txt',type:'text/plain',size:3*1024*1024},{name:'c.txt',type:'text/plain',size:3*1024*1024}]),/8 MB/)
 await assert.rejects(api.prepareAttachments([new window.File(['not an image'],'bad.png',{type:'image/png'})]),/格式不符/)
 await assert.rejects(api.prepareAttachments([new window.File([Uint8Array.from([0,255,0])],'binary.txt',{type:'text/plain'})]),/不是可读取的文本/)
 const cancelled=new AbortController();cancelled.abort();await assert.rejects(api.prepareAttachments([file],cancelled.signal),{name:'AbortError'})
 attach([file]);await until(()=>document.querySelector('[aria-label="移除附件 sample.ts"]'))
 document.querySelector('[aria-label="上下文用量"]').click();await until(()=>document.querySelector('[data-context-category="draft"] dd')?.textContent.trim()!=='0'&&!document.body.textContent.includes('正在读取附件…'));assert.equal(chatCalls,0);document.querySelector('[aria-label="上下文用量"]').click()
 attach([new window.File(['%PDF'],'test.pdf',{type:'application/pdf'})]);await until(()=>document.body.textContent.includes('PDF / Office'));assert.equal(document.querySelectorAll('[data-slot="attachment"]').length,1)
 document.querySelector('[aria-label="移除附件 sample.ts"]').click();await until(()=>!document.querySelector('[data-slot="attachment"]'));assert.equal(objectUrls.size,0)
 if(noModel){
  attach([file]);await until(()=>document.querySelector('[aria-label="移除附件 sample.ts"]'));await send();await until(()=>document.body.textContent.includes('输入的内容会保留'));assert.equal(chatCalls,0);assert.equal(document.querySelector('textarea').value,'fixture');assert(document.querySelector('[aria-label="移除附件 sample.ts"]'));assert(document.querySelector('[data-slot="empty"]'))
 }else{
  // A model removed after selection must not consume the draft, attachment or create history.
  modelUnavailable=true;attach([file]);await until(()=>document.querySelector('[aria-label="移除附件 sample.ts"]'))
  const oldHistoryCount=conversations.size;await send();await until(()=>document.body.textContent.includes('当前模型已不可用'))
  assert.equal(chatCalls,0);assert.equal(conversations.size,oldHistoryCount);assert.equal(document.querySelector('textarea').value,'fixture');assert(document.querySelector('[aria-label="移除附件 sample.ts"]'))
  modelUnavailable=false;document.querySelector('[aria-label="移除附件 sample.ts"]').click();await until(()=>!document.querySelector('[data-slot="attachment"]'))
  await send();await until(()=>document.body.textContent.includes('此工具已关闭'));await clear();assert.equal(changes,0)
  document.querySelector('[aria-label="已启用工具详情"]').click()
  await until(()=>document.querySelector('[data-tool-id="set_account_enabled"] [role="switch"]'))
  document.querySelector('[data-tool-id="set_account_enabled"] [role="switch"]').click()
  await until(()=>config.tools.set_account_enabled===true)
  document.querySelector('[aria-label="已启用工具详情"]').click()
  await send();await until(()=>button('执行'));assert.equal(changes,0);button('取消').click();await until(()=>document.body.textContent.includes('已取消'));await clear();assert.equal(changes,0)
  await send();await until(()=>button('执行'));await api.saveAssistantConfig({tools:{set_account_enabled:false}});button('执行').click();await until(()=>document.body.textContent.includes('此工具已关闭'));await clear();assert.equal(changes,0)
  // Exact fields only: a model selection preserves fresh permissions and prompt.
  config={...config,systemPrompt:'fresh',tools:{...config.tools,set_account_enabled:false}}
  await api.saveAssistantConfig({model:'second'});assert.equal(config.systemPrompt,'fresh');assert.equal(config.tools.set_account_enabled,false);assert.deepEqual(requests.at(-1),{model:'second'})
  await api.saveAssistantConfig({tools:{set_account_enabled:true}})
  await send();await until(()=>button('执行'));const execute=button('执行');execute.click();execute.click();await until(()=>changes===1);await clear();assert.equal(changes,1)
  // Stop while account resolution is pending: no write may start later.
  window.workbuddyDesktop.getState=async()=>{await new Promise(r=>releaseRead=r);return originalState()}
  await send();await until(()=>button('执行'));button('执行').click();await until(()=>releaseRead);const before=chatCalls;stopButton().click();releaseRead();await new Promise(r=>setTimeout(r,30));assert.equal(changes,1);assert.equal(chatCalls,before);await clear()
  window.workbuddyDesktop.getState=originalState
  // Stop during the first mutation of a batch: don't execute the second item or continue chatting.
  mode='batch';window.workbuddyDesktop.updateAccount=async()=>{changes++;await new Promise(r=>releaseWrite=r)}
  await send();await until(()=>button('执行'));button('执行').click();await until(()=>releaseWrite);const batchBefore=chatCalls;stopButton().click();releaseWrite();await new Promise(r=>setTimeout(r,30));assert.equal(changes,2);assert.equal(chatCalls,batchBefore);await clear()
  window.workbuddyDesktop.updateAccount=async()=>{changes++}
  // A failed second bridge call shows a failed card with the first change preserved in details.
  mode='batchfail';let batchWrites=0;window.workbuddyDesktop.updateAccount=async()=>{if(++batchWrites===2)throw new Error('HTTP 401 Bearer fixture-secret')}
  await send();await until(()=>button('执行'));button('执行').click();await until(()=>document.body.textContent.includes('已完成 1 项，第 2 项失败'))
  assert.equal(batchWrites,2);assert(document.body.textContent.includes('"partial":true'));assert(!document.body.textContent.includes('fixture-secret'));await clear()
  window.workbuddyDesktop.updateAccount=async()=>{changes++}
  // Model tests require both enablement and their own confirmation.
  mode='test';let tests=0;let testPayload;window.workbuddyDesktop.testModel=async payload=>{testPayload=payload;tests++;return {success:true}}
  await api.saveAssistantConfig({tools:{test_model:true}});await send();await until(()=>button('执行'));assert.equal(tests,0)
  const promptDetails=document.querySelector('[data-tool-confirm] details');assert(promptDetails);promptDetails.querySelector('summary').click();assert(promptDetails.open)
  const confirmedPrompt=promptDetails.querySelector('pre').textContent;assert(confirmedPrompt.endsWith('完整提示词尾部'));assert(confirmedPrompt.length>256)
  button('执行').click();await until(()=>tests===1);assert.equal(testPayload.prompt,confirmedPrompt);await clear()
  mode='empty';await send();await until(()=>document.body.textContent.includes('模型返回了空回复'));assert(!stopButton());await clear()
  mode='error';await send();await until(()=>document.body.textContent.includes('fixture upstream failure'));assert.equal(changes,2);await clear()
  mode='loop';const loopBefore=chatCalls;await send();await until(()=>document.body.textContent.includes('12 次上限'));assert.equal(chatCalls-loopBefore,12);await clear()
  // AI SDK steps must become separate OpenAI assistant/tool groups.
  const wire=api.toWireMessages([{id:'x',role:'assistant',parts:[{type:'step-start'},{type:'dynamic-tool',toolName:'list_models',toolCallId:'a',input:{},state:'output-available',output:'first'},{type:'step-start'},{type:'text',text:'second'}]}]);assert.deepEqual(wire.map(m=>m.role),['assistant','tool','assistant'])
  mode='text';attach([file],'drop');attach([image],'paste');await until(()=>document.querySelectorAll('[data-slot="attachment"]').length===2)
  // Attachments alone are a valid message and preserve the file data through actual SDK transport.
  const el=document.querySelector('textarea');Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set.call(el,'');el.dispatchEvent(new Event('input',{bubbles:true}));await until(()=>!sendButton().disabled);sendButton().click();await until(()=>document.querySelector('button[aria-label="复制回答"]'))
  const request=requests.filter(item=>Array.isArray(item.messages)).at(-1);assert(request.messages[0].content.some(p=>p.type==='image_url'));assert(request.messages[0].content.some(p=>p.text?.includes('sample.ts')));assert.equal(objectUrls.size,0)
  document.querySelector('button[aria-label="复制回答"]').click();await until(()=>copied==='done'&&document.querySelector('button[aria-label="已复制"]'))
  navigator.clipboard.writeText=async()=>{throw new Error('denied')};document.querySelector('button[aria-label="已复制"]').click();await until(()=>document.querySelector('button[aria-label="复制失败，请重试"]'))
  window.copyToClipboard=async text=>{copied=text;return true};document.querySelector('button[aria-label="复制失败，请重试"]').click();await until(()=>document.querySelector('button[aria-label="已复制"]'))
  const removedRetryBefore=chatCalls;modelUnavailable=true;document.querySelector('button[aria-label="重新生成"]').click();await until(()=>document.body.textContent.includes('当前模型已不可用'));assert.equal(chatCalls,removedRetryBefore,'retry also checks the current model directory');modelUnavailable=false
  const retryBefore=chatCalls;document.querySelector('button[aria-label="重新生成"]').click();await until(()=>chatCalls>retryBefore&&!stopButton());assert.equal(requests.filter(item=>Array.isArray(item.messages)).at(-1).messages[0].content.find(p=>p.type==='image_url').image_url.url,prepared[1].url)
  // Real history hook: save actual SDK messages/files; selecting must not invoke any tool or model.
  const historyKey=window.localStorage.getItem('aibuddy.assistant.active-conversation')
  await until(()=>conversations.get(historyKey)?.messages?.length===2)
  assert.equal(conversations.get(historyKey).messages[0].parts.filter(part=>part.type==='file').length,2)
  const savedCalls=chatCalls,savedChanges=changes
  await clear()
  const historyButton=()=>[...document.querySelectorAll('nav[aria-label="历史对话列表"] button')].find(button=>button.title==='sample.ts')
  await until(()=>historyButton());historyButton().click()
  await until(()=>document.querySelector('[aria-label="预览附件 sample.ts"]')||document.querySelector('[data-slot="message"]'))
  await until(()=>window.localStorage.getItem('aibuddy.assistant.active-conversation')===historyKey)
  assert.equal(chatCalls,savedCalls);assert.equal(changes,savedChanges)
  assert.equal(api.restoreMessages([{id:'old',role:'assistant',parts:[{type:'dynamic-tool',toolName:'set_account_enabled',toolCallId:'old-tool',input:{},state:'input-available'}]}])[0].parts[0].state,'output-error')
  document.querySelector('[aria-label="对话操作：sample.ts"]').click();await until(()=>menuItem('重命名'));menuItem('重命名').click()
  await until(()=>document.querySelector('#assistant-conversation-title'))
  const titleInput=document.querySelector('#assistant-conversation-title');Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(titleInput,'附件分析记录');titleInput.dispatchEvent(new Event('input',{bubbles:true}));await until(()=>!button('保存').disabled);button('保存').click()
  await until(()=>conversations.get(historyKey).title==='附件分析记录'&&!document.querySelector('#assistant-conversation-title'))
  const search=document.querySelector('[aria-label="搜索对话"]');Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(search,'不存在的标题');search.dispatchEvent(new Event('input',{bubbles:true}));await until(()=>document.body.textContent.includes('没有匹配的对话'))
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(search,'');search.dispatchEvent(new Event('input',{bubbles:true}));await until(()=>document.querySelector('[aria-label="对话操作：附件分析记录"]'))
  document.querySelector('[aria-label="对话操作：附件分析记录"]').click();await until(()=>menuItem('删除对话'));menuItem('删除对话').click();await until(()=>button('删除'));button('删除').click();await until(()=>conversations.get(historyKey).deleted&&document.querySelector('[data-slot="empty"]'))
  assert.equal(chatCalls,savedCalls);assert.equal(changes,savedChanges)
  const remaining=[...conversations.values()].filter(row=>!row.deleted).length
  assert(remaining>1)
  button('删除全部').click();await until(()=>button('删除'));button('取消').click();await until(()=>!button('删除'));assert.equal([...conversations.values()].filter(row=>!row.deleted).length,remaining)
  button('删除全部').click();await until(()=>button('删除'));button('删除').click();await until(()=>[...conversations.values()].every(row=>row.deleted))
  assert.equal(chatCalls,savedCalls);assert.equal(changes,savedChanges)
  await clear();assert.equal(objectUrls.size,0)
  // IME Enter must not submit a partially composed Chinese sentence.
  const textarea=document.querySelector('textarea');Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set.call(textarea,'输入中');textarea.dispatchEvent(new Event('input',{bubbles:true}));const imeBefore=chatCalls;textarea.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true}));await new Promise(r=>setTimeout(r,10));assert.equal(chatCalls,imeBefore)
 }
 console.log('PASS: actual AI SDK + official Base UI chat composition; readonly defaults, field patches, revocation/confirmation/stop, 12-round limit, UTF-8 files and inline images, file-only sends, validation/rejection, drop/paste/removal, missing/removed-model draft retention, empty-response completion, URL cleanup, copy/retry with attachments, IME, secret filtering, searchable model capabilities, click-open tool switches with pending/failure/field-save synchronization and per-action confirmation, history CRUD and confirmed bulk deletion; context budget, attachments, hidden reasoning exclusion, conservative route limits and aliases')
}finally{dom.window.close();fs.rmSync(dir,{recursive:true,force:true})}
