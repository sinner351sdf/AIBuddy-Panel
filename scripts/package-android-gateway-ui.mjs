// Copy only public panel assets; application databases, signing keys and local runtime data never enter the APK.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {execFileSync} from 'node:child_process'
const root=path.resolve(new URL('..',import.meta.url).pathname)
const source=path.join(root,'desktop-tauri/ui'),target=path.join(root,'desktop-tauri/mobile/android/app/src/main/assets/gateway-ui')
const allowed=new Set(['.html','.js','.css','.svg','.png','.ico','.webmanifest','.json','.woff','.woff2','.ttf','.jpg','.jpeg','.webp','.txt'])
for(const file of ['index.html','web-mobile-entry.js','login.html','islands/ui.js','islands/ui.css'])if(!fs.existsSync(path.join(source,file)))throw new Error('Missing built panel asset: '+file)
fs.rmSync(target,{recursive:true,force:true});fs.mkdirSync(target,{recursive:true})
const hashes={}
function copy(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
 const filename=path.join(directory,entry.name),relative=path.relative(source,filename)
 if(entry.name.startsWith('.')||entry.isSymbolicLink())continue
 if(entry.isDirectory()){copy(filename);continue}
 if(!allowed.has(path.extname(filename))||['m/mobile.js','m/mobile.css','sw.js'].includes(relative))continue
 const dest=path.join(target,relative);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(filename,dest);hashes[relative]=crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex')
}}
copy(source)
const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version
const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()
fs.writeFileSync(path.join(target,'runtime-build.json'),JSON.stringify({version,commit,files:hashes},null,2)+'\n')
console.log(`Bundled ${Object.keys(hashes).length} complete-panel assets for Android gateway ${version} (${commit.slice(0,7)})`)
