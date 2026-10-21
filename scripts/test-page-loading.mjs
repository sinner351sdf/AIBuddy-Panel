import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createRequire} from 'node:module'
const root=new URL('..',import.meta.url).pathname
const require=createRequire(root+'/desktop-tauri/ui-islands/package.json'),{JSDOM}=require('jsdom')
const entry=fs.readFileSync(root+'/desktop-tauri/ui/index.html','utf8')
const source=fs.readFileSync(root+'/desktop-tauri/ui/js/page-loading.js','utf8')
const dom=new JSDOM(entry,{url:'http://navigation.fixture.invalid',runScripts:'outside-only'})
const w=dom.window,doc=w.document,timers=new Map();let timerId=0
w.setTimeout=callback=>{timers.set(++timerId,callback);return timerId};w.clearTimeout=id=>timers.delete(id)
w.eval(source);doc.dispatchEvent(new w.Event('DOMContentLoaded'))
const tick=async()=>{await Promise.resolve();await Promise.resolve()}
const section=page=>doc.querySelector(`.page[data-page="${page}"]`)
const overlay=()=>doc.getElementById('page-transition-skeleton')
function navigate(page){for(const el of doc.querySelectorAll('.page'))el.classList.toggle('active',el.dataset.page===page);w.wbPageLoading.sync()}
const layouts={overview:'report',credits:'report',agent:'form',settings:'form',assistant:'chat',docs:'form',accounts:'table',checkin:'table',gateway:'table',proxies:'table',keys:'table',logs:'table',tasks:'table',requests:'table'}
for(const [page,layout]of Object.entries(layouts)){
 navigate(page)
 assert.equal(overlay().hidden,false,`${page}: first navigation shows a real skeleton`)
 assert(overlay().querySelector('[data-slot=skeleton]'),page)
 assert.equal(overlay().firstElementChild.dataset.startupLayout,layout)
 assert(section(page).hasAttribute('inert'),`${page}: concealed controls cannot receive keyboard input`)
 section(page).dataset.pageReady='true';await tick()
 assert(overlay().hidden,`${page}: committed data or error releases immediately`)
 assert(!section(page).hasAttribute('inert'))
 assert.equal(section(page).getAttribute('aria-busy'),'false')
 assert.equal(doc.documentElement.hasAttribute('data-desktop-startup'),false,'navigation never restarts the full shell loading gate')
}
// A page refresh must not clear existing content, lose a draft or restart the skeleton.
const account=section('accounts'),draft=doc.createElement('input');draft.value='unfinished edit';account.append(draft)
account.dataset.pageReady='false';navigate('accounts');await tick();assert(overlay().hidden);assert.equal(draft.value,'unfinished edit')
// Recreated pages represent a new initial request. A late response from A cannot conceal B.
for(const page of ['accounts','keys']){const old=section(page),fresh=old.cloneNode(false);fresh.dataset.pageReady='false';old.replaceWith(fresh)}
navigate('accounts');const lateTimeout=[...timers.values()][0];navigate('keys');section('accounts').dataset.pageReady='true';await tick();assert(!overlay().hidden);assert.equal(doc.documentElement.dataset.pageLoading,'keys');lateTimeout();assert(overlay().querySelector('[data-slot=skeleton]'))
// Slow or disconnected backends present a recoverable error instead of an endless skeleton.
let refreshed=0,renavigated=0;w.wbApp={refresh:()=>{refreshed++},showPage:()=>{renavigated++}}
for(const [id,callback] of [...timers]){timers.delete(id);callback()}
assert(overlay().querySelector('[data-slot=alert]'));overlay().querySelector('[data-loading-retry]').click();assert.equal(refreshed,1);assert.equal(renavigated,1);assert(overlay().querySelector('[data-slot=skeleton]'))
section('keys').dataset.pageReady='true';await tick();assert(overlay().hidden);assert.equal(timers.size,0)
// Each actual business page publishes its own committed readiness, independent of promise timing.
const files={overview:'report-page',credits:'credits-page',agent:'agent-page',settings:'settings-page',assistant:'assistant-page',docs:'docs-page',accounts:'accounts-page',checkin:'checkin-page',gateway:'models-page',proxies:'proxies-page',keys:'keys-page',logs:'logs-panel',tasks:'tasks-panel',requests:'requests-page'}
for(const [page,file]of Object.entries(files))assert(fs.readFileSync(root+`/desktop-tauri/ui-islands/src/islands/${file}.tsx`,'utf8').includes(`usePageReady('${page}',`),`${page}: readiness contract is wired`)
dom.window.close()
console.log('PASS: 14 navigation destinations, shared Skeleton layouts, committed readiness, cached refresh/draft retention, rapid navigation races, inert/aria cleanup, slow-load error and retry; no shell re-hide')
