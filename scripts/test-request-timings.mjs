// Offline rendering checks; no real requests, account data or configuration changes.
import { cn } from './ui-fixture-utils.mjs'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
const require = createRequire(new URL('../desktop-tauri/ui-islands/package.json', import.meta.url))
const ts = require('typescript'), React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const source = readFileSync(new URL('../desktop-tauri/ui-islands/src/islands/request-timings.tsx', import.meta.url), 'utf8')
const exports = {}
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
}).outputText, {
  exports,
  require: name => name === 'react' ? React : {
    cn,
    t: (text, values = {}) => text.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? key)),
  },
})
const { timingRows, RequestTimings } = exports
const timings = [
  {stage:'credentials', startedAt:1000, durationMs:0, completed:true},
  {stage:'build_request', startedAt:1000, durationMs:20, completed:true},
  {stage:'send_headers', startedAt:1020, durationMs:300, completed:true},
  {stage:'first_byte', startedAt:1320, durationMs:25, completed:true},
  {stage:'first_content', startedAt:1345, durationMs:null, completed:null},
]
let rows = timingRows(timings, true, 31345)
assert.equal(rows[0].duration, '0 ms', 'measured zero must not become missing')
assert.equal(rows[4].duration, '30.00 s')
assert.equal(rows[4].state, '进行中')
assert.equal(rows[5].duration, '—', 'unreached stage must not become zero')
rows = timingRows(timings, false, 999999)
assert.equal(rows[4].duration, '—', 'ended requests must not keep counting')
assert.equal(rows[4].state, '中断 / 未完成')
const closed = [...timings.slice(0,4), {...timings[4],durationMs:5000,completed:false}]
rows = timingRows(closed, false, 999999)
assert.equal(rows[4].duration, '5.00 s')
const html = renderToStaticMarkup(React.createElement(RequestTimings, {
  attempts:[{timings:closed}],running:false,startedAt:900,
}))
assert.ok(html.includes('连接、发送并等待响应头'))
assert.ok(html.includes('100 ms') && html.includes('5.00 s'))
assert.ok(html.includes('中断 / 未完成') && !html.includes('进行中'))
const legacy = renderToStaticMarkup(React.createElement(RequestTimings, {attempts:[{}],running:false,startedAt:900}))
assert.ok(legacy.includes('旧记录不会补算') && !legacy.includes('<table'))
console.log('PASS: running/completed/interrupted/unreached stages, zero duration, old records and actual table rendering')
