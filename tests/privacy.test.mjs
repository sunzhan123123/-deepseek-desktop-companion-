import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import {join,dirname,basename,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {validatePublicPath,scanPublicText,inspectRelease} from '../scripts/verify-release.mjs';

async function removeOwnedTemporary(path){
  assert.equal(dirname(resolve(path)),resolve(tmpdir()));
  assert.ok(basename(path).startsWith('companion-'));
  await rm(path,{recursive:true,force:true});
}

test('release path policy blocks traversal, credentials, chat, model memory and recordings',()=>{
  for(const name of ['../escape.js','/absolute.txt','C:/private.txt','.dsh/account.yaml',
    '.credentials.yaml','data/chat.json','harness-home/sessions/record.jsonl',
    'chat-ledger-v1.json','companion-session-v1.json','server.stdout.log',
    'companion-settings.local.json','node_modules/module/index.js','recording.mp4']){
    assert.equal(validatePublicPath(name).ok,false,name);
  }
  assert.equal(validatePublicPath('docs/INSTALL.zh-CN.md').ok,true);
  assert.equal(validatePublicPath('room-animation-v2/AB.mp4').ok,true);
});

test('secret detection reports categories without returning the secret',()=>{
  const fake='sk-'+'x'.repeat(40);
  const findings=scanPublicText('const sample = "'+fake+'";');
  assert.ok(findings.length>0);
  assert.ok(!JSON.stringify(findings).includes(fake));
  assert.deepEqual(scanPublicText('const name="DEEPSEEK_API_KEY"; // reference, no value'),[]);
});

test('quoted JSON keys, ENV assignments and uppercase media cannot bypass release policy',()=>{
  const fake='Q'.repeat(32);
  assert.ok(scanPublicText(JSON.stringify({api_key:fake})).length>0);
  assert.ok(scanPublicText('DEEPSEEK_API_KEY='+fake).length>0);
  assert.equal(validatePublicPath('personal.PNG').ok,false);
  assert.equal(validatePublicPath('room-animation-v2/AB.MP4').ok,false);
  assert.equal(validatePublicPath('private.EXE').ok,false);
});

test('a duplicate media manifest cannot replace another approved media item',async()=>{
  const root=await mkdtemp(join(tmpdir(),'companion-duplicate-manifest-'));
  try{
    await mkdir(join(root,'assets'));
    const manifest={version:'1.0.0',source:['release-files.json','assets/media-manifest.json'],binary:[],media:['room-animation-v2/AB.mp4','room-animation-v2/BA.mp4']};
    await writeFile(join(root,'release-files.json'),JSON.stringify(manifest));
    const row={file:'room-animation-v2/AB.mp4',bytes:0,sha256:createHash('sha256').digest('hex')};
    await writeFile(join(root,'assets/media-manifest.json'),JSON.stringify({files:[row,row]}));
    const report=await inspectRelease(root);
    assert.ok(report.errors.some(x=>x.category==='media-allowlist-mismatch'));
  }finally{await removeOwnedTemporary(root);}
});

test('a public-looking unlisted file cannot silently enter an archive',async()=>{
  const root=await mkdtemp(join(tmpdir(),'companion-publish-policy-'));
  try{
    const manifest={version:'1.0.0',source:['README.md','release-files.json'],binary:[],media:[]};
    await writeFile(join(root,'release-files.json'),JSON.stringify(manifest));
    await writeFile(join(root,'README.md'),'Public documentation.');
    const good=await inspectRelease(root);
    assert.deepEqual(good.errors,[]);
    await mkdir(join(root,'docs'));
    await writeFile(join(root,'docs','extra.txt'),'This file is not approved for publication.');
    const bad=await inspectRelease(root);
    assert.ok(bad.errors.some(x=>x.category==='not-allowlisted'));
  }finally{await removeOwnedTemporary(root);}
});
