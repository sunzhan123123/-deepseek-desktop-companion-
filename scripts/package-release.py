"""Build shareable archives from the reviewed positive file list only.

Uses Python's standard library and Node.js. Does not read the user's home,
Harness configuration, runtime history or model memory directories.
"""
from pathlib import Path, PurePosixPath
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import zipfile

ROOT=Path(__file__).resolve().parents[1]
VERSION='1.0.0'

def sha(data):
    return hashlib.sha256(data).hexdigest()

def require_relative(name):
    value=PurePosixPath(name)
    if value.is_absolute() or '..' in value.parts or ':' in name or '\\' in name:
        raise ValueError('Invalid distribution member path')
    target=ROOT.joinpath(*value.parts)
    if target.is_symlink() or not target.is_file() or not target.resolve().is_relative_to(ROOT.resolve()):
        raise ValueError('Distribution input must be an existing regular file')
    return target

def make_archive(destination,names,replace):
    if destination.exists() and not replace:
        raise FileExistsError('Release exists; use --replace to rebuild generated archives')
    rows=[]
    fd,temporary=tempfile.mkstemp(prefix=destination.stem+'-',suffix='.tmp',dir=destination.parent)
    os.close(fd)
    try:
        with zipfile.ZipFile(temporary,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
            for name in sorted(set(names)):
                path=require_relative(name)
                data=path.read_bytes()
                info=zipfile.ZipInfo(name,date_time=(2026,11,9,0,0,0))
                info.compress_type=zipfile.ZIP_DEFLATED
                info.external_attr=0o100644<<16
                archive.writestr(info,data)
                rows.append({'file':name,'bytes':len(data),'sha256':sha(data)})
        with zipfile.ZipFile(temporary) as archive:
            if archive.testzip() is not None: raise ValueError('Archive CRC failed')
            if sorted(archive.namelist())!=sorted(set(names)): raise ValueError('Unexpected archive contents')
        os.replace(temporary,destination)
    finally:
        if os.path.exists(temporary): os.unlink(temporary)
    return {'archive':destination.name,'bytes':destination.stat().st_size,
            'sha256':sha(destination.read_bytes()),'fileCount':len(rows),'files':rows}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=ROOT.parent/'deepseek-desktop-companion-release')
    parser.add_argument('--replace',action='store_true')
    args=parser.parse_args()
    node=shutil.which('node')
    if not node: raise RuntimeError('Install Node.js first')
    # The safety verifier rejects runtime/credential paths, unlisted files and
    # likely secret literals before even the first archive is created.
    subprocess.run([node,str(ROOT/'scripts/verify-release.mjs'),'--require-media'],cwd=ROOT,check=True)
    files=json.loads((ROOT/'release-files.json').read_text(encoding='utf-8'))
    source=files['source'];media=files['media'];binary=files['binary']
    for name in source+media+binary: require_relative(name)
    out=args.output.resolve()
    out.mkdir(parents=True,exist_ok=True)
    groups={
      'source':source,
      'assets':media+['assets/media-manifest.json','ASSET-NOTICE.md'],
      'complete':source+media+binary,
    }
    reports=[]
    for kind,names in groups.items():
        destination=out/f'deepseek-desktop-companion-{kind}-v{VERSION}.zip'
        reports.append(make_archive(destination,names,args.replace))
    report={'version':VERSION,'privateRuntimeDataIncluded':False,'mediaFiles':len(media),
            'sourceManifest':'release-files.json','archives':reports}
    (out/'RELEASE-CONTENTS-v1.0.0.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    (out/'SHA256SUMS.txt').write_text(''.join(item['sha256']+'  '+item['archive']+'\n' for item in reports),encoding='ascii')
    print(json.dumps({'version':VERSION,'archives':[{k:v for k,v in item.items() if k!='files'} for item in reports]},indent=2))

if __name__=='__main__': main()
