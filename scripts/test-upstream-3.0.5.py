#!/usr/bin/env python3
"""3.0.5/beta integration: disposable DBs, disabled synthetic accounts, no provider traffic."""
import base64, copy, json, os, secrets, shutil, socket, sqlite3, subprocess, tempfile, time
from pathlib import Path
import urllib.request, urllib.error
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
ROOT=Path(__file__).resolve().parents[1]
CLIENT=urllib.request.build_opener(urllib.request.ProxyHandler({}))
checks=0

def check(ok,message):
    global checks
    assert ok,message
    checks+=1

class Fixture:
    def __init__(self,home):
        self.home=home; self.home.mkdir(exist_ok=True); self.process=None; self.token=None
        with socket.socket() as s: s.bind(('127.0.0.1',0)); self.port=s.getsockname()[1]
        self.base=f'http://127.0.0.1:{self.port}'
        self.env={k:v for k,v in os.environ.items() if not k.startswith(('AGENT2API_','WORKBUDDY_'))}
        self.env.update(AGENT2API_PROXY_HOME=str(home),AGENT2API_PROXY_PORT=str(self.port),AGENT2API_HOST='127.0.0.1',AGENT2API_CAPTCHA_ENABLED='0',AGENT2API_UI_DIR=str(ROOT/'desktop-tauri/ui'))
        (home/'config.json').write_text(json.dumps({'modelsDevEnabled':False,'scheduledTasks':{k:{'enabled':False} for k in ['credentialMaintenance','modelRefresh','updateCheck']}}))
    def start(self):
        with (self.home/'server.log').open('ab') as log: self.process=subprocess.Popen([str(ROOT/'target/debug/agent2api-server')],env=self.env,stdout=log,stderr=log)
        for _ in range(150):
            assert self.process.poll() is None,(self.home/'server.log').read_text()[-1500:]
            try: CLIENT.open(self.base+'/health',timeout=.2).close();return
            except OSError: time.sleep(.1)
        raise AssertionError('startup timeout')
    def stop(self):
        if self.process and self.process.poll() is None:self.process.terminate();self.process.wait(timeout=15)
    def req(self,path,method='GET',body=None,status=200,key=None):
        headers={'Content-Type':'application/json'}
        if key:headers['Authorization']='Bearer '+key
        elif self.token:headers['x-panel-token']=self.token
        r=urllib.request.Request(self.base+path,data=None if body is None else json.dumps(body).encode(),headers=headers,method=method)
        try:res=CLIENT.open(r,timeout=15)
        except urllib.error.HTTPError as error:res=error
        with res:
            raw=res.read(); check(res.status==status,f'{method} {path}: {res.status}, wanted {status}: {raw[:300]}')
        result=json.loads(raw);return result.get('data',result)
    def login(self): self.token=self.req('/api/panel/login?auth-mode=body','POST',{'username':'integration-fixture','password':password})['accessToken']
    def decode(self,text):
        if not text.startswith('enc1:'):return json.loads(text)
        data=base64.b64decode(text[5:]);return json.loads(AESGCM((self.home/'account.key').read_bytes()).decrypt(data[:12],data[12:],None))

password=secrets.token_urlsafe(20)
with tempfile.TemporaryDirectory(prefix='a2a-305-integration-') as tmp:
    root=Path(tmp); f=Fixture(root/'base')
    try:
        f.start();f.token=f.req('/api/panel/setup?auth-mode=body','POST',{'username':'integration-fixture','password':password})['accessToken']
        f.req('/api/upgrade/run','POST',{})
        check(f.req('/api/auto-continue')=={'autoContinue':False,'autoContinueMaxRounds':3},'auto-continue must default off/3')
        f.req('/api/auto-continue','PUT',{'autoContinue':True,'autoContinueMaxRounds':9},status=400)
        check(f.req('/api/auto-continue')['autoContinue'] is False,'invalid partial patch changed flag')
        f.req('/api/auto-continue','PUT',{'autoContinueMaxRounds':2})
        f.req('/api/stats/summary?range=custom&startDate=2026-10-01&endDate=2026-10-02')
        f.req('/api/task-records')
        key='sk-fixture-'+secrets.token_hex(16)
        f.req('/api/keys','POST',{'name':'fixture','key':key})
        f.stop()
        now=int(time.time()*1000)
        account={'id':'fixture-accio','provider':'accio','edition':'intl','editionLabel':'国际版','name':'Fixture','enabled':False,'accessToken':'synthetic-account-secret'}
        with sqlite3.connect(f.home/'agent2api.db') as db:
            db.execute('INSERT INTO accounts(id,provider,priority,enabled,data) VALUES(?,?,0,0,?)',(account['id'],account['provider'],json.dumps(account)))
            db.execute('INSERT INTO request_raw(id,ts,request_body,response_body,size) VALUES(?,?,?,?,?)',('preserved',now,'old body','old response',20))
            db.execute("INSERT INTO requests(id,ts,model,status,account_id,provider,total_tokens) VALUES('preserved',?,'fixture',200,'fixture-accio','accio',1000)",(now,))
            db.execute("INSERT INTO task_runs(batch_id,account_id,account_name,provider,kind,source,started_at,finished_at,outcome) VALUES('fixture','fixture-accio','Fixture','accio','growth','manual',?,?,'completed')",(now,now))
            db.execute("INSERT OR REPLACE INTO kv(key,value) VALUES('logRetentionDays','42')")
            db.executemany('INSERT INTO request_daily(date,requests,successful,tokens) VALUES(?,1,1,?)',[('2026-10-01',111),('2026-10-02',222)])
        f.start();f.login()
        for start,end,expected in [('2026-10-01','2026-10-01',111),('2026-10-02','2026-10-02',222),('2026-10-01','2026-10-02',333)]:
            summary=f.req(f'/api/stats/summary?range=custom&startDate={start}&endDate={end}')
            check(summary['overview']['tokens']==expected,'custom dates selected the wrong token total')
        old_token=f.token; f.stop();f.start()
        check(f.req('/api/task-records')['total']==1,'persistent access session/records lost on restart')
        with sqlite3.connect(f.home/'agent2api.db') as db:
            raw=db.execute('SELECT data FROM accounts').fetchone()[0];check(raw.startswith('enc1:'),'account not encrypted')
            check(f.decode(raw)['accessToken']=='synthetic-account-secret','account decrypt mismatch')
            stored=json.loads(db.execute("SELECT value FROM kv WHERE key='apiKeys'").fetchone()[0])[0]['key']
            check(stored.startswith('enc1:') and key not in stored,'API key not encrypted')
        f.req('/v1/chat/completions','POST',{'model':'fixture','messages':[]},status=401,key=stored)
        snap=f.req('/api/backup/export');check(bool(snap['accountKeyFingerprint']),'JSON backup fingerprint missing')
        check('synthetic-account-secret' not in json.dumps(snap),'backup leaked account credential')
        f.req('/api/backup/import','POST',{'confirm':True,'data':snap});f.req('/api/task-records',status=401);f.login()
        with sqlite3.connect(f.home/'agent2api.db') as db:
            check(db.execute('SELECT data FROM accounts').fetchone()[0].startswith('enc1:'),'JSON restore wrote plaintext')
            check(db.execute('SELECT request_body FROM request_raw').fetchone()[0]=='old body','JSON restore lost raw history')
            check(db.execute("SELECT edition FROM account_history WHERE account_id='fixture-accio'").fetchone()[0]=='intl','JSON restore lost identity')
        legacy=copy.deepcopy(snap);legacy['accounts'][0]['data']=account
        for row in legacy['kv']:
            if row['key']=='apiKeys':
                entries=json.loads(row['value']);entries[0]['key']=key;row['value']=json.dumps(entries)
        f.req('/api/backup/import','POST',{'confirm':True,'data':legacy});f.login()
        with sqlite3.connect(f.home/'agent2api.db') as db:
            check(db.execute('SELECT data FROM accounts').fetchone()[0].startswith('enc1:'),'legacy import not sealed')
        f.stop();seed=root/'seed.db';shutil.copy2(f.home/'agent2api.db',seed); original_key=(f.home/'account.key').read_bytes()
        # Wrong key: encrypted rows survive; ciphertext must not become a working gateway key.
        (f.home/'account.key').write_bytes(secrets.token_bytes(32));f.start();f.login()
        f.req('/api/backup/import','POST',{'confirm':True,'data':snap},status=400)
        f.req('/v1/chat/completions','POST',{'model':'fixture','messages':[]},status=401,key=stored)
        f.stop()
        with sqlite3.connect(f.home/'agent2api.db') as db:check(db.execute('SELECT COUNT(*) FROM accounts').fetchone()[0]==1,'wrong key deleted account')
        # A lost key must not delete ciphertext or silently accept it as a key.
        (f.home/'account.key').unlink();f.start();f.login()
        f.req('/api/backup/import','POST',{'confirm':True,'data':snap},status=400)
        f.req('/v1/chat/completions','POST',{'model':'fixture','messages':[]},status=401,key=stored)
        f.stop()
        with sqlite3.connect(f.home/'agent2api.db') as db:
            check(db.execute('SELECT COUNT(*) FROM accounts').fetchone()[0]==1,'missing key deleted account')
            check(db.execute('SELECT data FROM accounts').fetchone()[0].startswith('enc1:'),'missing key exposed plaintext')
        (f.home/'account.key').write_bytes(original_key)
        # Both lineages use versions 12/13 for different content. Probe real tables and
        # columns, retain old bodies/tasks/settings, repeat startup and inspect snapshots.
        for version,lineage in [(11,'local'),(12,'local'),(13,'local'),(12,'upstream'),(13,'upstream'),(14,'upstream'),(15,'local')]:
            g=Fixture(root/f'{lineage}-{version}')
            try:
                shutil.copy2(seed,g.home/'agent2api.db');(g.home/'config.json').unlink();(g.home/'account.key').write_bytes(original_key)
                with sqlite3.connect(g.home/'agent2api.db') as db:
                    db.execute('DROP TABLE assistant_conversations')
                    if lineage=='upstream':
                        for name in ['insert','update_old','update_new','delete']:db.execute(f'DROP TRIGGER IF EXISTS account_history_{name}')
                        for table in ['account_history','task_run_items','task_runs']:db.execute(f'DROP TABLE {table}')
                    if (lineage=='local' and version<14) or version<12:db.execute('ALTER TABLE requests DROP COLUMN client')
                    db.execute(f'PRAGMA user_version={version}')
                g.start();g.login();g.req('/api/task-records');g.req('/api/stats/summary?range=all');g.stop()
                with sqlite3.connect(g.home/'agent2api.db') as db:
                    check(db.execute('PRAGMA user_version').fetchone()[0]==16,'schema did not migrate')
                    check(db.execute('SELECT COUNT(*) FROM assistant_conversations').fetchone()[0]==0,'assistant history table missing')
                    check(db.execute('SELECT request_body FROM request_raw').fetchone()[0]=='old body','migration deleted body')
                    check(db.execute('SELECT total_tokens FROM requests').fetchone()[0]==1000,'migration changed tokens')
                    check(db.execute("SELECT value FROM kv WHERE key='logRetentionDays'").fetchone()[0]=='42','retention overwritten')
                    check(db.execute('SELECT edition FROM account_history').fetchone()[0]=='intl','history missing after branch migration')
                    check('client' in [r[1] for r in db.execute('PRAGMA table_info(requests)')],'client column missing')
                    check(db.execute('SELECT client FROM requests').fetchone()[0] in ('',None),'old client guessed')
                    if lineage=='local':check(db.execute('SELECT COUNT(*) FROM task_runs').fetchone()[0]==1,'task history deleted')
                backups=list((g.home/'backups').glob('pre-upgrade-*.db'));check(len(backups)==1,'missing consistent pre-upgrade snapshot')
                with sqlite3.connect(backups[0]) as db:check(db.execute('PRAGMA user_version').fetchone()[0]==version,'snapshot mutated')
                g.start();g.login();g.req('/api/task-records');g.stop();check(len(list((g.home/'backups').glob('pre-upgrade-*.db')))==1,'repeated startup duplicated migration')
            finally:g.stop()
        # Inject an error after v14 DDL but before its transaction commits; the
        # next clean startup must resume from v13 with all original rows intact.
        g=Fixture(root/'interrupted-migration')
        try:
            shutil.copy2(seed,g.home/'agent2api.db');(g.home/'config.json').unlink();(g.home/'account.key').write_bytes(original_key)
            with sqlite3.connect(g.home/'agent2api.db') as db:
                db.execute('ALTER TABLE requests DROP COLUMN client')
                db.execute('PRAGMA user_version=13')
                db.execute("CREATE TRIGGER fixture_interrupt BEFORE INSERT ON account_history BEGIN SELECT RAISE(ABORT,'fixture-migration-interrupt'); END")
            with (g.home/'server.log').open('ab') as log:
                g.process=subprocess.Popen([str(ROOT/'target/debug/agent2api-server')],env=g.env,stdout=log,stderr=log)
            for _ in range(100):
                if 'fixture-migration-interrupt' in (g.home/'server.log').read_text():break
                time.sleep(.05)
            check('fixture-migration-interrupt' in (g.home/'server.log').read_text(),'migration interruption was not reached')
            g.stop()
            with sqlite3.connect(g.home/'agent2api.db') as db:
                check(db.execute('PRAGMA user_version').fetchone()[0]==13,'failed migration advanced version')
                check('client' not in [r[1] for r in db.execute('PRAGMA table_info(requests)')],'failed migration committed partial DDL')
                check(db.execute('SELECT request_body FROM request_raw').fetchone()[0]=='old body','failed migration lost body')
                check(db.execute('SELECT COUNT(*) FROM task_runs').fetchone()[0]==1,'failed migration lost task history')
                db.execute('DROP TRIGGER fixture_interrupt')
            g.start();g.login();g.req('/api/task-records');g.stop()
            with sqlite3.connect(g.home/'agent2api.db') as db:
                check(db.execute('PRAGMA user_version').fetchone()[0]==16,'migration did not resume')
                check(db.execute('SELECT total_tokens FROM requests').fetchone()[0]==1000,'resumed migration changed totals')
                check(db.execute('SELECT edition FROM account_history').fetchone()[0]=='intl','resumed migration lost history')
        finally:g.stop()
        print(f'PASS: {checks} integration assertions; schema lineage matrix and interrupted migration recovery, encryption, JSON roundtrip/legacy restore, missing/wrong key, persistent sessions, unchanged history/retention; synthetic disabled account only')
    finally:f.stop()
