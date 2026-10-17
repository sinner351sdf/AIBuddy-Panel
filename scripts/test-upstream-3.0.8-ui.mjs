// Render real settings/provider components and validate the shared GFM renderer without network.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import {createRequire} from 'node:module'
const root=path.resolve(new URL('..',import.meta.url).pathname),islands=root+'/desktop-tauri/ui-islands',require=createRequire(islands+'/package.json')
const {build}=require('esbuild'),{JSDOM}=require('jsdom'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'a2a-308-ui-'))
const dom=new JSDOM('<!doctype html><div></div>',{url:'http://localhost/'})
Object.assign(globalThis,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage})
window.wbI18n={t:(s,v={})=>s.replace(/\{(\w+)\}/g,(_,k)=>String(v[k]??`{${k}}`))}
window.workbuddyDesktop={platform:'web'}
try {
 const output=path.join(tmp,'fixture.cjs'),source=fs.readFileSync(islands+'/src/islands/settings-page.tsx','utf8')
 await build({stdin:{contents:source+"\nexport {GatewayPane}; export {getSnapshot as fixtureSettingsSnapshot} from './settings-state'; export {renderToStaticMarkup} from 'react-dom/server'; export {createElement} from 'react'",resolveDir:islands+'/src/islands',loader:'tsx'},bundle:true,platform:'node',format:'cjs',outfile:output,jsx:'automatic',alias:{'@ui':root+'/desktop-tauri/ui-kit/src',react:path.dirname(require.resolve('react/package.json')),'react-dom':path.dirname(require.resolve('react-dom/package.json'))},nodePaths:[islands+'/node_modules',root+'/desktop-tauri/ui-kit/node_modules'],logLevel:'silent'})
 const f=require(output),html=f.renderToStaticMarkup(f.createElement(f.GatewayPane,{snap:f.fixtureSettingsSnapshot()}))
 assert.equal((html.match(/id="btn-role-compat-refresh"/g)||[]).length,1,'merged gateway must contain exactly one compatibility panel')
 assert.ok(html.includes('developer')&&html.includes('system'))
 const markdown={window:{}};vm.runInNewContext(fs.readFileSync(root+'/desktop-tauri/ui/markdown.js','utf8'),markdown)
 const api=markdown.window.wbMarkdown
 assert.ok(api,'shared markdown renderer missing')
 const render=api.render||api.renderMarkdown||api.toHtml
 assert.equal(typeof render,'function')
 const table=render('| 名称 | 说明 |\n| :-- | --: |\n| a | b \\| c |')
 const tableDom=new JSDOM(table)
 assert.equal(tableDom.window.document.querySelectorAll('tbody td').length,2,'escaped pipe created an extra column')
 assert.equal(tableDom.window.document.querySelector('tbody td:last-child').textContent,'b | c')
 tableDom.window.close()
 assert.ok(table.includes('md-ta-r'),'GFM alignment must survive')
 console.log('PASS: actual settings composition has one developer-role panel; shared GFM tables preserve escaped pipes and alignment')
} finally {dom.window.close();fs.rmSync(tmp,{recursive:true,force:true})}
process.exit(0)
