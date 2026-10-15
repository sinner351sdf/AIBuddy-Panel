#!/usr/bin/env python3
"""Local UI fixture proxy. Simulates QR authorization only; never contacts a provider.
Run test-workbuddy-task-center.py --serve first. No real credentials are accepted.
"""
import http.server,json,time,urllib.request,urllib.error,urllib.parse,secrets,threading
fixture_client=urllib.request.build_opener(urllib.request.ProxyHandler({}))
states={};mutex=threading.Lock()
class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def reply(self,status,data,html=False):
        body=data.encode() if html else json.dumps(data).encode()
        self.send_response(status);self.send_header('Content-Type','text/html; charset=utf-8' if html else 'application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
    def api(self,path,method='GET',data=None):
        headers={k:v for k,v in self.headers.items() if k.lower() not in ['host','content-length','connection','accept-encoding','origin','referer']}
        headers['Content-Type']='application/json';headers['Accept-Encoding']='identity'
        request=urllib.request.Request('http://127.0.0.1:13075'+path,headers=headers,method=method,data=data)
        try:return fixture_client.open(request,timeout=25)
        except urllib.error.HTTPError as e:return e
    def route(self):
        url=urllib.parse.urlsplit(self.path);q=urllib.parse.parse_qs(url.query)
        body=self.rfile.read(int(self.headers.get('Content-Length','0')))
        if url.path=='/api/session/login/start' and self.command=='POST':
            p=json.loads(body);state='fixture-'+secrets.token_hex(8)
            with mutex:states[state]={'provider':p.get('provider'),'done':False}
            return self.reply(200,{'success':True,'data':{'state':state,'authUrl':'http://127.0.0.1:13076/__fixture/authorize?state='+state,'expiresAt':int(time.time()*1000)+300000}})
        if url.path=='/api/session/login/wait':
            with mutex:r=states.get(q.get('state',[''])[0])
            if r is None:return self.reply(404,{'success':False,'error':'登录任务不存在或已过期'})
            return self.reply(200,{'success':True,'data':{'done':True,'session':{'nickname':'扫码测试账号','updated':False,'accountId':'user-qr-ui-fixture'}} if r['done'] else {'pending':True,'phase':'waiting'}})
        if url.path=='/api/session/login/cancel':
            with mutex:r=states.pop(json.loads(body).get('state',''),None)
            return self.reply(200,{'success':True,'data':{'canceled':bool(r and not r['done'])}})
        if url.path=='/__fixture/authorize':
            state=q.get('state',[''])[0]
            return self.reply(200,'<!doctype html><meta charset="utf-8"><title>模拟授权</title><main style="font:16px system-ui;padding:40px"><h1>模拟授权（仅界面验收）</h1><p>不连接腾讯，不使用真实账号。</p><form method="post" action="/__fixture/confirm"><input type="hidden" name="state" value="'+state+'"><button>确认模拟授权</button></form></main>',True)
        if url.path=='/__fixture/confirm':
            p=urllib.parse.parse_qs(body.decode());state=p.get('state',[''])[0]
            with mutex:
                if state not in states:return self.reply(404,'授权已取消',True)
                provider=states[state]['provider'];states[state]['done']=True
            payload={'provider':provider,'enabled':False,'edition':'intl' if provider=='workbuddy-intl' else 'cn','account':{'uid':'qr-ui-fixture','nickname':'扫码测试账号'},'auth':{'accessToken':'fixture-no-real-token'}}
            with self.api('/api/accounts','POST',json.dumps(payload).encode()) as response:
                if response.status!=200:return self.reply(500,'模拟账号保存失败',True)
            return self.reply(200,'<meta charset="utf-8"><h1>模拟授权完成</h1><p>返回添加账号弹窗查看结果。</p>',True)
        # This UI fixture must not forward a balance probe, task action or other
        # provider-facing route. Only local panel/config/history reads are allowed.
        local_exact={'/api/accounts','/api/growth-tasks/queue','/api/growth-tasks/schedule','/api/task-records','/api/config','/api/status'}
        local_prefixes=('/api/panel/','/api/task-records/','/api/scheduled-tasks','/api/version')
        if url.path.startswith('/api/') and url.path not in local_exact and not url.path.startswith(local_prefixes):
            return self.reply(403,{'success':False,'error':'隔离界面验收禁止上游操作'})
        if url.path=='/api/accounts' and self.command!='GET':
            return self.reply(403,{'success':False,'error':'模拟账号只由模拟授权流程写入'})
        with self.api(self.path,self.command,body or None) as response:
            data=response.read();self.send_response(response.status)
            for key,value in response.headers.items():
                if key.lower() not in ['content-length','transfer-encoding','connection','content-encoding']:self.send_header(key,value)
            if 'text/html' in response.headers.get('Content-Type','') and url.path=='/':data=data.replace(b'</body>','<div style="position:fixed;bottom:3px;right:25px;z-index:99999;font:11px system-ui;color:#856000;background:#fff8d8;padding:2px 7px;border-radius:4px">界面验收：模拟授权与示例记录</div></body>'.encode())
            self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
    do_GET=route;do_POST=route;do_PUT=route;do_DELETE=route
print('QR UI fixture http://127.0.0.1:13076 — simulated authorization, no provider calls',flush=True)
http.server.ThreadingHTTPServer(('127.0.0.1',13076),Handler).serve_forever()
