#!/usr/bin/env python3
"""Collect license/notice texts from exact cached sources without executing dependency code."""
from pathlib import Path
import json,hashlib,os,tarfile,re
ROOT=Path(__file__).resolve().parents[1]
report=json.loads((ROOT/'docs/aibuddy-port/plugin-migration/dependency-licenses-20261030.json').read_text());texts={};packages=[];missing=[]
registries=list((Path(os.environ.get('CARGO_HOME',Path.home()/'.cargo'))/'registry/src').glob('*'))
original=Path(os.environ.get('AIBUDDY_NPM_NOTICE_ROOT',ROOT))
supplementDir=ROOT/'docs/aibuddy-port/plugin-migration/license-texts'
supplements=json.loads((supplementDir/'sources.json').read_text())
def wanted(name):return bool(re.match(r'(?i)^(license|licence|notice|copying|copyright)(?:[._-].*)?$',Path(name).name))
seen=set()
for row in report['rows']:
 if row['ecosystem']=='npm' and row.get('dev'):continue
 ident=(row['ecosystem'],row['name'],row['version'])
 if ident in seen:continue
 seen.add(ident);found={}
 if row['ecosystem']=='cargo':
  name,version=row['name'],row['version'];folder=next((d/f'{name}-{version}' for d in registries if (d/f'{name}-{version}/Cargo.toml').exists()),None)
  if folder:
   for file in folder.iterdir():
    if file.is_file() and wanted(file.name):found[file.name]=file.read_text(errors='replace')
  else:
   file=ROOT/f'data/license-source-cache/{name}-{version}.crate'
   if file.exists():
    if hashlib.sha256(file.read_bytes()).hexdigest()!=row['sourceChecksum']:raise SystemExit('Source checksum mismatch')
    with tarfile.open(file,'r:gz') as tar:
     for member in tar.getmembers():
      rel=member.name.split('/',1)[-1]
      if member.isfile() and '/' not in rel and wanted(rel) and member.size<1024*1024:found[rel]=tar.extractfile(member).read().decode(errors='replace')
 else:
  folder=original/Path(row['lock']).parent/row['name']
  meta=folder/'package.json'
  if meta.exists() and json.loads(meta.read_text()).get('version')==row['version']:
   for file in folder.iterdir():
    if file.is_file() and wanted(file.name):found[file.name]=file.read_text(errors='replace')
 if not found:
  # Some crates publish only an SPDX declaration. Retain that declaration, author
  # metadata and exact upstream notices, and reproduce the referenced standard
  # terms without inventing a copyright holder or changing the declared license.
  info=next((p for p in supplements['packages'] if p['name']==row['name'] and p['version']==row['version']),{})
  for notice in supplements['upstream']:
   if notice['repo']==(info.get('repository') or '').replace('https://github.com/','').rstrip('/') and notice['sha']==info.get('sha'):
    found['upstream: '+notice['url']]=(supplementDir/notice['file']).read_text()
  expression=row.get('license') or ''
  choices=[x for x in supplements['canonicalLicenses'] if re.search(r'(?<![A-Za-z0-9-])'+re.escape(x)+r'(?![A-Za-z0-9-])',expression)]
  selected=choices if ' AND ' in expression else choices[:1]
  if selected:
   found['SPDX declaration and source metadata']='Declared license: '+expression+'\nAuthors (package metadata, not a new copyright claim): '+json.dumps(info.get('authors'),ensure_ascii=False)+'\nExact source repository: '+str(info.get('repository'))+'\nSource commit: '+str(info.get('sha'))+'\nCanonical terms below reproduce the declared license option. Template placeholders in standard texts are not an assertion of new copyright.\n'
   for license in selected:found['Canonical terms: '+license]=(supplementDir/(license+'.txt')).read_text()
  else:missing.append({'ecosystem':ident[0],'name':ident[1],'version':ident[2],'license':row.get('license')})
 refs=[]
 for filename,text in sorted(found.items()):
  # Normalize line endings/trailing spaces only; retain the complete notice wording.
  text='\n'.join(line.rstrip(' \t\r') for line in text.splitlines())+'\n'
  digest=hashlib.sha256(text.encode()).hexdigest();texts[digest]=text;refs.append((filename,digest))
 source=f"https://static.crates.io/crates/{row['name']}/{row['name']}-{row['version']}.crate" if row['ecosystem']=='cargo' else json.loads((ROOT/row['lock']).read_text())['packages'][row['name']].get('resolved','See committed package-lock.json')
 packages.append((ident,row.get('license'),refs,source))
header='Third-party licenses and notices\n\nThese texts retain the licenses of their respective components. Inclusion does not relicense third-party code.\nCorresponding source: https://github.com/sinner351sdf/AIBuddy-Panel ; use the exact Release tag and committed Cargo.lock/package-lock.json to identify versions and build inputs. Native proprietary provider SDKs are not bundled. Frozen Android source retains its separate historical license and is not built by this release.\n\n'
body=[header]
for (ecosystem,name,version),license,refs,source in packages:
 body.append(f'{ecosystem}: {name} {version}\nDeclared license: {license}\nSource: {source}\n'+''.join(f'{name}: License text {sha}\n' for name,sha in refs)+'\n')
for sha,text in texts.items():body.append(f'\n===== License text {sha} =====\n\n{text.rstrip()}\n')
out=ROOT/'desktop-tauri/ui/third-party-licenses.txt';out.write_text(''.join(body))
summary={'packages':len(packages),'uniqueLicenseTexts':len(texts),'missingLicenseTexts':missing,'bytes':out.stat().st_size}
(ROOT/'docs/aibuddy-port/plugin-migration/notice-collection-20261030.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary))
