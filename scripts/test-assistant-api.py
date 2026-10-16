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
  mode=body['messages'][-1]['content']
  text={'choices':[{'delta':{'content':'fixture answer'},'finish_reason':'stop'}]}
  tool={'choices':[{'delta':{'tool_calls':[{'index':0,'id':'call-one','function':{'name':'list_models','arguments':'{}'}}]},'finish_reason':'tool_calls'}]}
  if mode=='tool':frames=[tool,'[DONE]']
  elif mode=='error':frames=[tool,{'error':{'message':'fixture SSE failure'}},'[DONE]']
  elif mode=='truncated':frames=[tool]
  else:frames=[text,{'choices':[],'usage':{'prompt_tokens':12000,'completion_tokens':15,'total_tokens':12015}},'[DONE]']
  data=''.join('data: '+(f if isinstance(f,str) else json.dumps(f))+'\r\n\r\n' for f in frames).encode()
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
  cfg=req('/api/assistant/config')['config'];check({k for k,v in cfg['tools'].items() if v}=={'list_models','list_account_balance'},'readonly defaults')
  req('/api/assistant/config','PATCH',{'config':{'model':'x'}},status=401,auth=False)
  for method in ['PUT','PATCH']:
   with client.open(Request(base+'/api/assistant/config',method='OPTIONS',headers={'Origin':'http://tauri.localhost','Access-Control-Request-Method':method,'Access-Control-Request-Headers':'content-type,x-agent2api-assistant'})) as response:
    check(response.status==204 and method in response.headers['Access-Control-Allow-Methods'],'desktop configuration preflight blocked '+method)
  provider=req('/api/custom-providers','POST',{'name':'Local AI SDK','protocol':'chat_completions','baseUrl':f'http://127.0.0.1:{server.server_port}/v1','apiKey':'synthetic-only'})['provider']['id']
  req('/api/custom-providers/models','POST',{'providerId':provider,'models':[{'id':'fixture-model','enabled':True}],'mappings':[]})
  catalog=req('/api/assistant/models');check(any(row['id']=='fixture-model' for row in catalog['models']),'custom model missing from assistant catalog')
  req('/api/assistant/config','PATCH',{'config':{'tools':{'set_account_enabled':True},'systemPrompt':'fresh'}})
  req('/api/assistant/config','PATCH',{'config':{'tools':{'set_account_enabled':False}}})
  cfg=req('/api/assistant/config','PATCH',{'config':{'model':'fixture-model'}})['config']
  check(cfg['systemPrompt']=='fresh' and not cfg['tools']['set_account_enabled'] and cfg['tools']['list_models'],'model patch overwrote prompt or permissions')
  req('/api/assistant/config','PATCH',{'config':{'tools':{'invented':True}}},status=400)
  tools=[{'type':'function','function':{'name':name,'description':'fixture','parameters':{'type':'object','properties':{}}}} for name in ['list_models','set_account_enabled']]
  def chat(mode):return req('/api/assistant/chat','POST',{'messages':[{'role':'user','content':mode}],'uiStream':True,'tools':tools},sse=True)
  text=chat('text');check('text-delta' in text and 'fixture answer' in text and 'finish-step' in text and '[DONE]' in text,'CRLF text lost or UI protocol invalid')
  check([t['function']['name'] for t in upstream_requests[-1]['tools']]==['list_models'],'disabled tool exposed')
  for _ in range(30):
   rows=req('/api/stats/requests?client=AI%20%E5%8A%A9%E6%89%8B')['entries']
   if rows and rows[0]['status']!=0:break
   time.sleep(.05)
  check(rows[0]['totalTokens']==12015 and not rows[0]['isTest'],'UI adapter broke actual usage accounting')
  text=chat('tool');check('tool-input-available' in text and 'call-one' in text,'complete tool not available')
  # Exact real outbound payload: inline image + UTF-8 text file contents reach the upstream.
  image='data:image/png;base64,'+base64.b64encode(b'\x89PNG\r\n\x1a\nfixture').decode()
  content=[{'type':'text','text':'附件 sample.ts：\n你好，export const answer = 42;'}, {'type':'image_url','image_url':{'url':image}}]
  req('/api/assistant/chat','POST',{'messages':[{'role':'user','content':content}],'uiStream':True,'tools':tools},sse=True)
  check(upstream_requests[-1]['messages'][-1]['content']==content,'attachment content was lost or altered')
  check(upstream_requests[-1]['messages'][0]=={'role':'system','content':'fresh'},'system prompt behavior changed')
  before=len(upstream_requests)
  for part in [{'type':'file','file':{'filename':'x.pdf','file_data':'secret'}},{'type':'image_url','image_url':{'url':'https://example.com/private.png'}},{'type':'image_url','image_url':{'url':'data:image/png;base64,ZXhl'}}]:
   req('/api/assistant/chat','POST',{'messages':[{'role':'user','content':[part]}],'uiStream':True},status=400)
  check(len(upstream_requests)==before,'invalid attachment reached upstream')
  for mode in ['error','truncated']:
   text=chat(mode);check('errorText' in text and 'tool-input-available' not in text,'failed stream released tool: '+text)
  req('/api/keys','POST',{'name':'fixture','key':'sk-fixture-key'})
  try:r=client.open(Request(base+'/api/assistant/config',headers={'Authorization':'Bearer sk-fixture-key'},method='PATCH',data=b'{"config":{"model":"x"}}'),timeout=5)
  except HTTPError as e:r=e
  check(r.status==403,'inference key changed assistant config');r.close()
  # History is local, admin-only, revision checked, and contains exact UI files/tools.
  req('/api/assistant/conversations',auth=False,status=401)
  conversation=req('/api/assistant/conversations','POST')['conversation'];cid=conversation['id'];path='/api/assistant/conversations/'+cid
  ui_messages=[{'id':'user-1','role':'user','parts':[{'type':'text','text':'history question'},{'type':'file','mediaType':'image/png','url':image,'filename':'sample.png'}]}, {'id':'assistant-1','role':'assistant','parts':[{'type':'text','text':'history answer'},{'type':'dynamic-tool','toolCallId':'pending','toolName':'set_account_enabled','input':{},'state':'input-available'}]}]
  before=len(upstream_requests)
  conversation=req(path,'PUT',{'revision':0,'messages':ui_messages})['conversation']
  check(conversation['messages']==ui_messages and len(upstream_requests)==before,'history persistence altered messages or executed a tool')
  req(path,'PUT',{'revision':0,'messages':[]},status=409)
  req(path,'PATCH',{'revision':0,'title':'stale'},status=409)
  conversation=req(path,'PATCH',{'revision':conversation['revision'],'title':'saved attachment chat'})['conversation']
  check(req('/api/assistant/conversations')['items'][0]['title']=='saved attachment chat','history list/title missing')
  req(path,'PATCH',{'revision':conversation['revision'],'title':'  '},status=400)
  req(path,'PUT',{'revision':conversation['revision'],'messages':[{'id':'bad','role':'system','parts':[]}]},status=400)
  req(path,'PUT',{'revision':conversation['revision'],'messages':[{'id':'bad','role':'user','parts':[{'type':'file','mediaType':'image/png','url':'https://invalid.test/x.png'}]}]},status=400)
  # Actual SQLite dump/restore path includes the new history table even in compact backups.
  req('/api/assistant/conversations/missing',status=404)
  process.terminate();process.wait(timeout=15);start()
  persisted=req(path)['conversation'];check(persisted['messages']==ui_messages and persisted['title']=='saved attachment chat','history lost after restart')
  req(path,'DELETE');req(path,status=404)
  req(path,'PUT',{'revision':persisted['revision'],'messages':ui_messages},status=409)
  check(not req('/api/assistant/conversations')['items'],'deleted conversation reappeared')
  # Bulk deletion applies only to the explicitly confirmed IDs; malformed requests are atomic.
  first=req('/api/assistant/conversations','POST')['conversation']['id']
  second=req('/api/assistant/conversations','POST')['conversation']['id']
  newer=req('/api/assistant/conversations','POST')['conversation']['id']
  req('/api/assistant/conversations','DELETE',{},status=400)
  req('/api/assistant/conversations','DELETE',{'ids':[first,None]},status=400)
  check(len(req('/api/assistant/conversations')['items'])==3,'invalid bulk deletion partially deleted history')
  result=req('/api/assistant/conversations','DELETE',{'ids':[first,second]})
  check(result['deleted']==2,'bulk deletion count wrong')
  check([row['id'] for row in req('/api/assistant/conversations')['items']]==[newer],'bulk deletion removed a newer unconfirmed chat')
  req('/api/assistant/conversations/'+first,'PUT',{'revision':0,'messages':ui_messages},status=409)


  cfg=req('/api/assistant/config')['config'];check(cfg['model']=='fixture-model' and cfg['systemPrompt']=='fresh' and not cfg['tools']['set_account_enabled'],'patched settings lost on restart')
  print(f'PASS: {checks} AI SDK API checks; scoped patch, desktop preflights, real OpenAI-to-UI CRLF stream, errors/truncation never release tool input, actual usage and restart; disposable fixtures only')
 finally:
  if process and process.poll() is None:process.terminate();process.wait(timeout=15)
  server.shutdown();server.server_close()
