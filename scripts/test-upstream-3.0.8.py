#!/usr/bin/env python3
"""3.0.8 + beta isolated HTTP regression: synthetic credentials and local upstream only."""
from pathlib import Path
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
import base64,json,os,secrets,socket,sqlite3,subprocess,tempfile,threading,time,urllib.request,urllib.error
ROOT=Path(__file__).resolve().parents[1];client=urllib.request.build_opener(urllib.request.ProxyHandler({}));calls=[];checks=0
class Upstream(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_POST(self):
  calls.append(json.loads(self.rfile.read(int(self.headers.get('Content-Length','0')))))
  body=json.dumps({'id':'fixture','object':'chat.completion','choices':[{'index':0,'message':{'role':'assistant','content':'local fixture answer'},'finish_reason':'stop'}],'usage':{'prompt_tokens':10,'completion_tokens':3,'total_tokens':13}}).encode()
  body=b'data: '+body+b'\n\ndata: [DONE]\n\n'
  self.send_response(200);self.send_header('Content-Type','text/event-stream');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
upstream=ThreadingHTTPServer(('127.0.0.1',0),Upstream);threading.Thread(target=upstream.serve_forever,daemon=True).start()
with tempfile.TemporaryDirectory(prefix='aibuddy-308-api-') as tmp:
 home=Path(tmp);token=None;process=None
 with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
 env={k:v for k,v in os.environ.items() if not k.startswith(('AGENT2API_','WORKBUDDY_','CHATGLM_','ORCATERM_'))}
 env.update(AGENT2API_HOST='127.0.0.1',AGENT2API_PROXY_PORT=str(port),AGENT2API_PROXY_HOME=tmp,AGENT2API_CAPTCHA_ENABLED='0',AGENT2API_UI_DIR=str(ROOT/'desktop-tauri/ui'))
 (home/'config.json').write_text(json.dumps({'modelsDevEnabled':False,'scheduledTasks':{key:{'enabled':False} for key in ['credentialMaintenance','modelRefresh','updateCheck']}}))
 password=secrets.token_urlsafe(24)
 def check(ok,note):
  global checks
  assert ok,note;checks+=1
 def req(path,method='GET',body=None,status=200,auth=True):
  headers={'Content-Type':'application/json'}
  if path.startswith('/v1/'):headers['Authorization']='Bearer sk-308-fixture'
  if auth and token:headers['x-panel-token']=token
  try:r=client.open(urllib.request.Request(f'http://127.0.0.1:{port}'+path,method=method,headers=headers,data=None if body is None else json.dumps(body).encode()),timeout=15)
  except urllib.error.HTTPError as e:r=e
  with r:raw=r.read();check(r.status==status,f'{method} {path}: {r.status} {raw[:250]}')
  if path.startswith('/v1/'):return raw.decode()
  data=json.loads(raw);return data.get('data',data)
 def start():
  global process
  log=(home/'server.log').open('ab');process=subprocess.Popen([str(ROOT/'target/debug/agent2api-server')],env=env,stdout=log,stderr=log);log.close()
  for _ in range(150):
   assert process.poll() is None,(home/'server.log').read_text()[-2000:]
   try:client.open(f'http://127.0.0.1:{port}/health',timeout=.2).close();return
   except OSError:time.sleep(.1)
  raise AssertionError('startup timed out')
 try:
  start();token=req('/api/panel/setup?auth-mode=body','POST',{'username':'fixture','password':password})['accessToken']
  check(req('/api/update/beta')['enabled'] is False,'beta default must be off')
  check(req('/api/developer-role-compat')['developerRoleCompat'] is True,'developer default must be on')
  for path,body in [('/api/update/beta',{'enabled':'true'}),('/api/developer-role-compat',{'developerRoleCompat':'false'})]:req(path,'POST' if 'update' in path else 'PUT',body,status=400)
  req('/api/update/beta',auth=False,status=401);req('/api/developer-role-compat',auth=False,status=401)
  req('/api/update/beta','POST',{'enabled':True})
  provider=req('/api/custom-providers','POST',{'name':'308 local fixture','protocol':'chat_completions','baseUrl':f'http://127.0.0.1:{upstream.server_port}/v1','apiKey':'synthetic-only'})
  req('/api/custom-providers/models','POST',{'providerId':provider['provider']['id'],'models':[{'id':'fixture-308','enabled':True}],'mappings':[]})
  req('/api/keys','POST',{'key':'sk-308-fixture','name':'fixture'})
  messages=[{'role':'developer','content':'fixture instructions'},{'role':'user','content':'fixture question'}]
  req('/v1/chat/completions','POST',{'model':'fixture-308','messages':messages,'stream':True})
  check(calls[-1]['messages'][0]['role']=='system','developer role not normalized')
  check(messages[0]['role']=='developer','caller message mutated')
  req('/api/developer-role-compat','PUT',{'developerRoleCompat':False})
  req('/v1/chat/completions','POST',{'model':'fixture-308','messages':messages,'stream':True})
  check(calls[-1]['messages'][0]['role']=='developer','disabled setting still rewrote role')
  ids=[]
  jwt=lambda data:'eyJhbGciOiJIUzI1NiJ9.'+base64.urlsafe_b64encode(json.dumps(data).encode()).decode().rstrip('=')+'.c3ludGhldGlj'
  files=[('raccoon',{'accessToken':jwt({'uid':'308-raccoon','sub':'308-raccoon','userId':'308-raccoon','exp':int(time.time())+3600}),'uid':'308-raccoon'}),('catpaw',{'auth':{'loginType':'passport','accessToken':'synthetic-catpaw-token'},'account':{'uid':'308-catpaw'}}),('cline-pass',{'providers':{'cline':{'settings':{'auth':{'accessToken':'synthetic-cline-token','refreshToken':'synthetic-cline-refresh','userId':'308-cline'}}}}})]
  for kind,content in files:
   data=req('/api/accounts','POST',{'provider':kind,'authFileContent':json.dumps(content),'authFileName':'fixture.json','name':'308 '+kind,'importDesktop':True});account=data['account'];ids.append(account['id'])
   check('synthetic-' not in json.dumps(account),'credential leaked from file import')
   check(not account.get('desktop',False),'file import incorrectly became desktop pointer')
   req('/api/accounts','POST',{'provider':kind,'authFileContent':'bad json','authFileName':'bad.json'},status=400)
   req('/api/accounts','POST',{'provider':kind,'authFileB64':'AA=='},status=400)
  req('/api/accounts','POST',{'provider':'kuku','authFileB64':base64.b64encode(b'not sqlite').decode(),'authFileName':'Cookies'},status=400)
  req('/api/keys','POST',{'key':'sk-308-restricted','name':'restricted','allowedModels':['fixture-308']})
  for path in ['/api/update/beta','/api/developer-role-compat']:
   try:r=client.open(urllib.request.Request(f'http://127.0.0.1:{port}'+path,headers={'Authorization':'Bearer sk-308-restricted'}),timeout=5)
   except urllib.error.HTTPError as e:r=e
   check(r.status==403,'restricted inference key reached new management API');r.close()
  process.terminate();process.wait(timeout=15)
  with sqlite3.connect(home/'agent2api.db') as db:
   check(db.execute('PRAGMA user_version').fetchone()[0]==17,'schema version not upgraded')
   for aid in ids:
    check(db.execute('SELECT data FROM accounts WHERE id=?',(aid,)).fetchone()[0].startswith('enc1:'),'import not encrypted')
    check(db.execute('SELECT COUNT(*) FROM account_history WHERE account_id=?',(aid,)).fetchone()[0]==1,'import history missing')
   # Simulate a v16 local DB with assistant history, then upgrade indexes without deleting content.
   db.execute("INSERT INTO assistant_conversations VALUES ('308-history','history','[]',2,0,1,1,0)")
   db.execute('DROP INDEX idx_requests_status');db.execute('DROP INDEX idx_requests_summary');db.execute('PRAGMA user_version=16')
  start();token=req('/api/panel/login?auth-mode=body','POST',{'username':'fixture','password':password})['accessToken']
  check(req('/api/update/beta')['enabled'] is True,'beta preference not persisted')
  check(req('/api/developer-role-compat')['developerRoleCompat'] is False,'role setting not persisted')
  summary=req('/api/stats/summary?range=all')
  check(summary['overview']['tokens']==26,'report accounting: '+str(summary['overview'])+' rows='+str(req('/api/stats/requests')['entries']))
  with sqlite3.connect(home/'agent2api.db') as db:
   check(db.execute('PRAGMA user_version').fetchone()[0]==17,'v16 migration not applied')
   check(db.execute("SELECT title FROM assistant_conversations WHERE id='308-history'").fetchone()[0]=='history','assistant history lost during migration')
   check(db.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name IN ('idx_requests_status','idx_requests_summary')").fetchone()[0]==2,'report indexes not created')
  print(f'PASS: {checks} isolated 3.0.8 API checks; role forwarding, beta persistence, credential files, encryption/history, management auth and schema16 migration')
 finally:
  if process and process.poll() is None:process.terminate();process.wait(timeout=15)
  upstream.shutdown();upstream.server_close()
