#!/usr/bin/env python3
"""Tiny executable protocol fixtures, only for isolated lifecycle acceptance."""
import json,pathlib,zipfile,os
out=pathlib.Path('/private/tmp/aibuddy-validation-20261025/fixtures');out.mkdir(parents=True,exist_ok=True)
target='aarch64-apple-darwin'
worker='''#!/usr/bin/python3
import sys,json,os
for line in sys.stdin:
 try:
  frame=json.loads(line); method=frame.get("method"); ident=frame.get("id",0)
  if not method:continue
  if method=="init":
   result=[{"id":"fixture","label":"Lifecycle fixture","capabilities":{"chat":False},"default_models":[{"id":"fixture-cached","name":"Fixture cached"}]}]
  elif method=="shutdown":
   print(json.dumps({"id":ident,"result":None}),flush=True);break
  elif method=="models.list":result=[{"id":"fixture-cached"}]
  elif method=="models.refresh":result={"refreshed":False,"message":"fixture retains cached catalog"}
  else:result=None
  print(json.dumps({"id":ident,"result":result}),flush=True)
 except Exception:sys.exit(2)
'''
base={'id':'aibuddy-providers','name':'Lifecycle fixture','version':'0.2.2-lifecycle.1','protocol':1,'providers':[{'id':'fixture','label':'Lifecycle fixture','order':1,'default_enabled':True}],'entry':{target:'bin/worker'},'ui':[]}
for name,mutation,body in [('good',{},worker),('bad-exe',{'version':'0.2.2-lifecycle.2'},'invalid executable fixture'),('bad-handshake',{'version':'0.2.2-lifecycle.3'},'#!/usr/bin/python3\nimport sys,json\nfor line in sys.stdin:\n f=json.loads(line);print(json.dumps({"id":f["id"],"result":{"invalid":"provider list"}}),flush=True)\n'),('wrong-protocol',{'protocol':2},worker),('wrong-platform',{'entry':{'x86_64-pc-windows-msvc':'bin/worker'}},worker),('wrong-id',{'id':'agent2api-providers'},worker),('bad-signature',{'signature':{'algorithm':'ed25519','key_id':'fixture-unknown','target':target,'value':'AAAA'}},worker),('wrong-signature-platform',{'signature':{'algorithm':'ed25519','key_id':'fixture-unknown','target':'x86_64-pc-windows-msvc','value':'AAAA'}},worker)]:
 m=dict(base);m.update(mutation)
 with zipfile.ZipFile(out/(name+'.zip'),'w',compression=zipfile.ZIP_STORED) as z:
  z.writestr('pack.json',json.dumps(m))
  info=zipfile.ZipInfo('bin/worker');info.external_attr=(0o100755)<<16;z.writestr(info,body)
print(json.dumps({'fixtures':8,'directory':str(out)}))
