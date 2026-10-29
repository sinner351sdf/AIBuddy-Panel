// Provider artifacts have their own namespace, identity and provenance. Node 18+.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {inflateRawSync} from 'node:zlib'
import {execFileSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'

export const PACK_ID='aibuddy-providers'
export const TARGETS=['x86_64-pc-windows-msvc','x86_64-apple-darwin','aarch64-apple-darwin','x86_64-unknown-linux-gnu','aarch64-unknown-linux-gnu']
export const sha256=bytes=>crypto.createHash('sha256').update(bytes).digest('hex')
const requireValue=(ok,message)=>{if(!ok)throw new Error(message)}
const semver=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
export function pluginVersion(tag){
 const version=tag.startsWith('providers-v')?tag.slice(11):''
 const match=semver.exec(version)
 requireValue(match&&!match[4]?.split('.').some(x=>/^\d+$/.test(x)&&x.length>1&&x.startsWith('0')),'无效的插件标签')
 return version
}
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return (crc^0xffffffff)>>>0}
export function zipEntries(bytes){
 requireValue(bytes.length>22&&bytes.length<=24*1024*1024,'插件包为空或超过24MB')
 let end=-1
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--){if(bytes.readUInt32LE(i)===0x06054b50&&i+22+bytes.readUInt16LE(i+20)===bytes.length){end=i;break}}
 requireValue(end>=0,'ZIP目录缺失')
 const count=bytes.readUInt16LE(end+10),size=bytes.readUInt32LE(end+12),start=bytes.readUInt32LE(end+16)
 requireValue(bytes.readUInt32LE(end+4)===0&&count===bytes.readUInt16LE(end+8)&&count>0&&count<=4096&&start+size===end,'不支持多卷、ZIP64或异常目录')
 const entries=new Map();let cursor=start,total=0
 for(let n=0;n<count;n++){
  requireValue(cursor+46<=end&&bytes.readUInt32LE(cursor)===0x02014b50,'ZIP目录损坏')
  const flags=bytes.readUInt16LE(cursor+8),method=bytes.readUInt16LE(cursor+10),crc=bytes.readUInt32LE(cursor+16),packed=bytes.readUInt32LE(cursor+20),length=bytes.readUInt32LE(cursor+24)
  const nameLength=bytes.readUInt16LE(cursor+28),extra=bytes.readUInt16LE(cursor+30),comment=bytes.readUInt16LE(cursor+32),mode=bytes.readUInt32LE(cursor+38)>>>16,offset=bytes.readUInt32LE(cursor+42)
  requireValue(cursor+46+nameLength+extra+comment<=end,'ZIP条目越界')
  const name=bytes.subarray(cursor+46,cursor+46+nameLength).toString('utf8')
  requireValue(name&&!name.startsWith('/')&&!name.includes('\\')&&!name.includes(':')&&!name.includes('\0')&&!name.split('/').includes('..')&&!entries.has(name),'ZIP有重复或越界路径')
  requireValue((flags&1)===0&&[0,8].includes(method)&&(mode&0xf000)!==0xa000,'不支持加密、符号链接或异常压缩')
  requireValue(offset+30<=start&&bytes.readUInt32LE(offset)===0x04034b50,'ZIP本地头损坏')
  const localName=bytes.readUInt16LE(offset+26),localExtra=bytes.readUInt16LE(offset+28),dataStart=offset+30+localName+localExtra
  requireValue(bytes.subarray(offset+30,offset+30+localName).toString('utf8')===name&&dataStart+packed<=start,'ZIP头或内容越界')
  total+=length;requireValue(total<=128*1024*1024&&length<=128*1024*1024,'ZIP解压内容过大')
  const compressed=bytes.subarray(dataStart,dataStart+packed),data=method===0?compressed:inflateRawSync(compressed,{maxOutputLength:128*1024*1024})
  requireValue(data.length===length&&crc32(data)===crc,'ZIP校验失败')
  entries.set(name,{data,mode});cursor+=46+nameLength+extra+comment
 }
 requireValue(cursor===end,'ZIP目录条目数量错误');return entries
}
export function signingPayload(manifest,target,entries){
 const binary=entries.get(manifest.entry[target])?.data;requireValue(binary,'插件入口缺失')
 const providers=manifest.providers.map(p=>`${p.id}:${p.order??0}:${p.default_enabled===false?0:1}`).sort()
 const entry=Object.entries(manifest.entry).map(([k,v])=>`${k}=${v}`).sort()
 const ui=[...entries].filter(([name])=>name.startsWith('ui/')&&!name.endsWith('/')).map(([name,value])=>`${name}=${sha256(value.data)}`).sort()
 return `agent2api-pack-v1\nid=${manifest.id}\nversion=${manifest.version}\nprotocol=${manifest.protocol}\ntarget=${target}\nproviders=${providers.join(',')}\nentry=${entry.join(',')}\nbinary=${sha256(binary)}\nui=${ui.join(',')}\n`
}
function binaryTarget(bytes,target){
 if(target.includes('windows')){if(bytes.length<128||bytes.toString('ascii',0,2)!=='MZ')return false;const pe=bytes.readUInt32LE(60);return pe+6<=bytes.length&&bytes.readUInt32LE(pe)===0x4550&&bytes.readUInt16LE(pe+4)===0x8664}
 if(target.includes('linux'))return bytes.length>=64&&bytes.toString('ascii',1,4)==='ELF'&&bytes[4]===2&&bytes[5]===1&&bytes.readUInt16LE(18)===(target.startsWith('aarch64')?183:62)
 return bytes.length>=32&&bytes.readUInt32LE(0)===0xfeedfacf&&bytes.readUInt32LE(4)===(target.startsWith('aarch64')?0x0100000c:0x01000007)
}
export function validatePackage(file,{version,target,requireSigned=false,trustedKeys={}}={}){
 requireValue(TARGETS.includes(target),'不支持的插件平台');pluginVersion(`providers-v${version}`)
 requireValue(path.basename(file)===`${PACK_ID}-${version}-${target}.zip`,'插件资产名与版本/平台不匹配')
 const bytes=fs.readFileSync(file),entries=zipEntries(bytes);requireValue(entries.has('pack.json'),'插件没有pack.json')
 const manifest=JSON.parse(entries.get('pack.json').data.toString('utf8'))
 requireValue(manifest.id===PACK_ID&&manifest.version===version&&manifest.protocol===1,'插件id/version/protocol不匹配')
 requireValue(Array.isArray(manifest.providers)&&manifest.providers.length>0&&manifest.providers.every(p=>/^[a-z0-9-]+$/.test(p.id))&&new Set(manifest.providers.map(p=>p.id)).size===manifest.providers.length,'提供商清单无效')
 requireValue(manifest.entry&&Object.entries(manifest.entry).every(([platform,entry])=>TARGETS.includes(platform)&&typeof entry==='string'&&entry.startsWith('bin/')&&!entry.includes('\\')&&!entry.includes(':')&&!entry.split('/').includes('..')),'插件入口映射无效')
 const entry=manifest.entry?.[target];requireValue(typeof entry==='string'&&entry.startsWith('bin/')&&entries.has(entry),'当前平台入口缺失')
 requireValue(binaryTarget(entries.get(entry).data,target),'插件二进制架构与目标不匹配')
 if(!target.includes('windows'))requireValue((entries.get(entry).mode&0o111)!==0,'Unix入口缺少执行权限')
 let signed=false
 if(manifest.signature){
  const s=manifest.signature,key=trustedKeys[s.keyId]
  requireValue(s.algorithm==='ed25519'&&s.target===target&&typeof key==='string'&&/^[0-9a-f]{64}$/i.test(key),'插件签名或可信密钥不匹配')
  const publicKey=crypto.createPublicKey({format:'der',type:'spki',key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(key,'hex')])})
  requireValue(crypto.verify(null,Buffer.from(signingPayload(manifest,target,entries)),publicKey,Buffer.from(s.value,'base64')),'插件签名校验失败');signed=true
 }
 requireValue(!requireSigned||signed,'发布仅接受已验证的生产签名包')
 return {id:manifest.id,version,target,protocol:manifest.protocol,signed,sha256:sha256(bytes),binarySha256:sha256(entries.get(entry).data),bytes:bytes.length}
}
export function validateBuild(run,artifacts,sha,tag,repo){
 pluginVersion(tag)
 requireValue(run.head_sha===sha&&run.status==='completed'&&run.conclusion==='success'&&run.path==='.github/workflows/provider-plugin-build.yml'&&run.repository?.full_name===repo&&run.head_branch===tag&&run.event==='push','插件构建来源或tag不匹配')
 for(const target of TARGETS){const matches=artifacts.artifacts?.filter(x=>x.name===`provider-${target}`&&!x.expired&&x.size_in_bytes>0)||[];requireValue(matches.length===1&&matches[0].workflow_run?.head_sha===sha,`插件构建附件缺失或来源错误：${target}`)}
}
export function collectPackages(directory,tag,sha,trustedKeys,{requireSigned=true}={}){
 const version=pluginVersion(tag),result=[]
 for(const target of TARGETS){
  const name=`${PACK_ID}-${version}-${target}.zip`,file=path.join(directory,`provider-${target}`,name),checked=validatePackage(file,{version,target,requireSigned,trustedKeys})
  const entries=zipEntries(fs.readFileSync(file))
  for(const notice of ['LICENSE','NOTICE-AIBUDDY.md','licenses/third-party-licenses.txt'])requireValue(entries.get(notice)?.data.length>0,'插件发布附件缺少许可证或版权说明')
  const record=JSON.parse(fs.readFileSync(`${file}.build.json`));requireValue(record.sourceRepo==='sinner351sdf/AIBuddy-Panel'&&record.id===PACK_ID&&record.signed===checked.signed&&record.bytes===checked.bytes&&record.sourceSha===sha&&record.sourceDirty===false&&record.schemaVersion===17&&record.protocol===1&&record.target===target&&record.version===version&&record.sha256===checked.sha256&&record.binarySha256===checked.binarySha256,'插件构建清单不匹配')
  requireValue(fs.readFileSync(`${file}.sha256`,'utf8')===`${checked.sha256}  ${name}\n`,'插件校验文件不匹配');result.push(file,`${file}.build.json`,`${file}.sha256`)
 }
 return result
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const [command,...args]=process.argv.slice(2)
  if(command==='run')validateBuild(JSON.parse(fs.readFileSync(args[0])),JSON.parse(fs.readFileSync(args[1])),...args.slice(2))
  else if(command==='list')process.stdout.write(collectPackages(args[0],args[1],args[2],JSON.parse(fs.readFileSync(args[3]))).join('\0')+'\0')
  else if(command==='manifest'){
   const [file,target,sha]=args,version=JSON.parse(fs.readFileSync('provider-plugin/pack.json')).version
   const checked=validatePackage(file,{version,target});const dirty=execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim().length>0
   const record={...checked,sourceRepo:'sinner351sdf/AIBuddy-Panel',sourceSha:sha,sourceDirty:dirty,schemaVersion:17}
   fs.writeFileSync(`${file}.build.json`,JSON.stringify(record,null,2)+'\n');fs.writeFileSync(`${file}.sha256`,`${checked.sha256}  ${path.basename(file)}\n`)
  }else throw new Error('未知插件校验命令')
 }catch(error){console.error(`错误: ${error.message}`);process.exitCode=1}
}
