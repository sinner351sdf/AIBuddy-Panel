import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('..', import.meta.url))
const islands = path.join(root, 'desktop-tauri/ui-islands')
const require = createRequire(path.join(islands, 'package.json'))
const temp = mkdtempSync(path.join(tmpdir(), 'aibuddy-model-hint-'))
try {
 const output=path.join(temp,'hint.cjs')
 require('esbuild').buildSync({entryPoints:[path.join(islands,'src/islands/model-test-error-hint.ts')],bundle:true,platform:'node',format:'cjs',outfile:output,logLevel:'silent'})
 const {modelTestErrorHint:hint}=require(output)
 assert.match(hint(403,'accio_waf_block'),/不代表账号失效/)
 assert.match(hint(403,undefined,'Accio 网关请求被拒绝（WAF_BLOCK）'),/安全网关/)
 assert.match(hint(503,'accio_security_guard_unavailable'),/安全组件初始化/)
 assert.match(hint(401),/重新授权/)
 assert.match(hint(403),/无法判断登录失效/)
 assert.match(hint(403,'permission_denied','WAF_BLOCK mentioned by upstream'),/模型权限/, 'an explicit other code beats legacy text matching')
 assert.match(hint(429),/限额冷却/);assert.match(hint(404),/获取模型/);assert.match(hint(504),/预算/);assert.match(hint(502),/接入链路/)
 assert.equal(hint(200),undefined)
 for(const [status,code] of [[401,null],[403,null],[403,'accio_waf_block']])assert(!/删掉|删除账号/.test(hint(status,code)))
 const dialog=readFileSync(path.join(islands,'src/islands/model-test-dialog.tsx'),'utf8')
 assert(dialog.includes('modelTestErrorHint(status, result?.error_code, result?.error)'), 'the rendered result must use reason-aware hints')
 console.log('Model test hints: 15 checks passed (typed WAF, legacy WAF, SG unavailable, auth, generic 403, code precedence, rate/model/timeouts, preserved account).')
} finally { rmSync(temp,{recursive:true,force:true}) }
