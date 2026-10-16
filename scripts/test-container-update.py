#!/usr/bin/env python3
"""Isolated Linux update rehearsal. Requires built images and bundle directories.
No production volumes, no real accounts, no publishing or external update source.
"""
import argparse, hashlib, http.server, json, os, secrets, shutil, socket, sqlite3, subprocess, tarfile, tempfile, threading, time, urllib.request, urllib.error
from pathlib import Path
parser=argparse.ArgumentParser();parser.add_argument('--bundles',required=True);parser.add_argument('--image-prefix',default='aibuddy-panel-305-qa');args=parser.parse_args()
client=urllib.request.build_opener(urllib.request.ProxyHandler({}));checks=0

def check(value,msg):
 global checks
 assert value,msg
 checks+=1

def docker(*args):return subprocess.check_output(['docker',*args],text=True,stderr=subprocess.STDOUT).strip()
def freeport():
 with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]

with tempfile.TemporaryDirectory(prefix='a2a-container-update-') as temp:
 root=Path(temp);assets=root/'assets';assets.mkdir();server_port=freeport();fixture_base=f'http://host.docker.internal:{server_port}';bad_checksum=True
 for arch,machine in [('amd64',62),('arm64',183)]:
  bundle=Path(args.bundles)/f'linux_{arch}'/'bundle'
  binary=(bundle/'agent2api-server').read_bytes();check(binary[:4]==b'\x7fELF' and int.from_bytes(binary[18:20],'little')==machine,f'{arch} ELF architecture mismatch')
  stage=root/arch;shutil.copytree(bundle,stage)
  (stage/'update-manifest.json').write_text(json.dumps({'version':'3.0.5','schemaVersion':15}))
  with (stage/'ui/index.html').open('a') as out:out.write('\n<!-- isolated-update-fixture -->\n')
  target=assets/f'agent2api-server-linux-{arch}.tar.gz'
  with tarfile.open(target,'w:gz') as archive:
   for entry in ['agent2api-server','ui','update-manifest.json']:archive.add(stage/entry,arcname=entry)
  digest=hashlib.sha256(target.read_bytes()).hexdigest();Path(str(target)+'.sha256').write_text(f'{digest}  {target.name}\n')
 class Handler(http.server.BaseHTTPRequestHandler):
  def log_message(self,*args):pass
  def do_GET(self):
   if self.path.startswith('/repos/') and self.path.endswith('/releases/latest'):
    payload={'tag_name':'v3.0.5-aibuddy.1','name':'Isolated update fixture','body':'Synthetic update acceptance only','html_url':fixture_base+'/release','assets':[{'name':p.name,'browser_download_url':fixture_base+'/assets/'+p.name,'size':p.stat().st_size} for p in assets.iterdir()]}
    body=json.dumps(payload).encode();typ='application/json'
   elif self.path.startswith('/assets/'):
    name=self.path[len('/assets/'):];p=assets/name
    if '/' in name or not p.is_file():self.send_error(404);return
    body=('0'*64+'  '+name[:-7]).encode() if bad_checksum and name.endswith('.sha256') else p.read_bytes();typ='application/octet-stream'
   else:self.send_error(404);return
   self.send_response(200);self.send_header('Content-Type',typ);self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
 fixture=http.server.ThreadingHTTPServer(('127.0.0.1',server_port),Handler);threading.Thread(target=fixture.serve_forever,daemon=True).start()
 try:
  for arch in ['arm64','amd64']:
   for enabled in [False,True]:
    if arch=='amd64' and not enabled:continue
    home=root/f'data-{arch}-{enabled}';home.mkdir();port=freeport();name=f'a2a-305-qa-{arch}-{secrets.token_hex(3)}';base=f'http://127.0.0.1:{port}';token=None;password=secrets.token_urlsafe(20)
    (home/'config.json').write_text(json.dumps({'modelsDevEnabled':False,'scheduledTasks':{k:{'enabled':False} for k in ['credentialMaintenance','modelRefresh','updateCheck']}}))
    def req(path,method='GET',body=None,status=200,key=None):
     headers={'Content-Type':'application/json'}
     if key:headers['Authorization']='Bearer '+key
     elif token:headers['x-panel-token']=token
     r=urllib.request.Request(base+path,headers=headers,method=method,data=None if body is None else json.dumps(body).encode())
     try:res=client.open(r,timeout=30)
     except urllib.error.HTTPError as error:res=error
     with res:raw=res.read();check(res.status==status,f'{arch} {path}: {res.status}, expected {status}: {raw[:350]}')
     data=json.loads(raw);return data.get('data',data)
    def health():
     for _ in range(200):
      try:
       with client.open(base+'/health',timeout=.5) as r:
        if r.status==200:return
      except OSError:pass
      time.sleep(.1)
     raise AssertionError('health timeout: '+docker('logs','--tail','20',name))
    def restarts():return int(docker('inspect','--format','{{.RestartCount}}',name))
    def restart_via_api():
     previous=restarts();req('/api/update/restart','POST',{})
     for _ in range(200):
      if restarts()>previous:break
      time.sleep(.1)
     check(restarts()>previous,'restart hook did not restart container');health();req('/api/task-records')
    try:
     cmd=['run','-d','--name',name,'--platform','linux/'+arch,'--restart','unless-stopped','-p',f'127.0.0.1:{port}:3065','-v',f'{home}:/data','-e','AGENT2API_CAPTCHA_ENABLED=0','-e',f'WORKBUDDY_UPDATE_API_BASE={fixture_base}']
     if enabled:cmd+=['-e','AGENT2API_SELF_UPDATE=1']
     docker(*cmd,args.image_prefix+':'+arch);health()
     token=req('/api/panel/setup?auth-mode=body','POST',{'username':'container-fixture','password':password})['accessToken']
     # All update network traffic is redirected to the local fake release server.
     result=req('/api/update/check?current=3.0.3')
     check(result['repository']=='sinner351sdf/AIBuddy-Panel','default repository changed')
     check(result['selfUpdate'] is enabled,'default self-update switch incorrect')
     if not enabled:
      req('/api/update/install','POST',{},status=400);continue
     check(result['hasUpdate'] and result['serverAsset']['name']==f'agent2api-server-linux-{arch}.tar.gz','release or architecture selection failed')
     key='sk-'+secrets.token_hex(12);req('/api/keys','POST',{'name':'unrestricted-fixture','key':key})
     req('/api/update/install','POST',{},status=403,key=key)
     archive=f'agent2api-server-linux-{arch}.tar.gz'
     req('/api/update/download','POST',{'url':fixture_base+'/assets/'+archive,'name':archive})
     for _ in range(200):
      progress=req('/api/update/progress')
      if not progress.get('active'):break
      time.sleep(.1)
     check(progress.get('done') and not progress.get('error'),'download failed')
     before=docker('exec',name,'sha256sum','/usr/local/bin/agent2api-server','/app/ui/index.html')
     bad_checksum=True;req('/api/update/install','POST',{},status=502)
     check(docker('exec',name,'sha256sum','/usr/local/bin/agent2api-server','/app/ui/index.html')==before,'checksum failure replaced files')
     bad_checksum=False;req('/api/update/install','POST',{})
     check('isolated-update-fixture' in docker('exec',name,'cat','/app/ui/index.html'),'UI was not installed')
     check(docker('exec',name,'test','-f','/usr/local/bin/agent2api-server.backup')=='','binary backup missing')
     req('/api/update/install','POST',{},status=400)
     req('/api/update/download','POST',{'url':fixture_base+'/assets/'+archive,'name':archive},status=409)
     restart_via_api()
     # Incompatible rollback metadata blocks restoring the old pair without touching DB.
     backup_manifest='/usr/local/bin/agent2api-server.backup.manifest.json'
     lower=root/'lower.json';lower.write_text(json.dumps({'version':'3.0.3','schemaVersion':13}));docker('cp',str(lower),name+':'+backup_manifest)
     req('/api/update/rollback','POST',{},status=400)
     with sqlite3.connect(home/'agent2api.db') as db:check(db.execute('PRAGMA user_version').fetchone()[0]==15,'rollback guard changed database')
     compatible=root/'compatible.json';compatible.write_text(json.dumps({'version':'3.0.5','schemaVersion':15}));docker('cp',str(compatible),name+':'+backup_manifest)
     req('/api/update/rollback','POST',{});restart_via_api()
     check(docker('exec',name,'sha256sum','/usr/local/bin/agent2api-server','/app/ui/index.html')==before,'rollback did not restore the complete pair')
     check(bool(list((home/'backups').glob('pre-upgrade-*.db'))),'install did not snapshot database')
     print(f'PASS: {arch} download/checksum failure/install/restart/session restore/rollback/compatibility guard',flush=True)
    finally:docker('rm','-f',name)
 finally:fixture.shutdown();fixture.server_close()
 print(f'PASS: {checks} isolated Linux container assertions; no production mounts, no real account or provider traffic')
