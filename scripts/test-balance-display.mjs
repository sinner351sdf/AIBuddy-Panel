// Balance display model, actual row rendering and persisted whole-column preference.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
const require = createRequire(new URL('../desktop-tauri/ui-islands/package.json', import.meta.url))
const ts = require('typescript'), React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const file = name => readFileSync(new URL(`../desktop-tauri/ui-islands/src/islands/${name}`, import.meta.url), 'utf8')
const transpile = source => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
}).outputText
const model = {}
vm.runInNewContext(transpile(file('accounts-balance.ts')), { exports: model })
const rows = (entry, pool = null) => JSON.parse(JSON.stringify(model.balanceDisplayRows(entry, pool)))
const accio = {available:null, unit:'%', subscription:{remainQuota:698,totalQuota:700}}
assert.deepEqual(rows(accio,{text:'剩余 100%',valueText:'100%',percent:100}),[
  {key:'cycle',text:'100%',percent:100},
  {key:'subscription',text:'698 / 700',percent:698/700*100},
])
assert.equal(rows({totalLeft:7068})[0].text,'7068')
assert.equal(rows({available:9598,unit:'积分'})[0].text,'9598')
assert.equal(rows({available:0,unit:'积分'})[0].text,'0')
assert.equal(rows({totalLeft:0,unlimited:true})[0].text,'∞')
assert.equal(rows({available:null})[0].percent,null)
assert.equal(rows({available:0,unit:'%'})[0].percent,0)
assert.equal(rows({unit:'%',subscription:{remainQuota:0,totalQuota:700}})[1].text,'0 / 700')
assert.equal(rows({unit:'%',subscription:{remainQuota:5,totalQuota:0}})[1].percent,null)
assert.equal(rows({unit:'%',subscription:{remainQuota:null,totalQuota:700}}).length,1)
assert.equal(rows({unit:'%',subscription:{remainQuota:5,totalQuota:null}})[1].text,'5')
assert.equal(rows({unit:'积分',subscription:{remainQuota:5,totalQuota:700}}).length,1)
assert.equal(rows({available:' '})[0].text,'—')
assert.deepEqual(rows(null),[])
const src=file('accounts-panels.tsx')
const ast=ts.createSourceFile('accounts-panels.tsx',src,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
const rowFunction=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='BalanceRows')
const render={}
vm.runInNewContext(transpile(`${rowFunction.getText(ast)}\nexport { BalanceRows };`),{
  exports:render,React,
  t:message=>message,
  Progress:props=>React.createElement('progress',{value:props.value,max:100,'aria-label':props['aria-label']}),
})
const data=rows(accio,{text:'剩余 100%',valueText:'100%',percent:100})
const numbers=renderToStaticMarkup(React.createElement(render.BalanceRows,{rows:data,bars:false,tone:'ok'}))
assert.ok(numbers.includes('698 / 700')&&numbers.includes('100%'))
assert.ok(!numbers.includes('<progress'))
const bars=renderToStaticMarkup(React.createElement(render.BalanceRows,{rows:data,bars:true,tone:'ok'}))
assert.equal((bars.match(/<progress/g)||[]).length,2)
const unknown=renderToStaticMarkup(React.createElement(render.BalanceRows,{rows:rows({available:9598}),bars:true,tone:'ok'}))
assert.ok(unknown.includes('balance-unknown-bar')&&unknown.includes('9598'))
assert.ok(!unknown.includes('<progress'))
const warning=renderToStaticMarkup(React.createElement(render.BalanceRows,{rows:data,bars:false,tone:'warn'}))
assert.equal((warning.match(/⚠/g)||[]).length,1)
assert.ok(warning.includes('余额数据不完整'))
const memory=new Map()
const localStorage={getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,value)}
function loadStore(storage=localStorage){
  const exports={}
  vm.runInNewContext(transpile(file('accounts-store.ts')),{
    exports,localStorage:storage,
    require:name=>name==='./accounts-shared'?{shared:()=>({})}:{},
  })
  return exports
}
const store=loadStore()
assert.equal(store.getStore().balanceBars,false)
let notifications=0
store.subscribe(()=>notifications++)
store.toggleBalanceBars()
assert.equal(store.getStore().balanceBars,true)
assert.equal(notifications,1)
assert.equal(loadStore().getStore().balanceBars,true)
store.toggleBalanceBars()
assert.equal(loadStore().getStore().balanceBars,false)
assert.equal(notifications,2)
const blocked=loadStore({getItem:()=>{throw Error('blocked')},setItem:()=>{throw Error('blocked')}})
blocked.toggleBalanceBars()
assert.equal(blocked.getStore().balanceBars,true)
console.log('PASS: balance model, separate cycle/subscription quotas, zero/unknown values, numeric/bar rendering and persisted store toggle')
