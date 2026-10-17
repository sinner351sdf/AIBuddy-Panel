// Render the real proxy page: group disclosure must preserve selection and row actions.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createRequire} from 'node:module'
const root=path.resolve(new URL('..',import.meta.url).pathname),islands=root+'/desktop-tauri/ui-islands'
const require=createRequire(islands+'/package.json'),{buildSync}=require('esbuild'),{JSDOM}=require('jsdom')
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'a2a-proxy-groups-'))
const dom=new JSDOM('<!doctype html><div id="fixture"></div>',{url:'http://localhost/'})
for(const key of ['window','document','HTMLElement','Element','Node','MouseEvent','KeyboardEvent','MutationObserver','HTMLButtonElement','localStorage']) globalThis[key]=dom.window[key]
Object.defineProperty(globalThis,'navigator',{configurable:true,value:dom.window.navigator})
globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window)
globalThis.requestAnimationFrame=callback=>setTimeout(callback,0)
globalThis.cancelAnimationFrame=clearTimeout
globalThis.IS_REACT_ACT_ENVIRONMENT=true
window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}})
window.wbI18n={t:(s,v={})=>s.replace(/\{(\w+)\}/g,(_,k)=>String(v[k]??`{${k}}`))}
window.workbuddyDesktop={getSubscriptions:async()=>({items:[],kernel:{installed:true,running:true,version:"fixture",listenerCount:0,download:{state:"idle",received:0,total:0}}})}
let mounted,React
try {
 const output=path.join(temp,'fixture.cjs')
 const source=fs.readFileSync(islands+'/src/islands/proxies-page.tsx','utf8')
 buildSync({stdin:{contents:source+"\nexport {ProxiesPage}; export {accept,togglePick,getSnapshot as poolSnapshot} from './proxies-state'; export {React,createRoot};",loader:'tsx',resolveDir:islands+'/src/islands'},bundle:true,platform:'node',format:'cjs',outfile:output,jsx:'automatic',alias:{'@ui':root+'/desktop-tauri/ui-kit/src',react:path.dirname(require.resolve('react/package.json')),'react-dom':path.dirname(require.resolve('react-dom/package.json'))},nodePaths:[islands+'/node_modules',root+'/desktop-tauri/ui-kit/node_modules'],logLevel:'silent'})
 const fixture=require(output);React=fixture.React
 const base={enabled:true,protocol:'http',host:'127.0.0.1',port:7897,resolveError:null,lastTest:null}
 const list=[{...base,id:'manual',name:'Manual fixture',source:'manual'},{...base,id:'clash',name:'Clash fixture',source:'clash'},{...base,id:'lazy',name:'Lazy fixture',source:'subscription',port:null,resolveError:'No listener',usedBy:[]},{...base,id:'waiting',name:'Waiting fixture',source:'subscription',port:null,usedBy:[{id:'a'}]},{...base,id:'orphan',name:'Orphan fixture',source:'subscription',port:null,orphan:true,resolveError:'Subscription removed'}]
 fixture.accept({items:list});fixture.togglePick('lazy',true)
 const host=document.getElementById('fixture');mounted=fixture.createRoot(host)
 await React.act(async()=>mounted.render(React.createElement(fixture.ProxiesPage)))
 const rowCount=()=>host.querySelectorAll('tr[data-id]').length
 const group=name=>host.querySelector(`button[aria-label="${name}"]`)
 const click=async el=>{assert.ok(el);await React.act(async()=>el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})))}
 assert.equal(rowCount(),5)
 assert.ok(host.querySelector('[data-id="lazy"]').textContent.includes('按需分配端口'))
 assert.ok(host.querySelector('[data-id="waiting"]').textContent.includes('等待分配端口'))
 assert.ok(host.querySelector('[data-id="orphan"]').textContent.includes('解析失败'),'orphan failures must not be disguised as on-demand ports')
 for(const [label,hidden] of [['订阅',3],['Clash Verge',1],['手动',1]]) {
  await click(group(`收起「${label}」分组`))
  assert.equal(rowCount(),5-hidden)
  assert.equal(group(`展开「${label}」分组`).getAttribute('aria-expanded'),'false')
  await click(group(`展开「${label}」分组`))
  assert.equal(rowCount(),5)
  assert.equal(group(`收起「${label}」分组`).getAttribute('aria-expanded'),'true')
 }
 assert.equal(fixture.poolSnapshot().selected.has('lazy'),true,'folding does not reset selected rows')
 const row=host.querySelector('[data-id="lazy"]')
 assert.equal(row.querySelector('[role="checkbox"]').getAttribute('aria-checked'),'true')
 assert.ok([...row.querySelectorAll('button')].some(el=>el.textContent==='测试'),'test action survives expansion')
 console.log('PASS: real proxy page folds every source independently, preserves selection/actions, and distinguishes on-demand, waiting and orphan addresses')
} finally {
 if(mounted&&React) await React.act(async()=>mounted.unmount())
 dom.window.close();fs.rmSync(temp,{recursive:true,force:true})
}
process.exit(0)
