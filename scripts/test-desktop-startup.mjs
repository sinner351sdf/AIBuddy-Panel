import assert from 'node:assert/strict'
import fs from 'node:fs'
import {execFileSync} from 'node:child_process'
import {createRequire} from 'node:module'
import os from 'node:os'
import path from 'node:path'
import {stampDesktopAssets} from './stamp-desktop-assets.mjs'
const root=new URL('..',import.meta.url).pathname
const require=createRequire(root+'/desktop-tauri/ui-islands/package.json'),{JSDOM}=require('jsdom')
const source=fs.readFileSync(root+'/desktop-tauri/ui/js/desktop-startup.js','utf8')
const html=fs.readFileSync(root+'/desktop-tauri/ui/index.html','utf8')
assert(html.includes('<div id="shell-tags-host" class="tags-view"></div>'))
assert(html.indexOf('src="js/desktop-startup.js')<html.indexOf('css/tokens.css'))
assert(!fs.readFileSync(root+'/desktop-tauri/ui/m.html','utf8').includes('desktop-startup.js'))
{
 const early=new JSDOM('<html><head></head><body></body></html>',{url:'http://prefs.fixture.invalid',runScripts:'outside-only'})
 early.window.localStorage.setItem('aibuddy-prefs',JSON.stringify({contentWidth:'boxed',isTagsview:false,darkTopbar:true}))
 early.window.eval(fs.readFileSync(root+'/desktop-tauri/ui/js/prefs.js','utf8'))
 assert.equal(early.window.document.documentElement.getAttribute('data-pref-width'),'boxed')
 assert.equal(early.window.document.documentElement.getAttribute('data-pref-tags'),'off')
 assert.equal(early.window.document.documentElement.getAttribute('data-pref-topbar'),'dark')
 assert.equal(early.window.document.body.children.length,0,'visual preferences apply before the shell exists')
 early.window.close()
}
{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'a2a-asset-versions-'))
 try {
  fs.writeFileSync(path.join(temp,'app.js'),'current script');fs.writeFileSync(path.join(temp,'style.css'),'current styles')
  fs.writeFileSync(path.join(temp,'index.html'),'<link href="style.css"><script src="app.js?v=old"></script>')
  const inline=`<script>document.write('<script src="dynamic/'+locale+'.js">')</script>`
  fs.appendFileSync(path.join(temp,'index.html'),inline)
  const first=stampDesktopAssets(temp);assert(first.includes(inline),'dynamic dictionary loader stays untouched');assert(!first.includes('v=old'));assert.equal(stampDesktopAssets(temp),first,'versions reproduce byte-for-byte')
  fs.writeFileSync(path.join(temp,'style.css'),'new styles')
  const changed=stampDesktopAssets(temp);assert.notEqual(changed,first,'changed asset gets a new browser cache key')
  assert.equal(changed.match(/src="([^"]+)"/)[1],first.match(/src="([^"]+)"/)[1],'unchanged assets retain their cache key')
 } finally {fs.rmSync(temp,{recursive:true,force:true})}
}
const sidebar=html.match(/<!-- desktop-startup-sidebar:start -->([\s\S]*?)<!-- desktop-startup-sidebar:end -->/)[1]
const skeleton=html.match(/<!-- desktop-startup-skeleton:start -->([\s\S]*?)<!-- desktop-startup-skeleton:end -->/)[1]
{
 const doc=new JSDOM(sidebar+skeleton).window.document, status=doc.querySelector('[role=status]')
 assert.equal(doc.querySelectorAll('[role=status]').length,1)
 assert.equal(status.getAttribute('aria-live'),'polite')
 assert(status.querySelector('[aria-hidden=true] [data-slot=skeleton]'))
 assert(status.querySelector('[data-slot=card-header]'))
 assert(doc.querySelector('#desktop-startup-sidebar [data-slot=skeleton]'))
 assert.equal(doc.querySelector('#desktop-startup-sidebar').getAttribute('aria-hidden'),'true')
 assert.equal(doc.querySelectorAll('#desktop-startup-sidebar .startup-sidebar-group').length,4)
 assert.equal(status.querySelectorAll('button,input,a,select,[tabindex]').length,0,'placeholders do not create fake interactive controls')
 assert.deepEqual([...status.querySelectorAll('[data-startup-layout]')].map(n=>n.dataset.startupLayout),['report','table','form','chat'])
 execFileSync(process.execPath,[root+'/scripts/build-desktop-startup-skeleton.mjs'])
 assert.equal(fs.readFileSync(root+'/desktop-tauri/ui/index.html','utf8'),html,'shared component pre-render is deterministic and idempotent')
}
async function fixture(page='overview',tags=true){
 const dom=new JSDOM(`<html ${tags?'':'data-pref-tags="off"'}><head></head><body>${sidebar}<main><div id="shell-tags-host"></div><div class="content">${skeleton}<div class="content-inner"><section class="page active" data-page="${page}"></section></div></div></main></body></html>`,{url:'http://startup.fixture.invalid',runScripts:'outside-only'})
 const w=dom.window,frames=new Map(),timers=new Map();let id=0
 w.requestAnimationFrame=cb=>{frames.set(++id,cb);return id};w.cancelAnimationFrame=id=>frames.delete(id)
 w.setTimeout=cb=>{timers.set(++id,cb);return id};w.clearTimeout=id=>timers.delete(id)
 w.localStorage.setItem('workbuddy-desktop-page',page)
 w.eval(source);w.document.dispatchEvent(new w.Event('DOMContentLoaded'))
 async function tick(){await Promise.resolve();for(const [id,cb]of [...frames]){frames.delete(id);cb()}await Promise.resolve()}
 const doc=w.document,root=doc.documentElement,body=doc.body,active=doc.querySelector('.page.active')
 const waiting=()=>root.hasAttribute('data-desktop-startup')
 const append=(parent,markup)=>parent.insertAdjacentHTML('beforeend',markup)
 return {dom,doc,root,active,body,tick,timers,waiting,append}
}
function addChrome(f, breadcrumb='Current page') {
 const page=f.active.getAttribute('data-page')
 const controls=['shell-sidebar-trigger','shell-btn-fullscreen','nc-btn-bell','pref-btn-link','pref-btn-theme','pref-btn-prefs']
 f.append(f.body, '<header class="topbar">'+controls.map(id=>`<button id="${id}">${id}</button>`).join('')+'</header>')
 f.append(f.body,`<nav id="nav"><button class="nav-item active" data-page="${page}"><span class="label">Current page</span></button></nav><div id="shell-breadcrumb"><span data-slot="breadcrumb-page">${breadcrumb}</span></div>`)
 const list=f.doc.querySelector('#shell-tags-host [role=tablist]')
 if(list)f.append(list,`<div data-page="${page}"><button role="tab" aria-selected="true">Current page</button></div>`)
}
{
 const f=await fixture();assert.equal(f.root.dataset.desktopStartupLayout,'report');await f.tick();assert(f.waiting(),'an empty first frame stays in a single loading state')
 f.append(f.active,'<section class="panel">initial loading</section>');f.append(f.body,'<button id="pref-btn-search">Search</button>');f.append(f.doc.getElementById('shell-tags-host'),'<div role="tablist">Tabs</div>');await f.tick();assert(f.waiting(),'partial report cards do not flash before first data settles')
 f.active.dataset.initialReady='true';await f.tick();assert(f.waiting(),'wait for the welcome portal in the same visible first frame')
 f.append(f.active,'<h2 id="welcome-banner-title">Welcome</h2>');await f.tick();assert(f.waiting(),'a settled report cannot expose an incomplete topbar')
 addChrome(f,'Old route');await f.tick();assert(f.waiting(),'breadcrumb must synchronize with the restored navigation before first paint')
 f.doc.querySelector('[data-slot="breadcrumb-page"]').textContent='Current page';await f.tick();assert(!f.waiting());assert(!f.root.hasAttribute('data-desktop-startup-layout'));assert.equal(f.doc.querySelector('.content').getAttribute('aria-busy'),'false');assert.equal(f.timers.size,0,'ready content releases immediately and cancels the fallback')
 f.active.dataset.initialReady='false';await f.tick();assert(!f.waiting(),'subsequent refreshes never re-hide a usable page');f.doc.getElementById('nc-btn-bell').remove();await f.tick();assert(!f.waiting(),'later header updates never restart the initial loading gate');f.dom.window.close()
}
for(const tags of [true,false]){
 const f=await fixture('settings',tags);assert.equal(f.root.dataset.desktopStartupLayout,'form');f.append(f.active,'<section>Settings fields</section>');f.append(f.body,'<button id="pref-btn-search">Search</button>');if(tags)f.append(f.doc.getElementById('shell-tags-host'),'<div role="tablist">Tabs</div>');addChrome(f);await f.tick();assert(!f.waiting(),'saved non-report pages and hidden tabs do not wait for report data');f.dom.window.close()
}
{
 const f=await fixture('settings');f.dom.window.innerWidth=900
 f.append(f.active,'<section>Settings</section>');f.append(f.body,'<button id="pref-btn-search">Search</button><span id="crumb-page">Current page</span>')
 f.append(f.doc.getElementById('shell-tags-host'),'<div role="tablist">Tabs</div>');addChrome(f);f.doc.getElementById('nav').remove()
 await f.tick();assert(!f.waiting(),'closed Sidebar Sheet at a narrow viewport has no navigation DOM and still releases promptly');f.dom.window.close()
}
{
 const f=await fixture();for(const callback of [...f.timers.values()])callback();assert(!f.waiting(),'a failed island cannot indefinitely hide available content');f.dom.window.close()
}
for(const [page,layout] of [['accounts','table'],['assistant','chat']]) { const f=await fixture(page);assert.equal(f.root.dataset.desktopStartupLayout,layout);f.dom.window.close() }
console.log('PASS: static shared Skeleton/Card pre-render, route layouts, accessibility, deterministic generation; one initial desktop loading state, settled report/banner/full toolbar/breadcrumb/tabs readiness, saved routes, hidden tabs, immediate release, no refresh re-hide and failure fallback; dedicated mobile entry unaffected')
