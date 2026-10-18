import {collectAssets,validateRun} from '../../../../scripts/release-assets.mjs'
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import os from 'node:os'
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'a2a-release-review-'))
try {
 const entries=[['windows-nsis','setup.exe'],['macos-universal','setup.dmg'],['linux-desktop/deb','setup.deb'],['linux-desktop/appimage','setup.AppImage'],['linux-server-amd64','agent2api-server-linux-amd64.tar.gz'],['linux-server-arm64','agent2api-server-linux-arm64.tar.gz'],['windows-server-amd64','agent2api-server-windows-amd64.zip']]
 for(const [folder,name] of entries){const p=path.join(dir,folder);fs.mkdirSync(p,{recursive:true});fs.writeFileSync(path.join(p,name),'synthetic package');if(/\.zip$|\.tar\.gz$/.test(name))fs.writeFileSync(path.join(p,name+'.sha256'),crypto.createHash('sha256').update('synthetic package').digest('hex')+'  '+name+'\n')}
 const assets=collectAssets(dir,'v3.1.0-aibuddy.1').map(p=>path.basename(p));const sha='a'.repeat(40)
 const names=['windows-nsis','macos-universal','linux-desktop','linux-server-amd64','linux-server-arm64']
 let acceptedMissing=false;try{validateRun({head_sha:sha,status:'completed',conclusion:'success',path:'.github/workflows/build.yml',repository:{full_name:'fixture/repo'}},{artifacts:names.map(name=>({name,size_in_bytes:1,expired:false,workflow_run:{head_sha:sha}}))},sha,'v3.1.0-aibuddy.1','fixture/repo');acceptedMissing=true}catch{}
 console.log(JSON.stringify({windowsServerCollected:assets.includes('agent2api-server-windows-amd64.zip'),acceptsRunWithoutWindowsServer:acceptedMissing,assets},null,2))
 if(!assets.includes('agent2api-server-windows-amd64.zip') || acceptedMissing) process.exitCode=1
}finally{fs.rmSync(dir,{recursive:true,force:true})}
