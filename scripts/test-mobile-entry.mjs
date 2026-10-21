import './test-mobile-native-download.mjs'
// Dedicated mobile entry, with complete editors confined to secondary mobile screens.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createHash} from 'node:crypto'
import vm from 'node:vm'
const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8')
const html = read('desktop-tauri/ui/m.html')
assert.match(html, /<div id="root"><\/div>/)
assert.match(html, /src="\/m\/mobile\.js\?v=[a-f0-9]{12}"/)
assert.match(html, /href="\/m\/mobile\.css\?v=[a-f0-9]{12}"/)
assert.ok(!html.includes('web-mobile-entry.js'), 'mobile must never redirect to the desktop shell')
for(const extension of ['js','css']){ const digest=createHash('sha256').update(fs.readFileSync(new URL('../desktop-tauri/ui/m/mobile.'+extension,import.meta.url))).digest('hex').slice(0,12);assert(html.includes('/m/mobile.'+extension+'?v='+digest),'mobile entry points to current content bytes');assert(read('desktop-tauri/ui/sw.js').includes('./m/mobile.'+extension+'?v='+digest),'offline precache owns the same versioned URLs') }
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
const handlers={};const sw = read('desktop-tauri/mobile/public/sw.js'), swContext = { self: {location:{origin:'http://localhost'},addEventListener(name,fn){handlers[name]=fn}},URL,Response }
vm.createContext(swContext); vm.runInContext(sw, swContext)
for (const pathname of ['/m', '/m/', '/m.html']) assert.equal(swContext.isEntryNavigation({mode:'navigate'}, {pathname}), true)
assert.equal(swContext.isMobileAsset('/api/accounts'), false)
for(const pathname of ['/','/index.html']) {
 assert.equal(swContext.isEntryNavigation({mode:'navigate'},{pathname}),false,'mobile worker never substitutes desktop entry HTML')
 let intercepted=false;handlers.fetch({request:{method:'GET',mode:'navigate',url:'http://localhost'+pathname},respondWith(){intercepted=true}});assert.equal(intercepted,false)
}
let offline=false,cached=new Response('old bundle'),stored=[]
swContext.caches={open:async()=>({match:async()=>cached,put:async(request,response)=>stored.push(await response.text())})}
swContext.fetch=async()=>{if(offline)throw new Error('offline');return new Response('current bundle')}
for(const pathname of ['/islands/ui.js','/islands/ui.css','/js/prefs.js']) {
 let response;handlers.fetch({request:{method:'GET',mode:'cors',url:'http://localhost'+pathname},respondWith(value){response=value}})
 assert.equal(await(await response).text(),'current bundle','shared resources use current bytes online, never the stale mobile cache')
}
offline=true
let response;handlers.fetch({request:{method:'GET',url:'http://localhost/islands/ui.js'},respondWith(value){response=value}})
assert.equal(await(await response).text(),'old bundle','mobile shared features retain offline fallback')
swContext.caches.open=async()=>({match:async key=>typeof key==='string'&&key==='/islands/ui.js'?new Response('offline shared bundle'):undefined})
handlers.fetch({request:{method:'GET',url:'http://localhost/islands/ui.js?v=current'},respondWith(value){response=value}})
assert.equal(await(await response).text(),'offline shared bundle','versioned shared requests fall back to the current precache when offline')
assert.ok(sw.includes('./m/mobile.js') && sw.includes('./m/mobile.css'), 'offline shell contains dedicated mobile assets')
const management = read('desktop-tauri/mobile/src/pages/ManagementPage.tsx')
assert.ok(!management.includes('<iframe'), 'mobile features cannot embed desktop HTML')
assert.ok(management.includes('api.mount(target, options)') && management.includes('new MutationObserver(committed)'), 'real components mount in the phone document')
const bridge = read('desktop-tauri/ui/m-feature-bridge.js')
const rust = read('desktop-tauri/src-tauri/server/src/web_shim.rs')
assert.equal(bridge.split('\n').slice(1).join('\n'), rust.split('pub fn shim_js()')[1].match(/r#"([\s\S]*?)"#/u)[1].trimEnd() + '\n', 'mobile uses exactly the canonical HTTP bridge')
assert.ok(read('desktop-tauri/mobile/android/app/src/main/java/com/aibuddy/panel/mobile/DashboardActivity.java').includes('entry=origin+"m"'), 'native local and remote services open the mobile shell')
assert.ok(!read('scripts/package-android-gateway-ui.mjs').includes("['m/mobile.js','m/mobile.css','sw.js'].includes"), 'native gateway includes mobile bundles')
console.log('PASS: dedicated mobile aliases/PWA/native entry, root-relative assets, unchanged desktop tab, in-document mobile features, canonical HTTP bridge and API cache exclusion')
