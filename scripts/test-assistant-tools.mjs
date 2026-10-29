// Actual tool implementation with isolated synthetic bridge data; no provider traffic.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(path.join(root, 'desktop-tauri/ui-islands/package.json'))
const { buildSync } = require('esbuild')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a2a-assistant-tools-'))
const outfile = path.join(dir, 'tools.cjs')
let refreshes = 0
globalThis.window = { wbI18n: { t: (text, values = {}) => text.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? `{${key}}`)) }, wbApp: { refresh: () => { refreshes++ } } }
globalThis.fetch = () => { throw new Error('Unexpected network request') }
buildSync({ entryPoints: [path.join(root, 'desktop-tauri/ui-islands/src/islands/assistant-tools.ts')], bundle: true, platform: 'node', format: 'cjs', outfile, logLevel: 'silent' })
const { toolById } = require(outfile)
let passed = 0
async function check(name, run) { await run(); passed++; console.log(`PASS ${name}`) }
const tool = id => { const value = toolById(id); assert(value, id); return value }
const base = { provider: 'fixture', id: 'model' }
const accountRows = [{ id: 'one', name: 'First', provider: 'a', priority: 0 }, { id: 'two', name: 'Second', provider: 'b', priority: 1 }, { id: 'three', name: 'Third', provider: 'a', priority: 2 }]

try {
  for (const id of ['set_model_enabled', 'set_model_mapping', 'set_account_enabled']) {
    await check(`${id} validates every item before a write`, async () => {
      let writes = 0
      window.workbuddyDesktop = { getState: async () => ({ accounts: accountRows }), setModelState: async () => { writes++ }, addModelMapping: async () => { writes++ }, updateAccount: async () => { writes++ } }
      const first = id === 'set_account_enabled' ? { account: 'one', enabled: false } : id === 'set_model_mapping' ? { ...base, alias: 'alias', action: 'add' } : { ...base, enabled: false }
      for (const invalid of [{}, null, 'invalid', []]) {
        const args = { items: [first, invalid] }
        assert.throws(() => tool(id).plan(args))
        await assert.rejects(tool(id).run(args))
        assert.equal(writes, 0)
      }
      for (const items of [undefined, [], Array(101).fill(first)]) {
        await assert.rejects(tool(id).run({ items }))
        assert.equal(writes, 0)
      }
    })
  }

  await check('all account references resolve before writing', async () => {
    let writes = 0
    window.workbuddyDesktop = { getState: async () => ({ accounts: accountRows }), updateAccount: async () => { writes++ } }
    await assert.rejects(tool('set_account_enabled').run({ items: [{ account: 'one', enabled: false }, { account: 'missing', enabled: true }] }))
    assert.equal(writes, 0)
  })

  await check('mapping enum is strict in preview and execution', async () => {
    let writes = 0
    window.workbuddyDesktop = { addModelMapping: async () => { writes++ }, removeModelMapping: async () => { writes++ } }
    for (const action of ['delete', '', 'ADD', undefined, null]) {
      const args = { items: [{ ...base, alias: 'alias', action }] }
      assert.throws(() => tool('set_model_mapping').plan(args), /action/)
      await assert.rejects(tool('set_model_mapping').run(args), /action/)
    }
    assert.equal(writes, 0)
    const result = await tool('set_model_mapping').run({ items: [{ ...base, alias: 'alias', action: 'add' }, { ...base, alias: 'alias', action: 'remove' }] })
    assert.equal(writes, 2)
    assert.equal(JSON.parse(result.text).ok, true)
  })

  await check('missing bridge methods cannot report successful actions', async () => {
    const args = {
      list_account_balance: {},
      set_model_enabled: { items: [{ ...base, enabled: false }] },
      set_model_mapping: { items: [{ ...base, alias: 'alias', action: 'add' }] },
      set_model_capability: { ...base, capabilities: { supportsImages: true } },
      test_model: base,
      set_provider_order: { provider: 'a', position: 2 },
      set_account_order: { account: 'one', position: 2 },
      set_account_enabled: { items: [{ account: 'one', enabled: false }] },
    }
    window.workbuddyDesktop = { getState: async () => ({ accounts: accountRows }) }
    for (const [id, input] of Object.entries(args)) await assert.rejects(tool(id).run(input), /不支持此操作/, id)
    let writes = 0
    window.workbuddyDesktop.addModelMapping = async () => { writes++ }
    await assert.rejects(tool('set_model_mapping').run({ items: [{ ...base, alias: 'a', action: 'add' }, { ...base, alias: 'a', action: 'remove' }] }), /removeModelMapping/)
    assert.equal(writes, 0, 'missing second method must fail preflight')
  })

  await check('runtime batch failure reports confirmed progress and unexecuted tail', async () => {
    let writes = 0
    const before = refreshes
    window.workbuddyDesktop = { setModelState: async () => { if (++writes === 2) throw new Error('Bearer raw-secret HTTP 401') } }
    const result = await tool('set_model_enabled').run({ items: ['first', 'second', 'third'].map(id => ({ ...base, id, enabled: true })) })
    const data = JSON.parse(result.text)
    assert.equal(writes, 2)
    assert.equal(result.failed, true)
    assert.equal(data.ok, false)
    assert.equal(data.partial, true)
    assert.equal(data.changed.length, 1)
    assert.equal(data.failed.index, 2)
    assert.equal(data.failed.outcome, 'unconfirmed')
    assert.equal(data.notExecuted.length, 1)
    assert(!result.text.includes('raw-secret'))
    assert(refreshes > before)
  })

  await check('cancellation and fresh permission checks precede every bridge action', async () => {
    let writes = 0
    let checks = 0
    const controller = new AbortController()
    window.workbuddyDesktop = { setModelState: async () => { writes++; controller.abort() } }
    const input = { items: [{ ...base, enabled: false }, { ...base, enabled: true }] }
    await assert.rejects(tool('set_model_enabled').run(input, { signal: controller.signal, beforeAction: async () => { checks++ } }), { name: 'AbortError' })
    assert.equal(writes, 1)
    assert.equal(checks, 1)
    writes = 0; checks = 0
    window.workbuddyDesktop.setModelState = async () => { writes++ }
    const result = await tool('set_model_enabled').run(input, { beforeAction: async () => { if (++checks === 2) throw new Error('此工具已关闭，未执行') } })
    assert.equal(writes, 1)
    assert.equal(checks, 2)
    assert.equal(JSON.parse(result.text).changed.length, 1)
    assert.equal(result.failed, true)
  })

  await check('full normalized prompt shown for confirmation equals submitted prompt', async () => {
    let payload
    window.workbuddyDesktop = { testModel: async value => { payload = value; return { success: true, status: 200 } } }
    for (const length of [275, 4000]) {
      const prompt = 'a'.repeat(length - 9) + '尾部待确认文本结束'
      const input = { ...base, prompt: `  ${prompt}  ` }
      const plan = tool('test_model').plan(input)
      await tool('test_model').run(input)
      assert.equal(plan.content.text, prompt)
      assert.equal(payload.prompt, plan.content.text)
      assert(plan.content.text.endsWith('尾部待确认文本结束'))
    }
    for (const input of [{ ...base, prompt: 'x'.repeat(4001) }, { ...base, prompt: 7 }, { id: 'model' }]) {
      assert.throws(() => tool('test_model').plan(input))
      await assert.rejects(tool('test_model').run(input))
    }
  })

  await check('balance output has bounded valid JSON and no nested credentials or raw errors', async () => {
    const secret = 'fixture-secret-must-not-leave'
    const usage = { available: 7, used: 2, total: 9, unit: '积分', raw: { apiKey: secret }, wallets: [{ displayName: 'daily', balance: 7, token: secret, balanceView: { token: secret } }], windows: [{ label: '5h', remainingPercent: 80, resetsAt: 123, raw: { secret } }], subscription: { planName: 'Plan', remainQuota: 7, credentials: secret, status: { secret } }, credits: [{ name: 'daily', remain: 7, accessToken: secret }] }
    window.workbuddyDesktop = { getAllBalances: async () => ({ results: [{ id: 'one', name: 'First', usage, error: `HTTP 403 token=${secret}` }] }) }
    let result = await tool('list_account_balance').run({})
    let data = JSON.parse(result.text)
    assert(!result.text.includes(secret))
    assert.equal(data.accounts[0].usage.available, 7)
    assert.equal(data.accounts[0].usage.wallets[0].balance, 7)
    assert.equal(data.accounts[0].usage.windows[0].remainingPercent, 80)
    assert.equal(data.accounts[0].usage.subscription.planName, 'Plan')
    assert.equal(data.accounts[0].error, '认证失败，请检查账号登录状态')
    window.workbuddyDesktop.getAllBalances = async () => ({ results: Array.from({ length: 65 }, (_, id) => ({ id: String(id), name: 'x'.repeat(5000), usage: { ...usage, wallets: Array(32).fill({ displayName: 'w'.repeat(5000), balance: 7 }) } })) })
    result = await tool('list_account_balance').run({})
    data = JSON.parse(result.text)
    assert(result.text.length <= 12000)
    assert.equal(data.total, 65)
    assert.equal(data.truncated, true)
    assert(!result.text.includes(secret))
  })

  await check('test response allows scalar fields only and never returns raw provider error', async () => {
    const secret = 'fixture-test-secret'
    window.workbuddyDesktop = { testModel: async () => ({ success: false, status: 429, error: `Too many requests Bearer ${secret}`, reply: '"\\\n'.repeat(2000), account_name: { token: secret }, duration_ms: { token: secret }, ttfb_ms: 3, raw: secret }) }
    const result = await tool('test_model').run(base)
    const data = JSON.parse(result.text)
    assert(result.text.length <= 6000)
    assert.equal(result.failed, true)
    assert.equal(data.duration_ms, null)
    assert.equal(data.account, null)
    assert.equal(data.ttfb_ms, 3)
    assert(!result.text.includes(secret))
    window.workbuddyDesktop.testModel = async () => { throw new Error(`HTTP 401 Authorization: Bearer ${secret}`) }
    await assert.rejects(tool('test_model').run(base), error => error.message.includes('认证失败') && !error.message.includes(secret))
  })

  await check('provider order moves every account in an interleaved group', async () => {
    let queue
    window.workbuddyDesktop = { getState: async () => ({ accounts: accountRows }), reorderAccounts: async ids => { queue = ids } }
    const result = await tool('set_provider_order').run({ provider: 'a', position: 2 })
    assert.deepEqual(queue, ['two', 'one', 'three'])
    assert.equal(JSON.parse(result.text).moved, 2)
  })
  console.log(`Assistant tools: ${passed} regression scenarios passed`)
} finally {
  fs.rmSync(dir, { recursive: true, force: true })
}
