// Run the actual production web shim against synthetic HTTP and storage only.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
const rust = readFileSync(new URL('../desktop-tauri/src-tauri/server/src/web_shim.rs', import.meta.url), 'utf8')
const source = rust.split('    r#"')[1].split('"#')[0]
const denied = { error: { type: 'panel_login_required', message: '请先登录管理面板' } }
const settle = () => new Promise(resolve => setImmediate(resolve))
function fixture(mode = 'body') {
  const storage = new Map([['agent2api.webKey','inference-key'],['agent2api-user','cached-admin'],['assistant-draft','keep draft'],['sidebar-layout','keep layout']])
  if (mode === 'body') storage.set('agent2api.panelAuth',JSON.stringify({access:'old-access',refresh:'old-refresh'}))
  const calls=[],redirects=[];let cookie='old-cookie',invalidated=0
  const window={location:{href:'http://fixture.test/',replace:target=>redirects.push(target)},wbAccountMenu:{invalidateSession(){invalidated++}}}
  const context=vm.createContext({window,URL,URLSearchParams,console,setTimeout,clearTimeout,setInterval,clearInterval,
    document:{getElementById(){throw Error('an upstream/auth denial must not ask for a gateway key')}},
    localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    fetch:(path,init={})=>new Promise((resolve,reject)=>calls.push({path,init,cookie,reject,respond(status,payload,nextCookie){if(nextCookie)cookie=nextCookie;resolve({status,ok:status>=200&&status<300,text:async()=>JSON.stringify(payload),json:async()=>payload})}})),
  })
  vm.runInContext(source,context)
  const request=path=>window.__TAURI_INTERNALS__.invoke('api_request',{request:{method:'GET',path}})
  const refreshes=()=>calls.filter(c=>c.path.startsWith('/api/panel/refresh'))
  const at=path=>calls.filter(c=>c.path===path)
  const success=()=>refreshes().at(-1).respond(200,{success:true,data:mode==='body'?{accessToken:'new-access',refreshToken:'new-refresh',expiresIn:7200}:{}},'new-cookie')
  return {storage,calls,redirects,request,refreshes,at,success,window,invalidated:()=>invalidated}
}
for(const mode of ['cookie','body']) {
 test(`${mode}: concurrent and late 401 responses share one refresh`,async()=>{
  const f=fixture(mode),paths=['/one','/two','/late'],results=Promise.all(paths.map(f.request))
  f.at('/one')[0].respond(401,denied);f.at('/two')[0].respond(401,denied);await settle()
  assert.equal(f.refreshes().length,1);assert.equal(f.refreshes()[0].init.headers['x-api-key'],undefined)
  assert.equal(f.refreshes()[0].init.headers['x-panel-refresh'],mode==='body'?'old-refresh':undefined)
  f.success();await settle()
  for(const path of paths.slice(0,2)){assert.equal(f.at(path)[1].cookie,'new-cookie');if(mode==='body')assert.equal(f.at(path)[1].init.headers['x-panel-token'],'new-access');f.at(path)[1].respond(200,{success:true,data:path})}
  f.at('/late')[0].respond(401,denied);await settle();assert.equal(f.refreshes().length,1);f.at('/late')[1].respond(200,{success:true,data:'/late'})
  assert.deepEqual(await results,paths);assert.deepEqual(f.redirects,[])
 })
 test(`${mode}: expired refresh logs out once and preserves user data`,async()=>{
  const f=fixture(mode),results=Promise.allSettled(['/one','/two','/late'].map(f.request))
  f.at('/one')[0].respond(401,denied);f.at('/two')[0].respond(401,denied);await settle();f.refreshes()[0].respond(401,denied);await settle()
  f.at('/late')[0].respond(401,denied);const finished=await results
  assert(finished.every(r=>r.status==='rejected'&&r.reason.type==='panel_login_required'));assert.equal(f.refreshes().length,1)
  assert.deepEqual(f.redirects,['/login?reason=session-expired']);assert.equal(f.invalidated(),1);assert(!f.storage.has('agent2api.panelAuth'));assert(!f.storage.has('agent2api-user'))
  assert.equal(f.storage.get('assistant-draft'),'keep draft');assert.equal(f.storage.get('sidebar-layout'),'keep layout');assert.equal(f.storage.get('agent2api.webKey'),'inference-key')
  const count=f.calls.length;await assert.rejects(f.request('/after'));assert.equal(f.calls.length,count)
  assert(!f.calls.some(c=>c.path==='/api/session/logout'),'never delete the provider account when signing out of the panel')
 })
 test(`${mode}: a second typed 401 after retry ends the session without a loop`,async()=>{
  const f=fixture(mode),result=f.request('/one');result.catch(()=>{});f.at('/one')[0].respond(401,denied);await settle();f.success();await settle();f.at('/one')[1].respond(401,denied)
  await assert.rejects(result);assert.equal(f.refreshes().length,1);assert.equal(f.redirects.length,1)
 })
 for(const failure of ['network',503])test(`${mode}: ${failure} during refresh does not log out`,async()=>{
  const f=fixture(mode),result=f.request('/one');result.catch(()=>{});f.at('/one')[0].respond(401,denied);await settle()
  if(failure==='network')f.refreshes()[0].reject(Error('offline'));else f.refreshes()[0].respond(503,{error:{message:'temporary'}})
  await assert.rejects(result,/暂时无法验证登录状态/);assert.equal(f.redirects.length,0);if(mode==='body')assert(f.storage.has('agent2api.panelAuth'))
  const retry=f.request('/retry');f.at('/retry')[0].respond(200,{data:'ok'});assert.equal(await retry,'ok')
 })
}
for(const [status,type]of [[403,'management_error'],[401,'upstream_error']])test(`${status} ${type} does not expire a valid panel session`,async()=>{
 const f=fixture(),result=f.request('/provider');result.catch(()=>{});f.at('/provider')[0].respond(status,{error:{type,message:'specific upstream or permission error'}})
 await assert.rejects(result,/specific upstream or permission error/);assert.equal(f.refreshes().length,0);assert.equal(f.redirects.length,0);assert(f.storage.has('agent2api.panelAuth'))
})
test('public status with a missing administrator triggers refresh before showing cached identity',async()=>{
 const f=fixture(),result=f.request('/api/panel/status');f.at('/api/panel/status')[0].respond(200,{success:true,data:{registered:true,username:null}});await settle();assert.equal(f.refreshes().length,1);f.success();await settle();f.at('/api/panel/status')[1].respond(200,{success:true,data:{registered:true,username:'admin'}});assert.equal((await result).username,'admin');assert.equal(f.redirects.length,0)
})
test('unregistered compatibility mode does not force a panel login',async()=>{
 const f=fixture(),result=f.request('/api/panel/status');f.at('/api/panel/status')[0].respond(200,{success:true,data:{registered:false,username:null}});assert.equal((await result).registered,false);assert.equal(f.refreshes().length,0);assert.equal(f.redirects.length,0)
})
