#!/usr/bin/env python3
"""Isolated regression tests for restricted keys, restore sessions and corrupt quota ledgers."""
import json, os, secrets, socket, sqlite3, subprocess, tempfile, time, urllib.request, urllib.error
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
BINARY=ROOT/'desktop-tauri/src-tauri/target/debug/agent2api-server'
client=urllib.request.build_opener(urllib.request.ProxyHandler({}))
def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1',0)); return s.getsockname()[1]
with tempfile.TemporaryDirectory(prefix='agent2api-review-') as tmp:
    home=Path(tmp); gateway,panel=free_port(),free_port()
    (home/'config.json').write_text(json.dumps({'scheduledTasks':{k:{'enabled':False} for k in ('credentialMaintenance','modelRefresh','updateCheck')}}))
    env={k:v for k,v in os.environ.items() if not k.startswith(('AGENT2API_','WORKBUDDY_'))}
    env.update(USERPROFILE=tmp,CODEX_HOME=str(home/'.codex'),AGENT2API_HOST='127.0.0.1',AGENT2API_PROXY_HOME=tmp,
               AGENT2API_PROXY_PORT=str(gateway),AGENT2API_PANEL_PORT=str(panel),AGENT2API_CAPTCHA_ENABLED='0',
               AGENT2API_UI_DIR=str(ROOT/'desktop-tauri/ui'))
    def req(path,method='GET',body=None,token=None,key=None,refresh=None,port=None):
        headers={'Content-Type':'application/json'}
        if token: headers['x-panel-token']=token
        if key: headers['Authorization']='Bearer '+key
        if refresh: headers['x-panel-refresh']=refresh
        request=urllib.request.Request(f'http://127.0.0.1:{port or panel}'+path,method=method,headers=headers,
            data=None if body is None else json.dumps(body).encode())
        try:r=client.open(request,timeout=15)
        except urllib.error.HTTPError as e:r=e
        with r:
            raw=r.read()
            try:data=json.loads(raw)
            except ValueError:data={'non_json':True}
            return r.status,data
    with (home/'server.log').open('w') as log:
        proc=subprocess.Popen([str(BINARY)],env=env,stdout=log,stderr=log)
        try:
            for _ in range(100):
                if proc.poll() is not None:raise RuntimeError('fixture exited')
                try:
                    if req('/health',port=gateway)[0]==200:break
                except OSError:pass
                time.sleep(.1)
            password=secrets.token_urlsafe(20)
            status,login=req('/api/panel/setup?auth-mode=body','POST',{'username':'audit-fixture','password':password})
            assert status==200
            token=login['data']['accessToken']; refresh=login['data']['refreshToken']
            key='sk-review-'+secrets.token_hex(16)
            s,r=req('/api/keys','POST',{'name':'restricted-fixture','key':key},token=token);assert s==200
            kid=r['data']['created']['id']; qp='/api/keys/'+kid+'/quota'
            assert req(qp,'PUT',{'quotaTokens':100,'expiresAt':1},token=token)[0]==200
            expired_v1=req('/v1/chat/completions','POST',{},key=key,port=gateway)[0]
            export_status,export=req('/api/backup/export',key=key)
            reset_status,_=req(qp,'PUT',{'quotaTokens':None,'expiresAt':None,'resetUsed':True},key=key)
            print(json.dumps({'finding':'restricted_key_admin_access','expired_v1':expired_v1,'export':export_status,'self_remove_limits':reset_status,'snapshot_contains_admin':False}))
            assert expired_v1==403 and export_status==403 and reset_status==403
            assert req(qp,'PUT',{'expiresAt':None},token=token)[0]==200
            assert req('/api/keys',key=key)[0]==403
            # Invalid embedded account JSON must fail before changing the database or sessions.
            invalid=req('/api/backup/export',token=token)[1]['data']
            invalid['accounts']=[{'id':'invalid-fixture','provider':'workbuddy','data':'{broken'}]
            assert req('/api/backup/import','POST',{'data':invalid,'confirm':True},token=token)[0]==400
            assert req('/api/keys',token=token)[0]==200
            # A valid snapshot with no persisted refresh-token row must replace old memory too.
            snap=req('/api/backup/export',token=token)[1]['data']
            snap['kv']=[x for x in snap['kv'] if x['key']!='panelTokens']
            assert req('/api/backup/import','POST',{'data':snap,'confirm':True},token=token)[0]==200
            refresh_status,new_login=req('/api/panel/refresh?auth-mode=body','POST',{},refresh=refresh)
            print(json.dumps({'finding':'restore_retains_old_refresh_session','refresh_after_removing_panelTokens':refresh_status}))
            assert refresh_status==401
            assert req('/api/keys',token=token)[0]==401
            status,new_login=req('/api/panel/login?auth-mode=body','POST',{'username':'audit-fixture','password':password})
            assert status==200
            token=new_login['data']['accessToken']
            # Corrupt only the synthetic quota ledger, and check admission before model validation.
            assert req(qp,'PUT',{'quotaTokens':100},token=token)[0]==200
            dbpath=home/'agent2api.db'
            with sqlite3.connect(dbpath) as db:
                db.execute('INSERT OR REPLACE INTO kv(key,value) VALUES (?,?)',('keyQuotaUsage',json.dumps({kid:{'usedTokens':100}})))
            before=req('/v1/chat/completions','POST',{},key=key,port=gateway)
            with sqlite3.connect(dbpath) as db:
                db.execute('UPDATE kv SET value=? WHERE key=?',('{broken','keyQuotaUsage'))
            after=req('/v1/chat/completions','POST',{},key=key,port=gateway)
            used=req(qp,token=token)[1]['data']['usedTokens']
            print(json.dumps({'finding':'corrupt_quota_ledger_fails_open','before_status':before[0],'after_status':after[0],'reported_used':used,'after_error':after[1].get('error')}))
            assert before[0]==403 and after[0]==403 and used is None
            # Split-port Codex setup must use the inference port and preserve existing settings.
            codex=home/'.codex';codex.mkdir(exist_ok=True)
            (codex/'config.toml').write_text('model = "fixture-model"\n[projects."/fixture"]\ntrust_level = "trusted"\n')
            status,setup=req('/api/codex/setup','POST',{'apiKey':key},token=token)
            assert status==200
            assert setup['data']['baseUrl']==f'http://127.0.0.1:{gateway}/v1'
            assert 'fixture-model' in (codex/'config.toml').read_text()
            assert 'trust_level' in (codex/'config.toml').read_text()
            first_backup=(codex/'config.toml.bak').read_text()
            assert req('/api/codex/setup','POST',{'baseUrl':'https://gateway.example/api/v1'},token=token)[0]==200
            assert (codex/'config.toml.bak').read_text()==first_backup
            assert req('/api/codex/setup','POST',{'baseUrl':'file:///tmp/invalid'},token=token)[0]==400
            print('PASS: split-port Codex URL, config preservation, backup retention and invalid URL rejection')
            # Whitelist-only keys are restricted even without expiry or quota.
            for field in ('allowedModels','allowedProviders'):
                child='sk-scope-'+secrets.token_hex(16)
                status,entry=req('/api/keys','POST',{'name':field,'key':child,field:['workbuddy' if field=='allowedProviders' else 'fixture']},token=token)
                assert status==200,entry.get('error')
                assert req('/api/backup/export',key=child)[0]==403
            print('PASS: model/provider whitelist keys cannot export administrative data')
            # New beta management APIs remain protected and custom JSON backups stay compatible.
            for path in ('/api/routing','/api/routing/queue','/api/checkin-schedules','/api/checkin-records','/api/zcode/captcha-pool'):
                assert req(path)[0]==401,path
                assert req(path,key=key)[0]==403,path
                assert req(path,token=token)[0]==200,path
            status,routing=req('/api/routing','PUT',{'routingStrategy':'rotate','routingSticky':'session'},token=token)
            assert status==200 and routing['data']['routingStrategy']=='rotate'
            assert req('/api/routing',token=token)[1]['data']['routingSticky']=='session'
            for path in ('/api/backup/sql/export','/api/backup/sql/import'):
                assert req(path,'POST',{'filePath':'/tmp/must-not-be-written.sql'},token=token)[0]==403
            assert req('/api/checkin-keepalive','POST',{'models':['fixture-first','fixture-second']},token=token)[0]==200
            assert req('/api/checkin-keepalive',token=token)[1]['data']['models']==['fixture-first','fixture-second']
            status,schedules=req('/api/checkin-schedules','POST',{'label':'fixture-schedule','time':'23:59','enabled':False,'providers':['workbuddy']},token=token)
            assert status==200,schedules.get('error')
            matches=[x for x in schedules['data']['schedules'] if x.get('label')=='fixture-schedule']
            assert len(matches)==1
            assert req('/api/checkin-schedules/'+matches[0]['id'],'DELETE',token=token)[0]==200
            print('PASS: beta route authorization, native-only SQL paths, keepalive persistence and schedule CRUD')
        finally:
            proc.terminate()
            try:proc.wait(timeout=10)
            except subprocess.TimeoutExpired:proc.kill();proc.wait()
