import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
const root=path.resolve(new URL('..',import.meta.url).pathname),islands=root+'/desktop-tauri/ui-islands',require=createRequire(islands+'/package.json')
const {build}=require('esbuild'),{JSDOM}=require('jsdom'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'a2a-307-ui-'))
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
let keepalive={models:['hy3'],defaultModels:['hy3'],webConversationEnabled:false},pending,fail=false;const saved=[],toasts=[]
window.wbApp={toast:message=>toasts.push(message)}
window.workbuddyDesktop={getCheckinCenter:async()=>({keepalive,auto:{enabled:false},extras:{onboarding:[]},providers:[]}),getCheckinSchedules:async()=>({enabled:false,schedules:[]}),setCheckinWebConversation:async enabled=>{saved.push(enabled);await new Promise(resolve=>pending=resolve);if(fail)throw Error('fixture failure');keepalive={...keepalive,webConversationEnabled:enabled};return keepalive},saveCheckinKeepalive:async models=>(keepalive={...keepalive,models})}
let rootNode,React,f
try {
 const output=path.join(tmp,'fixture.cjs')
 await build({stdin:{contents:`export {default as React} from 'react'; export {createRoot} from 'react-dom/client'; export {ScheduleTab} from './src/islands/checkin-schedule-tab';export {loadCheckinCenter,submitWebConversation,submitKeepaliveModels,setKeepaliveDraft,getCheckinStore} from './src/islands/checkin-state';export {matchesPresetName} from './src/islands/add-account-bridge'`,resolveDir:islands,loader:'tsx'},bundle:true,platform:'node',format:'cjs',outfile:output,jsx:'automatic',alias:{'@ui':root+'/desktop-tauri/ui-kit/src/index.ts',react:path.dirname(require.resolve('react/package.json')),'react-dom':path.dirname(require.resolve('react-dom/package.json'))},nodePaths:[islands+'/node_modules',root+'/desktop-tauri/ui-kit/node_modules'],logLevel:'silent'})
 f=require(output);React=f.React;rootNode=f.createRoot(document.getElementById('root'))
 await React.act(async()=>{await f.loadCheckinCenter();rootNode.render(React.createElement(f.ScheduleTab))})
 const control=()=>document.querySelector('[role=switch][aria-labelledby], [role=switch]#checkin-web-conversation, button[role=switch]')
 assert.ok(control());assert.equal(control().getAttribute('aria-checked'),'false')
 await React.act(async()=>control().click());assert.deepEqual(saved,[true]);assert.equal(control().getAttribute('aria-checked'),'false');assert.ok(control().hasAttribute('data-disabled'))
 await React.act(async()=>{f.setKeepaliveDraft(['draft-model']);pending()})
 assert.equal(control().getAttribute('aria-checked'),'true');assert.deepEqual(f.getCheckinStore().keepaliveDraft,['draft-model'],'switch must preserve draft chain')
 fail=true
 await React.act(async()=>control().click());await React.act(async()=>pending())
 assert.equal(control().getAttribute('aria-checked'),'true','failed save must preserve confirmed value');assert.ok(!control().hasAttribute('data-disabled'))
 await React.act(async()=>f.submitKeepaliveModels(['new-model']))
 assert.equal(f.getCheckinStore().snapshot.keepalive.webConversationEnabled,true,'legacy chain save must retain opt-in')
 window.wbPresetProviders={list:[{name:'Matched preset'}]}
 assert.equal(f.matchesPresetName({name:'Matched preset'}),true);assert.equal(f.matchesPresetName({name:'Renamed custom'}),false)
 console.log('PASS: real shadcn Switch opt-in, pending/failed save, draft retention, legacy chain updates and preset card deduplication; no network')
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
