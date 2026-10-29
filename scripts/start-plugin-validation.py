#!/usr/bin/env python3
"""Launch only the isolated gateway copy at 127.0.0.1:3165; never replace 3065."""
import argparse,os,pathlib,socket,subprocess,json,secrets,sqlite3,time,urllib.request,urllib.error
p=argparse.ArgumentParser();p.add_argument('--home',default='/private/tmp/aibuddy-validation-20261025');p.add_argument('--binary',default='/private/tmp/aibuddy-plugin-target/debug/agent2api-server');a=p.parse_args()
home=pathlib.Path(a.home).resolve();root=pathlib.Path(__file__).resolve().parents[1]
if not str(home).startswith(('/private/tmp/','/tmp/')):raise SystemExit('validation requires a private temporary data copy')
if not (home/'agent2api.db').is_file() or not (home/'account.key').is_file():raise SystemExit('missing private database/key copy')
with socket.socket() as probe:
 # Ignore closed connections in TIME_WAIT; an active listener still refuses bind.
 probe.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
 try:probe.bind(('127.0.0.1',3165))
 except OSError:raise SystemExit('3165 occupied; stopping without choosing another port')
cred=home/'test-credentials.json'
if not cred.exists():
 cred.write_text(json.dumps({'username':'aibuddy-validation','password':secrets.token_urlsafe(32),'fullKey':secrets.token_urlsafe(32),'restrictedKey':secrets.token_urlsafe(32)}));cred.chmod(0o600)
credentials=json.loads(cred.read_text())
# Only the isolated copy receives a fixture admin and fixture inference keys.
c=sqlite3.connect(home/'agent2api.db')
c.execute("delete from kv where key in ('panelAdmin','panelTokens','panelAccessSessions','apiKey')")
keys=[{'id':'validation-full','name':'Validation full fixture','key':credentials['fullKey'],'enabled':True,'createdAt':int(time.time()*1000)}, {'id':'validation-restricted','name':'Validation restricted fixture','key':credentials['restrictedKey'],'enabled':True,'createdAt':int(time.time()*1000),'allowedProviders':['demo']}]
c.execute('insert or replace into kv(key,value) values(?,?)',('apiKeys',json.dumps(keys)));c.commit();c.close()
env={key:os.environ[key] for key in ['PATH','HOME','TMPDIR'] if key in os.environ}
env.update(AIBUDDY_VALIDATION_MODE='1',AGENT2API_HOST='127.0.0.1',AGENT2API_PROXY_PORT='3165',AGENT2API_PROXY_HOME=str(home),AGENT2API_UI_DIR=str(root/'desktop-tauri/ui'),AGENT2API_ADMIN_USER=credentials['username'],AGENT2API_ADMIN_PASSWORD=credentials['password'],AGENT2API_CAPTCHA_ENABLED='0',AGENT2API_SELF_UPDATE='0')
trust=home/'fixture-trust.json'
if trust.is_file():env['AIBUDDY_VALIDATION_TRUST_FILE']=str(trust)
with (home/'server.log').open('ab') as log:
 child=subprocess.Popen([str(pathlib.Path(a.binary).resolve())],cwd=root,env=env,stdout=log,stderr=log,start_new_session=True)
(home/'server.pid').write_text(str(child.pid)+'\n')
probe=urllib.request.build_opener(urllib.request.ProxyHandler({}))
for attempt in range(100):
 if child.poll() is not None:raise SystemExit('validation server exited; inspect '+str(home/'server.log'))
 try:
  with probe.open('http://127.0.0.1:3165/health',timeout=1) as response:
   if response.status==200:break
 except (OSError,urllib.error.URLError):pass
 time.sleep(.1)
else:raise SystemExit('validation server did not become healthy; inspect '+str(home/'server.log'))

print(json.dumps({'pid':child.pid,'url':'http://127.0.0.1:3165/','home':str(home),'log':str(home/'server.log'),'credentialsFile':str(cred)}))
