// Exercise the actual account balance formatters without browser/provider calls.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
const require = createRequire(new URL('../desktop-tauri/ui-islands/package.json', import.meta.url))
const ts = require('typescript')
const source = readFileSync(new URL('../desktop-tauri/ui-islands/src/islands/accounts-panels.tsx', import.meta.url), 'utf8')
const ast = ts.createSourceFile('accounts-panels.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const names = ['usageSummary', 'usagePool', 'walletRemainingPercent', 'numberOrNull', 'numberText',
  'subscriptionText', 'leadPlan', 'grantUsage', 'biggestGrant']
const sharedAst = ts.createSourceFile('accounts-shared.ts', readFileSync(new URL('../desktop-tauri/ui-islands/src/islands/accounts-shared.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text)).concat(sharedAst.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === 'numberText'))
assert.equal(functions.length, names.length, 'test must load every real formatter dependency')
const exports = {}
vm.runInNewContext(ts.transpileModule(functions.map(node => node.getText()).join('\n'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, {
  exports,
  t: (message, params = {}) => message.replace(/\{(\w+)\}/g, (_, name) => String(params[name])),
  usageFailureOf: entry => entry?.error ? { message: entry.error } : null,
  compactNumber: String, formatTime: String, zcodePlanStateLabel: String,
})
const { usageSummary, usagePool } = exports
const reading = wallet => ({ available: null, unit: '%', wallets: [wallet] })
let cases = 0
for (const [wallet, expected] of [
  [{ unit: '%', balance: 100, usedPercent: 0, detail: '1 天后重置' }, 100], // persisted legacy shape
  [{ unit: '%', balance: 0, usedPercent: 100 }, 0],
  [{ unit: '%', balance: 62.5, remainingPercent: 62.5 }, 62.5], // new shape
  [{ unit: '%', usedPercent: 25 }, 75],
  [{ remainingPercent: 33 }, 33], // existing monitor shape
  [{ unit: '%', balance: '50' }, 50],
]) {
  const pool = usagePool(reading(wallet))
  assert.equal(pool.percent, expected)
  assert.equal(pool.text, `剩余 ${Math.round(expected)}%`)
  const summary = usageSummary(reading(wallet))
  assert.equal(summary.text, pool.text)
  assert.equal(summary.kind, 'ok')
  if (wallet.detail) assert.ok(summary.title.includes(wallet.detail))
  cases++
}
for (const balance of [null, undefined, '', '  ', false, 'unknown', Infinity]) {
  const data = reading({ unit: '%', balance })
  assert.equal(usagePool(data), null)
  assert.equal(usageSummary(data).text, '无数据')
  assert.equal(usageSummary(data).kind, 'muted')
  cases++
}
assert.equal(usagePool({wallets: [{unit: '积分', balance: 42, usedPercent: 25}]}), null)
assert.equal(usagePool({wallets: [{remainingPercent: 80}, {remainingPercent: 20}]}).percent, 20)
assert.equal(usageSummary({totalLeft: 7068, planLeft: 500, bonusLeft: 6568}).text, '可用 7068')
assert.equal(usageSummary({available: 0, unit: '积分', wallets: []}).text, '可用 0 积分')
assert.equal(usageSummary({available: 9598, unit: '积分'}).text, '可用 9598 积分')
assert.equal(usageSummary({available: null, unit: '%', availableView: '自定义展示'}).text, '自定义展示')
assert.equal(usageSummary({error: 'fixture failure'}).kind, 'bad')
assert.equal(usageSummary(undefined).kind, 'muted')
assert.equal(usageSummary(null).text, '查询中…')
assert.equal(usagePool({wallets: [{total: 700, balance: 698, remainingPercent: 99.7}]}).percent, 99.7)
assert.equal(usagePool({plans: [{name: '套餐', entitlements: [{totalUnits: 100, usedUnits: 20}]}]}).percent, 80)
for (const balance of [0, 42]) {
  const result = usageSummary({available:null,unit:'%',wallets:[{unit:'积分',balance}]})
  assert.equal(result.text, `可用 ${balance} 积分`); assert.equal(result.kind,'ok')
}
console.log(`PASS: ${cases + 13} balance scenarios (Accio, legacy cache, unknown/zero, other providers and errors)`)
