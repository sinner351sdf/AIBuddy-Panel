// Exercise the exact Java-injected observer with real same-origin child documents.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createRequire} from 'node:module'
const require = createRequire(new URL('../desktop-tauri/ui-islands/package.json', import.meta.url))
const {JSDOM} = require('jsdom')
const source = fs.readFileSync(new URL('../desktop-tauri/mobile/android/app/src/main/java/com/aibuddy/panel/mobile/DashboardDownloads.java', import.meta.url), 'utf8')
const body = source.split('void observeClicks(){')[1].split('private void begin')[0]
const script = JSON.parse(body.match(/web\.evaluateJavascript\(("(?:\\.|[^"\\])*")/)[1])
const dom = new JSDOM('<!doctype html><body><iframe></iframe></body>', {url:'http://127.0.0.1:3065/m', runScripts:'outside-only'})
const wait = () => new Promise(resolve => setTimeout(resolve, 0))
function click(doc, name) {
  const a = doc.createElement('a')
  a.href = 'blob:http://127.0.0.1:3065/' + name
  a.download = name
  a.addEventListener('click', event => event.preventDefault())
  doc.body.appendChild(a)
  a.click()
  assert.deepEqual(JSON.parse(JSON.stringify(dom.window.__aibuddyDownloadMeta)), {url:a.href, name})
  a.remove()
}
try {
  dom.window.eval(script)
  click(dom.window.document, 'top.json')
  click(dom.window.document.querySelector('iframe').contentDocument, 'existing-child.json')
  const child = dom.window.document.createElement('iframe')
  dom.window.document.body.appendChild(child)
  await wait()
  click(child.contentDocument, 'new-editor.json')
  const nested = child.contentDocument.createElement('iframe')
  child.contentDocument.body.appendChild(nested)
  await wait()
  click(nested.contentDocument, 'nested-editor.csv')
  dom.window.eval(script)
  click(child.contentDocument, 'observer-is-idempotent.json')
  console.log('PASS: exact native download observer preserves export filenames in existing, dynamic and nested same-origin mobile editors')
} finally {dom.window.close()}
