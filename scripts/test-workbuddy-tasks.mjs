// Client contract and state checks, with no browser or provider calls.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
const require = createRequire(new URL('../desktop-tauri/ui-islands/package.json', import.meta.url))
const ts = require('typescript'), exports = {}
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../desktop-tauri/ui-islands/src/islands/workbuddy-tasks-api.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports })
const { createAccountGrowthClient, canAcceptTask, canAutomateTask, taskState } = exports
const requests = []
const client = createAccountGrowthClient(async (method, path, body) => {
  requests.push(JSON.parse(JSON.stringify({ method, path, body })))
  return { accepted: 1 }
})
await client.list('account / one')
await client.accept('account / one')
await client.accept('account / one', 'chat_5')
await client.claim('account / one', 'chat_5')
await client.run('account / one')
assert.equal(requests[0].path, '/api/growth-tasks/accounts/account%20%2F%20one')
assert.deepEqual(requests[1].body, { all: true })
assert.deepEqual(requests[2].body, { code: 'chat_5' })
assert.deepEqual(requests[3].body, { code: 'chat_5' })
assert.equal(requests[3].path, '/api/growth-tasks/accounts/account%20%2F%20one/claim')
assert.equal(requests[4].path, '/api/growth-tasks/run')
assert.deepEqual(requests[4].body, { accountId: 'account / one' })
await client.runTask('account / one', 'WorkBuddy_Valorant')
await client.runTask('account / one', 'black_cat')
assert.deepEqual(requests[5].body,{accountId:'account / one',taskCode:'WorkBuddy_Valorant',taskKind:'growth'})
assert.deepEqual(requests[6].body,{accountId:'account / one',taskCode:'black_cat',taskKind:'night'})
await client.compensation('account / one')
await client.claimCompensation('account / one')
assert.equal(requests[7].method, 'GET')
assert.equal(requests[7].path, '/api/growth-tasks/accounts/account%20%2F%20one/compensation')
assert.deepEqual(requests[8], { method: 'POST', path: '/api/growth-tasks/gift', body: { accountId: 'account / one', kind: 'compensation' } })
for (const [task, state] of [[{claimed:true, claimable:true}, 'claimed'], [{locked:true, claimable:true}, 'locked'],
  [{claimable:true}, 'claimable'], [{accepted:true}, 'accepted'], [{}, 'pending']]) {
  assert.equal(taskState(task), state)
}
assert.equal(canAcceptTask({}), true)
for (const task of [{accepted:true}, {claimed:true}, {locked:true}]) assert.equal(canAcceptTask(task), false)
assert.equal(canAutomateTask({automatable:true}), true)
for (const task of [{}, {automatable:true, claimed:true}, {automatable:true, locked:true}]) assert.equal(canAutomateTask(task), false)
const failed = createAccountGrowthClient(async () => { throw Error('fixture request failure') })
await assert.rejects(failed.claim('one', 'chat_5'), /fixture request failure/)
await assert.rejects(failed.run('one'), /fixture request failure/)
console.log('PASS: per-account request scope, escaping, task states, eligibility and error propagation')
