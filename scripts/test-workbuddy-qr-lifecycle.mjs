#!/usr/bin/env node
// Execute the real QR component's effect with deterministic hooks and transport.
import { cn } from './ui-fixture-utils.mjs'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import assert from 'node:assert/strict'
const require = createRequire(new URL('../desktop-tauri/ui-islands/package.json', import.meta.url))
const ts = require('typescript')
const source = readFileSync(new URL('../desktop-tauri/ui-islands/src/islands/workbuddy-qr-login.tsx', import.meta.url), 'utf8')
const js = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022}}).outputText
const flush = async () => { for(let i=0;i<20;i++) await Promise.resolve() }
const deferred = () => { let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve} }
let slots=[],cursor=0,effects=[],pending=[],tree,refreshes=0,requests=[],starts=[],cancelGate=null
let waitResponse={pending:true,phase:'waiting'}
const hooks={
  useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value}]},
  useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i]},
  useEffect(effect,deps){const i=cursor++;if(!effects[i] || deps.some((v,n)=>v!==effects[i].deps[n])) pending.push(()=>{effects[i]?.cleanup?.();effects[i]={deps,cleanup:effect()}})},
  createElement(type,props,...children){return {type,props:props||{},children:children.flat()}}
}
const exports={}
vm.runInNewContext(js,{exports,require(name){if(name==='react')return hooks;if(name==='qrcode')return {toDataURL:async value=>'image:'+value};if(name==='@ui')return {Button:'button',cn};if(name==='../i18n')return {t:v=>v};if(name==='./add-account-bridge')return {shared:()=>({wbApp:{refresh:async()=>refreshes++}}),closeAddModals:()=>{}};if(name==='./task-center-api')return {taskRequest:async(method,path,body)=>{requests.push({method,path,body});if(path.endsWith('/start')){const d=deferred();starts.push(d);return d.promise}if(path.endsWith('/cancel'))return cancelGate?cancelGate.promise:{canceled:true};if(path.includes('/wait'))return waitResponse;throw new Error(path)}};throw new Error(name)},setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},Date,URL,window:{addEventListener(){},removeEventListener(){}},document:{hidden:false,addEventListener(){},removeEventListener(){}}})
function render(edition='cn',active=true){cursor=0;pending=[];tree=exports.WorkbuddyQrLogin({edition,active});for(const effect of pending)effect();return tree}
function buttons(node,text){if(!node||typeof node!=='object')return [];return [...(node.type==='button'&&node.children.includes(text)?[node]:[]),...node.children.flatMap(child=>buttons(child,text))]}
function nodes(node,predicate){if(!node||typeof node!=='object')return [];return [...(predicate(node)?[node]:[]),...node.children.flatMap(child=>nodes(child,predicate))]}
function textContent(node){if(node==null||typeof node==='boolean')return '';if(typeof node!=='object')return String(node);return node.children.map(textContent).join('')}
function phase(){return slots[1]}
function startValue(state){return {state,authUrl:'https://example.test/auth?state='+state,expiresAt:Date.now()+300000}}
// A slow start from the old edition must be cancelled and cannot replace intl QR.
render('cn');render('intl');starts[1].resolve(startValue('intl-new'));await flush();assert.equal(slots[3].state,'intl-new');starts[0].resolve(startValue('cn-old'));await flush();assert.equal(slots[3].state,'intl-new');assert(requests.some(r=>r.path.endsWith('/cancel')&&r.body.state==='cn-old'))
// Old cleanup finds a saved login while the new round is waiting: no success overwrite.
cancelGate=deferred();waitResponse={done:true,session:{nickname:'old saved account'}};render('cn');starts[2].resolve(startValue('cn-new'));waitResponse={pending:true};await flush();assert.equal(phase(),'waiting');waitResponse={done:true,session:{nickname:'old saved account'}};cancelGate.resolve({canceled:false});await flush();assert.equal(phase(),'waiting');assert.equal(slots[5],undefined);assert.equal(refreshes,0)
// Explicit successful poll on a current generation is presented and never auto-starts again.
waitResponse={done:true,session:{nickname:'current account',accountId:'user-current'}};cancelGate=null;render('intl');starts[3].resolve(startValue('intl-success'));await flush();assert.equal(phase(),'success');assert.equal(slots[5].nickname,'current account');assert.equal(starts.length,4);assert.equal(refreshes,1)
// Continue adding is explicit. Closing before slow start returns cancels that state.
render('intl');const continueButton=buttons(tree,'继续添加')[0];assert(continueButton);continueButton.props.onClick();waitResponse={pending:true};render('intl');assert.equal(starts.length,5);render('intl',false);starts[4].resolve(startValue('closed-slow'));await flush();assert(requests.some(r=>r.path.endsWith('/cancel')&&r.body.state==='closed-slow'))
for(const effect of effects)effect?.cleanup?.()

// Mixed-version servers can omit expiry or return strings/Unix seconds.
assert.equal(typeof exports.normalizeLoginStart,'function','expiry compatibility helper is exported for regression checks')
const normalizedNow=1800000000000
const loginIdentity={state:'expiry-case',authUrl:'https://example.test/auth?state=expiry-case'}
for(const [label,value,expected] of [
  ['milliseconds',normalizedNow+60000,normalizedNow+60000],
  ['millisecond string',String(normalizedNow+60000),normalizedNow+60000],
  ['Unix seconds',(normalizedNow+60000)/1000,normalizedNow+60000],
  ['Unix second string',String((normalizedNow+60000)/1000),normalizedNow+60000],
  ['ISO date',new Date(normalizedNow+60000).toISOString(),normalizedNow+60000],
  ['expired milliseconds',normalizedNow-60000,normalizedNow-60000],
  ['expired Unix seconds',(normalizedNow-60000)/1000,normalizedNow-60000],
  ['missing',undefined,normalizedNow+300000],
  ['null',null,normalizedNow+300000],
  ['empty','',normalizedNow+300000],
  ['whitespace','   ',normalizedNow+300000],
  ['invalid string','not-a-date',normalizedNow+300000],
  ['invalid date','2026-99-99T00:00:00Z',normalizedNow+300000],
  ['NaN',NaN,normalizedNow+300000],
  ['infinity',Infinity,normalizedNow+300000],
  ['zero',0,normalizedNow+300000],
  ['zero numeric string','0',normalizedNow+300000],
  ['negative',-1,normalizedNow+300000],
  ['non-positive numeric string','-1',normalizedNow+300000],
  ['boolean',true,normalizedNow+300000],
  ['object',{},normalizedNow+300000],
]) {
  const result=exports.normalizeLoginStart({...loginIdentity,expiresAt:value},normalizedNow)
  assert.equal(result.state,loginIdentity.state,label+' retains state')
  assert.equal(result.authUrl,loginIdentity.authUrl,label+' retains authorization URL')
  assert.equal(result.expiresAt,expected,label+' normalizes expiry to milliseconds')
}

// Render a real old-server response: the visible URL must be an actual link,
// and the accessible countdown must stay numeric when expiresAt is absent.
slots=[];cursor=0;effects=[];pending=[];starts=[];requests=[];cancelGate=null;waitResponse={pending:true,phase:'waiting'}
render('cn')
const oldServerLogin={state:'old-server-no-expiry',authUrl:'https://example.test/login?platform=CLI&state=old-server-no-expiry'}
const beforeStart=Date.now();starts[0].resolve(oldServerLogin);await flush();render('cn')
const urlLink=nodes(tree,node=>node.type==='a'&&node.props.href===oldServerLogin.authUrl)[0]
assert(urlLink,'authorization URL is clickable')
assert(textContent(urlLink).includes(oldServerLogin.authUrl),'authorization link displays the actual URL text')
const countdown=nodes(tree,node=>node.props['aria-label']==='剩余有效时间')[0]
assert(countdown,'remaining lifetime has a stable accessible label')
assert.match(textContent(countdown),/\b\d{1,2}:\d{2}\b/,'countdown displays minutes and padded seconds')
assert(!textContent(tree).includes('NaN'),'missing expiresAt must never render NaN')
assert(slots[3].expiresAt>=beforeStart+300000&&slots[3].expiresAt<=Date.now()+300000,'missing expiry gets a five-minute fallback from authorization arrival')
for(const effect of effects)effect?.cleanup?.()
console.log('PASS: real QR effects isolate editions, late starts, cleanup/save races, continuation and closing; expiry formats and fallback keep a numeric countdown and visible authorization link')
