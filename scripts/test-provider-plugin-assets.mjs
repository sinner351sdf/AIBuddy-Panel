import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import {deflateRawSync} from 'node:zlib'
import {execFileSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {PACK_ID,TARGETS,pluginVersion,validatePackage,signingPayload,zipEntries,validateBuild,collectPackages,sha256} from './provider-plugin-assets.mjs'
import {signArtifacts} from './sign-provider-artifacts.mjs'
// Independent fixture writer. Headers deliberately exercise the actual ZIP reader.
function crc(bytes){let value=0xffffffff;for(const byte of bytes){value^=byte;for(let j=0;j<8;j++)value=(value>>>1)^((value&1)?0xedb88320:0)}return(value^0xffffffff)>>>0}
function zip(files,method=0){let offset=0;const locals=[],central=[];for(const [name,data,mode=0o100644] of files){const n=Buffer.from(name),packed=method===8?deflateRawSync(data):data,l=Buffer.alloc(30),c=Buffer.alloc(46);l.writeUInt32LE(0x04034b50);l.writeUInt16LE(20,4);l.writeUInt16LE(0x800,6);l.writeUInt16LE(method,8);l.writeUInt32LE(crc(data),14);l.writeUInt32LE(packed.length,18);l.writeUInt32LE(data.length,22);l.writeUInt16LE(n.length,26);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(3<<8|20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);c.writeUInt16LE(method,10);c.writeUInt32LE(crc(data),16);c.writeUInt32LE(packed.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE((mode<<16)>>>0,38);c.writeUInt32LE(offset,42);locals.push(l,n,packed);central.push(c,n);offset+=30+n.length+packed.length}const e=Buffer.alloc(22);e.writeUInt32LE(0x06054b50);e.writeUInt16LE(files.length,8);e.writeUInt16LE(files.length,10);e.writeUInt32LE(central.reduce((n,b)=>n+b.length,0),12);e.writeUInt32LE(offset,16);return Buffer.concat([...locals,...central,e])}
function binary(target){const b=Buffer.alloc(160);if(target.includes('windows')){b.write('MZ');b.writeUInt32LE(80,60);b.writeUInt32LE(0x4550,80);b.writeUInt16LE(0x8664,84)}else if(target.includes('linux')){b.set([0x7f,69,76,70,2,1]);b.writeUInt16LE(target.startsWith('aarch64')?183:62,18)}else{b.writeUInt32LE(0xfeedfacf);b.writeUInt32LE(target.startsWith('aarch64')?0x0100000c:0x01000007,4)}return b}
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'aibuddy-provider-assets-')),version='0.2.2-aibuddy.dev.1',sha='a'.repeat(40),allKeys={}
try{
 assert.equal(pluginVersion(`providers-v${version}`),version)
 for(const tag of ['v3.3.0','providers-v01.2.3','providers-v1.2.3junk','providers-v1.2.3-beta.01'])assert.throws(()=>pluginVersion(tag))
 for(const target of TARGETS){
  const entry=`bin/agent2api-providers${target.includes('windows')?'.exe':''}`,manifest={id:PACK_ID,version,protocol:1,providers:[{id:'accio',order:1,default_enabled:true}],entry:{[target]:entry}}
  const files=()=>[['pack.json',Buffer.from(JSON.stringify(manifest))],[entry,binary(target),0o100755],['ui/checkin/index.html',Buffer.from('<h1>fixture</h1>')],['LICENSE',Buffer.from('fixture AGPL notice')],['NOTICE-AIBUDDY.md',Buffer.from('fixture source notice')],['licenses/third-party-licenses.txt',Buffer.from('fixture dependency notices')]]
  const file=path.join(temp,`${PACK_ID}-${version}-${target}.zip`),write=items=>fs.writeFileSync(file,zip(items))
  write(files());assert.equal(validatePackage(file,{version,target}).signed,false)
  assert.throws(()=>validatePackage(file,{version,target,requireSigned:true}),/生产签名/)
  const {privateKey,publicKey}=crypto.generateKeyPairSync('ed25519'),publicHex=publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('hex'),trustedKeys={[`fixture-${target}`]:publicHex};Object.assign(allKeys,trustedKeys)
  manifest.signature={algorithm:'ed25519',keyId:`fixture-${target}`,target,value:crypto.sign(null,Buffer.from(signingPayload(manifest,target,zipEntries(fs.readFileSync(file)))),privateKey).toString('base64')}
  write(files());assert.equal(validatePackage(file,{version,target,requireSigned:true,trustedKeys}).signed,true)
  fs.writeFileSync(file,zip(files(),8));const checked=validatePackage(file,{version,target,requireSigned:true,trustedKeys});assert.equal(checked.signed,true)
  const artifactDir=path.join(temp,`provider-${target}`);fs.mkdirSync(artifactDir);const artifact=path.join(artifactDir,path.basename(file));fs.copyFileSync(file,artifact)
  fs.writeFileSync(`${artifact}.build.json`,JSON.stringify({...checked,sourceRepo:'sinner351sdf/AIBuddy-Panel',sourceSha:sha,sourceDirty:false,schemaVersion:17}))
  fs.writeFileSync(`${artifact}.sha256`,`${checked.sha256}  ${path.basename(file)}\n`)
  assert.throws(()=>validatePackage(file,{version,target,requireSigned:true,trustedKeys:{}}),/可信密钥/)
  const tampered=files();tampered[2][1]=Buffer.from('<script>changed</script>');write(tampered);assert.throws(()=>validatePackage(file,{version,target,trustedKeys}),/签名校验失败/)
  delete manifest.signature
  manifest.version='0.2.1';write(files());assert.throws(()=>validatePackage(file,{version,target}),/version/);manifest.version=version
  const wrong=files();wrong[1][1]=Buffer.alloc(160);write(wrong);assert.throws(()=>validatePackage(file,{version,target}),/架构/)
  const duplicate=files();duplicate.push(duplicate[0]);write(duplicate);assert.throws(()=>validatePackage(file,{version,target}),/重复/)
  const traversal=files();traversal.push(['../outside',Buffer.from('bad')]);write(traversal);assert.throws(()=>validatePackage(file,{version,target}),/越界/)
  if(!target.includes('windows')){const noExec=files();noExec[1][2]=0o100644;write(noExec);assert.throws(()=>validatePackage(file,{version,target}),/执行权限/)}
 }
 const tag=`providers-v${version}`,repo='sinner351sdf/AIBuddy-Panel',run={head_sha:sha,status:'completed',conclusion:'success',path:'.github/workflows/provider-plugin-build.yml',repository:{full_name:repo},head_branch:tag,event:'push'},artifacts={artifacts:TARGETS.map(target=>({name:`provider-${target}`,expired:false,size_in_bytes:100,workflow_run:{head_sha:sha}}))}
 assert.equal(collectPackages(temp,tag,sha,allKeys).length,15)
 // Exercise the real offline signer across all targets, independently written ZIPs,
 // original build manifests/checksums, actual keygen and post-signature validation.
 const offline=path.join(temp,'unsigned'),signed=path.join(temp,'signed'),keyFile=path.join(temp,'fixture.key.json')
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
 execFileSync(process.execPath,[path.join(root,'provider-plugin/scripts/sign.mjs'),'keygen','--key',keyFile,'--key-id','fixture-offline'],{stdio:'pipe'})
 if(process.platform!=='win32')assert.equal(fs.statSync(keyFile).mode&0o777,0o600)
 assert.throws(()=>execFileSync(process.execPath,[path.join(root,'provider-plugin/scripts/sign.mjs'),'keygen','--key',keyFile],{stdio:'pipe'}))
 const key=JSON.parse(fs.readFileSync(keyFile)),publicHex=crypto.createPublicKey(key.privateKeyPem).export({type:'spki',format:'der'}).subarray(-32).toString('hex'),offlineKeys={[key.keyId]:publicHex}
 fs.mkdirSync(offline)
 for(const target of TARGETS){
  const name=`${PACK_ID}-${version}-${target}.zip`,source=path.join(temp,`provider-${target}`,name),entries=zipEntries(fs.readFileSync(source))
  const manifest=JSON.parse(entries.get('pack.json').data);delete manifest.signature
  entries.get('pack.json').data=Buffer.from(JSON.stringify(manifest))
  const dir=path.join(offline,`provider-${target}`);fs.mkdirSync(dir);const file=path.join(dir,name)
  fs.writeFileSync(file,zip([...entries].map(([name,e])=>[name,e.data,e.mode])))
  const checked=validatePackage(file,{version,target})
  fs.writeFileSync(`${file}.build.json`,JSON.stringify({...JSON.parse(fs.readFileSync(`${source}.build.json`)),...checked}))
  fs.writeFileSync(`${file}.sha256`,`${checked.sha256}  ${name}\n`)
 }
 const options={input:offline,output:signed,tag,sha,keyFile,trustedKeys:offlineKeys}
 assert.throws(()=>signArtifacts({...options,sha:'b'.repeat(40)}),/构建清单/);assert.ok(!fs.existsSync(signed))
 assert.throws(()=>signArtifacts({...options,trustedKeys:{}}),/reviewed trusted/)
 if(process.platform!=='win32'){fs.chmodSync(keyFile,0o644);assert.throws(()=>signArtifacts(options),/0600/);fs.chmodSync(keyFile,0o600)}
 assert.equal(signArtifacts(options).targets,5);assert.equal(collectPackages(signed,tag,sha,offlineKeys).length,15)
 assert.throws(()=>signArtifacts(options),/already exist/)
 assert.equal(collectPackages(offline,tag,sha,offlineKeys,{requireSigned:false}).length,15,'unsigned inputs remain intact')
 const productionKeys=JSON.parse(fs.readFileSync(path.join(root,'provider-plugin/trusted-keys.json'))),hostTrust=fs.readFileSync(path.join(root,'desktop-tauri/src-tauri/server/src/server/core/plugin_host/install.rs'),'utf8')
 for(const [id,hex] of Object.entries(productionKeys)){assert.ok(!id.startsWith('fixture'));assert.match(hex,/^[0-9a-f]{64}$/);assert.ok(hostTrust.includes(`"${id}"`)&&hostTrust.includes(`"${hex}"`))}
 assert.throws(()=>collectPackages(temp,tag,'b'.repeat(40),allKeys),/构建清单/)
 const recordFile=path.join(temp,`provider-${TARGETS[0]}`,`${PACK_ID}-${version}-${TARGETS[0]}.zip.build.json`),record=JSON.parse(fs.readFileSync(recordFile))
 fs.writeFileSync(recordFile,JSON.stringify({...record,sourceRepo:'other/repo'}));assert.throws(()=>collectPackages(temp,tag,sha,allKeys),/构建清单/);fs.writeFileSync(recordFile,JSON.stringify(record))
 fs.writeFileSync(recordFile,JSON.stringify({...record,schemaVersion:18}));assert.throws(()=>collectPackages(temp,tag,sha,allKeys),/构建清单/);fs.writeFileSync(recordFile,JSON.stringify(record))
 const checksumFile=recordFile.replace('.build.json','.sha256'),checksum=fs.readFileSync(checksumFile)
 fs.writeFileSync(checksumFile,'bad');assert.throws(()=>collectPackages(temp,tag,sha,allKeys),/校验文件/);fs.writeFileSync(checksumFile,checksum)
 validateBuild(run,artifacts,sha,tag,repo)
 assert.throws(()=>validateBuild({...run,path:'.github/workflows/build.yml'},artifacts,sha,tag,repo),/构建来源/)
 assert.throws(()=>validateBuild(run,{artifacts:artifacts.artifacts.slice(1)},sha,tag,repo),/附件缺失/)
 assert.throws(()=>validateBuild(run,artifacts,'b'.repeat(40),tag,repo),/构建来源/)
 const compressed=zip([['fixture',Buffer.alloc(1024*1024,0x61)]],8)
 assert.equal(zipEntries(compressed).get('fixture').data.length,1024*1024)
 const directory=compressed.readUInt32LE(compressed.length-6)
 const badCrc=Buffer.from(compressed);badCrc.writeUInt32LE(0,directory+16);assert.throws(()=>zipEntries(badCrc),/校验/)
 const oversized=Buffer.from(compressed);oversized.writeUInt32LE(129*1024*1024,directory+24);assert.throws(()=>zipEntries(oversized),/过大/)
 const unsupported=Buffer.from(compressed);unsupported.writeUInt16LE(12,directory+10);assert.throws(()=>zipEntries(unsupported),/不支持/)
 assert.equal(sha256(Buffer.from('fixture')).length,64)
 console.log('PASS: five native architectures, exact package/version/platform/protocol, ZIP store/deflate, CRC and inflation caps, traversal/duplicates, Unix modes, trusted fixture signatures and UI tamper rejection, unsigned publication refusal and five-target workflow provenance, schema manifest and companion checksums')
}finally{fs.rmSync(temp,{recursive:true,force:true})}
