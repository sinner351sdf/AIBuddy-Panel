#!/usr/bin/env python3
"""Isolated 3.1 Agent/travel/history contracts. No real clients, credentials or provider calls."""
from pathlib import Path
import json,os,secrets,socket,sqlite3,subprocess,tempfile,time,urllib.request,urllib.error
ROOT=next(p for p in Path(__file__).resolve().parents if (p/"desktop-tauri/src-tauri/server/Cargo.toml").is_file());client=urllib.request.build_opener(urllib.request.ProxyHandler({}));checks=0

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
  session=req('/api/panel/setup?auth-mode=body','POST',{'username':'fixture','password':secrets.token_urlsafe(20)});token=session['accessToken']
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

  results=[]
  def probe(name,ok,detail):
   results.append({'name':name,'passed':bool(ok),'detail':detail});print(('PASS ' if ok else 'FAIL ')+name+': '+json.dumps(detail,ensure_ascii=False))
  def raw(path,method='GET',body=None,headers=None):
   h={'Content-Type':'application/json','x-panel-token':token,**(headers or {})}
   request=urllib.request.Request(f'http://127.0.0.1:{port}'+path,headers=h,method=method,data=None if body is None else json.dumps(body).encode())
   try:r=client.open(request,timeout=15)
   except urllib.error.HTTPError as e:r=e
   with r:
    status=r.status;hs=dict(r.headers);b=r.read()
   try:payload=json.loads(b)
   except ValueError:payload={}
   return status,hs,payload
  status,headers,_=raw('/api/panel/login','OPTIONS',headers={'Origin':'https://localhost','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,x-panel-auth-mode'})
  allowed=next((v for k,v in headers.items() if k.lower()=='access-control-allow-headers'),'')
  probe('APK login CORS header',status==204 and 'x-panel-auth-mode' in allowed.lower(),{'status':status,'allowHeaders':allowed})
  status,headers,_=raw('/api/panel/refresh','OPTIONS',headers={'Origin':'https://localhost','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,x-panel-auth-mode,x-panel-refresh'})
  allowed=next((v for k,v in headers.items() if k.lower()=='access-control-allow-headers'),'')
  probe('APK refresh CORS headers',status==204 and all(h in allowed.lower() for h in ['x-panel-auth-mode','x-panel-refresh']),{'status':status,'allowHeaders':allowed})
  status,_,payload=raw('/api/panel/refresh','POST',{},headers={'Origin':'https://localhost','x-panel-auth-mode':'body','x-panel-refresh':session['refreshToken']})
  refreshed=payload.get('data',{});probe('APK refresh token rotation',status==200 and bool(refreshed.get('accessToken')) and refreshed.get('refreshToken')!=session['refreshToken'],{'status':status,'hasRotatedToken':bool(refreshed.get('refreshToken'))})
  token=refreshed['accessToken']
  status,_,payload=raw('/api/agents/restore','POST',{'clientId':'codex'})
  probe('Mobile Agent restore payload',status==200,{'status':status,'error':payload.get('error')})
  agent_snapshot=req('/api/agents')
  Path(__file__).with_name('agent-snapshot.json').write_text(json.dumps(agent_snapshot,ensure_ascii=False,indent=2)+'\n')
  live=next(c for c in agent_snapshot['clients'] if c['id']=='codex')
  probe('Mobile Agent field contract',all(k in live for k in ['configPath','viaGateway','configMode','hasBackup']),{'mobileExpects':['configPath','viaGateway','configMode','hasBackup'],'actualFields':sorted(live.keys())})
  # Add synthetic historical travel data to the disposable database, never account state.
  import datetime
  now=int(time.time()*1000);day=datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).strftime('%Y-%m-%d')
  with sqlite3.connect(data/'agent2api.db') as db:
   db.execute('INSERT INTO task_runs(batch_id,account_id,account_name,provider,kind,source,slot,started_at,finished_at,outcome,message) VALUES(?,?,?,?,?,?,?,?,?,?,?)',('review-fixture','deleted-fixture','Fixture','workbuddy','travel','schedule',day+'T09:15',now,now,'success','synthetic completed travel'))
  travel=req('/api/travel-schedule')
  probe('Travel completed-slot state','09:15' in travel.get('firedToday',[]) and travel.get('lastResult') is not None,{'firedToday':travel.get('firedToday'),'lastResult':travel.get('lastResult'),'databaseContainsCompletedSlot':True})
  manual=req('/api/travel-schedule/run','POST',{})
  probe('Travel run summary contract',all(k in manual.get('summary',{}) for k in ['actions','credit','failed']),{'summary':manual.get('summary'),'UIRequires':['actions','credit','failed']})
  wb=home/'.workbuddy/models.json';wb.parent.mkdir();original_wb=json.dumps({'providers':[{'id':'keep-existing','apiKey':'synthetic-existing'}],'other':'keep'});wb.write_text(original_wb)
  req('/api/agents/profiles','POST',{'clientId':'workbuddy','profiles':[{**profile,'protocol':'openai_chat'}]});req('/api/agents/apply','POST',{'clientId':'workbuddy'})
  applied_wb=json.loads(wb.read_text())
  probe('WorkBuddy preserves other providers',any(p['id']=='keep-existing' for p in applied_wb['providers']),{'providerIdsAfterApply':[p['id'] for p in applied_wb['providers']],'otherSetting':applied_wb.get('other')})
  req('/api/agents/restore','POST',{'clientId':'workbuddy'});probe('WorkBuddy backup restores original',wb.read_text()==original_wb,{'restoredOriginalBytes':wb.read_text()==original_wb})
  merged={'providers':[{'id':'first','extra':'left'},{'id':'agent2api','custom':'preserve','apiKey':'synthetic-old'},{'id':'last','extra':'right'}],'other':'keep'};wb.write_text(json.dumps(merged))
  preview=req('/api/agents/preview','POST',{'clientId':'workbuddy'})
  req('/api/agents/apply','POST',{'clientId':'workbuddy'});updated=json.loads(wb.read_text())
  probe('WorkBuddy merges existing provider in place',[p['id'] for p in updated['providers']]==['first','agent2api','last'] and updated['providers'][1].get('custom')=='preserve' and updated['providers'][0]==merged['providers'][0] and updated['providers'][2]==merged['providers'][2],{'providerIds':[p['id'] for p in updated['providers']],'custom':updated['providers'][1].get('custom')})
  req('/api/agents/restore','POST',{'clientId':'workbuddy'});malformed={'providers':{}};wb.write_text(json.dumps(malformed));before=sorted(str(p) for p in backups.rglob('*'))
  req('/api/agents/apply','POST',{'clientId':'workbuddy'},status=400)
  probe('WorkBuddy malformed configuration fails before backup',json.loads(wb.read_text())==malformed and before==sorted(str(p) for p in backups.rglob('*')),{'unchanged':json.loads(wb.read_text())==malformed,'backupUnchanged':before==sorted(str(p) for p in backups.rglob('*'))})
  # A failed second apply must not hide the backup from the successful first apply.
  codex.write_text(original);req('/api/agents/profiles','POST',{'clientId':'codex','profiles':[profile]});req('/api/agents/apply','POST',{'clientId':'codex'})
  valid_bytes=codex.read_text();req('/api/agents/profiles','POST',{'clientId':'codex','profiles':[{**profile,'gatewayKeyId':'does-not-exist'}]});req('/api/agents/apply','POST',{'clientId':'codex'},status=400);req('/api/agents/restore','POST',{'clientId':'codex'})
  probe('Failed apply preserves useful restore point',codex.read_text()==original,{'restoredOriginal':codex.read_text()==original,'restoredPreviouslyAppliedConfig':codex.read_text()==valid_bytes})
  read_results={}
  for path in ['/api/session','/api/stats/summary?range=yesterday','/api/stats/requests?limit=5','/api/logs?limit=5','/api/checkin-center','/api/models/manage','/api/keys','/api/proxies/pool','/api/scheduled-tasks','/api/agents']:
   status,_,payload=raw(path);read_results[path]=status
  probe('Mobile read endpoints',all(s==200 for s in read_results.values()),read_results)
  req('/api/keys','POST',{'key':'sk-review-second-fixture','name':'second fixture'})
  status,_,_=raw('/api/keys/'+key_id,'PATCH',{'enabled':False});probe('Mobile key toggle endpoint',status==200,{'status':status});raw('/api/keys/'+key_id,'PATCH',{'enabled':True})
  # Pending and completed results are isolated by durable batch id.
  with sqlite3.connect(data/'agent2api.db') as db:
   for account,outcome in [('pending-fixture','running'),('failed-fixture','failed')]:
    db.execute('INSERT INTO task_runs(batch_id,account_id,account_name,provider,kind,source,started_at,outcome,message) VALUES(?,?,?,?,?,?,?,?,?)',('pending-review',account,account,'workbuddy','travel','manual',now+1,outcome,'synthetic'))
   rid=db.execute("select id from task_runs where account_id='pending-fixture'").fetchone()[0]
   db.execute('INSERT INTO task_run_items(run_id,code,outcome,message,credit,created_at) VALUES(?,?,?,?,?,?)',(rid,'@travel','success','synthetic reward',37,now+1))
  pending=req('/api/travel-schedule?batchId=pending-review')['lastResult']
  probe('Travel pending batch is not completed',pending['running'] is True and pending['batchId']=='pending-review',{'running':pending['running'],'accounts':pending['accounts']})
  with sqlite3.connect(data/'agent2api.db') as db:
   db.execute("UPDATE task_runs SET outcome='success',finished_at=? WHERE account_id='pending-fixture'",(now+2,))
  complete=req('/api/travel-schedule?batchId=pending-review')['lastResult']
  probe('Travel completed batch totals',complete['running'] is False and complete['credit']==37 and complete['failed']==1 and len(complete['actions'])==2,complete)
  old=req('/api/travel-schedule?batchId=review-fixture')['lastResult']
  probe('Travel batch correlation and unknown reward',old['batchId']=='review-fixture' and old['credit'] is None,{'batchId':old['batchId'],'credit':old['credit']})
  next_state=req('/api/travel-schedule','POST',{'enabled':True})
  probe('Travel next execution time',next_state['nextRunAt']>now,{'nextRunAt':next_state['nextRunAt']})
  result_path=Path(__file__).with_name('contract-results.json');result_path.write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n')
  print('Review contracts:',sum(r['passed'] for r in results),'passed;',sum(not r['passed'] for r in results),'failed')
  print(f'BASELINE: {checks} isolated 3.1 assertions; admin gating, credential-safe preview, real-key selection, backup failure, two-file restore, shared scheduler and local history')
 finally:
  process.terminate();process.wait(timeout=15);log.close()

if any(not row['passed'] for row in results):
 raise SystemExit(1)
