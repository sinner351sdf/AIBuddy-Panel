#!/usr/bin/env python3
"""Inventory exact locked dependency license metadata; never execute package code."""
from pathlib import Path
import argparse,collections,hashlib,json,os,tarfile,tomllib
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--output',default='docs/aibuddy-port/plugin-migration/dependency-licenses-20261030.json');p.add_argument('--strict',action='store_true');args=p.parse_args()
cache=Path(os.environ.get('CARGO_HOME',Path.home()/'.cargo'))/'registry/src';registry=list(cache.glob('*'));archives=ROOT/'data/license-source-cache';rows=[]
for lock in ['desktop-tauri/src-tauri/Cargo.lock','provider-plugin/Cargo.lock']:
 for package in tomllib.loads((ROOT/lock).read_text())['package']:
  if 'source' not in package:continue
  name,version=package['name'],package['version'];metadata=None;origin=None
  for directory in registry:
   source=directory/f'{name}-{version}'/'Cargo.toml'
   if source.exists():metadata=tomllib.loads(source.read_text())['package'];origin='cargo-registry-source';break
  if metadata is None:
   archive=archives/f'{name}-{version}.crate'
   if archive.exists():
    if hashlib.sha256(archive.read_bytes()).hexdigest()!=package['checksum']:raise SystemExit(f'Checksum mismatch: {name} {version}')
    with tarfile.open(archive,'r:gz') as tar:
     member=tar.getmember(f'{name}-{version}/Cargo.toml')
     if member.size>1024*1024:raise SystemExit('Oversized crate manifest')
     metadata=tomllib.loads(tar.extractfile(member).read().decode())['package'];origin='sha256-verified-official-crate'
  metadata=metadata or {}
  rows.append({'ecosystem':'cargo','lock':lock,'name':name,'version':version,'license':metadata.get('license'),'licenseFile':metadata.get('license-file'),'sourceChecksum':package.get('checksum'),'evidence':origin})
for lock in ['desktop-tauri/ui-islands/package-lock.json','desktop-tauri/ui-kit/package-lock.json','desktop-tauri/mobile/package-lock.json','desktop-tauri/package-lock.json']:
 for name,package in json.loads((ROOT/lock).read_text()).get('packages',{}).items():
  if name:rows.append({'ecosystem':'npm','lock':lock,'name':name,'version':package.get('version'),'license':package.get('license'),'dev':package.get('dev',False),'evidence':'locked-package-metadata','integrity':package.get('integrity')})
missing=sorted({(r['ecosystem'],r['name'],r['version']) for r in rows if not r.get('license') and not r.get('licenseFile')})
expressions=dict(collections.Counter(r.get('license') or 'MISSING' for r in rows))
report={'note':'Exact locked metadata is provenance evidence, not a legal compatibility certificate. Third-party notices and source obligations remain applicable. No dependency code executed.','missing':missing,'expressions':expressions,'rows':rows}
output=ROOT/args.output;output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'licenseExpressions':expressions,'missing':missing},ensure_ascii=False))
if args.strict and missing:raise SystemExit(1)
