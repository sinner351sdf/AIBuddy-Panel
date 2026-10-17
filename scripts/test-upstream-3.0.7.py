#!/usr/bin/env python3
"""3.0.7 isolated API regression; synthetic accounts only, no provider/model calls."""
from pathlib import Path
import json,os,secrets,socket,sqlite3,subprocess,tempfile,time,urllib.request,urllib.error
ROOT=Path(__file__).resolve().parents[1]
http=urllib.request.build_opener(urllib.request.ProxyHandler({}));checks=0
with tempfile.TemporaryDirectory(prefix='aibuddy-307-api-') as tmp:
 home=Path(tmp);token=None;process=None
 with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
 env={k:v for k,v in os.environ.items() if not k.startswith(('AGENT2API_','WORKBUDDY_','ORCATERM_'))}
 env.update(AGENT2API_HOST='127.0.0.1',AGENT2API_PROXY_PORT=str(port),AGENT2API_PROXY_HOME=tmp,AGENT2API_CAPTCHA_ENABLED='0',AGENT2API_UI_DIR=str(ROOT/'desktop-tauri/ui'))
 (home/'config.json').write_text(json.dumps({'modelsDevEnabled':False,'scheduledTasks':{key:{'enabled':False} for key in ['credentialMaintenance','modelRefresh','updateCheck']}}))
 password=secrets.token_urlsafe(24)
 def check(ok,note):
  global checks
  assert ok,note;checks+=1
 def req(path,method='GET',body=None,status=200,auth=True):
  headers={'Content-Type':'application/json'}
  if token and auth:headers['x-panel-token']=token
  try:response=http.open(urllib.request.Request(f'http://127.0.0.1:{port}'+path,method=method,headers=headers,data=None if body is None else json.dumps(body).encode()),timeout=15)
  except urllib.error.HTTPError as error:response=error
  with response:data=response.read();check(response.status==status,f'{method} {path} {response.status} {data[:200]}')
  data=json.loads(data);return data.get('data',data)
 def start():
  global process
  log=(home/'server.log').open('ab');process=subprocess.Popen([str(ROOT/'target/debug/agent2api-server')],env=env,stdout=log,stderr=log);log.close()
  for _ in range(150):
   assert process.poll() is None,(home/'server.log').read_text()[-2000:]
   try:http.open(f'http://127.0.0.1:{port}/health',timeout=.2).close();return
   except OSError:time.sleep(.1)
  raise AssertionError('startup timed out')
 try:
  start();token=req('/api/panel/setup?auth-mode=body','POST',{'username':'fixture','password':password})['accessToken']
  keep=req('/api/checkin-keepalive');check(keep['webConversationEnabled'] is False,'new web conversation must default off')
  req('/api/checkin-keepalive',auth=False,status=401)
  for provider in ['workbuddy','workbuddy-intl','orcaterm']:
   req('/api/accounts','POST',{'provider':provider,'importDesktop':True},status=403)
  req('/api/checkin-keepalive','POST',{'webConversationEnabled':'true'},status=400)
  req('/api/checkin-keepalive','POST',{'webConversationEnabled':True,'models':[]},status=400)
  check(req('/api/checkin-keepalive')['webConversationEnabled'] is False,'invalid request changed flag')
  check(req('/api/checkin-keepalive','POST',{'webConversationEnabled':True})['webConversationEnabled'] is True,'explicit opt-in failed')
  keep=req('/api/checkin-keepalive','POST',{'models':['hy3','hy3',' deepseek-v4.1-flash ']})
  check(keep['models']==['hy3','deepseek-v4.1-flash'] and keep['webConversationEnabled'] is True,'legacy model save reset opt-in')
  keep=req('/api/checkin-keepalive','POST',{'webConversationEnabled':False})
  check(keep['models']==['hy3','deepseek-v4.1-flash'] and keep['webConversationEnabled'] is False,'flag save changed model chain')
  ids=[]
  for index,body in enumerate([
   {'access_token':'synthetic-flat','refresh_token':'synthetic-refresh','uid':'307-flat','name':'flat-fixture','provider':'workbuddy-intl','domain':'https://www.workbuddy.ai'},
   {'auth':{'accessToken':'synthetic-nested','refreshToken':'synthetic-refresh','domain':'https://www.codebuddy.cn'},'account':{'uid':'307-nested','nickName':'nested-fixture'},'provider':'workbuddy'}]):
   data=req('/api/accounts','POST',body);ids.append(data['account']['id'])
   check('synthetic-' not in json.dumps(data),'credential leaked via account response')
  req('/api/keys','POST',{'key':'sk-307-fixture','name':'fixture','allowedModels':['fixture-model']})
  try:r=http.open(urllib.request.Request(f'http://127.0.0.1:{port}/api/checkin-keepalive',headers={'Authorization':'Bearer sk-307-fixture'}))
  except urllib.error.HTTPError as error:r=error
  check(r.status==403,'restricted inference key authorized keepalive config');r.close()
  with sqlite3.connect(home/'agent2api.db') as db:
   db.execute("CREATE TRIGGER fixture_reject_web_flag BEFORE INSERT ON kv WHEN NEW.key='checkinWebConversationEnabled' BEGIN SELECT RAISE(ABORT,'fixture disk failure'); END")
  req('/api/checkin-keepalive','POST',{'webConversationEnabled':True},status=500)
  check(req('/api/checkin-keepalive')['webConversationEnabled'] is False,'failed write enabled remote conversations in memory')
  with sqlite3.connect(home/'agent2api.db') as db:db.execute('DROP TRIGGER fixture_reject_web_flag')
  process.terminate();process.wait(timeout=15)
  with sqlite3.connect(home/'agent2api.db') as db:
   check(db.execute('PRAGMA user_version').fetchone()[0]==17,'local schema regressed')
   for account in ids:
    check(db.execute('SELECT data FROM accounts WHERE id=?',(account,)).fetchone()[0].startswith('enc1:'),'import not encrypted')
    check(db.execute('SELECT COUNT(*) FROM account_history WHERE account_id=?',(account,)).fetchone()[0]==1,'historical identity missing')
  start();token=req('/api/panel/login?auth-mode=body','POST',{'username':'fixture','password':password})['accessToken']
  check(req('/api/checkin-keepalive')['webConversationEnabled'] is False,'opt-out not persisted')
  check(req('/api/checkin-keepalive')['models']==['hy3','deepseek-v4.1-flash'],'chain lost after restart')
  for account in ids:req('/api/accounts/'+account,'DELETE')
  with sqlite3.connect(home/'agent2api.db') as db:
   check(db.execute('SELECT COUNT(*) FROM account_history WHERE account_id IN (?,?)',ids).fetchone()[0]==2,'deletion removed imported history')
  print(f'PASS: {checks} isolated API checks; default-off opt-in, strict types, persistence, native import boundary, legacy credentials, encryption/history and restricted-key management isolation')
 finally:
  if process and process.poll() is None:process.terminate();process.wait(timeout=15)
