import http from 'node:http';
import {createReadStream} from 'node:fs';
import {open,readFile,writeFile,rename,mkdir,stat} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

const HERE=dirname(fileURLToPath(import.meta.url));
const SAFE={runtime:'聊天服务暂时不可用，请重启后再试。',turn:'这次回复未能完成，请重新发送。',interrupted:'上次聊天已中断，请重新发送。',setup:'需要先放入手机打字视频，暂时不能发送。',lease:'房间连接已失效，请重新连接。',cycle:'打字动画尚未正确完成，请继续播放。',request:'请求格式不正确。'};
const LEASE_MS=30000;
const EARLY_TOLERANCE_MS=250;
const INTENT_VERSION=5;
const cleanText=(value,max=200000)=>String(value??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').slice(0,max);
const validId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(value);
const failure=(status,message)=>Object.assign(new Error(message),{status,publicMessage:message});

/** Read ISO BMFF movie duration without a codec/ffprobe dependency or decoding frames. */
export async function readMp4DurationMs(path){
 const file=await open(path,'r');
 try{
  const {size}=await file.stat();
  async function header(offset,end){
   const b=Buffer.alloc(16);const {bytesRead}=await file.read(b,0,Math.min(16,end-offset),offset);if(bytesRead<8)return null;
   let length=b.readUInt32BE(0),head=8;if(length===1){if(bytesRead<16)return null;const n=b.readBigUInt64BE(8);if(n>BigInt(Number.MAX_SAFE_INTEGER))return null;length=Number(n);head=16;}else if(length===0)length=end-offset;
   if(length<head||offset+length>end)return null;return {type:b.toString('ascii',4,8),length,head};
  }
  let moov;
  for(let offset=0;offset+8<=size;){const box=await header(offset,size);if(!box)break;if(box.type==='moov'){moov={start:offset+box.head,end:offset+box.length};break;}offset+=box.length;}
  if(!moov)throw Error('Invalid MP4 metadata');
  for(let offset=moov.start;offset+8<=moov.end;){const box=await header(offset,moov.end);if(!box)break;if(box.type==='mvhd'){
   const payload=Buffer.alloc(40);const {bytesRead}=await file.read(payload,0,Math.min(40,box.length-box.head),offset+box.head);const version=payload[0];let scale,duration;
   if(version===0&&bytesRead>=20){scale=payload.readUInt32BE(12);duration=payload.readUInt32BE(16);}else if(version===1&&bytesRead>=32){scale=payload.readUInt32BE(20);duration=Number(payload.readBigUInt64BE(24));}else throw Error('Invalid movie duration');
   const ms=duration/scale*1000;if(!Number.isFinite(ms)||ms<=0||ms>3600000)throw Error('Invalid movie duration');return Math.ceil(ms);
  }offset+=box.length;}
  throw Error('Missing movie duration');
 }finally{await file.close();}
}

// Only literal keywords in a newly admitted human message change the goal.
// Matching is intentionally independent of quotes, negation or model output.
export function classifyRestIntent(text){
 let goal=null;
 for(const [keyword]of String(text??'').matchAll(/起床|床|睡|桌|上班|加班|工作/gu))goal=keyword==='床'||keyword==='睡'?'F':'A';
 return goal;
}
function goalForHumanMessage(text,currentGoal){return classifyRestIntent(text)??currentGoal;}

/** HTTP state contains explicit public fields only. Private model output lives in active.pendingText. */
export async function createCompanionServer({runtime,staticRoot=HERE,dataRoot=resolve(process.env.LOCALAPPDATA||join(process.env.USERPROFILE||HERE,'AppData','Local'),'DeepSeekWallpaperCompanion'),typingRoot=join(staticRoot,'companion-typing-v1'),port=17865,now=()=>performance.now()}={}){
 if(!runtime||typeof runtime.initialize!=='function'||typeof runtime.run!=='function')throw Error('A companion runtime is required');
 staticRoot=resolve(staticRoot);typingRoot=resolve(typingRoot);dataRoot=resolve(dataRoot);await mkdir(dataRoot,{recursive:true});
 const assets={};for(const anchor of ['B','E']){try{const durationMs=await readMp4DurationMs(join(typingRoot,anchor+'.mp4'));assets[anchor]={available:true,url:'/companion-typing-v1/'+anchor+'.mp4',durationMs};}catch{assets[anchor]={available:false,url:'/companion-typing-v1/'+anchor+'.mp4',durationMs:0};}}
 const instanceId=randomUUID();let version=1,runtimeState={state:'starting'},restAnchor='A',turns=[],active=null,lease=null,clearInFlight=false,closed=false,url;
 let persistence=Promise.resolve();const ledgerPath=join(dataRoot,'chat-ledger-v1.json');const peers=new Set();const seenCycles=new Set();const acknowledgements=new Map();
 try{
  const saved=JSON.parse(await readFile(ledgerPath,'utf8'));if(saved.restAnchor==='A'||saved.restAnchor==='F')restAnchor=saved.restAnchor;
  if(Array.isArray(saved.turns))turns=saved.turns.filter(t=>validId(t.id)&&typeof t.userText==='string').map(t=>({id:t.id,userText:cleanText(t.userText,24000),status:t.status==='complete'&&typeof t.reply==='string'?'complete':'error',phase:'idle',replyReady:t.status==='complete'&&typeof t.reply==='string',...(t.status==='complete'&&typeof t.reply==='string'?{reply:cleanText(t.reply)}:{error:SAFE.interrupted})}));
 }catch(error){if(error.code!=='ENOENT'){/* Invalid owned ledger is never reflected to the browser. */}}
 function expireLease(){if(lease&&now()>=lease.expiresAt){lease=null;if(active)active.cycle=null;return true;}return false;}
 function snapshot(){return {appId:'deepseek-wallpaper-companion-v1',instanceId,version,runtime:{...runtimeState},assets:{B:{...assets.B},E:{...assets.E}},restAnchor,activeTurnId:active?.turn.id??null,room:{connected:!!lease},turns:turns.map(t=>({id:t.id,userText:t.userText,status:t.status,phase:t.phase,replyReady:!!t.replyReady,...(t.status==='complete'&&typeof t.reply==='string'?{reply:t.reply}:{}),...(t.status==='error'?{error:t.error||SAFE.turn}:{})}))};}
 function persist(publicTurns=snapshot().turns){const data=JSON.stringify({version:1,intentVersion:INTENT_VERSION,restAnchor,turns:publicTurns},null,2);persistence=persistence.catch(()=>{}).then(async()=>{const temporary=ledgerPath+'.tmp';await writeFile(temporary,data,{encoding:'utf8',mode:0o600});await rename(temporary,ledgerPath);});return persistence;}
 function publish({save=true}={}){version++;const data='event: state\ndata: '+JSON.stringify(snapshot())+'\n\n';for(const peer of peers){if(peer.destroyed||peer.writableLength>1024*1024){peers.delete(peer);peer.destroy();}else peer.write(data);}if(save)void persist();}
 function pump(){
  if(closed||active||runtimeState.state!=='ready')return;const turn=turns.find(t=>t.status==='queued');if(!turn)return;
  turn.status='generating';turn.phase='thinking';turn.replyReady=false;const owned={turn,pendingText:null,cycle:null,modelDone:false};active=owned;publish();
  Promise.resolve().then(()=>runtime.run({id:turn.id,text:turn.userText,context:{desiredGoal:restAnchor,roomConnected:!!lease&&now()<lease.expiresAt,actualAnchor:null},onProgress:value=>{if(closed||active!==owned||owned.modelDone)return;const phase=value?.phase;if(phase==='thinking'||phase==='searching'){turn.phase=phase;publish({save:false});}}})).then(result=>{
   if(closed||active!==owned)return;const text=typeof result?.text==='string'?cleanText(result.text):'';if(!text.trim())throw Error('Empty response');owned.pendingText=text;owned.modelDone=true;turn.replyReady=true;turn.status='typing';turn.phase='waiting_animation';publish();
  }).catch(()=>{if(closed||active!==owned)return;owned.pendingText=null;turn.status='error';turn.phase='idle';turn.replyReady=false;turn.error=SAFE.turn;active=null;publish();pump();});
 }
 function requireLease(body){if(expireLease())publish({save:false});if(!lease||body.clientId!==lease.clientId||body.leaseId!==lease.id)throw failure(409,SAFE.lease);return lease;}
 function sameCycle(c,body){return c&&c.turnId===body.turnId&&c.anchor===body.anchor&&c.cycleId===body.cycleId&&c.leaseId===body.leaseId&&c.clientId===body.clientId;}
 async function roomAction(body){
  if(body.action==='connect'){
   if(!validId(body.clientId))throw failure(400,SAFE.request);expireLease();if(lease&&lease.clientId!==body.clientId)throw failure(409,'另一个房间窗口正在播放，请使用那个窗口。');
   if(!lease)lease={id:randomUUID(),clientId:body.clientId,expiresAt:now()+LEASE_MS};else lease.expiresAt=now()+LEASE_MS;publish({save:false});return {leaseId:lease.id,snapshot:snapshot()};
  }
  const owner=requireLease(body);
  if(body.action==='heartbeat'){owner.expiresAt=now()+LEASE_MS;return {snapshot:snapshot()};}
  if(body.action!=='typing-started'&&body.action!=='typing-ended')throw failure(400,SAFE.request);
  if(!validId(body.turnId)||!validId(body.cycleId)||!['B','E'].includes(body.anchor)||!assets[body.anchor].available)throw failure(409,SAFE.cycle);
  const cached=acknowledgements.get(body.cycleId);
  if(body.action==='typing-ended'&&cached&&sameCycle(cached,body))return {snapshot:snapshot(),decision:cached.decision,turnId:body.turnId,cycleId:body.cycleId};
  if(!active||active.turn.id!==body.turnId)throw failure(409,SAFE.cycle);
  if(body.action==='typing-started'){
   if(sameCycle(active.cycle,body))return {snapshot:snapshot(),decision:'started',turnId:body.turnId,cycleId:body.cycleId};
   if(active.cycle||seenCycles.has(body.cycleId))throw failure(409,SAFE.cycle);
   seenCycles.add(body.cycleId);active.cycle={turnId:body.turnId,anchor:body.anchor,cycleId:body.cycleId,leaseId:owner.id,clientId:owner.clientId,startedAt:now(),ending:null};active.turn.phase=active.modelDone?'typing':active.turn.phase;publish({save:false});return {snapshot:snapshot(),decision:'started',turnId:body.turnId,cycleId:body.cycleId};
  }
  const owned=active;const cycle=owned.cycle;if(!sameCycle(cycle,body))throw failure(409,SAFE.cycle);
  if(cycle.ending)return cycle.ending;
  const remaining=assets[cycle.anchor].durationMs-(now()-cycle.startedAt);if(remaining>EARLY_TOLERANCE_MS)throw failure(409,SAFE.cycle);
  cycle.ending=(async()=>{
   if(remaining>0)await delay(Math.ceil(remaining)+1);
   requireLease(body);if(closed||active!==owned||owned.cycle!==cycle||now()-cycle.startedAt<assets[cycle.anchor].durationMs)throw failure(409,SAFE.cycle);
   const decision=owned.modelDone?'finished':'continue';acknowledgements.set(cycle.cycleId,{...cycle,ending:null,decision});owned.cycle=null;
   if(decision==='finished'){owned.turn.reply=owned.pendingText;owned.pendingText=null;owned.turn.status='complete';owned.turn.phase='idle';active=null;publish();pump();}else publish({save:false});
   return {snapshot:snapshot(),decision,turnId:body.turnId,cycleId:body.cycleId};
  })();try{return await cycle.ending;}catch(error){cycle.ending=null;throw error;}
 }
 const staticFiles=new Map([['/chat',['deepseek-chat-v1.html','text/html; charset=utf-8']],['/',['deepseek-chat-v1.html','text/html; charset=utf-8']],['/room',['room-companion-v1.html','text/html; charset=utf-8']],...['deepseek-chat-v1.js','companion-room-v1.js','idle-breath-v4.js','room-mark-cover-v4.js'].map(file=>['/'+file,[file,'text/javascript; charset=utf-8']])]);
 for(const file of ['AB','BA','BC','CB','CD','DC','DE','ED','EF','FE','loop-B','loop-E','loop-F'])staticFiles.set('/room-animation-v2/'+file+'.mp4',['room-animation-v2/'+file+'.mp4','video/mp4']);
 for(const anchor of ['A','B','C','D','E','F'])staticFiles.set('/room-animation-v2/pose-'+anchor+'.png',['room-animation-v2/pose-'+anchor+'.png','image/png']);
 function json(res,status,data){if(res.destroyed)return;res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(data));}
 async function readBody(req){const contentType=req.headers['content-type']||'';if(!/^application\/json(?:\s*;|$)/i.test(contentType))throw failure(415,SAFE.request);if(Number(req.headers['content-length'])>131072)throw failure(413,SAFE.request);let length=0;const chunks=[];for await(const chunk of req){length+=chunk.length;if(length>131072)throw failure(413,SAFE.request);chunks.push(chunk);}try{const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!body||typeof body!=='object'||Array.isArray(body))throw Error();return body;}catch{throw failure(400,SAFE.request);}}
 const server=http.createServer(async(req,res)=>{
  res.setHeader('x-content-type-options','nosniff');res.setHeader('referrer-policy','no-referrer');res.setHeader('cache-control','no-store');
  try{
   if(req.headers.host!==new URL(url).host)throw failure(403,'只允许本机访问。');
   if(req.method==='POST'&&req.headers.origin!==url)throw failure(403,'请求来源不正确。');
   if(!['GET','HEAD','POST'].includes(req.method))throw failure(405,SAFE.request);
   if(expireLease())publish({save:false});
   const path=new URL(req.url,url).pathname;
   if(path==='/api/state'&&req.method==='GET'){json(res,200,snapshot());return;}
   if(path==='/api/events'&&req.method==='GET'){
    res.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-store','connection':'keep-alive','x-accel-buffering':'no'});res.write('event: state\ndata: '+JSON.stringify(snapshot())+'\n\n');peers.add(res);req.on('close',()=>peers.delete(res));return;
   }
   if(path==='/api/chat'&&req.method==='POST'){
    const body=await readBody(req);if(typeof body.text!=='string'||!body.text.trim()||body.text.length>24000)throw failure(400,SAFE.request);
    if(clearInFlight)throw failure(409,'正在清空聊天记录，请稍后再发。');
    if(!assets.B.available&&!assets.E.available)throw failure(409,SAFE.setup);if(runtimeState.state==='error')throw failure(503,SAFE.runtime);if(turns.filter(t=>t.status==='queued').length>=8)throw failure(429,'等待中的消息已满，请稍后再发。');
    const userText=cleanText(body.text,24000);restAnchor=goalForHumanMessage(body.text,restAnchor);const turn={id:randomUUID(),userText,status:'queued',phase:'reading',replyReady:false};turns.push(turn);publish();pump();json(res,202,{turnId:turn.id,snapshot:snapshot()});return;
   }
   if(path==='/api/chat/clear'&&req.method==='POST'){
    await readBody(req);if(clearInFlight||active||turns.some(turn=>['queued','generating','typing'].includes(turn.status)))throw failure(409,'回复进行中，请结束后再清空。');
    clearInFlight=true;
    try{await persist([]);turns=[];publish({save:false});json(res,200,{snapshot:snapshot()});}
    finally{clearInFlight=false;}
    return;
   }
   if(path==='/api/room'&&req.method==='POST'){const body=await readBody(req);json(res,200,await roomAction(body));return;}
   if(path==='/api/shutdown'&&req.method==='POST'){await readBody(req);json(res,200,{ok:true});setImmediate(()=>{void close().catch(()=>{});});return;}
   if(req.method!=='GET'&&req.method!=='HEAD')throw failure(405,SAFE.request);
   let asset=staticFiles.get(path),file;
   if(path==='/companion-typing-v1/B.mp4'||path==='/companion-typing-v1/E.mp4'){const anchor=path.includes('/B.')?'B':'E';if(!assets[anchor].available)throw failure(404,'未找到文件。');file=join(typingRoot,anchor+'.mp4');asset=[null,'video/mp4'];}
   else if(asset)file=join(staticRoot,asset[0]);
   if(!asset)throw failure(404,'未找到文件。');let info;try{info=await stat(file);if(!info.isFile())throw Error();}catch{throw failure(404,'未找到文件。');}
   let start=0,end=info.size-1,status=200;const headers={'content-type':asset[1],'content-length':info.size,'accept-ranges':'bytes'};
   if(req.headers.range){const match=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);if(!match||(!match[1]&&!match[2])){res.setHeader('content-range','bytes */'+info.size);throw failure(416,'视频范围不正确。');}if(!match[1]){const length=Number(match[2]);start=Math.max(0,info.size-length);}else{start=Number(match[1]);if(match[2])end=Math.min(info.size-1,Number(match[2]));}if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=info.size||Number(match[2])===0&&!match[1]){res.setHeader('content-range','bytes */'+info.size);throw failure(416,'视频范围不正确。');}status=206;headers['content-range']=`bytes ${start}-${end}/${info.size}`;headers['content-length']=end-start+1;}
   res.writeHead(status,headers);if(req.method==='HEAD'){res.end();return;}const stream=createReadStream(file,{start,end});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
  }catch(error){if(!res.headersSent)json(res,error.status||500,{error:error.publicMessage||'服务暂时不可用，请稍后再试。'});else res.destroy();}
 });
 server.requestTimeout=15000;server.headersTimeout=10000;
 await new Promise((resolveReady,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.off('error',reject);resolveReady();});});url='http://127.0.0.1:'+server.address().port;
 const heartbeat=setInterval(()=>{if(expireLease())publish({save:false});for(const peer of peers)if(!peer.destroyed)peer.write(': heartbeat\n\n');},5000);heartbeat.unref();await persist();
 Promise.resolve().then(()=>runtime.initialize()).then(()=>{if(closed)return;runtimeState={state:'ready',model:'deepseek-flash'};publish({save:false});pump();}).catch(()=>{if(closed)return;runtimeState={state:'error',error:SAFE.runtime};for(const turn of turns)if(turn.status==='queued'){turn.status='error';turn.phase='idle';turn.error=SAFE.turn;}publish({save:!clearInFlight});});
 let closePromise;
 function close(){return closePromise??=(async()=>{closed=true;clearInterval(heartbeat);for(const peer of peers)peer.end();peers.clear();await new Promise(resolveClosed=>{server.close(resolveClosed);server.closeAllConnections();});await persistence.catch(()=>{});await runtime.close?.();})();}
 return {url,server,close};
}

async function main(){
 const args=process.argv.slice(2);let port=17865,dataRoot,openWindow=false;
 for(let i=0;i<args.length;i++){if(args[i]==='--open')openWindow=true;else if(args[i]==='--port'){port=Number(args[++i]);if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid port');}else if(args[i]==='--data-root'){dataRoot=resolve(args[++i]||'');}else throw Error('Unknown argument');}
 dataRoot??=resolve(process.env.LOCALAPPDATA||join(process.env.USERPROFILE||HERE,'AppData','Local'),'DeepSeekWallpaperCompanion');await mkdir(dataRoot,{recursive:true});
 const {createCompanionRuntime}=await import('./deepseek-companion-runtime-v1.mjs');const runtime=await createCompanionRuntime({dataRoot});const companion=await createCompanionServer({runtime,dataRoot,port});
 await writeFile(join(dataRoot,'server-v1.json'),JSON.stringify({pid:process.pid,url:companion.url,startedAt:new Date().toISOString()},null,2),{mode:0o600});
 if(openWindow){const reportOpenFailure=()=>console.error('Chat window could not open. The local service remains available; check edgeExe in companion-settings.local.json or run check-environment.cmd.');try{const {findCompanionEdge}=await import('./companion-paths.mjs');const edge=findCompanionEdge(HERE);const child=spawn(edge,['--app='+companion.url+'/chat','--window-size=460,780'],{detached:true,stdio:'ignore',windowsHide:false});child.on('error',reportOpenFailure);child.unref();}catch{reportOpenFailure();}}
 console.log('DeepSeek companion listening at '+companion.url+'/chat');let stopping=false;const stop=async()=>{if(stopping)return;stopping=true;await companion.close();process.exit(0);};process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(()=>{console.error('聊天服务未能启动，请检查端口和运行环境。');process.exitCode=1;});
