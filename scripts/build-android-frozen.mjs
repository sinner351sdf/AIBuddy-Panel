// Frozen Android dispatcher. No APK is built unless --build is explicit.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
export const ARCHIVE_SHA256='f4dc529f79964fa7da2677436e05d338076476377f1941c0b8c2ebe6805a7847'
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex')
const requireValue=(ok,message)=>{if(!ok)throw new Error(message)}
export function prepareAndroid(out){
 const archive=path.join(root,'legacy/android-baseline/source.tar.gz'),record=JSON.parse(fs.readFileSync(path.join(root,'legacy/android-baseline/snapshot.json')))
 requireValue(hash(fs.readFileSync(archive))===ARCHIVE_SHA256,'Android baseline archive checksum mismatch')
 const source=path.join(path.resolve(out),'source')
 requireValue(source!==root&&!root.startsWith(source+path.sep)&&source!==record.root&&!source.startsWith(record.root+path.sep),'Android output must be isolated from the live checkout')
 const entries=execFileSync('tar',['-tzf',archive],{encoding:'utf8'}).trim().split('\n')
 requireValue(entries.length===record.sourceFiles&&entries.every(name=>!path.isAbsolute(name)&&!name.includes('\\')&&!name.split('/').includes('..')&&record.hashes[name]),'Android archive file inventory mismatch')
 requireValue(new Set(entries).size===entries.length,'Android archive contains duplicate entries')
 if(!fs.existsSync(source)){fs.mkdirSync(source,{recursive:true});execFileSync('tar',['-xzf',archive,'-C',source])}
 for(const [name,expected] of Object.entries(record.hashes)){
  const file=path.join(source,name);requireValue(fs.lstatSync(file).isFile()&&!fs.lstatSync(file).isSymbolicLink()&&hash(fs.readFileSync(file))===expected,`Frozen Android source changed: ${name}`)
 }
 requireValue(!fs.existsSync(path.join(source,'provider-plugin')),'Frozen Android source must not include the new plugin workspace')
 const gateway=fs.readFileSync(path.join(source,'desktop-tauri/src-tauri/android-gateway/Cargo.toml'),'utf8')
 requireValue(gateway.includes('../server')&&!gateway.includes('provider-plugin'),'Android must link the frozen Rust server')
 const result={archiveSha256:ARCHIVE_SHA256,baselineHead:record.head,sourceFiles:record.sourceFiles,source,target:path.join(path.resolve(out),'target'),outputs:path.join(path.resolve(out),'dist')}
 fs.writeFileSync(path.join(path.resolve(out),'android-baseline-build.json'),JSON.stringify(result,null,2)+'\n')
 return result
}
function buildAndroid(record){
 requireValue(!process.env.AIBUDDY_FROZEN_ANDROID_BUILD,'Recursive frozen Android build refused')
 requireValue(process.env.ANDROID_HOME||process.env.ANDROID_SDK_ROOT,'Android SDK must be configured explicitly')
 const env={...process.env,AIBUDDY_FROZEN_ANDROID_BUILD:'1',CARGO_TARGET_DIR:record.target}
 const run=(command,args,cwd=record.source)=>execFileSync(command,args,{cwd,env,stdio:'inherit'})
 const npm=process.platform==='win32'?'npm.cmd':'npm'
 for(const folder of ['assets/brand/generator','desktop-tauri/ui-kit','desktop-tauri/mobile','desktop-tauri/ui-islands'])run(npm,['--prefix',folder,'ci'])
 run(process.execPath,['assets/brand/generator/render.js','--check-mobile'])
 run(npm,['--prefix','desktop-tauri/ui-islands','run','build'])
 run(npm,['--prefix','desktop-tauri/mobile','run','build'])
 run(process.execPath,['scripts/test-mobile-entry.mjs'])
 run(npm,['--prefix','desktop-tauri/mobile','run','build:apk'])
 run(process.execPath,['scripts/package-android-gateway-ui.mjs'])
 run('cargo',['ndk','-t','arm64-v8a','-t','x86_64','--platform','24','-o','../mobile/android/app/src/main/jniLibs','build','--locked','--release','--package','aibuddy-android-gateway'],path.join(record.source,'desktop-tauri/src-tauri'))
 const android=path.join(record.source,'desktop-tauri/mobile/android'),gradle=process.platform==='win32'?'gradlew.bat':'./gradlew'
 if(process.platform!=='win32')fs.chmodSync(path.join(android,'gradlew'),0o755)
 run(gradle,['--no-daemon','--stacktrace',':app:assembleDebug',':app:assembleRelease',':app:assembleDebugAndroidTest'],android)
 fs.mkdirSync(record.outputs,{recursive:true})
 fs.cpSync(path.join(android,'app/build/outputs'),path.join(record.outputs,'outputs'),{recursive:true})
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const args=process.argv.slice(2),index=args.indexOf('--out'),out=index<0?path.join(root,'target/android-frozen',ARCHIVE_SHA256.slice(0,12)):args[index+1]
  requireValue(out&&!out.startsWith('--')&&args.every((arg,i)=>['--prepare-only','--build','--out'].includes(arg)||(index>=0&&i===index+1)),'Usage: build-android-frozen.mjs [--prepare-only|--build] [--out DIRECTORY]')
  requireValue(!args.includes('--build')||!args.includes('--prepare-only'),'Choose prepare or build')
  const result=prepareAndroid(out)
  if(process.env.GITHUB_ENV){fs.appendFileSync(process.env.GITHUB_ENV,`AIBUDDY_ANDROID_SOURCE=${result.source}\nAIBUDDY_ANDROID_TARGET=${result.target}\n`)}
  if(args.includes('--build'))buildAndroid(result)
  console.log(JSON.stringify({...result,built:args.includes('--build')},null,2))
 }catch(error){console.error(error.message);process.exitCode=1}
}
