// Prefer numeric balances automatically; use bars only for percentage-only quotas.
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
  {key:'subscription',text:'698 credits',percent:698/700*100},
])
assert.equal(rows({totalLeft:7068})[0].text,'7068 积分')
assert.equal(rows({available:9598,unit:'积分'})[0].text,'9598 积分')
assert.equal(rows({available:0,unit:'积分'})[0].text,'0 积分')
assert.equal(rows({available:0,unit:'credits'})[0].text,'0 credits')
assert.equal(rows({available:282,unit:'credits'})[0].text,'282 credits')
assert.equal(rows({available:8000000,unit:'token',availableView:'800万 token'})[0].text,'800万 token')
assert.equal(rows({available:12,unit:'积分',availableView:'可用 12 积分'})[0].text,'12 积分')
assert.equal(rows({}, {text:'权益 1M token',valueText:'1M',unit:'token',percent:null})[0].text,'1M token')
assert.equal(rows({totalLeft:0,unlimited:true})[0].text,'∞ 积分')
assert.equal(rows({available:null})[0].percent,null)
assert.equal(rows({available:0,unit:'%'})[0].percent,0)
assert.equal(rows({unit:'%',subscription:{remainQuota:0,totalQuota:700}})[0].text,'0 credits')
assert.equal(rows({unit:'%',subscription:{remainQuota:5,totalQuota:0}})[0].percent,null)
assert.equal(rows({unit:'%',subscription:{remainQuota:null,totalQuota:700}}).length,1)
assert.equal(rows({unit:'%',subscription:{remainQuota:5,totalQuota:null}})[0].text,'5 credits')
assert.equal(rows({unit:'积分',subscription:{remainQuota:5,totalQuota:700}}).length,1)
assert.equal(rows({available:' '})[0].text,'—')
assert.deepEqual(rows(null),[])
const src=file('accounts-panels.tsx')
const ast=ts.createSourceFile('accounts-panels.tsx',src,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
const rowFunction=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='BalanceRows')
const detailFunctions=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&['usageDetailOf','numberOrNull','numberText'].includes(n.name?.text))
const render={}
vm.runInNewContext(transpile(`${rowFunction.getText(ast)}\n${detailFunctions.map(n=>n.getText(ast)).join('\n')}\nexport { BalanceRows, usageDetailOf };`),{
  exports:render,React,
  t:message=>message,
  compactNumber:String,flatMeterName:String,planBadgeLabel:String,isFreePlan:()=>false,
  Progress:props=>React.createElement('progress',{value:props.value,max:100,'aria-label':props['aria-label']}),
})
const data=rows(accio,{text:'剩余 100%',valueText:'100%',percent:100})
const numbers=renderToStaticMarkup(React.createElement(render.BalanceRows,{rows:data,bars:false,tone:'ok'}))
assert.ok(numbers.includes('698 credits')&&!numbers.includes('100%')&&!numbers.includes('700'))
assert.ok(!numbers.includes('<progress'))
const legacyMode=renderToStaticMarkup(React.createElement(render.BalanceRows,{rows:data,bars:true,tone:'ok'}))
assert.equal(legacyMode,numbers,'obsolete mode cannot force bars when a numeric balance exists')
const cycle=rows({unit:'%'},{text:'剩余 75%',valueText:'75%',percent:75})
const bars=renderToStaticMarkup(React.createElement(render.BalanceRows,{rows:cycle,tone:'ok'}))
assert.equal((bars.match(/<progress/g)||[]).length,1)
assert.ok(bars.includes('75%'))
const unknown=renderToStaticMarkup(React.createElement(render.BalanceRows,{rows:rows({available:9598}),bars:true,tone:'ok'}))
assert.ok(!unknown.includes('balance-unknown-bar')&&unknown.includes('9598'))
assert.ok(!unknown.includes('<progress'))
const warning=renderToStaticMarkup(React.createElement(render.BalanceRows,{rows:data,bars:false,tone:'warn'}))
assert.equal((warning.match(/⚠/g)||[]).length,1)
assert.ok(warning.includes('余额数据不完整'))
const detail=wallet=>render.usageDetailOf({available:10,wallets:[wallet]}).token[0]
const quantity=detail({allowanceTokens:100,usedTokens:25,usedPercent:25})
assert.equal(quantity.valueText,'75 / 100 token')
assert.equal(quantity.percentageOnly,false)
const percentage=detail({usedPercent:25})
assert.equal(percentage.valueText,'75%')
assert.equal(percentage.percent,75)
assert.equal(percentage.percentageOnly,true)
assert.equal(detail({allowanceTokens:1,usedTokens:0,usedPercent:0}).percentageOnly,true)
const memory=new Map([['workbuddy-desktop-accounts-balance-bars','1']])
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
assert.equal(store.getStore().balanceBars,undefined)
assert.equal(store.toggleBalanceBars,undefined)
const blocked=loadStore({getItem:()=>{throw Error('blocked')},setItem:()=>{throw Error('blocked')}})
assert.equal(blocked.getStore().balanceBars,undefined)
console.log('PASS: numeric balance priority, percentage-only fallback, zero/unknown balances, actual row rendering and ignored legacy mode')
