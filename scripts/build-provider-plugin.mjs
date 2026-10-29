// Build/package only. This never signs, installs or publishes a provider plugin.
import fs from 'node:fs'
import path from 'node:path'
import {execFileSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {PACK_ID,TARGETS,validatePackage} from './provider-plugin-assets.mjs'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),plugin=path.join(root,'provider-plugin')
const arch=process.arch==='arm64'?'aarch64':process.arch==='x64'?'x86_64':process.arch
const host=`${arch}-${process.platform==='win32'?'pc-windows-msvc':process.platform==='darwin'?'apple-darwin':'unknown-linux-gnu'}`
const args=process.argv.slice(2),option=name=>{const i=args.indexOf(name);return i<0?null:args[i+1]}
const target=option('--target')||host,out=path.resolve(option('--out')||path.join(plugin,'dist')),binary=option('--binary')?path.resolve(option('--binary')):null
if(binary&&!args.includes('--skip-build'))throw new Error('--binary requires explicit --skip-build')
if(!TARGETS.includes(target))throw new Error(`不支持的平台：${target}`)
const manifest=JSON.parse(fs.readFileSync(path.join(plugin,'pack.json'),'utf8'))
if(manifest.id!==PACK_ID||manifest.protocol!==1)throw new Error('插件清单id/protocol不匹配')
if(!args.includes('--skip-build')){
 const cargo=['build','--release','--locked','--manifest-path',path.join(plugin,'Cargo.toml'),'--target-dir',path.join(plugin,'target'),'-p','agent2api-providers']
 if(target!==host)cargo.push('--target',target)
 execFileSync('cargo',cargo,{cwd:plugin,stdio:'inherit'})
}
if(target===host){
 const exe=binary||path.join(plugin,'target','release',target.includes('windows')?'agent2api-providers.exe':'agent2api-providers')
 const built=JSON.parse(execFileSync(exe,['--build-info'],{encoding:'utf8'}))
 if(built.fixture===true)throw new Error('禁止将 demo 验证二进制打成生产提供商包')
 if(built.id!==PACK_ID||built.version!==manifest.version||built.protocol!==1||built.target!==target)throw new Error('已编译二进制的身份、版本或目标与pack.json不一致')
}
const packArgs=[path.join(plugin,'scripts/pack.mjs'),'--skip-build','--target',target,'--out',out]
if(binary)packArgs.push('--binary',binary)
execFileSync(process.execPath,packArgs,{cwd:plugin,stdio:'inherit'})
const file=path.join(out,`${PACK_ID}-${manifest.version}-${target}.zip`)
validatePackage(file,{version:manifest.version,target})
const sha=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()
execFileSync(process.execPath,[path.join(root,'scripts/provider-plugin-assets.mjs'),'manifest',file,target,sha],{cwd:root,stdio:'inherit'})
console.log(`Development provider artifact validated: ${file}`)
