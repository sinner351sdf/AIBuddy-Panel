#!/usr/bin/env python3
"""Isolated HTTP regression checks. No real accounts, notifications or model calls.
Run after cargo build: python3 scripts/test-aibuddy-port.py
Use --serve to leave an isolated, registered fixture available for browser review.
"""
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
BINARY = ROOT / 'desktop-tauri/src-tauri/target/debug/agent2api-server'
checks = 0

def check(condition, message):
    global checks
    assert condition, message
    checks += 1

with tempfile.TemporaryDirectory(prefix='agent2api-port-test-') as scratch:
    home = Path(scratch)
    (home / 'config.json').write_text(json.dumps({'scheduledTasks': {
        k: {'enabled': False} for k in ('credentialMaintenance', 'modelRefresh', 'updateCheck')
    }}))
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    env = {k: v for k, v in os.environ.items() if not k.startswith(('AGENT2API_', 'WORKBUDDY_'))}
    env.update(AGENT2API_PROXY_HOME=scratch, AGENT2API_PROXY_PORT=str(port),
               AGENT2API_HOST='127.0.0.1', AGENT2API_CAPTCHA_ENABLED='0',
               AGENT2API_UI_DIR=str(ROOT / 'desktop-tauri/ui'))
    base = f'http://127.0.0.1:{port}'
    # Deliberately bypass environment proxies for the loopback-only test fixture.
    client = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    def req(path, method='GET', body=None, token=None, key=None, expected=200):
        headers = {'Content-Type': 'application/json'}
        if token: headers['x-panel-token'] = token
        if key: headers['Authorization'] = 'Bearer ' + key
        request = urllib.request.Request(base + path, method=method, headers=headers,
            data=None if body is None else json.dumps(body).encode())
        try:
            response = client.open(request, timeout=15)
        except urllib.error.HTTPError as error:
            response = error
        raw = response.read()
        check(response.status == expected, f'{method} {path}: {response.status}, expected {expected}: {raw[:300]!r}')
        try: return json.loads(raw)
        except ValueError: return raw.decode()

    with (home / 'server.log').open('w') as log:
        proc = subprocess.Popen([str(BINARY)], env=env, stdout=log, stderr=log)
        try:
            for _ in range(100):
                if proc.poll() is not None:
                    raise RuntimeError((home / 'server.log').read_text())
                try:
                    client.open(base + '/health', timeout=.2).close()
                    break
                except (OSError, urllib.error.URLError): time.sleep(.1)
            else: raise RuntimeError('fixture failed to start')
            protected = [('/api/audit','GET'), ('/api/keys/missing/quota','GET'),
                ('/api/notify/channels','GET'), ('/api/notify/test','POST'),
                ('/api/sessions/list','GET'), ('/api/sessions/revoke','POST'),
                ('/api/maintenance','PUT'), ('/api/backup/export','GET'),
                ('/api/backup/import','POST'), ('/api/backup/settings','GET'),
                ('/api/backup/run','POST'), ('/api/shutdown','POST'),
                ('/api/branding','PUT'), ('/api/probe/run','POST')]
            for path, method in protected: req(path, method, {} if method != 'GET' else None, expected=401)
            password = secrets.token_urlsafe(18)
            login = req('/api/panel/setup?auth-mode=body', 'POST', {'username':'port-review','password':password})['data']
            token = login['accessToken']
            for path, method in protected: req(path, method, {} if method != 'GET' else None, expected=401)
            def admin(path, method='GET', body=None, **kw): return req(path, method, body, token=token, **kw)
            req('/api/panel/branding')
            req('/api/keys', expected=401)
            key = 'sk-port-test-' + secrets.token_hex(16)
            created = admin('/api/keys','POST',{'name':'regression','key':key})['data']['created']
            kid = created['id']
            quota_path = '/api/keys/' + kid + '/quota'
            quota = admin(quota_path, 'PUT', {'quotaTokens':100,'expiresAt':1})['data']
            check(quota['expired'] and quota['remainingTokens'] == 100, 'quota response')
            for path in ('/v1/chat/completions','/v1/responses','/v1/messages','/v1/embeddings'):
                req(path, 'POST', {}, key=key, expected=403)
            admin(quota_path,'PUT',{'resetUsed':True})
            check(admin(quota_path)['data']['expiresAt'] == 1, 'quota partial update cleared expiry')
            admin(quota_path,'PUT',{'quotaTokens':-1,'expiresAt':None}, expected=400)
            check(admin(quota_path)['data']['expiresAt'] == 1, 'invalid quota partially saved')
            admin('/api/keys/'+kid,'PATCH',{'name':'renamed'})
            check(admin(quota_path)['data']['quotaTokens'] == 100, 'legacy PATCH lost quota')
            admin('/api/keys/'+kid,'DELETE',expected=400) # upstream last active key guard
            admin(quota_path,'PUT',{'expiresAt':None})
            admin('/api/maintenance','PUT',{'enabled':True})
            for path in ('/v1/models','/v1/chat/completions','/v1/responses','/v1/messages','/v1/embeddings'):
                req(path, 'GET' if path.endswith('models') else 'POST', None if path.endswith('models') else {}, key=key, expected=503)
            req('/health')
            admin('/api/maintenance','PUT',{'enabled':False})
            req('/v1/models',key=key)
            first = admin('/api/sessions/list')['data']['current']
            check(bool(first), 'header-only session not recognized')
            admin('/api/sessions/revoke','POST',{'sessionId':first},expected=400)
            second = req('/api/panel/login?auth-mode=body','POST',{'username':'port-review','password':password})['data']['accessToken']
            second_id = req('/api/sessions/list',token=second)['data']['current']
            admin('/api/sessions/revoke','POST',{'sessionId':second_id})
            req('/api/sessions/list',token=second,expected=401)
            admin('/api/branding','PUT',{'title':'移植回归测试'})
            check(req('/api/panel/branding')['data']['title'] == '移植回归测试','public branding mismatch')
            snapshot = admin('/api/backup/export')['data']
            check(snapshot['kind'] == 'agent2api-backup', 'backup identity')
            admin('/api/backup/import','POST',{'data':snapshot},expected=400)
            admin('/api/branding','PUT',{'title':'changed'})
            snapshot['kind'] = 'aibuddy-panel-backup' # fork snapshot compatibility
            admin('/api/backup/import','POST',{'data':snapshot,'confirm':True})
            check(req('/api/panel/branding')['data']['title'] == '移植回归测试','backup did not restore branding')
            check(admin(quota_path)['data']['quotaTokens'] == 100,'backup did not restore quota')
            admin('/api/backup/run','POST',{})
            backups = list((home / 'backups').glob('*.db'))
            check(bool(backups),'SQLite backup missing')
            import sqlite3
            with sqlite3.connect(backups[0]) as conn:
                check(conn.execute('PRAGMA integrity_check').fetchone()[0]=='ok','backup corrupt')
            # Audit writes do not erase any existing config fields.
            admin('/api/audit')
            admin('/api/notify/channels')
            admin('/api/notify/alerts')
            admin('/api/backup/settings')
            html = req('/')
            check('js/branding.js' in html and 'js/prefs.js' in html,'new shell scripts missing')
            for asset in ('js/branding.js','js/prefs.js','js/notify-center.js','js/tags-view.js','islands/ui.js','islands/ui.css','i18n.js'):
                req('/'+asset)
            # Exercise actual forwarding and quota accounting against a loopback SSE upstream.
            from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
            import threading
            class Mock(BaseHTTPRequestHandler):
                hits = 0
                def log_message(self, *_): pass
                def do_POST(self):
                    Mock.hits += 1
                    payload = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                    chunk = {'id':'mock-chat','object':'chat.completion.chunk','model':'port-model',
                        'choices':[{'index':0,'delta':{'content':'hello'},'finish_reason':None}]}
                    final = {'id':'mock-chat','object':'chat.completion.chunk','model':'port-model',
                        'choices':[{'index':0,'delta':{},'finish_reason':'stop'}],
                        'usage':{'prompt_tokens':3,'completion_tokens':2,'total_tokens':5}}
                    content = ('data: '+json.dumps(chunk)+'\n\ndata: '+json.dumps(final)+'\n\ndata: [DONE]\n\n').encode()
                    self.send_response(200)
                    self.send_header('Content-Type','text/event-stream')
                    self.send_header('Content-Length',str(len(content)))
                    self.end_headers(); self.wfile.write(content)
            mock = ThreadingHTTPServer(('127.0.0.1',0),Mock)
            threading.Thread(target=mock.serve_forever,daemon=True).start()
            try:
                created_provider = admin('/api/custom-providers','POST',{'name':'Local fixture',
                    'protocol':'chat_completions','baseUrl':f'http://127.0.0.1:{mock.server_port}/v1',
                    'apiKey':'fixture-only'})['data']
                provider = created_provider['provider']['id']
                aid = created_provider['account']['id']
                admin('/api/growth-tasks/gift','POST',{'accountId':aid,'kind':'gift'},expected=400)
                admin('/api/growth-tasks/trial','POST',{'accountId':aid},expected=400)
                check(Mock.hits==0,'growth action used another provider credential')
                admin('/api/custom-providers/models','POST',{'providerId':provider,'models':[{'id':'port-model','enabled':True}],'mappings':[]})
                admin(quota_path,'PUT',{'quotaTokens':5,'expiresAt':None,'resetUsed':True})
                result = req('/v1/chat/completions','POST',{'model':'port-model',
                    'messages':[{'role':'user','content':'test'}],'stream':False},key=key)
                check(result['choices'][0]['message']['content']=='hello','nonstream forwarding broke')
                check(admin(quota_path)['data']['usedTokens']==5,'usage not charged exactly once')
                req('/v1/chat/completions','POST',{'model':'port-model','messages':[]},key=key,expected=403)
                check(Mock.hits==1,'over-quota request reached upstream')
                admin(quota_path,'PUT',{'quotaTokens':20,'resetUsed':True})
                streamed = req('/v1/chat/completions','POST',{'model':'port-model',
                    'messages':[{'role':'user','content':'test'}],'stream':True},key=key)
                check('[DONE]' in streamed and 'hello' in streamed,'stream forwarding broke')
                check(admin(quota_path)['data']['usedTokens']==5,'stream usage not charged exactly once')
                admin('/api/custom-providers/remove','POST',{'id':provider})
            finally:
                mock.shutdown(); mock.server_close()
            print(f'PASS: {checks} assertions; temporary database, no external account calls', flush=True)
            if '--serve' in sys.argv:
                # Browser login via x-panel-token uses this local-only fixture token.
                (Path('/private/tmp/agent2api-browser-fixture.json')).write_text(json.dumps({'url':base,'username':'port-review','password':password}))
                print(f'Browser fixture: {base}', flush=True)
                while True: time.sleep(1)
        finally:
            proc.terminate()
            try: proc.wait(timeout=5)
            except subprocess.TimeoutExpired: proc.kill(); proc.wait()
