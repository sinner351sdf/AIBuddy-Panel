#!/usr/bin/env python3
"""Isolated task-center API/schema regression. Never loads real account data.
Use --serve to keep a credential-free UI fixture available on 127.0.0.1:13075.
"""
import json,os,secrets,socket,sqlite3,subprocess,tempfile,time,urllib.request,urllib.error,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
BINARY=Path(os.environ.get('AGENT2API_TEST_SERVER_BIN',ROOT/'target/debug/agent2api-server'))
http=urllib.request.build_opener(urllib.request.ProxyHandler({}))
checks=0

def check(ok,msg):
    global checks
    assert ok,msg
    checks+=1

with tempfile.TemporaryDirectory(prefix='agent2api-task-center-') as tmp:
    home=Path(tmp)
    with socket.socket() as s:
        s.bind(('127.0.0.1',0));port=s.getsockname()[1]
    if '--serve' in sys.argv: port=13075
    base=f'http://127.0.0.1:{port}'
    (home/'config.json').write_text(json.dumps({'scheduledTasks':{k:{'enabled':False} for k in ['credentialMaintenance','modelRefresh','updateCheck']}}))
    env={k:v for k,v in os.environ.items() if not k.startswith(('AGENT2API_','WORKBUDDY_'))}
    env.update(AGENT2API_PROXY_HOME=tmp,AGENT2API_PROXY_PORT=str(port),AGENT2API_HOST='127.0.0.1',AGENT2API_CAPTCHA_ENABLED='0',AGENT2API_UI_DIR=str(ROOT/'desktop-tauri/ui'))
    def req(path,method='GET',data=None,token=None,key=None,status=200):
        headers={'Content-Type':'application/json'}
        if token:headers['x-panel-token']=token
        if key:headers['Authorization']='Bearer '+key
        request=urllib.request.Request(base+path,data=None if data is None else json.dumps(data).encode(),headers=headers,method=method)
        try:r=http.open(request,timeout=20)
        except urllib.error.HTTPError as e:r=e
        with r:
            raw=r.read();check(r.status==status,f'{path}: expected {status}, got {r.status}: {raw[:150]}')
            return json.loads(raw)
    def start():
        out=(home/'server.log').open('ab');proc=subprocess.Popen([str(BINARY)],env=env,stdout=out,stderr=out);out.close()
        for _ in range(150):
            if proc.poll() is not None:raise RuntimeError((home/'server.log').read_text()[-2500:])
            try:http.open(base+'/health',timeout=.2).close();return proc
            except OSError:time.sleep(.1)
        raise RuntimeError('startup timeout')
    proc=start()
    try:
        password='task-center-fixture-only' if '--serve' in sys.argv else secrets.token_urlsafe(18)
        token=req('/api/panel/setup?auth-mode=body','POST',{'username':'task-fixture','password':password})['data']['accessToken']
        for path in ['/api/growth-tasks/schedule','/api/task-records','/api/task-records/1']:
            req(path,status=401)
        c=req('/api/growth-tasks/schedule',token=token)['data']
        for k in ['growthEnabled','blackcatEnabled','travelEnabled','activityEnabled','streakEnabled']:check(c[k] is True,k+' missing default-on')
        check(c['blackcatTime']=='01:00' and c['travelHours']==[9,21],'wrong schedule defaults')
        check(len(c['tasks'])==5 and c['timezone']=='Asia/Shanghai','missing runtime summaries')
        req('/api/growth-tasks/schedule','PUT',{'growthEnabled':False,'growthTime':'02:15','firedGrowthDate':'spoof','tasks':[]},token=token)
        c=req('/api/growth-tasks/schedule',token=token)['data']
        check(c['growthEnabled'] is False and c['growthTime']=='02:15','partial preference update lost')
        check(c.get('firedGrowthDate')!='spoof','client rewrote cursor')
        for patch in [{'growthEnabled':'true'},{'blackcatTime':'08:00'},{'travelHours':[-1]},{'travelHours':[24]},{'activityTime':'xx'},{'recordRetentionDays':0}]:req('/api/growth-tasks/schedule','PUT',patch,token=token,status=400)
        req('/api/growth-tasks/run','POST',{'taskKind':'shell'},token=token,status=400)
        req('/api/growth-tasks/run','POST',{'mode':'anything'},token=token,status=400)
        for payload in [{'taskKind':False},{'mode':1},{'concurrency':0},{'concurrency':5},{'concurrency':'2'}]:req('/api/growth-tasks/run','POST',payload,token=token,status=400)
        req('/api/growth-tasks/run','POST',{'taskKind':'activity'},token=token)
        key='sk-fixture-'+secrets.token_hex(16)
        req('/api/keys','POST',{'name':'fixture','key':key},token=token)
        req('/api/task-records',key=key,status=403)
        req('/api/growth-tasks/rewards','POST',{'accountId':'missing','action':'lottery'},token=token,status=404)
        proc.terminate();proc.wait(timeout=10)
        with sqlite3.connect(home/'agent2api.db') as db:
            check(db.execute('pragma user_version').fetchone()[0]>=12,'schema not migrated')
            now=int(time.time()*1000)
            values=('fixture-batch','deleted-account','Task Center Demo','workbuddy','travel','schedule','2026-10-15T09:00',now,'success','已领奖，接续派出')
            db.execute('INSERT INTO task_runs(batch_id,account_id,account_name,provider,kind,source,slot,started_at,outcome,message) VALUES(?,?,?,?,?,?,?,?,?,?)',values)
            rid=db.execute('select last_insert_rowid()').fetchone()[0]
            db.execute('INSERT INTO task_run_items(run_id,code,outcome,message,credit,energy,reward_source,created_at) VALUES(?,?,?,?,?,?,?,?)',(rid,'@travel','success','上游明确返回旅行奖励',100,None,'upstream',now))
            db.execute('INSERT INTO task_run_items(run_id,code,outcome,message,created_at) VALUES(?,?,?,?,?)',(rid,'depart','success','派出成功，上游没有返回奖励金额',now))
            try:
                db.execute('INSERT INTO task_runs(batch_id,account_id,account_name,provider,kind,source,slot,started_at,outcome,message) VALUES(?,?,?,?,?,?,?,?,?,?)',values)
                raise AssertionError('duplicate slot accepted')
            except sqlite3.IntegrityError:check(True,'slot dedup')
            # A stale lease is recovered; a live lease from another instance is not.
            for account,lease in [('stale',0),('live',now+3600000)]:
                db.execute('INSERT INTO task_runs(batch_id,account_id,account_name,provider,kind,source,started_at,lease_until) VALUES(?,?,?,?,?,?,?,?)',('fixture',account,account,'workbuddy','growth','schedule',now,lease))
        proc=start()
        token=req('/api/panel/login?auth-mode=body','POST',{'username':'task-fixture','password':password})['data']['accessToken']
        c=req('/api/growth-tasks/schedule',token=token)['data']
        check(c['growthEnabled'] is False and c['growthTime']=='02:15','restart overwrote saved preferences')
        rows=req('/api/task-records?kind=travel&accountId=deleted-account&limit=999',token=token)['data']
        check(rows['total']==1 and rows['limit']==200,'filter/pagination changed')
        check(rows['items'][0]['accountName']=='Task Center Demo','deleted account history lost')
        detail=req('/api/task-records/'+str(rid),token=token)['data']
        check(detail['items'][0]['credit']==100 and detail['items'][1]['credit'] is None,'unknown reward became zero')
        rows=req('/api/task-records?accountId=stale',token=token)['data'];check(rows['items'][0]['outcome']=='interrupted','stale run not recovered')
        rows=req('/api/task-records?accountId=live',token=token)['data'];check(rows['items'][0]['outcome']=='running','live lease interrupted')
        req('/api/task-records?from=invalid',token=token,status=400)
        req('/api/task-records/999999',token=token,status=404)
        req('/api/growth-tasks/schedule','PUT',{'recordRetentionDays':120},token=token)
        check(req('/api/task-records',token=token)['data']['retentionDays']==120,'retention did not persist')
        # Re-login must preserve user settings, including fields outside the auth schema.
        req('/api/growth-tasks/schedule','PUT',{k:False for k in ['growthEnabled','blackcatEnabled','travelEnabled','activityEnabled','streakEnabled']},token=token)
        proc.terminate();proc.wait(timeout=10)
        with sqlite3.connect(home/'agent2api.db') as db:
            record={'id':'user-fixture-relogin','uid':'fixture-relogin','provider':'workbuddy','edition':'cn','name':'Custom Name','nameCustom':True,'enabled':False,'priority':7,'accessToken':'old-fixture-token','notes':'keep-note','customExtension':{'keep':True}}
            db.execute('INSERT INTO accounts(id,provider,priority,enabled,added_at,data) VALUES(?,?,?,?,?,?)',(record['id'],'workbuddy',7,0,1,json.dumps(record)))
        proc=start();token=req('/api/panel/login?auth-mode=body','POST',{'username':'task-fixture','password':password})['data']['accessToken']
        req('/api/accounts','POST',{'provider':'workbuddy','account':{'uid':'fixture-relogin','nickname':'Changed Upstream Name'},'auth':{'accessToken':'new-fixture-token'}},token=token)
        with sqlite3.connect(home/'agent2api.db') as db:
            raw=db.execute('SELECT data FROM accounts WHERE id=?',('user-fixture-relogin',)).fetchone()[0]
            check(raw.startswith('enc1:'),'account persisted without encryption')
            from cryptography.hazmat.primitives.ciphers.aead import AESGCM
            import base64
            sealed=base64.b64decode(raw[5:]); record=json.loads(AESGCM((home/'account.key').read_bytes()).decrypt(sealed[:12],sealed[12:],None))
            check(record['name']=='Custom Name' and record['enabled'] is False and record['priority']==7,'relogin changed identity/preferences')
            check(record['notes']=='keep-note' and record['customExtension']=={'keep':True},'relogin lost custom fields')
            check(record['accessToken']=='new-fixture-token','relogin did not refresh credential')
        print(f'PASS: {checks} API/schema assertions; isolated home, no provider credentials or requests',flush=True)
        if '--serve' in sys.argv:
            print(f'UI fixture: {base} (task-fixture / task-center-fixture-only); simulated records',flush=True)
            while True:time.sleep(1)
    finally:
        if proc.poll() is None:proc.terminate();proc.wait(timeout=10)
