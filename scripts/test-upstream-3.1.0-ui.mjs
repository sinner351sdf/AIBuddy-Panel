// Exercise real mobile Agent rendering/restore and desktop travel polling with backend-shaped fixtures.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {createRequire} from 'node:module'
const root=path.resolve(new URL('..',import.meta.url).pathname),islands=root+'/desktop-tauri/ui-islands'
const require=createRequire(islands+'/package.json'),{buildSync}=require('esbuild'),{JSDOM}=require('jsdom')
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'a2a-310-ui-')),dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'http://localhost/',pretendToBeVisual:true})
for(const key of ['window','document','HTMLElement','Element','Node','MouseEvent','KeyboardEvent','MutationObserver','HTMLButtonElement','HTMLInputElement','SVGElement','ShadowRoot','NodeFilter']) globalThis[key]=dom.window[key]
Object.defineProperty(globalThis,'navigator',{configurable:true,value:dom.window.navigator});globalThis.localStorage=dom.window.localStorage;globalThis.location=dom.window.location
window.wbI18n={t:(s,v={})=>s.replace(/\{(\w+)\}/g,(_,k)=>String(v[k]??`{${k}}`))};window.confirm=()=>true
window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}})
globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);globalThis.requestAnimationFrame=cb=>setTimeout(cb,0);globalThis.cancelAnimationFrame=clearTimeout;globalThis.IS_REACT_ACT_ENVIRONMENT=true
let reactRoot
try {
 const output=path.join(tmp,'fixture.cjs')
 buildSync({stdin:{contents:"export {AgentPage} from './desktop-tauri/mobile/src/pages/AgentPage'; export {HomePage} from './desktop-tauri/mobile/src/pages/HomePage'; export {store as mobileStore} from './desktop-tauri/mobile/src/state/store'; export * as travel from './desktop-tauri/ui-islands/src/islands/checkin-state'; export {act,createElement} from 'react'; export {createRoot} from 'react-dom/client';",resolveDir:root,loader:'tsx'},bundle:true,platform:'node',format:'cjs',outfile:output,jsx:'automatic',alias:{'@ui/navigation-icons':root+'/desktop-tauri/ui-kit/src/navigation-icons.ts','@ui':root+'/desktop-tauri/ui-kit/src/index.ts','@agent2api/ui':root+'/desktop-tauri/ui-kit/src/index.ts',react:path.dirname(require.resolve('react/package.json')),'react-dom':path.dirname(require.resolve('react-dom/package.json'))},nodePaths:[islands+'/node_modules',root+'/desktop-tauri/mobile/node_modules',root+'/desktop-tauri/ui-kit/node_modules'],logLevel:'silent'})
 const f=require(output),calls=[]
 const client={id:'codex',name:'ChatGPT',configPath:'~/.codex/config.toml',resolvedPath:'/fixture/.codex/config.toml',configMode:'single',installed:true,viaGateway:true,hasBackup:true}
 globalThis.fetch=async(url,init={})=>{calls.push({url,body:init.body?JSON.parse(init.body):null});return {status:200,ok:true,text:async()=>JSON.stringify({success:true,data:{clients:[client]}})}}
 reactRoot=f.createRoot(document.getElementById('root'))
 await f.act(async()=>{reactRoot.render(f.createElement(f.AgentPage));await new Promise(r=>setTimeout(r,0))})
 assert.ok(document.body.textContent.includes('~/.codex/config.toml'),'mobile shows the actual backend path')
 assert.ok(document.body.textContent.includes('已接管'),'mobile recognizes the backend viaGateway state')
 const restore=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='还原');assert.ok(restore,'backup restoration remains available')
 await f.act(async()=>{restore.dispatchEvent(new MouseEvent('click',{bubbles:true}));await new Promise(r=>setTimeout(r,0))})
 assert.deepEqual(calls.find(c=>c.url==='/api/agents/restore').body,{clientId:'codex'})
 await f.act(async()=>reactRoot.unmount());reactRoot=null
 // A successful login refreshes the session; homepage requests must rerun immediately.
 let authorized=false,homeRequests=0
 globalThis.fetch=async(url)=>{const session=String(url).includes('/api/session');if(!session)homeRequests++;const ok=authorized||session;return {status:ok?200:401,ok,text:async()=>JSON.stringify(ok?{success:true,data:session?{accounts:{accounts:[]}}:{daily:{todayEligible:0,todayDone:0,providers:[]},entries:[]}}:{success:false,error:'请先登录管理面板'})}}
 reactRoot=f.createRoot(document.getElementById('root'))
 await f.act(async()=>{reactRoot.render(f.createElement(f.HomePage));await new Promise(r=>setTimeout(r,30))})
 assert.ok(document.body.textContent.includes('请先登录管理面板'),'reproduce homepage pre-login failure')
 const beforeLogin=homeRequests;authorized=true
 await f.act(async()=>{await f.mobileStore.refresh(true);await new Promise(r=>setTimeout(r,30))})
 assert.ok(homeRequests>beforeLogin,'session refresh reloads homepage requests immediately')
 assert.ok(!document.body.textContent.includes('请先登录管理面板'),'login clears stale homepage errors without waiting for the minute timer')
 await f.act(async()=>reactRoot.unmount());reactRoot=null
 // Same source that the desktop travel button executes: wait for this batch, not another one.
 const notices=[];let polls=0
 window.wbApp={toast:message=>notices.push(message)}
 window.workbuddyDesktop={runTravelScheduleNow:async()=>({queued:1,batchId:'batch-1',summary:null}),getTravelSchedule:async batchId=>{assert.equal(batchId,'batch-1');polls++;if(polls===1){assert.ok(!notices.some(n=>n.includes('账号结果')),'never claim completion while pending');return {lastResult:{batchId:'other-batch',running:false,accounts:1,actions:[{}],credit:999,failed:0}}}return {lastResult:{batchId:'batch-1',running:false,accounts:1,actions:[{}],credit:null,failed:0}}}}
 await f.travel.runTravelScheduleNow();assert.equal(polls,2);assert.ok(notices.some(n=>n.includes('收益未声明')));assert.ok(!notices.some(n=>n.includes('999')||n.includes('+0')),'unknown/different-batch rewards are never fabricated')
 console.log('PASS: real mobile Agent path/status/restore and homepage login refresh contracts; travel batch polling waits for completion and preserves unknown rewards')
} finally {if(reactRoot) reactRoot.unmount();dom.window.close();fs.rmSync(tmp,{recursive:true,force:true})}
process.exit(0)
