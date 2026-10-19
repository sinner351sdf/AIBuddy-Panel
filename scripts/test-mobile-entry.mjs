import './test-mobile-native-download.mjs'
// Dedicated mobile entry, with complete editors confined to secondary mobile screens.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8')
const html = read('desktop-tauri/ui/m.html')
assert.match(html, /<div id="root"><\/div>/)
assert.match(html, /src="\/m\/mobile\.js"/)
assert.match(html, /href="\/m\/mobile\.css"/)
assert.ok(!html.includes('web-mobile-entry.js'), 'mobile must never redirect to the desktop shell')
for (const pathname of ['/m', '/m/', '/m.html']) {
  const base = new URL('http://localhost' + pathname)
  for (const asset of [...html.matchAll(/(?:src|href)="([^"<>]+)"/g)].map(match => match[1])) {
    assert.ok(asset.startsWith('/'), `${pathname}: asset must be root-relative: ${asset}`)
    assert.equal(new URL(asset, base).origin, base.origin)
  }
}
const legacy = read('desktop-tauri/ui/web-mobile-entry.js')
let destination
vm.runInNewContext(legacy, { location: { search: '?from=login', hash: '#accounts', replace: url => destination = url } })
assert.equal(destination, '/m?from=login#accounts', 'stale entry script also restores the mobile shell')
assert.equal(JSON.parse(read('desktop-tauri/mobile/public/manifest.webmanifest')).start_url, '/m')
const sw = read('desktop-tauri/mobile/public/sw.js'), swContext = { self: {addEventListener(){}} }
vm.createContext(swContext); vm.runInContext(sw, swContext)
for (const pathname of ['/m', '/m/', '/m.html']) assert.equal(swContext.isEntryNavigation({mode:'navigate'}, {pathname}), true)
assert.equal(swContext.isMobileAsset('/api/accounts'), false)
assert.ok(sw.includes('./m/mobile.js') && sw.includes('./m/mobile.css'), 'offline shell contains dedicated mobile assets')
const embed = read('desktop-tauri/ui/mobile-panel-embed.js')
function context(page, kind = 'same') {
  const origin = 'http://localhost', classes = [], events = {}, timers = [], opens = [], styles = []
  const window = { parent: kind === 'cross' ? {location:{origin:'https://other.invalid'}} : {location:{origin}}, wbApp: {getState:()=>({accounts:{accounts:[]}})}, wbAddAccountModal:{open:()=>opens.push('add')}, wbAccountPanel:{open:id=>opens.push(id)} }
  if (kind === 'top') window.parent = window
  const ctx = {window, location:{origin,search:'?'+new URLSearchParams(page)}, URLSearchParams, document:{documentElement:{classList:{add:value=>classes.push(value)}},head:{appendChild:value=>styles.push(value.textContent)},createElement:()=>({}),addEventListener:(event,callback)=>events[event]=callback}, setInterval:callback=>{timers.push(callback);return 1},clearInterval(){} }
  vm.runInNewContext(embed, ctx)
  return {window, classes, events, timers, opens, styles}
}
for (const kind of ['top','cross']) assert.equal(context({'mobile-panel':'keys'},kind).window.wbMobileEmbed, undefined)
assert.equal(context({'mobile-panel':'https://untrusted.invalid'}).window.wbMobileEmbed, undefined)
for (const page of ['keys','gateway','agent','assistant','settings','proxies','checkin']) {
  const value = context({'mobile-panel':page})
  assert.equal(value.window.wbMobileEmbed.page, page)
  assert.ok(value.styles.join('').includes('display:none!important'), 'embedded editor has no desktop chrome')
}
for (const [action, expected] of [['add','add'],['edit','fixture-account']]) {
  const value = context({'mobile-panel':'accounts','mobile-action':action,account:'fixture-account'})
  value.events.DOMContentLoaded(); value.timers[0]()
  assert.deepEqual(value.opens,[expected], 'account editor is a real workflow, not a toast')
}
assert.ok(read('desktop-tauri/ui/app.js').includes('persist && !window.wbMobileEmbed'), 'mobile editor never changes the saved desktop tab')
assert.ok(read('desktop-tauri/mobile/android/app/src/main/java/com/aibuddy/panel/mobile/DashboardActivity.java').includes('entry=origin+"m"'), 'native local and remote services open the mobile shell')
assert.ok(!read('scripts/package-android-gateway-ui.mjs').includes("['m/mobile.js','m/mobile.css','sw.js'].includes"), 'native gateway includes mobile bundles')
console.log('PASS: dedicated mobile aliases/PWA/native entry, root-relative assets, unchanged desktop tab, complete editors, allowlisted same-origin frames, real add/edit actions and API cache exclusion')
