// Execute the complete production web shim and login engine with fake HTTP/clock/DOM.
// No real provider calls, credentials or account writes.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
const require=createRequire(new URL('../desktop-tauri/ui-islands/package.json',import.meta.url))
const ts=require('typescript')
const modal=readFileSync(new URL('../desktop-tauri/ui-islands/src/islands/add-account-modal.tsx',import.meta.url),'utf8')
const modalAst=ts.createSourceFile('modal.tsx',modal,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
let backToPick
function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(modalAst)==='backToPick')backToPick=node.initializer;ts.forEachChild(node,visit)}
visit(modalAst)
assert.ok(backToPick,'load the actual nested-dialog close callback')
const rust=readFileSync(new URL('../desktop-tauri/src-tauri/server/src/web_shim.rs',import.meta.url),'utf8')
const shim=rust.split('    r#"')[1].split('"#')[0]
const engine=readFileSync(new URL('../desktop-tauri/ui/web-login.js',import.meta.url),'utf8')
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}
const flush=async()=>{for(let i=0;i<40;i++)await Promise.resolve()}
async function settled(promise){let done=false,value,error;promise.then(v=>{done=true;value=v},e=>{done=true;error=e});await flush();assert.ok(done,'login promise must settle without waiting for polling/timeout');if(error)throw error;return value}
class Element {
  constructor(tag){this.tag=tag;this.children=[];this.style={};this.hidden=true;this.disabled=false;this.events={}}
  appendChild(child){child.parent=this;this.children.push(child)}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this)}
  set innerHTML(value){this.html=value;this.children=[];if(value.includes('<input'))this.appendChild(new Element('input'))}
  get innerHTML(){return this.html||''}
  querySelector(selector){return this.children.find(c=>c.tag===selector)||null}
  addEventListener(name,fn){this.events[name]=fn}
  focus(){}
}
function fixture({blocked=false,mobile=false}={}){
  let now=0,id=0,stateId=0,successes=0,nextStart=null,nextWait=null
  const timers=new Map(),requests=[],popups=[],toasts=[]
  const body=new Element('body'),button=new Element('button'),cancel=new Element('button'),hint=new Element('span')
  button.id='qoder-web-button';cancel.id='qoder-web-cancel';hint.id='qoder-web-hint'
  body.appendChild(button);body.appendChild(cancel);body.appendChild(hint)
  const find=(node,key)=>node.id===key?node:node.children.map(c=>find(c,key)).find(Boolean)
  const doc={body,getElementById:key=>find(body,key)||null,createElement:tag=>new Element(tag)}
  const schedule=(fn,ms,interval=false)=>{const key=++id;timers.set(key,{fn,due:now+ms,ms,interval});return key}
  const win={location:{href:'http://fixture.test/'},wbApp:{toast:(...args)=>toasts.push(args)},wbProviders:{labelOf:id=>id},
    open(){if(blocked)return null;const popup={closed:false,location:{href:'about:blank'},close(){this.closed=true}};popups.push(popup);return popup}}
  const context=vm.createContext({window:win,document:doc,URL,console,
    Date:class extends Date{static now(){return now}},
    localStorage:{getItem:()=>null},
    setTimeout:(fn,ms)=>schedule(fn,ms),clearTimeout:key=>timers.delete(key),
    setInterval:(fn,ms)=>schedule(fn,ms,true),clearInterval:key=>timers.delete(key),
    fetch:async(path,options)=>{
      const request={path,method:options.method,body:options.body?JSON.parse(options.body):null};requests.push(request)
      let data={}
      if(path.endsWith('/login/start')){const plan=nextStart;nextStart=null;data=plan?await plan:{state:`state-${++stateId}`,authUrl:'https://login.example.test/device'}}
      else if(path.includes('/login/wait?')){const plan=nextWait;nextWait=null;data=plan?await plan:{done:false}}
      else if(path.endsWith('/login/cancel'))data={canceled:true}
      return {status:200,text:async()=>JSON.stringify({success:true,data})}
    },
    wbI18n:{t:(text,params={})=>text.replace(/\{(\w+)\}/g,(_,key)=>String(params[key]))},
    busy:false,releaseBusy(){context.busy=false},
    state:{provider:'qoder'},shared:()=>win,setState:action=>{context.state=action(context.state)},
  })
  if(mobile){delete context.busy;delete context.releaseBusy}
  vm.runInContext(shim,context)
  vm.runInContext(engine,context)
  const bridge=win.workbuddyDesktop
  const controller=win.wbWebLogin.create({provider:'qoder',buttonId:button.id,cancelId:cancel.id,hintId:hint.id,
    texts:()=>({button:'打开 Qoder 网页登录',hint:'fixture'}),start:()=>bridge.startLogin('cn','external','qoder'),onSuccess:()=>{successes++}})
  vm.runInContext(ts.transpileModule('window.backToPick = '+backToPick.getText(modalAst),{
    compilerOptions:{target:ts.ScriptTarget.ES2022},
  }).outputText,context)
  async function advance(ms){const end=now+ms;await flush();while(true){const next=[...timers].filter(([,t])=>t.due<=end).sort((a,b)=>a[1].due-b[1].due)[0];if(!next)break;const [key,t]=next;now=t.due;if(t.interval)t.due+=t.ms;else timers.delete(key);t.fn();await flush()}now=end;await flush()}
  return {bridge,controller,button,cancel,popups,requests,toasts,context,advance,doc,
    start:()=>controller.start(),leaveForm:()=>win.backToPick(),setStart:plan=>{nextStart=plan},setWait:plan=>{nextWait=plan},
    successes:()=>successes,intervals:()=>[...timers.values()].filter(t=>t.interval).length,
    canceledStates:()=>requests.filter(r=>r.path.endsWith('/login/cancel')).map(r=>r.body.state)}
}

// Explicit cancel must release both the bridge promise and the UI busy lock; retry succeeds.
let f=fixture(),first=f.start();await flush();assert.equal(f.button.disabled,true)
await f.controller.cancel();await settled(first)
assert.equal(f.context.busy,false);assert.equal(f.button.disabled,false);assert.equal(f.cancel.hidden,true)
assert.deepEqual(f.canceledStates(),['state-1']);assert.equal(f.intervals(),0);assert.equal(f.successes(),0)
f.setWait(Promise.resolve({done:true,session:{account:'fixture-account'}}))
const second=f.start();await f.advance(3000);await settled(second)
assert.equal(f.popups.length,2);assert.equal(f.successes(),1);assert.equal(f.button.disabled,false)
assert.deepEqual(f.canceledStates(),['state-1'],'successful flow is not canceled')

// Closing the authorization window must cancel automatically and allow another open.
f=fixture();first=f.start();await flush();f.popups[0].close();await f.advance(500);await settled(first)
assert.equal(f.context.busy,false);assert.equal(f.button.disabled,false);assert.deepEqual(f.canceledStates(),['state-1'])
const reopened=f.start();await flush();assert.equal(f.popups.length,2);await f.controller.cancel();await settled(reopened)

// Nested form close keeps its DOM mounted; the actual close callback must cancel the flow.
f=fixture();first=f.start();await flush();f.leaveForm();await settled(first)
assert.equal(f.context.state.step,'pick');assert.equal(f.context.busy,false);assert.equal(f.button.disabled,false)
assert.deepEqual(f.canceledStates(),['state-1'])
const backAgain=f.start();await flush();assert.equal(f.popups.length,2);await f.controller.cancel();await settled(backAgain)

// Cancel while /start is pending; its late reply cancels only its own server task.
f=fixture();let delayed=deferred();f.setStart(delayed.promise);first=f.start();await flush()
await f.controller.cancel();await settled(first)
const current=f.start();await flush();delayed.resolve({state:'old-slow-start',authUrl:'https://login.example.test/old'});await flush()
assert.deepEqual(f.canceledStates(),['old-slow-start']);assert.equal((await f.bridge.getLoginState()).active,true)
assert.equal(f.popups[1].closed,false);assert.equal(f.button.disabled,true)
await f.controller.cancel();await settled(current)

// A /wait response arriving after cancel must not clear or report success for the new flow.
f=fixture();delayed=deferred();f.setWait(delayed.promise);first=f.start();await f.advance(3000)
await f.controller.cancel();await settled(first)
const newer=f.start();await flush();delayed.resolve({done:true,session:{account:'old'}});await flush()
assert.equal(f.successes(),0);assert.equal((await f.bridge.getLoginState()).active,true)
assert.equal(f.popups[1].closed,false);await f.controller.cancel();await settled(newer)
const count=f.requests.filter(r=>r.path.includes('/login/wait?')).length;await f.advance(9000)
assert.equal(f.requests.filter(r=>r.path.includes('/login/wait?')).length,count,'old polling stops')

// Start failure releases state and window; retry is still possible.
f=fixture();delayed=deferred();f.setStart(delayed.promise);first=f.start();await flush();delayed.reject(Error('fixture start failed'));await settled(first)
assert.equal(f.button.disabled,false);assert.equal(f.popups[0].closed,true);assert.equal(f.intervals(),0)
const retry=f.start();await flush();await f.controller.cancel();await settled(retry)

// Blocked popup/link fallback and manual callback overlays must also close on cancel.
f=fixture({blocked:true});first=f.start();await flush();assert.ok(f.doc.getElementById('a2a-web-overlay'))
await f.controller.cancel();await settled(first);assert.equal(f.doc.getElementById('a2a-web-overlay'),null)
f=fixture();first=f.bridge.startAutoclawOauthLogin('manual-state','https://login.example.test/oauth','external');await flush()
assert.ok(f.doc.getElementById('a2a-web-overlay'));await f.bridge.cancelLogin()
const result=await settled(first);assert.equal(result.ok,false);assert.equal(result.canceled,true)
assert.equal(f.doc.getElementById('a2a-web-overlay'),null);await f.advance(9000)
assert.equal(f.doc.getElementById('a2a-web-overlay'),null);assert.deepEqual(f.canceledStates(),['manual-state'])
// The mobile host intentionally has neither app.js busy nor releaseBusy.
for(const blocked of [false,true]) {
 const phone=fixture({mobile:true,blocked});let pending=phone.start();await flush()
 assert(phone.requests.some(r=>r.path.endsWith('/login/start')),'phone starts a real bridge request without desktop globals')
 assert.equal(phone.button.disabled,true);await settled(phone.start())
 assert.equal(phone.requests.filter(r=>r.path.endsWith('/login/start')).length,1,'phone duplicate clicks remain locked')
 await phone.controller.cancel();await settled(pending);assert.equal(phone.button.disabled,false)
 const failed=deferred();phone.setStart(failed.promise);pending=phone.start();await flush();failed.reject(Error('phone fixture unavailable'));await settled(pending)
 assert.equal(phone.button.disabled,false);assert(phone.toasts.some(t=>String(t[0]).includes('phone fixture unavailable')),'phone errors are visible and recoverable')
 phone.setWait(Promise.resolve({done:true,session:{account:'phone-fixture'}}));pending=phone.start();await phone.advance(3000);if(blocked){await phone.controller.cancel()}await settled(pending)
 assert.equal(typeof phone.context.busy,'undefined');assert.equal(typeof phone.context.releaseBusy,'undefined')
}
console.log('PASS: cancel/reopen, popup close, slow start, late poll isolation, success/failure, blocked popup and manual OAuth; desktop busy lock and standalone mobile lock released')
