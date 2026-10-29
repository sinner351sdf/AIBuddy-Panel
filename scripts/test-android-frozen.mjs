import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {prepareAndroid,ARCHIVE_SHA256} from './build-android-frozen.mjs'
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'aibuddy-android-freeze-test-'))
try{
 const frozen=prepareAndroid(directory)
 assert.equal(frozen.archiveSha256,ARCHIVE_SHA256)
 assert.equal(frozen.sourceFiles,1617)
 assert.ok(!fs.existsSync(path.join(frozen.source,'provider-plugin')))
 assert.ok(!fs.existsSync(frozen.target));assert.ok(!fs.existsSync(frozen.outputs))
 assert.equal(prepareAndroid(directory).baselineHead,frozen.baselineHead)
 const manifest=path.join(frozen.source,'desktop-tauri/src-tauri/server/Cargo.toml')
 fs.appendFileSync(manifest,'\n# unexpected new server\n')
 assert.throws(()=>prepareAndroid(directory),/Frozen Android source changed/)
 console.log('PASS: exact Android archive hash, 1617 source hashes, frozen shared Rust linkage, isolated outputs, idempotent preparation and tamper refusal; no native build or APK generated')
}finally{fs.rmSync(directory,{recursive:true,force:true})}
