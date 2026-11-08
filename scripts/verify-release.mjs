/** Inspect only the proposed release, never a user's Harness/data directories. */
import {readdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join,relative,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';

const MEDIA=/^(?:room-animation-v2\/(?:pose-[A-F]\.png|(?:AB|BA|BC|CB|CD|DC|DE|ED|EF|FE|loop-[BEF])\.mp4)|companion-typing-v1\/[BE]\.mp4)$/u;
const TEXT=/\.(?:mjs|js|json|html|ps1|cmd|cs|md|txt|py|ya?ml)$/iu;
const ALLOWED=/\.(?:mjs|js|json|html|ps1|cmd|cs|md|txt|py|ya?ml|png|mp4|exe)$/iu;
export function validatePublicPath(name){
  if(typeof name!=='string'||!name||name.includes('\\')||name.includes(':')||name.startsWith('/')||name.split('/').some(x=>x==='..'||x===''))return {ok:false,category:'unsafe-path'};
  const parts=name.toLowerCase().split('/'),base=parts.at(-1);
  if(parts.some(x=>['.git','.dsh','.deepseek-wallpaper-companion','harness-home','workspace','runtime','data','node_modules','work','__pycache__'].includes(x)))return {ok:false,category:'private-directory'};
  if(/^\.(?:env|credentials)(?:\.|$)/u.test(base)||/\.local\.json$/u.test(base)||/\.(?:log|jsonl|sqlite\d*|db|bak|tmp|lock)$/u.test(base)||/^(?:chat-ledger-|companion-session-|companion-avatar-state-|companion-runtime-.*\.patch|desktop-launch\.json|desktop-wallpaper-.*\.json|server-.*\.json|launcher-.*-last\.json)/u.test(base))return {ok:false,category:'private-runtime-file'};
  if(/\.mp4$/iu.test(name)&&!MEDIA.test(name))return {ok:false,category:'unapproved-video'};
  if(/\.png$/iu.test(name)&&!MEDIA.test(name)&&name!=='assets/preview.png')return {ok:false,category:'unapproved-image'};
  if(/\.exe$/iu.test(name)&&name!=='deepseek-launcher-v4.exe')return {ok:false,category:'unapproved-binary'};
  if(!ALLOWED.test(name)&&!['LICENSE','.gitignore','.gitattributes'].includes(name))return {ok:false,category:'unapproved-extension'};
  return {ok:true};
}

export function scanPublicText(text){
  const checks=[
    ['private-key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u],
    ['api-secret',/\bsk-[A-Za-z0-9_-]{20,}\b/u],
    ['github-token',/\b(?:gh[pousr]_[A-Za-z0-9]{25,}|github_pat_[A-Za-z0-9_]{30,})\b/u],
    ['bearer-secret',/\bBearer\s+[A-Za-z0-9_\-.]{25,}/iu],
    ['assigned-secret',/(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password)["']?\s*[=:]\s*(?:["'][A-Za-z0-9_\-./+=]{18,}["']|[A-Za-z0-9_\-./+=]{18,}(?=\s|$))/imu],
    ['personal-path',/\b[A-Za-z]:[\\/]Users[\\/]1320[8][\\/]|wxid_[a-z0-9]{8,}/iu],
  ];
  return checks.filter(([,pattern])=>pattern.test(text)).map(([category])=>({category}));
}

async function walk(root,prefix=''){
  const output=[];
  for(const entry of await readdir(join(root,prefix),{withFileTypes:true})){
    if(entry.name==='.git')continue; // Local Git metadata is never a packaging input.
    const name=prefix?prefix+'/'+entry.name:entry.name;
    if(entry.isSymbolicLink())output.push({name,symlink:true});
    else if(entry.isDirectory())output.push(...await walk(root,name));
    else output.push({name});
  }
  return output;
}

export async function inspectRelease(root,{requireMedia=false,syntax=false}={}){
  root=resolve(root);const errors=[],warnings=[];
  const manifest=JSON.parse(await readFile(join(root,'release-files.json'),'utf8'));
  const source=manifest.source??[],binary=manifest.binary??[],media=manifest.media??[];
  const known=new Set([...source,...binary,...media]);
  if(known.size!==source.length+binary.length+media.length)errors.push({category:'duplicate-allowlist-entry'});
  for(const name of known){const rule=validatePublicPath(name);if(!rule.ok)errors.push({file:name,category:rule.category});}
  const files=await walk(root),present=new Set(files.map(x=>x.name));
  for(const item of files){
    const {name}=item;const rule=validatePublicPath(name);
    if(item.symlink)errors.push({file:name,category:'symlink'});
    if(!rule.ok)errors.push({file:name,category:rule.category});
    if(!known.has(name))errors.push({file:name,category:'not-allowlisted'});
    if(item.symlink)continue;
    if(TEXT.test(name)||['LICENSE','.gitignore','.gitattributes'].includes(name)){
      const text=await readFile(join(root,name),'utf8');
      for(const finding of scanPublicText(text))errors.push({file:name,...finding});
      if(syntax&&/\.(?:mjs|js)$/u.test(name)){
        const result=spawnSync(process.execPath,['--check',join(root,name)],{encoding:'utf8',windowsHide:true});
        if(result.status!==0)errors.push({file:name,category:'javascript-syntax'});
      }
      if(name.endsWith('.md')){
        for(const match of text.matchAll(/\]\(([^)]+)\)/gu)){
          const link=match[1].split('#')[0];
          if(!link||/^(?:https?:|mailto:|#)/iu.test(link))continue;
          const clean=decodeURIComponent(link.replace(/^<|>$/gu,''));
          const destination=resolve(dirname(join(root,name)),clean);
          const rel=relative(root,destination).replaceAll('\\','/');
          if(rel.startsWith('../')||(!present.has(rel)&&!(!requireMedia&&media.includes(rel))))errors.push({file:name,category:'broken-local-link',target:clean});
        }
      }
    }
  }
  for(const name of source)if(!present.has(name))errors.push({file:name,category:'missing-source-file'});
  let mediaCount=0;
  const mediaManifestPath=join(root,'assets/media-manifest.json');
  if(present.has('assets/media-manifest.json')){
    const mediaManifest=JSON.parse(await readFile(mediaManifestPath,'utf8'));
    const declared=new Set(mediaManifest.files.map(item=>item.file));
    if(media.length!==mediaManifest.files.length||declared.size!==mediaManifest.files.length||media.some(name=>!declared.has(name)))errors.push({category:'media-allowlist-mismatch'});
    for(const item of mediaManifest.files){
      if(!media.includes(item.file)){errors.push({file:item.file,category:'unknown-media'});continue;}
      if(!present.has(item.file)){if(requireMedia)errors.push({file:item.file,category:'missing-media'});continue;}
      const bytes=await readFile(join(root,item.file));mediaCount++;
      if(bytes.length!==item.bytes||createHash('sha256').update(bytes).digest('hex')!==item.sha256)errors.push({file:item.file,category:'media-hash-mismatch'});
    }
  }else if(media.length)errors.push({category:'missing-media-manifest'});
  if(mediaCount===0&&!requireMedia&&media.length)warnings.push({category:'source-only-media-not-installed'});
  return {version:manifest.version,files:files.length,mediaPresent:mediaCount,mediaExpected:media.length,errors,warnings};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const root=dirname(dirname(fileURLToPath(import.meta.url)));
  const result=await inspectRelease(root,{requireMedia:process.argv.includes('--require-media'),syntax:true});
  console.log(JSON.stringify(result,null,2));
  if(result.errors.length)process.exitCode=1;
}
