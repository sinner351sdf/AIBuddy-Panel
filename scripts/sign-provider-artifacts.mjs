// Sign verified CI artifacts offline. Private material never reaches Actions or output assets.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {collectPackages,validatePackage,pluginVersion,TARGETS,PACK_ID} from './provider-plugin-assets.mjs'

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
export function signArtifacts({input,output,tag,sha,keyFile,trustedKeys}){
  if(!/^[0-9a-f]{40}$/.test(sha))throw Error('Expected exact source SHA')
  const keyStat=fs.lstatSync(keyFile)
  if(!keyStat.isFile()||keyStat.isSymbolicLink()||(process.platform!=='win32'&&(keyStat.mode&0o077)))throw Error('Signing key must be a private regular file (0600)')
  if(fs.existsSync(output))throw Error('Signed output must not already exist')
  const version=pluginVersion(tag)
  let key,publicHex
  try{
    key=JSON.parse(fs.readFileSync(keyFile,'utf8'))
    const privateKey=crypto.createPrivateKey(key.privateKeyPem)
    if(privateKey.asymmetricKeyType!=='ed25519')throw Error('wrong key type')
    publicHex=crypto.createPublicKey(privateKey).export({type:'spki',format:'der'}).subarray(-32).toString('hex')
  }catch{throw Error('Signing key file must contain a valid Ed25519 key')}
  if(!Object.hasOwn(trustedKeys,key.keyId)||trustedKeys[key.keyId]!==publicHex)throw Error('Signing key does not match the reviewed trusted public key')
  // Validate every package, original checksum and CI manifest before writing anything.
  collectPackages(input,tag,sha,trustedKeys,{requireSigned:false})
  const staging=fs.mkdtempSync(path.join(path.dirname(path.resolve(output)),'.aibuddy-sign-'))
  try{
    for(const target of TARGETS){
      const name=`${PACK_ID}-${version}-${target}.zip`,source=path.join(input,`provider-${target}`,name)
      const directory=path.join(staging,`provider-${target}`);fs.mkdirSync(directory)
      const file=path.join(directory,name),record=JSON.parse(fs.readFileSync(`${source}.build.json`))
      fs.copyFileSync(source,file)
      execFileSync(process.execPath,[path.join(root,'provider-plugin/scripts/sign.mjs'),'sign','--zip',file,'--key',path.resolve(keyFile),'--target',target],{stdio:'pipe'})
      const checked=validatePackage(file,{version,target,requireSigned:true,trustedKeys})
      if(checked.binarySha256!==record.binarySha256)throw Error('Signing changed the provider binary')
      fs.writeFileSync(`${file}.build.json`,JSON.stringify({...record,...checked,unsignedSha256:record.sha256,signatureKeyId:key.keyId},null,2)+'\n')
      fs.writeFileSync(`${file}.sha256`,`${checked.sha256}  ${name}\n`)
    }
    collectPackages(staging,tag,sha,trustedKeys)
    fs.renameSync(staging,output)
    return {tag,sourceSha:sha,keyId:key.keyId,targets:TARGETS.length}
  }catch(error){fs.rmSync(staging,{recursive:true,force:true});throw error}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),option=name=>{const i=args.indexOf(name);if(i<0||!args[i+1])throw Error(`Missing ${name}`);return args[i+1]}
  try{
    const result=signArtifacts({input:option('--input'),output:option('--out'),tag:option('--tag'),sha:option('--sha'),keyFile:option('--key'),trustedKeys:JSON.parse(fs.readFileSync(option('--trusted-keys')))})
    console.log(JSON.stringify(result))
  }catch(error){console.error(`Offline signing failed: ${error.message}`);process.exitCode=1}
}
