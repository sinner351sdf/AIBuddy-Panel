#!/usr/bin/env python3
"""Exercise the real shell script with fake git/gh, temporary assets, no network or publication."""
import hashlib,json,os,subprocess,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
SHA='a'*40;REPO='sinner351sdf/AIBuddy-Panel'
MOCK=r'''#!/usr/bin/env python3
import json,os,sys,shutil
from pathlib import Path
args=sys.argv[1:];base=Path(os.environ['FIXTURE']);cfg=json.loads((base/'config.json').read_text())
with (base/'calls.jsonl').open('a') as out:out.write(json.dumps({'command':Path(sys.argv[0]).name,'args':args})+'\n')
if Path(sys.argv[0]).name=='git':
 if args[0]=='config':sys.exit(1)
 if args[0]=='rev-parse':print('a'*40)
 elif args[0]=='log':print('Fixture release notes\n\nPreserve local customization.')
 else:sys.exit('Unexpected git invocation')
 sys.exit(0)
if args[:2]==['repo','view']:print('sinner351sdf/AIBuddy-Panel')
elif args[:2]==['run','list']:print(json.dumps([{'databaseId':str(i)} for i in cfg.get('ids',[1])]))
elif args[0]=='api':
 run_id=args[1].split('/')[5];run=cfg.get('runs',{}).get(run_id,cfg['run'])
 print(json.dumps(cfg['artifacts'] if args[1].endswith('/artifacts') else run))
elif args[:2]==['run','download']:shutil.copytree(base/'assets',Path(args[args.index('-D')+1]))
elif args[:2]==['release','view']:sys.exit(0 if cfg.get('existing') else 1)
elif args[:2]==['release','edit']:pass
elif args[:2] in [['release','create'],['release','upload']]:
 assets=[Path(s) for s in args if Path(s).is_file()]
 with (base/'published.json').open('w') as out:json.dump({'files':[p.name for p in assets],'sums':next((p.read_text() for p in assets if p.name=='SHA256SUMS.txt'),'')},out)
else:sys.exit('Unexpected gh invocation '+str(args))
'''
count=0
with tempfile.TemporaryDirectory(prefix='a2a-release-test-') as temp:
 base=Path(temp);bin_dir=base/'bin';bin_dir.mkdir()
 for name in ['gh','git']:(bin_dir/name).write_text(MOCK);(bin_dir/name).chmod(0o755)
 def run(name,tag='v3.0.5-aibuddy.1',change=None,success=True,auto=False,existing=False,linux=True,desktop=False):
  global count
  home=base/name;home.mkdir();assets=home/'assets';assets.mkdir()
  for folder,filename in [('windows-nsis','AIBuddy Setup.exe'),('macos-universal','AIBuddy Panel.dmg')]:
   p=assets/folder;p.mkdir();(p/filename).write_bytes(b'installer fixture')
  if desktop:
   p=assets/'linux-desktop';p.mkdir();(p/'AIBuddy.deb').write_bytes(b'fixture deb');(p/'AIBuddy.AppImage').write_bytes(b'fixture appimage')
  if linux:
   for arch in ['amd64','arm64']:
    p=assets/f'linux-server-{arch}';p.mkdir();filename=f'agent2api-server-linux-{arch}.tar.gz';content=f'synthetic-{arch}'.encode();(p/filename).write_bytes(content)
    (p/(filename+'.sha256')).write_text(hashlib.sha256(content).hexdigest()+'  '+filename+'\n')
  cfg={'run':{'head_sha':SHA,'status':'completed','conclusion':'success','path':'.github/workflows/build.yml','repository':{'full_name':REPO}},'artifacts':{'artifacts':[{'name':n,'expired':False,'size_in_bytes':100,'workflow_run':{'head_sha':SHA}} for n in ['windows-nsis','macos-universal']+(['linux-server-amd64','linux-server-arm64'] if linux else [])+(['linux-desktop'] if desktop else [])]},'existing':existing}
  if change:change(home,cfg)
  (home/'config.json').write_text(json.dumps(cfg));(home/'dist').mkdir();(home/'dist/user-file').write_text('keep')
  result=subprocess.run(['bash',str(ROOT/'scripts/release.sh'),tag]+([] if auto else ['1']),cwd=home,env={**os.environ,'PATH':str(bin_dir)+os.pathsep+os.environ['PATH'],'FIXTURE':str(home),'HTTPS_PROXY':''},text=True,capture_output=True)
  assert (result.returncode==0)==success,(name,result.stdout,result.stderr)
  assert (home/'dist/user-file').read_text()=='keep','must not erase existing dist/'
  calls=[json.loads(line) for line in (home/'calls.jsonl').read_text().splitlines()]
  mutated=[c for c in calls if c['command']=='gh' and c['args'][:2] in [['release','upload'],['release','create']]]
  assert len(mutated)==(1 if success else 0),(name,mutated)
  if success:
   if not existing:
    create=next(c['args'] for c in mutated if c['args'][1]=='create')
    assert ('--prerelease=true' in create)==('beta' in tag),(name,create)
   files=json.loads((home/'published.json').read_text());expected=(7 if linux else 3)+(2 if desktop else 0)
   assert len([f for f in files['files'] if f!='notes.txt'])==expected,(name,files)
   assert ('agent2api-server-linux-arm64.tar.gz.sha256' in files['files'])==linux
   assert files['sums'].count('\n')==(4 if linux else 2)+(2 if desktop else 0)
   assert mutated[0]['args'][1]==('upload' if existing else 'create')
   assert '--repo' in mutated[0]['args'] and REPO in mutated[0]['args']
   assert 'Docker Hub' not in result.stdout and 'aimodcc' not in result.stdout
  count+=1
 run('new-release');run('existing-release',existing=True)
 run('legacy',tag='v3.0.3-aibuddy.1',linux=False)
 run('missing-linux',linux=False,success=False)
 run('wrong-sha',change=lambda h,c:c['run'].update(head_sha='b'*40),success=False)
 run('wrong-repo',change=lambda h,c:c['run']['repository'].update(full_name='other/repo'),success=False)
 run('wrong-workflow',change=lambda h,c:c['run'].update(path='.github/workflows/unknown.yml'),success=False)
 run('running',change=lambda h,c:c['run'].update(status='in_progress',conclusion=None),success=False)
 run('failed',change=lambda h,c:c['run'].update(conclusion='failure'),success=False)
 run('expired',change=lambda h,c:c['artifacts']['artifacts'][0].update(expired=True),success=False)
 run('wrong-artifact-source',change=lambda h,c:c['artifacts']['artifacts'][2]['workflow_run'].update(head_sha='b'*40),success=False)
 run('corrupt',change=lambda h,c:(h/'assets/linux-server-arm64/agent2api-server-linux-arm64.tar.gz').write_bytes(b'corrupted'),success=False)
 run('missing-sha256',change=lambda h,c:(h/'assets/linux-server-amd64/agent2api-server-linux-amd64.tar.gz.sha256').unlink(),success=False)
 run('wrong-sha-name',change=lambda h,c:(h/'assets/linux-server-arm64/agent2api-server-linux-arm64.tar.gz.sha256').write_text('a'*64+'  unexpected.tar.gz\n'),success=False)
 run('empty-desktop',change=lambda h,c:(h/'assets/windows-nsis/AIBuddy Setup.exe').write_bytes(b''),success=False)
 run('duplicate-desktop',change=lambda h,c:(h/'assets/windows-nsis/extra.exe').write_bytes(b'fake'),success=False)
 run('invalid-version',tag='vnope',success=False)
 def candidates(home,cfg):
  cfg['ids']=[1,2];cfg['runs']={'1':{**cfg['run'],'head_sha':'b'*40},'2':cfg['run']}
 run('auto-picks-correct-source',auto=True,change=candidates)
 run('modern-beta',tag='v3.0.4-beta.1')
 run('linux-desktop',tag='v3.0.8-aibuddy.1',desktop=True)
 run('linux-desktop-beta',tag='v3.0.8-aibuddy.1-beta.1',desktop=True)
 run('missing-linux-desktop',tag='v3.0.8-aibuddy.1',success=False)
 run('empty-linux-desktop',tag='v3.0.8-aibuddy.1',desktop=True,change=lambda h,c:(h/'assets/linux-desktop/AIBuddy.deb').write_bytes(b''),success=False)
 print(f'PASS: {count} release-script scenarios; create/upload, both Linux packages/checksums, source validation, legacy compatibility, spaces in paths, dist preservation and zero publication on failures; all gh/git commands mocked')
