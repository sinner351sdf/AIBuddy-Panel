#!/usr/bin/env python3
"""3.0.6 regression: disposable database + local OpenAI fixture only. No real accounts."""
import base64, json, os, secrets, socket, sqlite3, subprocess, tempfile, threading, time
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import Request, ProxyHandler, build_opener
from urllib.error import HTTPError
ROOT=Path(__file__).resolve().parents[1]
client=build_opener(ProxyHandler({})); upstream_requests=[]; checks=0
class Upstream(BaseHTTPRequestHandler):
 def log_message(self,*args): pass
 def do_POST(self):
  body=json.loads(self.rfile.read(int(self.headers['Content-Length']))); upstream_requests.append(body)
  frame={'id':'fixture','object':'chat.completion.chunk','model':'fixture-model','choices':[{'index':0,'delta':{'content':'fixture answer'},'finish_reason':None}]}
  end={'id':'fixture','object':'chat.completion.chunk','choices':[{'index':0,'delta':{},'finish_reason':'stop'}],'usage':{'prompt_tokens':12000,'completion_tokens':15,'total_tokens':12015}}
  data=('data: '+json.dumps(frame)+'\n\ndata: '+json.dumps(end)+'\n\ndata: [DONE]\n\n').encode()
  self.send_response(200);self.send_header('Content-Type','text/event-stream');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
server=ThreadingHTTPServer(('127.0.0.1',0),Upstream); threading.Thread(target=server.serve_forever,daemon=True).start()
def check(ok,note):
 global checks
 assert ok,note;checks+=1
with tempfile.TemporaryDirectory(prefix='a2a-306-regression-') as tmp:
 home=Path(tmp); token=None; process=None
 with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
 base=f'http://127.0.0.1:{port}'
 env={k:v for k,v in os.environ.items() if not k.startswith(('AGENT2API_','WORKBUDDY_'))}
 env.update(AGENT2API_PROXY_HOME=tmp,AGENT2API_PROXY_PORT=str(port),AGENT2API_HOST='127.0.0.1',AGENT2API_CAPTCHA_ENABLED='0',AGENT2API_UI_DIR=str(ROOT/'desktop-tauri/ui'))
 (home/'config.json').write_text(json.dumps({'modelsDevEnabled':False,'requestRetentionDays':42,'dailyRetentionDays':400,'scheduledTasks':{k:{'enabled':False} for k in ['credentialMaintenance','modelRefresh','updateCheck']}}))
 def req(path,method='GET',body=None,status=200,auth=True,sse=False):
  headers={'Content-Type':'application/json'}
  if auth and token:headers['x-panel-token']=token
  try:res=client.open(Request(base+path,method=method,headers=headers,data=None if body is None else json.dumps(body).encode()),timeout=20)
  except HTTPError as e:res=e
  with res:raw=res.read();check(res.status==status,f'{method} {path}: {res.status}: {raw[:500]}')
  if sse:return raw.decode()
  data=json.loads(raw);return data.get('data',data)
 def start():
  global process
  log=(home/'server.log').open('ab');process=subprocess.Popen([str(ROOT/'target/debug/agent2api-server')],env=env,stdout=log,stderr=log);log.close()
  for _ in range(200):
   assert process.poll() is None,(home/'server.log').read_text()[-1500:]
   try:client.open(base+'/health',timeout=.2).close();return
   except OSError:time.sleep(.1)
  raise AssertionError('startup timeout')
 try:
  start();token=req('/api/panel/setup?auth-mode=body','POST',{'username':'fixture','password':secrets.token_urlsafe(24)})['accessToken']
  cfg=req('/api/assistant/config')['config'];check({k for k,v in cfg['tools'].items() if v}=={'list_models','list_account_balance'},'only readonly tools default on')
  req('/api/assistant/config',status=401,auth=False)
  before=req('/api/retention');check(before['requestRetentionDays']==42 and before['dailyRetentionDays']==400,'retention changed on upgrade')
  req('/api/retention','PUT',{'requestLogRetentionDays':55})
  check(req('/api/retention')['requestRetentionDays']==55,'upstream retention alias ignored')
  req('/api/retention','PUT',{'requestRetentionDays':42,'requestLogRetentionDays':43},status=400)
  req('/api/retention','PUT',{'requestRetentionDays':42})
  created=req('/api/custom-providers','POST',{'name':'Local Fixture','protocol':'chat_completions','baseUrl':f'http://127.0.0.1:{server.server_port}/v1','apiKey':'synthetic-only'})
  pid=created['provider']['id'];aid=created['account']['id']
  req('/api/custom-providers/models','POST',{'providerId':pid,'models':[{'id':'fixture-model','enabled':True}],'mappings':[]})
  cfg['model']='fixture-model';req('/api/assistant/config','PUT',{'config':cfg})
  tools=[{'type':'function','function':{'name':name,'description':'fixture','parameters':{'type':'object','properties':{}}}} for name in ['list_models','set_account_enabled']]
  text=req('/api/assistant/chat','POST',{'messages':[{'role':'user','content':'fixture'}],'tools':tools},sse=True)
  check('fixture answer' in text and '[DONE]' in text,'stream did not finish')
  check([x['function']['name'] for x in upstream_requests[-1]['tools']]==['list_models'],'disabled tool leaked to model')
  for _ in range(30):
   rows=req('/api/stats/requests?client=AI%20%E5%8A%A9%E6%89%8B')['entries']
   if rows and rows[0]['status']!=0:break
   time.sleep(.1)
  check(rows[0]['client']=='AI 助手' and rows[0]['totalTokens']==12015 and not rows[0]['isTest'],'assistant usage/source not recorded')
  check(req('/api/stats/summary?range=all')['overview']['tokens']==12015,'assistant excluded from report')
  check(req('/api/stats/requests?client=Codex')['matched']==0,'source filter widened')
  preview=req('/api/stats/requests/clear-preview?client=AI%20%E5%8A%A9%E6%89%8B');check(preview is not None,'source preview failed')
  check(req('/api/retention')==before,'assistant changed retention')
  req('/api/keys','POST',{'name':'fixture','key':'sk-fixture-key'})
  headers={'Authorization':'Bearer sk-fixture-key'}
  try:r=client.open(Request(base+'/api/assistant/config',headers=headers),timeout=5)
  except HTTPError as e:r=e
  check(r.status==403,'inference key authorized assistant management');r.close()
  # New balance credentials remain in the existing encrypted account envelope.
  req('/api/custom-providers/update','POST',{'id':pid,'balanceScheme':'new_api'})
  req('/api/accounts/'+aid,'PATCH',{'balanceQuery':{'accessToken':'synthetic-query-secret','userId':'42'}})
  public=req('/api/accounts')
  check('synthetic-query-secret' not in json.dumps(public),'balance query secret leaked in public account')
  check(next(row for row in public['accounts'] if row['id']==aid)['balanceQuery']['hasAccessToken'],'query credential patch was ignored')
  zen=req('/api/custom-providers','POST',{'name':'Zen fixture','protocol':'chat_completions','baseUrl':'https://opencode.ai/zen/v1','clientEmulation':'opencode','balanceScheme':'opencode','apiKey':'synthetic-zen'})
  zid=zen['account']['id']
  req('/api/accounts/'+zid,'PATCH',{'proxy':{'source':'rotate','all':True}})
  failed=req('/api/accounts/usage?id='+zid)['results'][0]
  check('轮询没有可用出口' in failed.get('error',''),'empty rotation pool silently fell back to direct')
  # Local YAML: validate before write, deduplicate identical content, no kernel installed in fixture.
  yaml='proxies: [{name: local-fixture, type: http, server: 127.0.0.1, port: 1}]'
  payload={'name':'Local YAML','fileName':'fixture.yaml','enabled':False,'contentBase64':base64.b64encode(yaml.encode()).decode()}
  local=req('/api/subscriptions/add','POST',payload)
  local_id=local['items'][0]['id'];check(local['items'][0]['kind']=='local','file import became remote subscription')
  req('/api/subscriptions/add','POST',payload,status=400)
  req('/api/subscriptions/add','POST',{**payload,'contentBase64':base64.b64encode(b'proxies: []').decode()},status=400)
  check(req('/api/subscriptions')['items'][0]['id']==local_id,'duplicate/invalid import changed storage')
  process.terminate();process.wait(timeout=15)
  with sqlite3.connect(home/'agent2api.db') as db:
   stored=db.execute('SELECT data FROM accounts WHERE id=?',(aid,)).fetchone()[0]
   check(stored.startswith('enc1:'),'custom account not encrypted')
   from cryptography.hazmat.primitives.ciphers.aead import AESGCM
   sealed=base64.b64decode(stored[5:]);decoded=json.loads(AESGCM((home/'account.key').read_bytes()).decrypt(sealed[:12],sealed[12:],None))
   check(decoded['balanceQuery']['accessToken']=='synthetic-query-secret','query credential missing from encrypted record')
   check(db.execute('SELECT COUNT(*) FROM account_history WHERE account_id=?',(aid,)).fetchone()[0]==1,'custom identity missing')
  start();check(req('/api/assistant/config')['config']['model']=='fixture-model','assistant config lost on restart')
  check(req('/api/stats/summary?range=all')['overview']['tokens']==12015,'assistant totals lost on restart')
  print(f'PASS: {checks} checks; readonly defaults, admin-only routes, filtered tool definitions, local SSE terminal+usage, source filter, retention, encrypted account/history and restart')
 finally:
  if process and process.poll() is None:process.terminate();process.wait(timeout=15)
  server.shutdown();server.server_close()
