import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join,dirname,basename,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {createCompanionServer,classifyRestIntent} from '../deepseek-companion-server-v1.mjs';

const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
// Minimal standards-shaped movie metadata; tests exercise the HTTP protocol, not video decoding.
function movieDuration(ms){
  const mvhd=Buffer.alloc(28);mvhd.writeUInt32BE(28,0);mvhd.write('mvhd',4);
  mvhd.writeUInt32BE(1000,20);mvhd.writeUInt32BE(ms,24);
  const moov=Buffer.alloc(8);moov.writeUInt32BE(36);moov.write('moov',4);
  return Buffer.concat([moov,mvhd]);
}
test('the wake-up word is a whole match and the last explicit destination wins',()=>{
  for(const [message,goal] of [['起床','A'],['起床工作','A'],['上床睡觉','F'],
    ['睡醒后上班','A'],['桌边工作，之后睡觉','F'],['今天好冷',null],
    ['不要睡','F'],['“床”这个字','F']])assert.equal(classifyRestIntent(message),goal,message);
});

test('HTTP replies stay private until a real-duration typing cycle ends; clear keeps model memory',async()=>{
  const temporary=await mkdtemp(join(tmpdir(),'companion-release-smoke-'));
  const dataRoot=join(temporary,'private-test-data'),typingRoot=join(temporary,'typing');
  await mkdir(typingRoot);
  for(const name of ['B','E'])await writeFile(join(typingRoot,name+'.mp4'),movieDuration(1000));
  let clock=0,runCount=0,closed=false;
  const memoryPath=join(temporary,'model-memory-sentinel.txt');
  await writeFile(memoryPath,'test-owned memory');
  const runtime={async initialize(){},async run(){runCount++;return {text:'测试回复'};},async close(){closed=true;}};
  const service=await createCompanionServer({runtime,staticRoot:ROOT,dataRoot,typingRoot,port:0,now:()=>clock});
  async function get(path){return fetch(service.url+path);}
  async function post(path,body,origin=service.url){
    const response=await fetch(service.url+path,{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify(body)});
    return {status:response.status,body:await response.json()};
  }
  try{
    for(let n=0;n<100;n++){
      if((await (await get('/api/state')).json()).runtime.state==='ready')break;
      await delay(5);
    }
    assert.equal((await get('/chat')).status,200);
    assert.equal((await get('/.credentials.yaml')).status,404);
    assert.equal((await post('/api/chat',{text:'test'},'https://untrusted.invalid')).status,403);
    const connected=await post('/api/room',{action:'connect',clientId:'release-test-room'});
    assert.equal(connected.status,200);
    const lease={clientId:'release-test-room',leaseId:connected.body.leaseId};
    const accepted=await post('/api/chat',{text:'请起床工作'});
    assert.equal(accepted.status,202);
    const turnId=accepted.body.turnId;
    for(let n=0;n<100;n++){
      const state=await (await get('/api/state')).json();
      if(state.turns[0]?.replyReady)break;
      await delay(5);
    }
    const pending=await (await get('/api/state')).json();
    assert.equal(pending.restAnchor,'A');
    assert.equal(pending.turns[0].status,'typing');
    assert.equal(Object.hasOwn(pending.turns[0],'reply'),false);
    const cycle={...lease,turnId,anchor:'B',cycleId:'release-test-cycle'};
    assert.equal((await post('/api/room',{...cycle,action:'typing-started'})).status,200);
    assert.equal((await post('/api/room',{...cycle,action:'typing-ended'})).status,409);
    clock=1001;
    const ended=await post('/api/room',{...cycle,action:'typing-ended'});
    assert.equal(ended.status,200);
    assert.equal(ended.body.decision,'finished');
    assert.equal(ended.body.snapshot.turns[0].reply,'测试回复');
    assert.equal((await post('/api/chat/clear',{})).status,200);
    const cleared=await (await get('/api/state')).json();
    assert.equal(cleared.turns.length,0);
    assert.equal(runCount,1);
    assert.equal(await readFile(memoryPath,'utf8'),'test-owned memory');
    assert.equal(closed,false);
  }finally{
    await service.close();
    assert.equal(dirname(resolve(temporary)),resolve(tmpdir()));
    assert.ok(basename(temporary).startsWith('companion-release-smoke-'));
    await rm(temporary,{recursive:true,force:true});
  }
  assert.equal(closed,true);
});
