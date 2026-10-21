import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
const root=path.resolve(new URL('..',import.meta.url).pathname),islands=root+'/desktop-tauri/ui-islands',require=createRequire(islands+'/package.json')
const {build}=require('esbuild'),{JSDOM}=require('jsdom'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'a2a-targeted-growth-ui-'))
// Imported account modules install legacy pollers; this fixture owns and clears them.
const nativeSetInterval=globalThis.setInterval,nativeClearInterval=globalThis.clearInterval,intervals=new Set()
const nativeSetTimeout=globalThis.setTimeout,nativeClearTimeout=globalThis.clearTimeout,timeouts=new Set()
globalThis.setInterval=(callback,delay,...args)=>{const timer=nativeSetInterval(callback,delay,...args);intervals.add(timer);return timer}
globalThis.clearInterval=timer=>{intervals.delete(timer);nativeClearInterval(timer)}
globalThis.setTimeout=(callback,delay,...args)=>{const timer=nativeSetTimeout(()=>{timeouts.delete(timer);callback(...args)},delay);timeouts.add(timer);return timer}
globalThis.clearTimeout=timer=>{timeouts.delete(timer);nativeClearTimeout(timer)}
const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'http://localhost/'})
for(const key of ['window','document','HTMLElement','Element','Node','Event','CustomEvent','MouseEvent','KeyboardEvent','MutationObserver','HTMLButtonElement','HTMLInputElement','SVGElement','ShadowRoot','NodeFilter'])globalThis[key]=dom.window[key]
Object.defineProperty(globalThis,'navigator',{configurable:true,value:dom.window.navigator});globalThis.localStorage=dom.window.localStorage
Object.assign(globalThis,{getComputedStyle:dom.window.getComputedStyle.bind(dom.window),requestAnimationFrame:cb=>setTimeout(cb,0),cancelAnimationFrame:clearTimeout,IS_REACT_ACT_ENVIRONMENT:true})
globalThis.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};window.ResizeObserver=globalThis.ResizeObserver;window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});window.Element.prototype.getAnimations=()=>[]
window.wbI18n={t:(s,v={})=>s.replace(/\{(\w+)\}/g,(_,k)=>String(v[k]??`{${k}}`))}
window.PointerEvent=window.MouseEvent;globalThis.PointerEvent=window.PointerEvent
let compensation={active:true,claimed:false,claimable:true,creditNum:500,endTime:null}
const requests=[],toasts=[];let queue={running:false,items:[]},finishRun
let failTaskRead=false,finishAccept,finishClaim,claimResult={claimed:false,message:'fixture claim rejected'}
const tasks=[
 {code:'Sequential_Tasks_3',title:'小程序完成 5 次对话',current:3,target:5,accepted:true,automatable:true},
 {code:'WorkBuddy_Valorant',title:'体验无畏契约拼豆专家',current:0,target:1,accepted:true,automatable:true},
 {code:'pending_task',title:'待领取任务',current:0,target:1,accepted:false},
 {code:'reward_task',title:'达标任务',current:1,target:1,accepted:true,claimable:true},
 {code:'claimed_task',title:'历史任务',current:1,target:1,accepted:true,claimed:true},
 {code:'locked_task',title:'锁定任务',current:0,target:1,locked:true},
 {code:'manual_task',title:'关注公众号',current:0,target:1,accepted:true,automatable:false},
]
window.wbApp={toast:message=>toasts.push(message),refresh:()=>{}}
window.__TAURI_INTERNALS__={invoke:async(command,{request})=>{
 requests.push(request)
 if(request.path==='/api/growth-tasks/queue')return queue
 if(request.path==='/api/growth-tasks/run'){
  if(request.body.taskCode==='WorkBuddy_Valorant'){
   await new Promise(resolve=>finishRun=resolve)
   queue={running:true,items:[{accountId:'selected',taskCode:'WorkBuddy_Valorant',status:'running'}]}
   return {started:true,total:1}
  }
  if(request.body.taskCode==='Sequential_Tasks_3'){
   Object.assign(tasks.find(t=>t.code==='Sequential_Tasks_3'),{current:5,claimable:true})
   return {started:true,total:1}
  }
  return {started:true,total:2}
 }
 if(request.path.endsWith('/compensation'))return {accountId:'selected',status:{...compensation}}
 if(request.path==='/api/growth-tasks/gift'){compensation={...compensation,claimed:true,claimable:false};return {claimed:true,message:'fixture compensation claimed'}}
 if(request.path.endsWith('/accept')){await new Promise(resolve=>finishAccept=resolve);tasks.find(t=>t.code===request.body.code).accepted=true;return {accepted:1}}
 if(request.path.endsWith('/claim')){await new Promise(resolve=>finishClaim=resolve);return claimResult}
 if(request.path==='/api/growth-tasks/accounts/selected'){if(failTaskRead)throw Error('fixture list delayed');return {accountId:'selected',tasks}}
 throw Error('unexpected fixture request '+request.path)
}}
let rootNode,React,f
try {
 const output=path.join(tmp,'fixture.cjs')
 await build({stdin:{contents:`export {default as React} from 'react'; export {createRoot} from 'react-dom/client'; export {WorkBuddyTasksDialog} from './src/islands/workbuddy-tasks-dialog'`,resolveDir:islands,loader:'tsx'},bundle:true,platform:'node',format:'cjs',outfile:output,jsx:'automatic',alias:{'@ui':root+'/desktop-tauri/ui-kit/src/index.ts',react:path.dirname(require.resolve('react/package.json')),'react-dom':path.dirname(require.resolve('react-dom/package.json'))},nodePaths:[islands+'/node_modules',root+'/desktop-tauri/ui-kit/node_modules'],logLevel:'silent'})
 f=require(output);React=f.React;rootNode=f.createRoot(document.getElementById('root'))
 await React.act(async()=>rootNode.render(React.createElement(f.WorkBuddyTasksDialog,{account:{id:'selected',provider:'workbuddy',edition:'cn',enabled:false,name:'Fixture'},onClose(){}})))
 const row=code=>[...document.querySelectorAll('tbody tr')].find(row=>row.textContent.includes(code))
 const button=label=>[...document.querySelectorAll('button')].find(button=>button.textContent===label)
 assert.doesNotMatch(document.body.textContent,/已停用 API 转发|使用无畏契约拼豆专家完成真实对话|可自动执行|需手动完成/)
 assert.equal(document.querySelectorAll('thead th').length,4)
 assert.ok([...document.querySelectorAll('tbody tr')].every(row=>row.children.length===4))
 assert.doesNotMatch(row('Sequential_Tasks_3').textContent,/45–55 秒/,'long help must not occupy the row')
 const compensationRow=()=>[...document.querySelectorAll('tbody tr')].find(row=>row.textContent.includes('补偿积分'))
 assert.equal(compensationRow().lastElementChild.querySelector('button').textContent,'领取奖励')
 await React.act(async()=>compensationRow().lastElementChild.querySelector('button').click())
 assert.equal(compensationRow().children.length,4)
 assert.equal(compensationRow().lastElementChild.textContent,'已领取')
 assert.equal(compensationRow().lastElementChild.querySelector('button'),null)
 const help=row('Sequential_Tasks_3').querySelector('button[aria-label="完成 5 次对话说明"]')
 assert.ok(help,'question mark sits beside the task title')
 for(const code of ['manual_task','claimed_task','locked_task']){
  const status=row(code).lastElementChild
  assert.equal(status.querySelector('button'),null,code+' status is not clickable')
 }
 for(const code of ['Sequential_Tasks_3','WorkBuddy_Valorant'])assert.equal(row(code).lastElementChild.querySelector('button').textContent,'执行任务')
 const single=row('WorkBuddy_Valorant').lastElementChild.querySelector('button')
 await React.act(async()=>{single.click();single.click()})
 assert.equal(requests.filter(r=>r.path==='/api/growth-tasks/run').length,1)
 assert.deepEqual(requests.find(r=>r.path==='/api/growth-tasks/run').body,{accountId:'selected',taskCode:'WorkBuddy_Valorant',taskKind:'growth'})
 assert.ok(single.disabled)
 assert.match(single.textContent,/执行中/)
 await React.act(async()=>finishRun())
 assert.match(row('WorkBuddy_Valorant').lastElementChild.textContent,/执行中/)
 assert.ok(row('Sequential_Tasks_3').lastElementChild.querySelector('button').disabled)
 assert.equal(tasks.find(t=>t.code==='Sequential_Tasks_3').current,3,'single run cannot execute its neighbor')
 queue={running:false,items:[{accountId:'selected',taskCode:'WorkBuddy_Valorant',status:'success'}]}
 tasks.find(t=>t.code==='WorkBuddy_Valorant').claimed=true
 await React.act(async()=>new Promise(resolve=>nativeSetTimeout(resolve,3100)))
 assert.equal(row('WorkBuddy_Valorant').lastElementChild.textContent,'已领取')
 // A task that finishes before the first queue poll must also refresh immediately.
 await React.act(async()=>row('Sequential_Tasks_3').lastElementChild.querySelector('button').click())
 assert.equal(row('Sequential_Tasks_3').lastElementChild.querySelector('button').textContent,'领取奖励')
 assert.equal(row('pending_task').lastElementChild.querySelector('button').textContent,'领取任务')
 assert.equal(row('reward_task').lastElementChild.querySelector('button').textContent,'领取奖励')
 await React.act(async()=>help.click())
 assert.match(document.querySelector('[data-slot="popover-content"]').textContent,/45–55 秒/)
 await React.act(async()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})))
 // Accepting a task changes only acceptance, never its claimed state. Double-click sends one write.
 const accept=row('pending_task').querySelector('button')
 await React.act(async()=>{accept.click();accept.click()})
 assert.equal(requests.filter(r=>r.path.endsWith('/accept')).length,1)
 assert.ok(accept.disabled)
 await React.act(async()=>finishAccept())
 assert.match(row('pending_task').lastElementChild.textContent,/进行中/)
 assert.equal(row('pending_task').lastElementChild.querySelector('button'),null)
 // HTTP success with claimed:false must stay claimable and report failure.
 await React.act(async()=>row('reward_task').querySelector('button').click())
 await React.act(async()=>finishClaim())
 assert.match(document.body.textContent,/fixture claim rejected/)
 assert.equal(row('reward_task').lastElementChild.textContent,'领取奖励')
 assert.ok(!toasts.includes('任务奖励已领取'))
 await React.act(async()=>button('重新查询').click())
 // A confirmed claim remains claimed even if the following task-list read is stale.
 claimResult={claimed:true};failTaskRead=true
 const claim=row('reward_task').querySelector('button')
 await React.act(async()=>{claim.click();claim.click()})
 assert.equal(requests.filter(r=>r.path.endsWith('/claim')).length,2)
 await React.act(async()=>finishClaim())
 assert.equal(row('reward_task').lastElementChild.textContent,'已领取')
 assert.equal(row('reward_task').lastElementChild.querySelector('button'),null)
 assert.equal(toasts.filter(t=>t==='任务奖励已领取').length,1)
 assert.match(document.body.textContent,/fixture list delayed/)
 failTaskRead=false
 await React.act(async()=>button('重新查询').click())
 assert.equal(row('reward_task').lastElementChild.textContent,'已领取','stale requery cannot undo confirmed success')
 const run=[...document.querySelectorAll('button')].find(button=>button.textContent==='执行普通成长任务（不含夜猫）')
 assert.ok(run&&!run.disabled,'explicit manual run remains available on forwarding-disabled account')
 await React.act(async()=>run.click())
 assert.deepEqual(requests.filter(r=>r.path==='/api/growth-tasks/run').at(-1).body,{accountId:'selected'})
 assert.match(toasts.at(-1),/2 项任务/)
 assert.ok(!requests.some(r=>/enabled|enable|toggle/.test(r.path)),'manual task must not enable API routing')
 console.log('PASS: single-task execution scope, duplicate clicks, executing status, neighbor isolation, queued and fast completion refresh, four-column states, help and confirmed claims; mocked API only')
} finally {
 if(rootNode)await React.act(async()=>rootNode.unmount())
 dom.window.close();fs.rmSync(tmp,{recursive:true,force:true})
 for(const timer of intervals)nativeClearInterval(timer)
 for(const timer of timeouts)nativeClearTimeout(timer)
 globalThis.setInterval=nativeSetInterval;globalThis.clearInterval=nativeClearInterval
 globalThis.setTimeout=nativeSetTimeout;globalThis.clearTimeout=nativeClearTimeout
}
// Bundled React schedulers retain MessagePorts. All assertions/cleanup completed;
// this standalone fixture owns the process (failed assertions never reach here).
process.exit(0)
