#!/usr/bin/env python3
"""Exercise package verification and real child activation only on 3165."""
import pathlib,json,base64,http.cookiejar,urllib.request,urllib.error,hashlib,time,zipfile
home=pathlib.Path('/private/tmp/aibuddy-validation-20261025');fixtures=home/'fixtures';base='http://127.0.0.1:3165';credentials=json.loads((home/'test-credentials.json').read_text());jar=http.cookiejar.CookieJar();opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPCookieProcessor(jar));checks=[]
def call(path,method='GET',body=None):
 req=urllib.request.Request(base+path,data=None if body is None else json.dumps(body).encode(),method=method,headers={'content-type':'application/json'})
 try:
  with opener.open(req,timeout=50) as r:return r.status,json.load(r)
 except urllib.error.HTTPError as e:return e.code,json.load(e)
def check(name,test):
 checks.append({'name':name,'passed':bool(test)})
 if not test:raise AssertionError(name)
def data(value):return value.get('data',value)
def snapshot():return data(call('/api/plugins')[1])
def install(name):return call('/api/plugins/install','POST',{'packB64':base64.b64encode((fixtures/name).read_bytes()).decode()})
def healthy_old(name):
 s=snapshot();packs=s.get('packs',[]);check(name+' old version retained',len(packs)==1 and packs[0]['version']=='0.2.2-lifecycle.1');check(name+' old worker running',s.get('host',{}).get('running') is True)
status,value=call('/api/panel/login','POST',{'username':credentials['username'],'password':credentials['password']});check('admin login',status==200 and value.get('success') is True)
check('fixture run starts with no installed package',not snapshot().get('packs'))
status,value=install('signed-good.zip');check('temporary trusted signed fixture installs',status==200 and value.get('success') is True);healthy_old('first installation');check('signature reflected in registry',snapshot()['packs'][0]['signed'] is True)
registry=home/'plugins/plugins.json';before=registry.read_bytes();entry=home/'plugins/aibuddy-providers/0.2.2-lifecycle.1/bin/worker';binary_before=entry.read_bytes()
for name in ['wrong-protocol.zip','wrong-platform.zip','wrong-id.zip','bad-signature.zip','wrong-signature-platform.zip','signed-tampered.zip','bad-exe.zip','bad-handshake.zip']:
 status,value=install(name);check(name+' rejected',status==400 and value.get('success') is False);healthy_old(name);check(name+' exact registry restored',registry.read_bytes()==before);check(name+' prior binary retained',entry.read_bytes()==binary_before)
# A same-version overwrite must restore the actual previous binary too.
with zipfile.ZipFile(fixtures/'bad-exe.zip') as z:entries={n:z.read(n) for n in z.namelist()}
m=json.loads(entries['pack.json']);m['version']='0.2.2-lifecycle.1';entries['pack.json']=json.dumps(m).encode()
with zipfile.ZipFile(fixtures/'same-version-bad.zip','w') as z:
 for n,b in entries.items():info=zipfile.ZipInfo(n);info.external_attr=(0o100755 if n.startswith('bin/') else 0o100644)<<16;z.writestr(info,b)
status,value=install('same-version-bad.zip');check('same-version bad activation rejected',status==400);healthy_old('same-version rollback');check('same-version exact binary restored',entry.read_bytes()==binary_before);check('same-version exact registry restored',registry.read_bytes()==before)
status,value=call('/api/plugins/enable','POST',{'id':'aibuddy-providers','enabled':False});check('disable succeeds',status==200);s=snapshot();check('disabled state distinct from crash',s['packs'][0]['enabled'] is False and (s.get('host') is None or s['host']['running'] is False))
status,value=call('/api/plugins/enable','POST',{'id':'aibuddy-providers','enabled':True});check('reenable succeeds',status==200);healthy_old('reenable')
status,value=call('/api/plugins/provider','POST',{'id':'aibuddy-providers','provider':'fixture','enabled':False});check('provider disable persists',status==200 and snapshot()['packs'][0]['providers'][0]['enabled'] is False)
status,value=call('/api/plugins/provider','POST',{'id':'aibuddy-providers','provider':'fixture','enabled':True});check('provider enable persists',status==200 and snapshot()['packs'][0]['providers'][0]['enabled'] is True)
status,value=call('/api/plugins/uninstall','POST',{'id':'aibuddy-providers'});check('uninstall succeeds',status==200);check('uninstalled state distinct',not snapshot().get('packs') and not entry.exists())
report={'checkedAt':time.strftime('%Y-%m-%dT%H:%M:%S%z'),'url':base,'checks':checks,'passed':len(checks),'temporaryKeyOnly':True,'realProviderActions':0};(home/'lifecycle-acceptance.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps({'passed':len(checks),'report':str(home/'lifecycle-acceptance.json')}))
