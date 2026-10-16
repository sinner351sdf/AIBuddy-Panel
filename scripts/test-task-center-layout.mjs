// Mount both real pages against local fixtures; never call a provider or live service.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
const root=path.resolve(new URL('..',import.meta.url).pathname),islands=root+'/desktop-tauri/ui-islands',require=createRequire(islands+'/package.json')
const {build}=require('esbuild'),{JSDOM}=require('jsdom'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'a2a-task-layout-'))
const dom=new JSDOM('<!doctype html><div id="account-tasks"></div><div id="maintenance"></div>',{url:'http://localhost/'})
for(const key of ['window','document','HTMLElement','Element','Node','Event','CustomEvent','MouseEvent','KeyboardEvent','MutationObserver','HTMLButtonElement','HTMLInputElement','SVGElement','ShadowRoot','NodeFilter'])globalThis[key]=dom.window[key]
Object.defineProperty(globalThis,'navigator',{configurable:true,value:dom.window.navigator});globalThis.localStorage=dom.window.localStorage
globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);globalThis.requestAnimationFrame=cb=>setTimeout(cb,0);globalThis.cancelAnimationFrame=clearTimeout
globalThis.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};window.ResizeObserver=globalThis.ResizeObserver;window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});window.Element.prototype.getAnimations=()=>[];globalThis.IS_REACT_ACT_ENVIRONMENT=true
window.wbI18n={t:(s,v={})=>s.replace(/\{(\w+)\}/g,(_,k)=>String(v[k]??`{${k}}`))}
const requests=[],saved=[],nav=[];let tabState,React,roots=[],allowActions=false,queue={running:false,total:1,done:1,items:[{accountName:'completed fixture',taskCode:'@activity',status:'success',message:'completed result should only appear in history'}]}
const schedule={growthEnabled:true,growthTime:'09:00',blackcatEnabled:false,blackcatTime:'23:00',travelEnabled:true,travelHours:[9,21],activityEnabled:true,activityTime:'10:00',streakEnabled:true,streakTime:'09:30',recordRetentionDays:90,tasks:[]}
const snapshot={auto:{enabled:true,schedules:[]},daily:{providers:[],outOfScope:[],totalCount:0,doneCount:0},extras:{onboarding:[],plans:[],growth:[]},keepalive:{models:['fixture-model-a','fixture-model-b'],defaultModels:['fixture-model-a','fixture-model-b']}}
window.wbApp={currentPage:'tasks',toast(){},renderTopbarStatus(){},showPage(page){nav.push(page);this.currentPage=page}}
window.workbuddyDesktop={getCheckinCenter:async()=>snapshot,getCheckinRecords:async()=>({total:0,records:[]}),getCheckinSchedules:async()=>({enabled:true,schedules:[]}),getCheckinKeepalive:async()=>({models:[]}),getQoderUmid:async()=>({available:true}),getScheduledTasks:async()=>({tasks:['credentialMaintenance','modelRefresh','logsAutoRefresh','requestsAutoRefresh','reportAutoRefresh','updateCheck'].map((id,i)=>({id,label:['凭证自动维护','模型目录刷新','日志页自动刷新','请求日志页自动刷新','报表自动刷新','软件版本检查'][i],description:'fixture maintenance',unit:'minutes',runner:'backend',enabled:true,interval:10,min:1,max:1440,defaultInterval:10,running:false,lastRunAt:null,lastResult:null,retryAt:null,nextRunAt:null,canRun:true}))})}
let scanDeferred=null,travelFails=false
let scanReply={scannedAt:1792000010000,results:[
 {id:'domestic',name:'国内测试账号',tasks:[
  {code:'claimable',label:'已达标任务',current:1,target:1,rewardCredit:0,rewardEnergy:2,claimable:true},
  {code:'claimed',label:'已领任务',current:1,target:1,rewardCredit:100,rewardEnergy:0,claimed:true},
  {code:'locked',label:'锁定任务',current:0,target:5,locked:true},
  {code:'pending',label:'<img src=x onerror=alert(1)>',current:0,target:1,rewardCredit:0,rewardEnergy:0}]},
 {id:'failed',name:'失败账号',error:'fixture query failure',tasks:[]},
 {id:'empty',name:'空任务账号',tasks:[]}
]}
window.__TAURI_INTERNALS__={async invoke(command,{request}){assert.equal(command,'api_request');requests.push(request);if(request.method==='PUT'){assert.ok(allowActions);saved.push(request);return Object.assign(schedule,request.body)}if(request.method==='POST'){assert.ok(allowActions);if(request.path==='/api/growth-tasks/run'){queue={running:true,total:2,done:0,items:[]};return{total:2}}if(request.path==='/api/growth-tasks/stop'){queue={running:false,total:2,done:1,items:[]};return{ok:true}}if(request.path==='/api/growth-tasks/rewards')return{message:'fixture reward'};throw Error('Unexpected action '+request.path)}assert.equal(request.method,'GET','No real/synthetic account tasks should be executed in layout test');if(request.path==='/api/accounts')return{accounts:[{id:'domestic',provider:'workbuddy',name:'国内测试账号'},{id:'international',provider:'workbuddy-intl',name:'国际测试账号'}]};if(request.path==='/api/growth-tasks/schedule')return schedule;if(request.path==='/api/growth-tasks/queue')return queue;if(request.path==='/api/growth-tasks/scan')return scanDeferred || scanReply;if(request.path==='/api/growth-tasks/accounts/domestic')return{accountId:'domestic',queriedAt:1792000011000,tasks:scanReply.results[0].tasks};if(request.path==='/api/accounts/domestic/growth'){if(travelFails)throw Error('fixture travel error');return{travel:{buddyName:'fixture cat',state:'在途'}}};if(request.path.startsWith('/api/task-records?'))return{total:61,items:[{id:1,accountId:'international',accountName:'国际测试账号',kind:'activity',provider:'workbuddy-intl',source:'manual',startedAt:1792000000000,outcome:'success',message:'fixture history'}]};throw Error('Unexpected API '+request.path)}}
try{
 const file=tmp+'/fixture.cjs'
 await build({stdin:{contents:`import * as React from 'react';import {createRoot} from 'react-dom/client';import {CheckinPage} from './src/islands/checkin-page';import {TasksPanel} from './src/islands/tasks-panel';export {React,createRoot,CheckinPage,TasksPanel};export {openTaskCenter} from './src/islands/task-center-api';export {getCheckinStore,setCheckinTab} from './src/islands/checkin-state';`,loader:'tsx',resolveDir:islands},plugins:[{name:'export-real-pages',setup(build){build.onLoad({filter:/(checkin-page|tasks-panel)\.tsx$/},args=>({contents:fs.readFileSync(args.path,'utf8')+`\nexport {${args.path.endsWith('checkin-page.tsx')?'CheckinPage':'TasksPanel'}};`,loader:'tsx'}))}}],bundle:true,platform:'node',format:'cjs',outfile:file,jsx:'automatic',alias:{'@ui':root+'/desktop-tauri/ui-kit/src/index.ts',react:path.dirname(require.resolve('react/package.json')),'react-dom':path.dirname(require.resolve('react-dom/package.json'))},nodePaths:[islands+'/node_modules',root+'/desktop-tauri/ui-kit/node_modules'],logLevel:'silent'})
 const f=require(file);React=f.React;tabState=f;roots=[f.createRoot(document.getElementById('account-tasks')),f.createRoot(document.getElementById('maintenance'))]
 await React.act(async()=>{roots[0].render(React.createElement(f.CheckinPage));roots[1].render(React.createElement(f.TasksPanel))})
 const account=document.getElementById('account-tasks'),maintenance=document.getElementById('maintenance')
 assert.ok(maintenance.textContent.includes('系统维护'));assert.ok(maintenance.textContent.includes('凭证自动维护'));assert.ok(!maintenance.textContent.includes('WorkBuddy任务'));assert.ok(!maintenance.textContent.includes('成长任务'));assert.ok(!maintenance.textContent.includes('软件版本检查'))
 assert.equal(requests.length,0,'maintenance must not attach a second account task queue')
 const tabs=()=>[...account.querySelectorAll('[role=tablist][aria-label="任务中心分区"] [role=tab]')]
 assert.deepEqual(tabs().map(n=>n.textContent),['签到与福利','WorkBuddy任务','定时签到','签到记录'])
 const click=async(node)=>{assert.ok(node);await React.act(async()=>{if(node.getAttribute('role')==='option'){const pointer=new MouseEvent('pointerdown',{bubbles:true,button:0,buttons:1});Object.defineProperty(pointer,'pointerType',{value:'mouse'});node.dispatchEvent(pointer)}node.click()})}
 await click(tabs()[1]);assert.equal(f.getCheckinStore().tab,'workbuddy');assert.ok(account.textContent.includes('猫猫旅行'));assert.equal(document.querySelectorAll('#tasks-badge').length,1);assert.equal(document.querySelectorAll('#workbuddy-task-badge').length,0);assert.ok(!account.textContent.includes('completed fixture'),'completed queue does not persist as a progress card')
 const workTabs=()=>[...account.querySelectorAll('[role=tablist][aria-label="WorkBuddy任务分区"] [role=tab]')]
 assert.deepEqual(workTabs().map(n=>n.textContent),['任务与排程','执行记录']);assert.equal(account.querySelectorAll('button[aria-label^="立即执行"]').length,5,'one execution entry per task');let timeInput=account.querySelector('input[aria-label="成长任务执行时刻"]');assert.equal(timeInput.value,'09:00')
 await React.act(async()=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(timeInput,'11:20');timeInput.dispatchEvent(new Event('input',{bubbles:true}));timeInput.dispatchEvent(new Event('change',{bubbles:true}))})
 await click(tabs()[0]);await click(tabs()[1]);assert.equal(account.querySelector('input[aria-label="成长任务执行时刻"]').value,'11:20','draft survives primary-tab switches')
 assert.equal(saved.length,0,'tab switches must not save schedules')
 await React.act(async()=>f.openTaskCenter('international'));assert.equal(nav.at(-1),'checkin');assert.equal(f.getCheckinStore().tab,'workbuddy');assert.ok(account.querySelector('[role=combobox][aria-label="账号范围"]').textContent.includes('国际测试账号'))
 const runButtons=()=>[...account.querySelectorAll('button[aria-label^="立即执行"]')];assert.equal(runButtons().filter(b=>!b.disabled).length,1,'international account only allows activity');assert.equal(runButtons().find(b=>!b.disabled).getAttribute('aria-label'),'立即执行活跃上报')
 await click(workTabs()[1]);assert.ok(requests.at(-1).path.includes('accountId=international'));assert.ok(account.textContent.includes('fixture history'));assert.ok(account.querySelector('[aria-label="第 1 / 2 页"]'))
 const beforeRefresh=requests.filter(r=>r.path.startsWith('/api/task-records?')).length;await React.act(async()=>window.dispatchEvent(new Event('wb:task-center-refresh')));assert.equal(requests.filter(r=>r.path.startsWith('/api/task-records?')).length,beforeRefresh+1,'page refresh updates retained execution records')
 const next=[...account.querySelectorAll('button')].find(n=>n.getAttribute('aria-label')==='下一页');await click(next);assert.ok(requests.at(-1).path.includes('offset=50'))
 await click(tabs()[2]);
 const grips=()=>[...account.querySelectorAll('.ck-chain-grip')]
 assert.equal(grips().length,2);assert.equal(grips()[0].getAttribute('data-slot'),'button','model sorting uses the shared Button')
 await React.act(async()=>grips()[0].dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true})))
 assert.deepEqual(f.getCheckinStore().keepaliveDraft,['fixture-model-b','fixture-model-a'])
 await React.act(async()=>grips()[1].dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true})))
 assert.deepEqual(f.getCheckinStore().keepaliveDraft,['fixture-model-a','fixture-model-b'])
 await React.act(async()=>grips()[0].dispatchEvent(new MouseEvent('pointerdown',{button:0,bubbles:true})))
 assert.ok(document.body.classList.contains('ck-chain-dragging'))
 await React.act(async()=>window.dispatchEvent(new MouseEvent('pointerup',{bubbles:true})))
 assert.ok(!document.body.classList.contains('ck-chain-dragging'))
 await click(tabs()[3]);assert.equal(f.getCheckinStore().tab,'records');assert.ok(account.textContent.includes('签到记录'))
 assert.equal(requests.filter(r=>r.method==='POST').length,0);assert.equal(saved.length,0)
 // Exercise only in-memory fixture APIs: merged controls retain original payloads and safeguards.
 await click(tabs()[1]);await click(workTabs()[0]);allowActions=true
 await click(runButtons().find(b=>!b.disabled));assert.deepEqual(requests.findLast(r=>r.path==='/api/growth-tasks/run').body,{taskKind:'activity',mode:'full',concurrency:1,accountId:'international'})
 assert.ok(account.querySelector('[aria-label="任务运行状态"]'));assert.ok(runButtons().every(b=>b.disabled),'queue prevents duplicate execution')
 await click([...account.querySelectorAll('button')].find(b=>b.textContent==='查看执行记录'));const recordsBeforeStop=requests.filter(r=>r.path.startsWith('/api/task-records?')).length
 await click([...account.querySelectorAll('button')].find(b=>b.textContent==='停止后续步骤'));assert.ok(!account.querySelector('[aria-label="任务运行状态"]'),'finished/stopped queue hides compact status');assert.equal(requests.filter(r=>r.path.startsWith('/api/task-records?')).length,recordsBeforeStop+1,'terminal queue refreshes visible execution history')
 await React.act(async()=>f.openTaskCenter('domestic'))
 const combo=account.querySelector('[aria-label="手动账号并发"]');await click(combo);await click([...document.querySelectorAll('[role=option]')].find(n=>n.textContent==='并发 2'))
 await click([...account.querySelectorAll('button')].find(b=>b.textContent==='仅领取奖励'));assert.deepEqual(requests.findLast(r=>r.path==='/api/growth-tasks/run').body,{taskKind:'growth',mode:'claim',concurrency:2,accountId:'domestic'})
 await click([...account.querySelectorAll('button')].find(b=>b.textContent==='停止后续步骤'))
 await click([...account.querySelectorAll('button')].find(b=>b.textContent==='更多操作'));assert.deepEqual([...document.querySelectorAll('[role=menuitem]')].map(n=>n.textContent),['账号任务详情','使用补签卡补昨日','抽奖一次'])
 await click([...document.querySelectorAll('[role=menuitem]')].find(n=>n.textContent==='使用补签卡补昨日'));assert.deepEqual(requests.findLast(r=>r.path==='/api/growth-tasks/rewards').body,{accountId:'domestic',action:'makeup'})
 await click([...account.querySelectorAll('button')].find(b=>b.textContent==='保存时刻'));assert.deepEqual(saved.map(r=>r.body),[{growthTime:'11:20'}],'saving a time never changes account scope or switches')
 // Querying must display the actual response without accepting, running or claiming anything.
 const postCount=requests.filter(r=>r.method==='POST').length
 const query=()=>[...account.querySelectorAll('button')].find(b=>b.textContent==='查询任务')
 await click(account.querySelector('[role=combobox][aria-label="账号范围"]'));await click([...document.querySelectorAll('[role=option]')].find(n=>n.textContent==='全部符合条件的账号'))
 await click(query());assert.equal(requests.at(-1).path,'/api/growth-tasks/scan')
 let result=account.querySelector('[aria-label="任务查询结果"]');assert.ok(result);assert.ok(result.textContent.includes('3 个账号 · 4 项任务 · 1 项可领取'));assert.ok(result.textContent.includes('fixture query failure'));assert.ok(result.textContent.includes('该账号没有返回成长任务'))
 const table=result.querySelector('table');assert.deepEqual([...table.querySelectorAll('thead th')].map(n=>n.textContent),['任务','进度','奖励','状态']);assert.ok(table.textContent.includes('积分 0'));assert.ok(table.textContent.includes('0 / 1'));assert.ok(table.textContent.includes('已领取'));assert.ok(table.textContent.includes('未解锁'));assert.ok(table.textContent.includes('可领取'));assert.ok(table.textContent.includes('未完成'));assert.ok(!table.querySelector('img'),'provider task labels render as text')
 const toggle=[...result.querySelectorAll('button')].find(b=>b.textContent==='展开／收起结果');await click(toggle);assert.equal(toggle.getAttribute('aria-expanded'),'false');await click(toggle);assert.equal(toggle.getAttribute('aria-expanded'),'true')
 await click([...result.querySelectorAll('button')].find(b=>b.textContent==='查看任务详情'));assert.ok(document.querySelector('[role=dialog]').textContent.includes('已达标任务'),'result links to correct account detail');await click([...document.querySelector('[role=dialog]').querySelectorAll('button')].find(b=>b.textContent==='关闭'))
 await React.act(async()=>f.openTaskCenter('domestic'));travelFails=true;const allQueries=requests.filter(r=>r.path==='/api/growth-tasks/scan').length;await click(query());assert.equal(requests.filter(r=>r.path==='/api/growth-tasks/scan').length,allQueries,'selected-account query never scans other accounts');assert.ok(account.querySelector('[aria-label="任务查询结果"]').textContent.includes('1 个账号 · 4 项任务'));assert.ok(account.textContent.includes('fixture travel error'),'optional travel failure keeps task results visible')
 await React.act(async()=>f.openTaskCenter('international'));assert.ok(query().disabled);assert.ok(!account.querySelector('[aria-label="任务查询结果"]'))
 await click(account.querySelector('[role=combobox][aria-label="账号范围"]'));await click([...document.querySelectorAll('[role=option]')].find(n=>n.textContent==='全部符合条件的账号'))
 let finishScan;scanDeferred=new Promise(resolve=>{finishScan=resolve});await click(query());assert.ok([...account.querySelectorAll('button')].some(b=>b.textContent==='查询中…'))
 await React.act(async()=>f.openTaskCenter('international'));await React.act(async()=>finishScan(scanReply));assert.ok(!account.querySelector('[aria-label="任务查询结果"]'),'late response from previous account scope is ignored');scanDeferred=null
 await click(account.querySelector('[role=combobox][aria-label="账号范围"]'));await click([...document.querySelectorAll('[role=option]')].find(n=>n.textContent==='全部符合条件的账号'))
 scanReply={scannedAt:1792000020000,results:[]};await click(query());assert.ok(account.textContent.includes('没有可查询的国内版账号'))
 assert.equal(requests.filter(r=>r.method==='POST').length,postCount,'querying and viewing results never execute tasks or claim rewards')
 const tags=fs.readFileSync(root+'/desktop-tauri/ui/js/tags-view.js','utf8'),app=fs.readFileSync(root+'/desktop-tauri/ui/app.js','utf8'),shell=fs.readFileSync(root+'/desktop-tauri/ui-islands/src/islands/shell-navigation.tsx','utf8')
 assert.ok(tags.includes("checkin: '任务中心'")&&tags.includes("tasks: '系统维护'"));assert.ok(app.includes("checkin: wbI18n.t('任务中心')")&&app.includes("tasks: wbI18n.t('系统维护')"));assert.ok(shell.includes("id: 'checkin', label: '任务中心'")&&shell.includes("id: 'tasks', label: '系统维护'"))
 console.log('PASS: actual task/sign-in pages, maintenance isolation, account deep links, retained drafts, both record views, pagination and stable page IDs; visible query results, scoped queries, zero values, error/empty/race handling, text safety and detail links; fixture-only action payloads, duplicate-run guards, compact running status, retained low-frequency actions and schedule saves')
}finally{if(React)await React.act(async()=>roots.forEach(r=>r.unmount()));dom.window.close();require('esbuild').stop();fs.rmSync(tmp,{recursive:true,force:true})}
// Existing page modules register legacy timers; the fixture process owns all of them.
process.exit(0)
