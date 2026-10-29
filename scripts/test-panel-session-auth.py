#!/usr/bin/env python3
"""Local-only panel session contract at 3165, using private fixture credentials."""
import argparse,json,urllib.request,urllib.error
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--home',required=True);a=p.parse_args();h=Path(a.home).resolve();assert str(h).startswith('/private/tmp/')
c=json.loads((h/'test-credentials.json').read_text());base='http://127.0.0.1:3165';checks=[]
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args):return None
client=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
def req(path,method='GET',body=None,token=None,refresh=None,key=None):
 headers={'Accept':'application/json'}
 if token:headers['x-panel-token']=token
 if refresh:headers['x-panel-refresh']=refresh
 if key:headers['x-api-key']=key
 if body is not None:headers.update({'content-type':'application/json','x-panel-auth-mode':'body'})
 request=urllib.request.Request(base+path,data=None if body is None else json.dumps(body).encode(),headers=headers,method=method)
 try:response=client.open(request,timeout=15)
 except urllib.error.HTTPError as e:response=e
 raw=response.read()
 try:value=json.loads(raw)
 except Exception:value={}
 return response.code,response.headers,value

def check(name,ok):
 assert ok,name;checks.append(name)
st,_,login=req('/api/panel/login?auth-mode=body','POST',{'username':c['username'],'password':c['password']});check('fixture administrator login',st==200);access=login['data']['accessToken'];refresh=login['data']['refreshToken']
for key in [c['fullKey'],c['restrictedKey']]:
 for path in ['/api/growth-tasks/queue','/api/task-records','/api/plugins']:
  st,_,body=req(path,token='expired-fixture-access',key=key);check('gateway key cannot replace panel session '+path,st==401 and body['error']['type']=='panel_login_required')
st,headers,_=req('/api/growth-tasks/queue',token='expired-fixture-access',refresh=refresh,key=c['fullKey']);check('live refresh cannot authorize task API',st==401);check('live refresh is preserved on access expiry',headers.get('set-cookie') is None)
st,_,_=req('/',token='expired-fixture-access',refresh=refresh);check('renewable chain can load public shell',st==200)
st,_,_=req('/',token='expired-fixture-access',refresh='invalid-fixture-refresh');check('invalid chain navigates to login',st==302)
st,_,renewed=req('/api/panel/refresh?auth-mode=body','POST',{},refresh=refresh);check('normal refresh succeeds',st==200);fresh=renewed['data']['accessToken']
st,_,body=req('/api/growth-tasks/queue',token=fresh,key=c['restrictedKey']);check('valid administrator authorizes task reads',st==200)
st,_,body=req('/api/panel/status',token=fresh);check('live administrator identity is returned',st==200 and body['data']['username']==c['username'])
st,_,body=req('/api/panel/status',token='expired-fixture-access',key=c['fullKey']);check('public status never treats a gateway key as administrator identity',st==200 and body['data']['username'] is None)
st,_,_=req('/api/panel/refresh?auth-mode=body','POST',{},refresh='invalid-fixture-refresh');check('invalid refresh is definitive 401',st==401)
st,_,_=req('/api/growth-tasks/queue',token=fresh);check('unrelated invalid refresh does not revoke valid session',st==200)
(h/'panel-session-auth-acceptance.json').write_text(json.dumps({'passed':len(checks),'checks':checks,'realProviderActions':0},indent=2));print('PASS:',len(checks),'panel session authorization checks (local fixtures only)')
