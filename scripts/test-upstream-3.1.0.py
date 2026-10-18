#!/usr/bin/env python3
"""Isolated 3.1 Agent/travel/history contracts. No real clients, credentials or provider calls."""
from pathlib import Path
import json,os,secrets,socket,sqlite3,subprocess,tempfile,time,urllib.request,urllib.error
ROOT=Path(__file__).resolve().parents[1];client=urllib.request.build_opener(urllib.request.ProxyHandler({}));checks=0

def check(value,note):
 global checks
 assert value,note
 checks+=1

with tempfile.TemporaryDirectory(prefix='aibuddy-310-api-') as temp:
 root=Path(temp);home=root/'client-home';home.mkdir();(home/'.codex').mkdir();(home/'.gemini').mkdir()
 codex=home/'.codex/config.toml';original='model="old"\nother="keep"\n[model_providers.previous.http_headers]\nAuthorization="original-private-token"\n';codex.write_text(original)
 gemini=home/'.gemini/settings.json';gemini.write_text('{"other":true}')
 dotenv=home/'.gemini/.env';dotenv.write_text('GEMINI_API_KEY=old-private-gemini\nHTTP_PROXY=http://fixture.invalid\n')
 with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
 data=root/'data';data.mkdir();(data/'config.json').write_text(json.dumps({'modelsDevEnabled':False,'autoCheckin':{'enabled':False},'scheduledTasks':{k:{'enabled':False} for k in ['credentialMaintenance','modelRefresh','updateCheck']}}))
 env={k:v for k,v in os.environ.items() if not k.startswith(('AGENT2API_','WORKBUDDY_'))};env.update(HOME=str(home),AGENT2API_PROXY_HOME=str(data),AGENT2API_PROXY_PORT=str(port),AGENT2API_HOST='127.0.0.1',AGENT2API_CAPTCHA_ENABLED='0',AGENT2API_UI_DIR=str(ROOT/'desktop-tauri/ui'))
 log=(root/'service.log').open('wb');process=subprocess.Popen([str(ROOT/'target/debug/agent2api-server')],env=env,stdout=log,stderr=log);token=None
 def req(path,method='GET',body=None,status=200,key=None,auth=True):
  headers={'Content-Type':'application/json'}
  if key:headers['Authorization']='Bearer '+key
  elif token and auth:headers['x-panel-token']=token
  request=urllib.request.Request(f'http://127.0.0.1:{port}'+path,headers=headers,method=method,data=None if body is None else json.dumps(body).encode())
  try:r=client.open(request,timeout=15)
  except urllib.error.HTTPError as e:r=e
  with r:raw=r.read();check(r.status==status,f'{method} {path}: {r.status}, expected {status}: {raw[:200]}')
  a=json.loads(raw);return a.get('data',a)
 try:
  for _ in range(150):
   check(process.poll() is None,'fixture exited: '+(root/'service.log').read_text()[-800:])
   try:client.open(f'http://127.0.0.1:{port}/health',timeout=.2).close();break
   except OSError:time.sleep(.1)
  token=req('/api/panel/setup?auth-mode=body','POST',{'username':'fixture','password':secrets.token_urlsafe(20)})['accessToken']
  req('/api/agents',auth=False,status=401)
  key='sk-a2a-agent-local-fixture';req('/api/keys','POST',{'key':key,'name':'Agent fixture'})
  req('/api/agents',key=key,status=403)
  snapshot=req('/api/agents');key_id=snapshot['gateway']['keys'][0]['id']
  check(key not in json.dumps(snapshot),'Agent snapshot leaked real gateway key')
  profile={'id':'fixture','name':'Fixture','kind':'gateway','protocol':'responses','baseUrl':f'http://127.0.0.1:{port}/v1','model':'fixture-model','enabled':True,'default':True,'gatewayKeyId':key_id}
  req('/api/agents/profiles','POST',{'clientId':'codex','profiles':[profile]})
  preview=req('/api/agents/preview','POST',{'clientId':'codex','profileId':'fixture'})
  check('original-private-token' not in json.dumps(preview) and key not in json.dumps(preview),'preview leaked existing/new credentials')
  check(codex.read_text()==original,'preview wrote client configuration')
  req('/api/agents/apply','POST',{'clientId':'codex','profileId':'fixture'})
  check(key in codex.read_text() and 'sk-agent2api-local' not in codex.read_text(),'actual gateway credential missing')
  check('other = "keep"' in codex.read_text(),'unrelated client config lost')
  req('/api/agents/restore','POST',{'clientId':'codex'});check(codex.read_text()==original,'Codex restoration changed original bytes')
  external={**profile,'baseUrl':'https://fixture.invalid/v1'}
  req('/api/agents/profiles','POST',{'clientId':'codex','profiles':[external]});req('/api/agents/apply','POST',{'clientId':'codex'},status=400);check(codex.read_text()==original,'external destination altered config')
  req('/api/agents/profiles','POST',{'clientId':'codex','profiles':[profile]})
  backups=home/'.agent2api/agent-backups';saved=backups.with_name('saved-backups');backups.rename(saved);backups.write_text('block backup directory')
  req('/api/agents/apply','POST',{'clientId':'codex'},status=400);check(codex.read_text()==original,'backup failure allowed write');backups.unlink();saved.rename(backups)
  g={**profile,'protocol':'gemini'};req('/api/agents/profiles','POST',{'clientId':'gemini-cli','profiles':[g]})
  req('/api/agents/apply','POST',{'clientId':'gemini-cli'});check(key in dotenv.read_text(),'Gemini key missing')
  req('/api/agents/restore','POST',{'clientId':'gemini-cli'});check(dotenv.read_text()=='GEMINI_API_KEY=old-private-gemini\nHTTP_PROXY=http://fixture.invalid\n' and gemini.read_text()=='{"other":true}','Gemini two-file restore failed')
  state=req('/api/travel-schedule','POST',{'enabled':False,'times':['09:15','21:30']});check(state['enabled'] is False and state['times']==['09:15','21:30'],'travel config not mapped to persistent scheduler')
  state=req('/api/growth-tasks/schedule');check(state['travelEnabled'] is False,'travel APIs wrote different settings')
  conv=req('/api/assistant/conversations','POST',{});check(bool(conv['conversation']['revision']==0),'local assistant history lost revisions')
  req('/api/assistant/config','PATCH',{'config':{'reasoning':'high'}});check(req('/api/assistant/config')['config']['reasoning']=='high','assistant reasoning did not persist')
  with sqlite3.connect(data/'agent2api.db') as db:
   check(db.execute('pragma user_version').fetchone()[0]==17,'local schema version changed unexpectedly')
   check(db.execute("select count(*) from sqlite_master where name='assistant_sessions'").fetchone()[0]==0,'parallel upstream history table introduced')
   check(db.execute("select count(*) from kv where key='agentProfiles'").fetchone()[0]==1,'Agent profiles not persisted')
  print(f'PASS: {checks} isolated 3.1 assertions; admin gating, credential-safe preview, real-key selection, backup failure, two-file restore, shared scheduler and local history')
 finally:
  process.terminate();process.wait(timeout=15);log.close()
