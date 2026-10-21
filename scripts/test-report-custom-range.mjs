// Exercise the real report component's controlled dates and backend bridge args.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createRequire} from 'node:module'
import {MessageChannel as NodeMessageChannel} from 'node:worker_threads'
// React's browser Scheduler keeps MessagePorts alive in Node; close fixture channels.
const channels=[]
const originalMessageChannel=globalThis.MessageChannel
globalThis.MessageChannel=class extends NodeMessageChannel{constructor(){super();channels.push(this)}}
const root=path.resolve(new URL('..',import.meta.url).pathname)
const islands=path.join(root,'desktop-tauri/ui-islands')
const require=createRequire(path.join(islands,'package.json'))
const {buildSync}=require('esbuild'), {JSDOM}=require('jsdom')
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'a2a-report-range-'))
const dom=new JSDOM('<!doctype html><div id="fixture"></div>',{url:'http://localhost/'})
for(const key of ['window','document','HTMLElement','Element','Node','Event','MouseEvent','KeyboardEvent','MutationObserver','HTMLButtonElement','HTMLInputElement','SVGElement','ShadowRoot','NodeFilter'])globalThis[key]=dom.window[key]
Object.defineProperty(globalThis,'navigator',{configurable:true,value:dom.window.navigator})
globalThis.localStorage=dom.window.localStorage
globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window)
globalThis.requestAnimationFrame=callback=>setTimeout(callback,0)
globalThis.cancelAnimationFrame=clearTimeout
globalThis.IS_REACT_ACT_ENVIRONMENT=true
globalThis.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}}
window.ResizeObserver=globalThis.ResizeObserver
window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}})
window.Element.prototype.getAnimations=()=>[]
window.wbI18n={t:(text,vars={})=>text.replace(/\{(\w+)\}/g,(_,key)=>String(vars[key]??`{${key}}`))}
window.wbApp={toast(){}}
const calls=[];let fail=false
window.workbuddyDesktop={getScheduledTasks:async()=>({}), getStatsSummary:async(range,custom)=>{calls.push({range,custom});if(fail)throw new Error('fixture offline');return {range,overview:{requests:0,successful:0,tokens:0},days:[],hours:[],accounts:[],providers:[],models:[],cache:{}}}}
let mounted, React
try{
 const file=path.join(tmp,'fixture.cjs')
 buildSync({stdin:{contents:fs.readFileSync(path.join(islands,'src/islands/report-page.tsx'),'utf8')+'\nexport {React,createRoot};',loader:'tsx',resolveDir:path.join(islands,'src/islands')},bundle:true,platform:'node',format:'cjs',outfile:file,jsx:'automatic',alias:{'@ui':path.join(root,'desktop-tauri/ui-kit/src/index.ts'),react:path.dirname(require.resolve('react/package.json')),'react-dom':path.dirname(require.resolve('react-dom/package.json'))},nodePaths:[path.join(islands,'node_modules'),path.join(root,'desktop-tauri/ui-kit/node_modules')],logLevel:'silent'})
 const fixture=require(file); React=fixture.React; mounted=fixture.createRoot(document.getElementById('fixture'));
 await React.act(async()=>mounted.render(React.createElement(fixture.ReportPage)))
 const click=async(text)=>React.act(async()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);assert.ok(b,text+' missing');b.dispatchEvent(new MouseEvent('click',{bubbles:true}))})
 await click('自定义')
 const set=async(id,value)=>React.act(async()=>{const input=document.getElementById(id);Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))})
 await set('report-custom-start','2026-10-01');await set('report-custom-end','2026-10-02')
 assert.equal(document.getElementById('report-custom-start').value,'2026-10-01')
 assert.equal(document.getElementById('report-custom-end').value,'2026-10-02')
 await click('应用')
 assert.deepEqual(calls.at(-1),{range:'custom',custom:{start:'2026-10-01',end:'2026-10-02'}})
 assert.equal(document.getElementById('report-custom-start').value,'2026-10-01')
 await set('report-custom-start','2026-10-03')
 assert.equal([...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='应用').disabled,true)
 const previousSummary=window.wbReport.lastSummary()
 fail=true
 await React.act(async()=>{await window.wbReport.load({silent:true})})
 assert.equal(window.wbReport.lastSummary(),previousSummary,'same-range refresh failures preserve settled data')
 assert(document.querySelector('[role=alert]')?.textContent.includes('fixture offline'),'retained data carries a visible refresh error')
 await set('report-custom-end','2026-10-04');await click('应用')
 assert.equal(window.wbReport.lastSummary(),null,'a different failed date range must never display data from the preceding range')
 console.log('PASS: real report dates update, bridge args, persistence, invalid-range guard, same-range refresh retention and failed-range data isolation')
}finally{if(mounted)await React.act(async()=>mounted.unmount());dom.window.close();for(const channel of channels){channel.port1.close();channel.port2.close()}globalThis.MessageChannel=originalMessageChannel;require('esbuild').stop();fs.rmSync(tmp,{recursive:true,force:true})}
