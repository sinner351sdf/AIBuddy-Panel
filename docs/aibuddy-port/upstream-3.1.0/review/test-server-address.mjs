import {normalizeBase} from '../../../../desktop-tauri/mobile/src/lib/servers.ts'
const cases=[['https://gateway.example:443','https://gateway.example:443'],['https://gateway.example','https://gateway.example'],['http://192.168.1.2:3065/m','http://192.168.1.2:3065'],['http://[::1]:3065','http://[::1]:3065']]
const results=cases.map(([input,expected])=>({input,expected,actual:normalizeBase(input),passed:normalizeBase(input)===expected}))
console.log(JSON.stringify(results,null,2))
if(results.some(row=>!row.passed)) process.exitCode=1
