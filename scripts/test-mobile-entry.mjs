// Every old mobile bookmark now enters the same full panel, with no duplicate business UI.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
const html=fs.readFileSync(new URL('../desktop-tauri/ui/m.html',import.meta.url),'utf8')
assert.match(html,/<script src="\/web-mobile-entry\.js"><\/script>/)
assert.ok(!html.includes('m/mobile.js'),'mobile bookmarks must not load the reduced client')
const script=fs.readFileSync(new URL('../desktop-tauri/ui/web-mobile-entry.js',import.meta.url),'utf8')
for(const pathname of ['/m','/m/','/m.html'])for(const [hash,page]of [['#home','overview'],['#accounts','accounts'],['#models','gateway'],['#assistant','assistant'],['#tasks','tasks'],['#not-a-page',null],['#https://untrusted.example/',null]]){
 let destination,stored
 const context={location:{pathname,hash,search:'?from=login',replace:value=>destination=value},localStorage:{setItem:(key,value)=>{assert.equal(key,'workbuddy-desktop-page');stored=value}}}
 vm.runInNewContext(script,context)
 assert.equal(destination,'/?from=login'+(page?'#'+page:''))
 assert.equal(stored,page||undefined)
}
const sw=fs.readFileSync(new URL('../desktop-tauri/mobile/public/sw.js',import.meta.url),'utf8')
const context={self:{addEventListener(){}}};vm.createContext(context);vm.runInContext(sw,context)
for(const pathname of ['/m','/m/','/m.html','/','/index.html'])assert.equal(context.isEntryNavigation({mode:'navigate'},{pathname}),true)
assert.equal(context.isEntryNavigation({mode:'navigate'},{pathname:'/api/accounts'}),false)
console.log('PASS: mobile aliases reuse the complete panel; legacy route mapping, fixed origin, no reduced client, and panel entry cache paths')
