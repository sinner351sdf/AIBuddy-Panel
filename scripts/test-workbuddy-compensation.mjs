// Real React/UI components against in-memory responses. Never reads credentials or calls a provider.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { createRequire } from 'node:module'
const root = path.resolve(new URL('..', import.meta.url).pathname)
const islands = root + '/desktop-tauri/ui-islands', require = createRequire(islands + '/package.json')
const { build, stop } = require('esbuild'), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'a2a-compensation-'))
const aliases = { '@ui': root + '/desktop-tauri/ui-kit/src/index.ts', react: path.dirname(require.resolve('react/package.json')), 'react-dom': path.dirname(require.resolve('react-dom/package.json')) }
const accounts = [{ id: 'available', name: '可领取账号', provider: 'workbuddy' }, { id: 'claimed', name: '已领取账号', provider: 'workbuddy' }, { id: 'inactive', name: '暂无活动账号', provider: 'workbuddy' }, { id: 'international', provider: 'workbuddy-intl' }]
function fixture(request) {
  const id = request.path.split('/').at(-2)
  if (request.method === 'GET') return { accountId: id, queriedAt: Date.now(), status: { active: id !== 'inactive', claimed: id === 'claimed', claimable: id === 'available', creditNum: id === 'available' ? 500 : 0, endTime: id === 'inactive' ? null : '2026-10-22 23:59:59' } }
  return { claimed: true, already: false, credit: 500, message: '补偿积分领取成功（模拟响应）' }
}
async function bundle(contents, platform, outfile) {
  await build({ stdin: { contents, loader: 'tsx', resolveDir: islands }, bundle: true, platform, format: platform === 'node' ? 'cjs' : 'iife', outfile, jsx: 'automatic', alias: aliases, nodePaths: [islands + '/node_modules', root + '/desktop-tauri/ui-kit/node_modules'], logLevel: 'silent' })
}
if (process.argv.includes('--serve')) {
  await bundle(`import * as React from 'react'; import {createRoot} from 'react-dom/client'; import {WorkBuddyCompensation} from './src/islands/workbuddy-compensation';
    const fixture=${fixture.toString()};window.wbI18n={t:(s,v={})=>s.replace(/\\{(\\w+)\\}/g,(_,k)=>v[k]??'{'+k+'}')};let claimed=false;
    window.__TAURI_INTERNALS__={invoke:async(_,args)=>{const r=args.request; if(r.method==='POST'){claimed=true;return fixture(r)}const data=fixture(r);if(claimed&&data.accountId==='available'){data.status.claimed=true;data.status.claimable=false}return data}};
    createRoot(document.getElementById('root')).render(<WorkBuddyCompensation accounts={${JSON.stringify(accounts)}}/>);`, 'browser', tmp + '/fixture.js')
  const server = http.createServer((req, res) => {
    const files = { '/fixture.js': [tmp + '/fixture.js', 'text/javascript'], '/ui.css': [root + '/desktop-tauri/ui/islands/ui.css', 'text/css'] }
    if (files[req.url]) { res.setHeader('Content-Type', files[req.url][1]); res.end(fs.readFileSync(files[req.url][0])); return }
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>补偿积分 · 本地模拟验证</title><link rel="stylesheet" href="/ui.css"><body style="padding:32px;max-width:1100px;margin:auto"><h1 style="font-size:22px;font-weight:600">补偿积分 · 本地模拟验证</h1><p style="font-size:13px;margin:8px 0 24px">测试账号与模拟响应，不连接真实 WorkBuddy 账号。</p><div id="root"></div><script src="/fixture.js"></script></body></html>')
  }).listen(13076, '127.0.0.1', () => console.log('Fixture listening on http://127.0.0.1:13076'))
  const close = () => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); stop(); process.exit() }
  process.on('SIGTERM', close); process.on('SIGINT', close)
} else {
  const { JSDOM } = require('jsdom'), dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' })
  for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent', 'MouseEvent', 'MutationObserver', 'HTMLButtonElement', 'SVGElement']) globalThis[key] = dom.window[key]
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window)
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.wbI18n = { t: (s,v={}) => s.replace(/\{(\w+)\}/g, (_,k) => String(v[k] ?? `{${k}}`)) }
  const calls = []; let handler = fixture, refreshes = 0
  window.wbApp = { refresh: () => { refreshes++ } }
  window.__TAURI_INTERNALS__ = { invoke: async (_, { request }) => { calls.push(request); return handler(request) } }
  let React, view
  try {
    await bundle("export {WorkBuddyCompensation} from './src/islands/workbuddy-compensation';export * as React from 'react';export {createRoot} from 'react-dom/client';", 'node', tmp + '/fixture.cjs')
    const f = require(tmp + '/fixture.cjs'); React = f.React; view = f.createRoot(document.getElementById('root'))
    const render = async (items, key = 'all') => React.act(async () => view.render(React.createElement(f.WorkBuddyCompensation, { accounts: items, key })))
    const click = async button => { assert.ok(button && !button.disabled); await React.act(async () => button.click()) }
    const button = label => [...document.querySelectorAll('button')].find(b => b.textContent === label)
    await render(accounts)
    assert.equal(calls.length, 0, 'opening the panel never claims or queries automatically')
    await click(button('查询补偿状态'))
    assert.equal(calls.length, 3); assert.ok(calls.every(c => c.method === 'GET'))
    assert.ok(!calls.some(c => c.path.includes('international')))
    assert.ok(document.body.textContent.includes('500')); assert.ok(document.body.textContent.includes('2026-10-22'))
    const rows = [...document.querySelectorAll('tbody tr')]
    assert.equal(rows.length, 3); assert.ok(rows[1].textContent.includes('已领取')); assert.ok(rows[2].textContent.includes('暂无补偿活动'))
    assert.equal(rows.filter(row => !row.querySelector('button').disabled).length, 1)
    let finish; handler = r => r.method === 'POST' ? new Promise(resolve => { finish = resolve }) : fixture(r)
    const claim = rows[0].querySelector('button')
    await React.act(async () => { claim.click(); claim.click() })
    assert.equal(calls.filter(c => c.method === 'POST').length, 1, 'duplicate clicks submit once')
    assert.deepEqual(calls.find(c => c.method === 'POST').body, { accountId: 'available', kind: 'compensation' })
    await React.act(async () => finish({ claimed: true, credit: null, message: '领取成功' }))
    assert.ok(document.querySelector('tbody tr').textContent.includes('已领取'), 'delayed read cannot undo a confirmed claim')
    assert.equal(refreshes, 1)
    // A lost write response reconciles against a fresh status without a second write.
    await render(accounts.slice(0, 1), 'lost-response'); let claimed = false
    handler = r => { if (r.method === 'POST') { claimed = true; throw Error('lost response') }; const data = fixture(r); if (claimed) { data.status.claimed = true; data.status.claimable = false }; return data }
    await click(button('查询补偿状态')); const writes = calls.filter(c => c.method === 'POST').length
    await click(button('一键领取')); assert.equal(calls.filter(c => c.method === 'POST').length, writes + 1)
    assert.ok(document.body.textContent.includes('补偿状态已更新为已领取'))
    // Late responses must not enter a newly selected account scope.
    let resolveOld; handler = () => new Promise(resolve => { resolveOld = resolve })
    await render(accounts.slice(0, 1), 'old-scope'); await click(button('查询补偿状态'))
    await render([accounts[3]], 'intl-scope')
    await React.act(async () => resolveOld(fixture({ method: 'GET', path: '/accounts/available/compensation' })))
    assert.equal(document.querySelectorAll('tbody tr').length, 0); assert.ok(button('查询补偿状态').disabled)
    // Partial failures stay visible and do not hide successful queries or enable failed claims.
    handler = r => { if (r.path.includes('/claimed/')) throw Error('fixture status failure'); const result = fixture(r); result.status.creditNum = 0; return result }
    await render(accounts, 'partial'); await click(button('查询补偿状态'))
    assert.ok(document.body.textContent.includes('fixture status failure')); assert.equal(document.querySelector('tbody tr td:nth-child(2)').textContent, '0')
    assert.ok(document.querySelectorAll('tbody tr')[1].querySelector('button').disabled)
    // Batch action only includes successfully queried, currently claimable CN accounts.
    handler = r => {
      if (r.method === 'POST') return { claimed: true, message: 'fixture claimed', credit: null }
      const data = fixture(r); data.status.active = true; data.status.claimed = false; data.status.claimable = true; return data
    }
    await render(accounts, 'batch'); await click(button('查询补偿状态'))
    const batchStart = calls.length
    await click(button('一键领取 3 个账号'))
    assert.deepEqual(calls.slice(batchStart).filter(r => r.method === 'POST').map(r => r.body.accountId), ['available', 'claimed', 'inactive'])
    assert.ok([...document.querySelectorAll('tbody tr')].every(row => row.textContent.includes('已领取')))
    console.log('PASS: actual compensation panel; read-only queries, CN scope, zero credits, all status states, account-scoped claims, duplicate clicks, delayed/lost responses, balance refresh, partial failures and account-switch races')
  } finally { if (view) await React.act(async () => view.unmount()); dom.window.close(); fs.rmSync(tmp, { recursive: true, force: true }); stop() }
  // Shared account modules install legacy timers; this fixture owns the process.
  process.exit(0)
}
