#!/usr/bin/env python3
"""Read and mock-only acceptance against the isolated 3165 gateway."""
import argparse,http.cookiejar,json,pathlib,urllib.request,urllib.error,time,sqlite3
p=argparse.ArgumentParser();p.add_argument('--home',default='/private/tmp/aibuddy-validation-20261025');p.add_argument('--allow-fixture-history',action='store_true',help='Allow only additional demo account-history rows left by the local protocol replay; all original rows remain exact');a=p.parse_args();home=pathlib.Path(a.home);creds=json.loads((home/'test-credentials.json').read_text());base='http://127.0.0.1:3165';jar=http.cookiejar.CookieJar();client=urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPCookieProcessor(jar));checks=[];fixture_history_rows=0
def request(path,method='GET',body=None,key=None,authenticated=True):
 headers={'content-type':'application/json'}
 if key:headers['authorization']='Bearer '+key
 data=None if body is None else json.dumps(body).encode()
 opener=client if authenticated else urllib.request.build_opener(urllib.request.ProxyHandler({}))
 try:
  with opener.open(urllib.request.Request(base+path,data=data,method=method,headers=headers),timeout=45) as r:return r.status,json.load(r)
 except urllib.error.HTTPError as e:
  try:payload=json.load(e)
  except Exception:payload={}
  return e.code,payload

def check(name,condition):
 checks.append({'name':name,'passed':bool(condition)})
 if not condition:raise AssertionError(name)
status,health=request('/health',authenticated=False);check('health returns 200',status==200)
status,login=request('/api/panel/login?tokens=body','POST',{'username':creds['username'],'password':creds['password']});check('admin login',status==200 and login.get('success') is True)
for path in ['/api/session','/api/accounts','/api/plugins','/api/models/manage','/api/checkin-center','/api/growth-tasks/queue','/api/task-records','/api/assistant/conversations','/api/config','/api/backup/progress']:
 status,value=request(path);check('admin read '+path,status==200 and value.get('success') is not False)
# Both distributed inference keys must be unable to install/disable or inspect plugins.
for name in ['fullKey','restrictedKey']:
 for path,method,body in [('/api/plugins','GET',None),('/api/plugins/install','POST',{}),('/api/plugins/enable','POST',{'id':'aibuddy-providers','enabled':False}),('/api/plugins/settings','PATCH',{'autoUpdate':True})]:
  status,_=request(path,method,body,key=creds[name],authenticated=False);check(name+' requires panel session '+path,status==401)
status,_=request('/api/plugins',authenticated=False);check('anonymous plugins denied',status in [401,403])
status,_=request('/api/session/login/raccoon-callback',authenticated=False)
check('legacy raccoon callback route retains state and code validation',status==400)
status,_=request('/api/endpoints',authenticated=False)
check('legacy read-only endpoint inventory remains available',status==200)
status,value=request('/api/accounts/usage?id=nonexistent-validation-account')
check('isolated balance refresh rejected before account lookup or history mutation',status==503 and '保留原有余额记录' in json.dumps(value,ensure_ascii=False))
status,value=request('/api/accounts/usage/packages')
check('preserved credit-package route pauses isolated upstream refresh explicitly',status==200 and '隔离验收已暂停积分包刷新' in json.dumps(value,ensure_ascii=False))
# Check original identities, histories, task rows and user rules in the data copy.
old=sqlite3.connect(home/'baseline/agent2api.db');new=sqlite3.connect(home/'agent2api.db')
for table in ['accounts','assistant_conversations','account_history','task_runs','task_run_items','checkin_records','account_usage_records']:
 exists=old.execute("select 1 from sqlite_master where type='table' and name=?",(table,)).fetchone()
 if not exists:continue
 cols=[r[1] for r in old.execute('pragma table_info("'+table+'")')]
 order='id' if 'id' in cols else 'rowid'
 before=old.execute('select * from "'+table+'" order by '+order).fetchall();after=new.execute('select * from "'+table+'" order by '+order).fetchall()
 if a.allow_fixture_history and table=='account_history':
  by_id={row[cols.index('account_id')]:row for row in after}
  old_ids={row[cols.index('account_id')] for row in before}
  check('data preserved '+table,all(by_id.get(row[cols.index('account_id')])==row for row in before))
  extras=[dict(zip(cols,row)) for row in after if row[cols.index('account_id')] not in old_ids]
  check('additional history belongs only to local demo fixtures',all(row['provider']=='demo' and row['account_id'].startswith('demo-') for row in extras))
  fixture_history_rows=len(extras)
 else:
  check('data preserved '+table,before==after)
check('schema remains 17',new.execute('pragma user_version').fetchone()[0]==17)
old.close();new.close()
report={'url':base,'checkedAt':time.strftime('%Y-%m-%dT%H:%M:%S%z'),'checks':checks,'passed':len(checks),'fixtureHistoryRows':fixture_history_rows,'realProviderActions':0}
(home/'api-acceptance.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps({'passed':len(checks),'report':str(home/'api-acceptance.json')}))
