#!/usr/bin/env python3
"""Isolated growth API permission checks. --serve opens a mocked browser fixture.
All accounts have no credentials. No external provider requests are made.
"""
import http.server
import json
import os
from pathlib import Path
import secrets
import socket
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
import urllib.error

ROOT = Path(__file__).resolve().parents[1]
BINARY = ROOT / 'target/debug/agent2api-server'
client = urllib.request.build_opener(urllib.request.ProxyHandler({}))
checks = 0
def check(condition, message):
    global checks
    assert condition, message
    checks += 1
def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]

with tempfile.TemporaryDirectory(prefix='workbuddy-tasks-test-') as scratch:
    home = Path(scratch)
    port = free_port()
    base = 'http://127.0.0.1:' + str(port)
    (home / 'config.json').write_text(json.dumps({'scheduledTasks': {
        k: {'enabled': False} for k in ('credentialMaintenance', 'modelRefresh', 'updateCheck')
    }}))
    env = {k:v for k,v in os.environ.items() if not k.startswith(('AGENT2API_', 'WORKBUDDY_'))}
    env.update(AGENT2API_PROXY_HOME=scratch, AGENT2API_PROXY_PORT=str(port),
               AGENT2API_HOST='127.0.0.1', AGENT2API_CAPTCHA_ENABLED='0',
               AGENT2API_UI_DIR=str(ROOT / 'desktop-tauri/ui'))
    def req(path, method='GET', body=None, token=None, key=None, expected=200):
        headers = {'Content-Type':'application/json'}
        if token: headers['x-panel-token'] = token
        if key: headers['Authorization'] = 'Bearer ' + key
        request = urllib.request.Request(base + path, method=method, headers=headers,
            data=None if body is None else json.dumps(body).encode())
        try: response = client.open(request, timeout=15)
        except urllib.error.HTTPError as error: response = error
        with response:
            raw = response.read()
            check(response.status == expected, str((path, response.status, raw[:160])))
            return json.loads(raw)
    def start():
        log = (home / 'server.log').open('ab')
        proc = subprocess.Popen([str(BINARY)], env=env, stdout=log, stderr=log)
        log.close()
        for _ in range(100):
            if proc.poll() is not None: raise RuntimeError('fixture server exited')
            try:
                client.open(base + '/health', timeout=.3).close()
                return proc
            except OSError: time.sleep(.1)
        raise RuntimeError('fixture server startup timeout')

    proc = start()
    try:
        password = secrets.token_urlsafe(18)
        login = req('/api/panel/setup?auth-mode=body', 'POST', {'username':'task-fixture', 'password':password})['data']
        token = login['accessToken']
        key = 'sk-fixture-' + secrets.token_hex(16)
        kid = req('/api/keys','POST',{'name':'restricted','key':key},token=token)['data']['created']['id']
        req('/api/keys/'+kid+'/quota','PUT',{'quotaTokens':100},token=token)
        proc.terminate(); proc.wait(timeout=10)
        with sqlite3.connect(home / 'agent2api.db') as db:
            for i,(aid,provider,edition,name) in enumerate([
                ('fixture-wb','workbuddy','cn','WorkBuddy Demo'),
                ('fixture-wb-other','workbuddy','cn','Other WorkBuddy'),
                ('fixture-intl','workbuddy-intl','intl','International Demo'),
                ('fixture-raccoon','raccoon','cn','Raccoon Demo'),
            ]):
                data={'id':aid,'provider':provider,'edition':edition,'name':name,'nameCustom':True,'enabled':True,'priority':i}
                db.execute('INSERT INTO accounts(id,provider,priority,enabled,added_at,data) VALUES(?,?,?,?,?,?)',
                    (aid,provider,i,1,i+1,json.dumps(data)))
        proc = start()
        token = req('/api/panel/login?auth-mode=body','POST',{'username':'task-fixture','password':password})['data']['accessToken']
        for aid,status in [('missing',404),('fixture-intl',400),('fixture-raccoon',400),('fixture-wb',404)]:
            for suffix,method,body in [('', 'GET', None),('/accept','POST',{'all':True}),('/claim','POST',{'code':'chat_5'})]:
                path='/api/growth-tasks/accounts/'+aid+suffix
                req(path,method,body,expected=401)
                req(path,method,body,key=key,expected=403)
                req(path,method,body,token=token,expected=status)
            req('/api/growth-tasks/run','POST',{'accountId':aid},token=token,expected=status)
        for bad in ['',None,2,[],{}]:
            req('/api/growth-tasks/run','POST',{'accountId':bad},token=token,expected=400)
        req('/api/growth-tasks/accounts/fixture-wb/accept','POST',{},token=token,expected=400)
        req('/api/growth-tasks/accounts/fixture-wb/claim','POST',{},token=token,expected=400)
        result=req('/api/growth-tasks/run','POST',{},token=token)
        check(result['data']['total']==0, 'legacy global queue behavior changed')
        print('PASS: '+str(checks)+' account-growth API assertions; no credentials or provider calls',flush=True)

        if '--serve' in sys.argv:
            tasks=[
                {'code':'automation_1','title':'Set up an automation','current':1,'target':1,'rewardCredit':100,'rewardEnergy':5,'accepted':True,'claimable':True,'automatable':True},
                {'code':'chat_5','title':'Chat with AI five times','current':2,'target':5,'rewardCredit':100,'rewardEnergy':5,'accepted':False,'automatable':True},
                {'code':'first_buddy','title':'Adopt your first Buddy','current':1,'target':1,'rewardCredit':300,'rewardEnergy':8,'claimed':True,'accepted':True,'automatable':True},
                {'code':'Sequential_Tasks_7','title':'Explore inspiration','current':0,'target':1,'rewardCredit':100,'rewardEnergy':5,'locked':True,'automatable':True},
                {'code':'manual_task','title':'Complete a manual activity','current':0,'target':1,'rewardCredit':50,'accepted':True,'automatable':False},
            ]
            queue={'running':False,'items':[],'total':0,'done':0}
            initial_tasks=json.loads(json.dumps(tasks))
            events=[]
            control={'error':False}
            lock=threading.Lock()
            class Proxy(http.server.BaseHTTPRequestHandler):
                def log_message(self,*args): pass
                def send_json(self,data,status=200):
                    raw=json.dumps(data).encode()
                    self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
                def do_GET(self): self.handle_request()
                def do_POST(self): self.handle_request()
                def do_PUT(self): self.handle_request()
                def handle_request(self):
                    raw=self.rfile.read(int(self.headers.get('Content-Length',0)))
                    body=json.loads(raw) if raw else {}
                    if self.path=='/__fixture__/events': return self.send_json(events)
                    if self.path=='/__fixture__/reset':
                        tasks[:]=json.loads(json.dumps(initial_tasks));events.clear()
                        queue.update(running=False,items=[],total=0,done=0)
                        return self.send_json({'ok':True})
                    if self.path=='/__fixture__/fail-next':
                        control['error']=True;return self.send_json({'ok':True})
                    if self.path.startswith('/api/growth-tasks/accounts/'):
                        parts=self.path.split('/')
                        aid=parts[4]
                        check(aid=='fixture-wb','browser action escaped selected account')
                        if self.command=='GET':
                            if control['error']:
                                control['error']=False;return self.send_json({'success':False,'error':'Fixture query failed'},503)
                            return self.send_json({'success':True,'data':{'accountId':aid,'tasks':tasks,'queriedAt':int(time.time()*1000)}})
                        action=parts[5];events.append({'action':action,'accountId':aid,'body':body})
                        if action=='accept':
                            selected=[task for task in tasks if not task.get('claimed') and not task.get('locked') and not task.get('accepted')
                                      and (body.get('all') or task['code']==body.get('code'))]
                            for task in selected: task['accepted']=True
                            return self.send_json({'success':True,'data':{'accepted':len(selected)}})
                        if action=='claim':
                            task=next(task for task in tasks if task['code']==body.get('code'))
                            check(task.get('claimable') is True,'browser claimed an incomplete task')
                            task.update(claimed=True,claimable=False)
                            return self.send_json({'success':True,'data':{'claimed':True}})
                    if self.path=='/api/growth-tasks/queue': return self.send_json({'success':True,'data':queue})
                    if self.path=='/api/growth-tasks/run':
                        check(body.get('accountId')=='fixture-wb','browser started a global run')
                        events.append({'action':'run','accountId':body['accountId']})
                        pending=[task for task in tasks if task.get('automatable') and not task.get('claimed') and not task.get('locked')]
                        queue.update(running=True,total=len(pending),done=0,items=[{'accountId':'fixture-wb','taskCode':task['code'],'status':'running'} for task in pending])
                        def finish():
                            with lock:
                                for task in pending: task.update(current=task['target'],claimed=True,claimable=False,accepted=True)
                                for item in queue['items']: item['status']='ok'
                                queue.update(running=False,done=len(pending))
                        threading.Timer(1.5,finish).start()
                        return self.send_json({'success':True,'data':{'started':True,'total':len(pending)}})
                    headers={k:v for k,v in self.headers.items() if k.lower() not in ('host','cookie','authorization','x-panel-token','content-length')}
                    headers['x-panel-token']=token
                    request=urllib.request.Request(base+self.path,method=self.command,headers=headers,data=raw if raw else None)
                    try:response=client.open(request,timeout=15)
                    except urllib.error.HTTPError as error:response=error
                    with response:
                        data=response.read();self.send_response(response.status)
                        for k,v in response.headers.items():
                            if k.lower() not in ('content-length','transfer-encoding','connection','set-cookie'):self.send_header(k,v)
                        self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
            proxy=http.server.ThreadingHTTPServer(('127.0.0.1',0),Proxy)
            print('BROWSER_FIXTURE=http://127.0.0.1:'+str(proxy.server_port)+'/',flush=True)
            try:proxy.serve_forever()
            finally:proxy.server_close()
    finally:
        proc.terminate();proc.wait(timeout=10)
