// Regression: lazy subscription listeners and live-resolved Clash ports differ.
import assert from 'node:assert/strict'
import path from 'node:path'
import vm from 'node:vm'
import {createRequire} from 'node:module'
const root=path.resolve(new URL('..',import.meta.url).pathname)
const require=createRequire(path.join(root,'desktop-tauri/ui-islands/package.json'))
const {buildSync}=require('esbuild')
const output=buildSync({entryPoints:[path.join(root,'desktop-tauri/ui-islands/src/islands/proxies-state.ts')],bundle:true,write:false,platform:'node',format:'cjs',logLevel:'silent'})
const module={exports:{}}
vm.runInNewContext(output.outputFiles[0].text,{module,exports:module.exports,window:{wbI18n:{t:s=>s}},console})
const {poolItemStatus,isUnprovisionedItem}=module.exports
const lazy={source:'subscription',port:null,resolveError:'监听端口未分配',lastTest:{at:1,success:false}}
assert.equal(poolItemStatus(lazy),'wait','old failed tests must not classify an unallocated listener as broken')
assert.equal(isUnprovisionedItem(lazy),true)
assert.equal(poolItemStatus({...lazy,orphan:true}),'fail','missing subscriptions remain a real error')
assert.equal(isUnprovisionedItem({...lazy,orphan:true}),false)
assert.equal(poolItemStatus({source:'clash',port:null,resolved:{port:7897},lastTest:{at:1,success:true}}),'ok','Clash resolves its port dynamically')
assert.equal(poolItemStatus({source:'clash',port:null,resolveError:'listener removed',lastTest:{at:1,success:true}}),'fail')
assert.equal(poolItemStatus({...lazy,port:19101,resolveError:null,lastTest:null}),'none')
assert.equal(poolItemStatus({...lazy,port:19101,resolveError:null,lastTest:{at:1,success:true}}),'ok')
assert.equal(poolItemStatus({...lazy,port:19101,resolveError:null}),'fail')
console.log('PASS: lazy listener readiness, orphan failures, live Clash resolution and test states')
