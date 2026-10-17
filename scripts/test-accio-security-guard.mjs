// No accounts/network/native binaries needed. Exercise the actual embedded bridge.
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createInterface} from 'node:readline';
import assert from 'node:assert/strict';

const script = await readFile(new URL('../desktop-tauri/src-tauri/server/src/server/core/providers/accio/security_guard.cjs', import.meta.url), 'utf8');
const folder = await mkdtemp(join(tmpdir(), 'accio-sg-test-'));
let probes = 0;
async function probe(source, requests) {
  probes++;
  const module = join(folder, 'sdk.cjs');
  await writeFile(module, source);
  const child = spawn(process.execPath, ['-e', script, module], {stdio:['pipe','pipe','ignore']});
  const lines = createInterface({input:child.stdout});
  const output = [];
  const result = new Promise((resolve, reject) => {
    lines.on('line', line => { if (line.startsWith('@accio-sg:')) output.push(JSON.parse(line.slice(10))); });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve(output) : reject(Error(`worker exited ${code}`)));
  });
  const timer = setTimeout(() => child.kill(), 3000);
  child.stdin.end(requests.map((r,i)=>JSON.stringify({id:i+1,url:'https://example.com/path?sg_k=abc',appkey:'test',binding:'synthetic-session',...r})).join('\n')+'\n');
  try { return await result; } finally { clearTimeout(timer);child.kill(); }
}
const base = `let count=0;module.exports={initUmid:async()=>{count++;return 'token';},getSecurityToken:()=> 'token',getSecurityFactorsForWeb:raw=>JSON.stringify({'pctb-x-api':JSON.parse(raw).api,'pctb-x-data':JSON.parse(raw).data,'x-bx-count':count,'x-bx-text':'a b/+中文'})};`;
try {
  const replies = await probe(base, [{},{}]);
  assert.equal(replies.length,2);
  assert.deepEqual(replies.map(r=>r.id),[1,2]);
  assert.equal(replies[0].init.status,'success');
  assert.equal(replies[1].headers['x-bx-count'],'1');
  assert.equal(replies[0].headers['x-bx-text'],encodeURIComponent('a b/+中文'));
  if (process.platform!=='win32') {
    assert.equal(replies[0].headers['pctb-x-api'],'example.com%2Fpath');
    assert.equal(replies[0].headers['pctb-x-data'],createHash('md5').update('/path?sg_k=abc').digest('hex'));
  }
  const already = await probe(base.replace("count++;return 'token';","throw Object.assign(Error('already'),{errorCode:1});"), [{}]);
  assert.equal(already[0].init.status,'already_initialized');
  const missing = await probe(base.replace("count++;return 'token';","throw Object.assign(Error('failed'),{errorCode:1});").replace("getSecurityToken:()=> 'token'","getSecurityToken:()=> ''"), [{}]);
  assert.equal(missing[0].init.status,'failed');
  assert.equal(missing[0].init.tokenPresent,false);
  for (const [expression,expected] of [["'not JSON'",'sg_parse_error'],["'[]'",'sg_invalid_shape'],["'{}'",'sg_invalid_shape']]) {
    const value = await probe(`module.exports={initUmid:async()=> 'token',getSecurityFactorsForWeb:()=>${expression}};`,[{}]);
    assert.equal(value[0].errType,expected);
  }
  const native = await probe(`module.exports={initUmid:async()=> 'token',getSecurityFactorsForWeb:()=>{throw Object.assign(Error('private native output'),{errorCode:42});}};`,[{}]);
  assert.equal(native[0].errType,'sg_native_error');assert.equal(native[0].errCode,42);
  assert.ok(!JSON.stringify(native).includes('private native output'));
  const cookieSdk = `let env=0;module.exports={initUmid:async()=>{env++;return 'token';},initUmidBySgCookie:async c=>{if(c!=='synthetic-cookie')throw Error('bad cookie');return 'token';},getSecurityToken:()=> 'token',getSecurityFactorsForWeb:()=>JSON.stringify({'x-bx-env-init':env})};`;
  const cookie = await probe(cookieSdk,[{sgcookie:'synthetic-cookie'},{sgcookie:'synthetic-cookie'}]);
  assert.equal(cookie[0].init.mode,'sgcookie');assert.equal(cookie[1].headers['x-bx-env-init'],'0');
  assert.ok(!JSON.stringify(cookie).includes('synthetic-cookie'));
  const switched=await probe(cookieSdk,[{sgcookie:'synthetic-cookie'},{binding:'another-session',sgcookie:'another-cookie'}]);
  assert.equal(switched[1].errType,'sg_context_changed');
  const failedCookie=await probe(cookieSdk,[{sgcookie:'another-cookie'}]);
  assert.equal(failedCookie[0].init.status,'success');
  assert.equal(failedCookie[0].init.mode,'environment');
  assert.equal(failedCookie[0].init.fallbackAttempted,true);
  assert.equal(failedCookie[0].headers['x-bx-env-init'],'1');
  const failingCookieSdk = cookieSdk.replace("if(c!=='synthetic-cookie')throw Error('bad cookie');", "throw Object.assign(Error('private cookie path/token'),{errorCode:42});");
  const fallback = await probe(failingCookieSdk,[{sgcookie:'synthetic-cookie'}, {sgcookie:'synthetic-cookie'}]);
  assert.equal(fallback[0].init.cookieErrorCode,42);
  assert.equal(fallback[1].headers['x-bx-env-init'],'1'); // success cached, not re-initialized
  assert.ok(!JSON.stringify(fallback).includes('private cookie path/token'));
  for (const [code,message,reason] of [[1,'already','already_initialized'],[42,'already in progress /private/token','already_in_progress']]) {
    const sdk = failingCookieSdk.replace("Error('private cookie path/token'),{errorCode:42}", `Error(${JSON.stringify(message)}),{errorCode:${code}}`)
      .replace("getSecurityToken:()=> 'token'", "getSecurityToken:()=> ''");
    const result = await probe(sdk,[{sgcookie:'synthetic-cookie'}]);
    assert.equal(result[0].errType,'sg_init_failed');
    assert.equal(result[0].init.reason,reason);
    assert.equal(result[0].init.fallbackAttempted,false);
    assert.ok(!JSON.stringify(result).includes('/private/token'));
  }
  const alreadyCookie = await probe(failingCookieSdk.replace('{errorCode:42}', '{errorCode:1}'),[{sgcookie:'synthetic-cookie'}]);
  assert.equal(alreadyCookie[0].init.status,'already_initialized');
  assert.equal(alreadyCookie[0].init.fallbackAttempted,false);
  const bothFail = await probe(failingCookieSdk.replace("env++;return 'token';", "env++;throw Object.assign(Error('private fallback token'),{errorCode:43});"),[{sgcookie:'synthetic-cookie'}]);
  assert.equal(bothFail[0].errType,'sg_init_failed');
  assert.equal(bothFail[0].init.cookieErrorCode,42);
  assert.equal(bothFail[0].init.errorCode,43);
  assert.equal(bothFail[0].init.fallbackAttempted,true);
  assert.ok(!JSON.stringify(bothFail).includes('private fallback token'));
  const thrownNull = await probe(cookieSdk.replace("if(c!=='synthetic-cookie')throw Error('bad cookie');return 'token';", "throw null;"),[{sgcookie:'synthetic-cookie'}]);
  assert.equal(thrownNull[0].init.status,'success');
  assert.equal(thrownNull[0].init.cookieErrorCode,null);
  const stub = await probe('module.exports={isStub:true,getSecurityFactorsForWeb(){}};',[{}]);
  assert.equal(stub[0].errType,'sg_unavailable');
  const badUrl = await probe(base,[{url:'file:///tmp/foo'}]);assert.equal(badUrl[0].errType,'sg_bridge_error');
  console.log(`SecurityGuard bridge: ${probes} scenarios passed (conditional fallback, safe codes, cached success, serialization, URL binding, encoding, invalid output, native failure, stub rejection).`);
} finally { await rm(folder,{recursive:true,force:true}); }
