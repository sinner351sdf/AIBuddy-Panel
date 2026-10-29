#!/usr/bin/env node
// Synthetic protocol-1 stateful classification. No HTTP or provider credentials.
import assert from 'node:assert/strict'
import {spawn,execFileSync} from 'node:child_process'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
const args=process.argv.slice(2),position=args.indexOf('--binary')
assert(position>=0&&args[position+1],'Explicit --binary is required')
const binary=path.resolve(args[position+1])
const build=JSON.parse(execFileSync(binary,['--build-info'],{encoding:'utf8'}))
assert.equal(build.id,'aibuddy-providers');assert.equal(build.protocol,1)
const data=mkdtempSync(path.join(tmpdir(),'aibuddy-stateful-rpc-'))
const child=spawn(binary,[],{env:{...process.env,AIBUDDY_VALIDATION_MODE:'1'},stdio:['pipe','pipe','pipe']})
const pending=new Map();let serial=0,buffer='',passed=0
child.stdout.setEncoding('utf8')
child.stdout.on('data',chunk=>{buffer+=chunk;let newline;while((newline=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);if(!line)continue;const frame=JSON.parse(line),p=pending.get(frame.id);if(!p)continue;if(frame.result!==undefined||frame.error){pending.delete(frame.id);clearTimeout(p.timer);frame.error?p.reject(new Error(JSON.stringify(frame.error))):p.resolve(frame.result)}}})
child.on('exit',()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('plugin exited before reply'))}pending.clear()})
const call=(method,params)=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(new Error(`RPC timeout: ${method}`))},5000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,method,params})+'\n')})
const classify=(provider,error)=>call('classify_conversation',{provider,error})
const check=(condition,label)=>{assert(condition,label);passed++;console.log(`PASS ${label}`)}
try {
 const list=await call('init',{env:{data_dir:data,host_version:'fixture',target:build.target,proxy:'',debug_traffic:false}})
 assert(list.some(p=>p.id==='codearts')&&list.some(p=>p.id==='accio'))
 let result=await classify('codearts',{status:403,message:'permission denied',upstreamCode:123})
 check(result.kind==='fatal'&&result.status===403&&result.upstream_code===123,'CodeArts permission403 remains fatal')
 result=await classify('codearts',{status:403,message:'Insufficient quota in daily benefit pool'})
 check(result.kind==='quota_limited'&&result.status===403&&result.reset_at>Date.now()&&new Date(result.reset_at+8*3600e3).getUTCHours()===0,'CodeArts daily pool restores next Beijing midnight')
 result=await classify('codearts',{status:429,message:'rate limit'})
 check(result.kind==='quota_limited'&&result.reset_at===null,'CodeArts minute limit does not receive daily cooldown')
 result=await classify('accio',{status:429,message:'fixture quota',code:'accio_quota',upstream_code:429})
 check(result.kind==='quota_limited'&&result.status===429&&result.upstream_code===429,'Accio quota classification and snake_case alias survive RPC')
 result=await classify('accio',{status:401,message:'fixture auth',code:'accio_auth'})
 check(result.kind==='token_expired','Accio explicit auth error requests refresh')
 result=await classify('accio',{status:403,message:'restricted rate limit',code:'accio_account_restricted',details:{error_metadata:{retryable:false,replay_safe:false}}})
 check(result.kind==='fatal'&&result.status===403,'Accio restricted session is never quota by message')
 result=await classify('workbuddy',{status:403,message:'provider-specific permission',upstreamCode:999})
 check(result.kind==='fatal'&&result.status===403&&result.upstream_code===999,'unoverridden provider uses fatal default')
 console.log(`Stateful conversation classification ${passed}/7 passed`)
} finally {
 child.stdin.end();await new Promise(resolve=>{const timeout=setTimeout(()=>{child.kill();resolve()},500);child.once('exit',()=>{clearTimeout(timeout);resolve()})});rmSync(data,{recursive:true,force:true})
}
