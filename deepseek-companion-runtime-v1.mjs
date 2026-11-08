/** Private stdio adapter for an app-owned, chat-only DeepSeek Harness runtime. */
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdir, readFile, writeFile, rename, open, realpath, stat, lstat, unlink} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {homedir} from 'node:os';
import {join, resolve, relative, isAbsolute, dirname, basename} from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {sanitizeAvatarState} from './companion-live-context-v1.mjs';

const PROVIDER='deepseek-official', MODEL='deepseek-flash', PROFILE='wallpaper-chat';
const CLOSED='聊天服务已关闭，请重新打开聊天窗口。';
const INIT_FAILED='DeepSeek 聊天服务暂时无法启动，请确认已安装官方 Harness 并配置好模型凭据。';
const RUN_FAILED='这次回复没有完成，请稍后重试。';
const NO_OUTPUT='这次没有收到完整的文字回复，请重试。';
const CREDENTIAL_FORMAT='请先在原来的 Harness 中更新凭据格式，再重新打开聊天窗口。';
const freshError=message=>new Error(message);
const inside=(base,path)=>{const r=relative(base,path);return r===''||(!r.startsWith('..')&&!isAbsolute(r));};
const exists=async path=>{try{await stat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
const delay=ms=>new Promise(resolveDelay=>setTimeout(resolveDelay,ms));

/** Only Windows' standard package-local mirror may sit outside a physical AppData root. */
async function isPackageLocalMirror(canonicalRoot,mirrorRoot){
  if(process.platform!=='win32'||!process.env.LOCALAPPDATA)return false;
  let local;try{local=await realpath(resolve(process.env.LOCALAPPDATA));}catch{return false;}
  if(relative(local,dirname(canonicalRoot))!=='')return false;
  const parts=relative(local,mirrorRoot).split(/[\\/]/u);
  if(parts.length!==5||parts[0].toLowerCase()!=='packages'||parts[2].toLowerCase()!=='localcache'||parts[3].toLowerCase()!=='local')return false;
  if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]*_[a-zA-Z0-9]{13}$/u.test(parts[1]))return false;
  const expected=join(local,'Packages',parts[1],'LocalCache','Local',basename(canonicalRoot));
  return relative(expected,mirrorRoot)==='';
}

async function validateOwnedDirectories({canonicalRoot,canonicalOriginal,home,workspace}){
  const [homeInfo,workspaceInfo,canonicalHome,canonicalWorkspace]=await Promise.all([lstat(home),lstat(workspace),realpath(home),realpath(workspace)]);
  // A genuine junction/symlink cannot use the package-redirection exception.
  if(homeInfo.isSymbolicLink()||workspaceInfo.isSymbolicLink()||!homeInfo.isDirectory()||!workspaceInfo.isDirectory())throw freshError(INIT_FAILED);
  if(inside(canonicalOriginal,canonicalHome)||inside(canonicalOriginal,canonicalWorkspace))throw freshError(INIT_FAILED);
  if(basename(canonicalHome).toLowerCase()!=='harness-home'||basename(canonicalWorkspace).toLowerCase()!=='workspace')throw freshError(INIT_FAILED);
  const parent=dirname(canonicalHome);
  if(relative(parent,dirname(canonicalWorkspace))!=='')throw freshError(INIT_FAILED);
  if(!inside(canonicalRoot,parent)&&!await isPackageLocalMirror(canonicalRoot,parent))throw freshError(INIT_FAILED);
}

async function findInstallation(packageRoot){
  const candidates=[packageRoot,process.env.DSH_PACKAGE_ROOT,process.env.APPDATA&&join(process.env.APPDATA,'npm/node_modules/@deepseek-ai/dsh'),process.env.npm_config_prefix&&join(process.env.npm_config_prefix,'node_modules/@deepseek-ai/dsh')].filter(Boolean);
  if(!packageRoot){try{const r=createRequire(import.meta.url);candidates.push(dirname(r.resolve('@deepseek-ai/dsh/package.json')));}catch{}}
  for(const candidate of candidates){
    try{
      const root=resolve(candidate),manifest=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
      if(manifest.name!=='@deepseek-ai/dsh'||!await exists(join(root,'lib/bin.js')))continue;
      const require=createRequire(join(root,'package.json'));
      const {JsonRpcLineTransport}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-sdk-protocol')).href);
      if(typeof JsonRpcLineTransport==='function')return {root,JsonRpcLineTransport};
    }catch{}
    if(packageRoot)break;
  }
  throw freshError(INIT_FAILED);
}

/** Admit only the initial version metadata, without loading any credential values. */
async function requireVersionedCredentials(path){
  let handle;
  try{
    handle=await open(path,'r');
    const byte=Buffer.alloc(1);let line='',bytes=0;
    while(bytes++<8192){
      const read=await handle.read(byte,0,1,null);
      if(read.bytesRead===0&&line==='')break;
      if(read.bytesRead===0||byte[0]===10){
        const metadata=line.replace(/^\uFEFF/u,'').trim();line='';
        if(metadata!==''&&!metadata.startsWith('#')&&metadata!=='---'){
          if(!/^version\s*:\s*1\s*(?:#.*)?$/u.test(metadata))throw freshError(CREDENTIAL_FORMAT);
          return;
        }
        if(read.bytesRead===0)break;
      }else{line+=String.fromCharCode(byte[0]);}
    }
    throw freshError(CREDENTIAL_FORMAT);
  }catch{throw freshError(CREDENTIAL_FORMAT);}
  finally{await handle?.close().catch(()=>{});}
}

function deploymentPatch(credentialsPath,statePath){
  return [
    ...['tool-fs','tool-working-directory','persistent-bash','persistent-pwsh'].map(id=>({id,disabled:true})),
    {id:'system-prompt',config:{includeHarnessIdentity:false,includeRuntimeContext:false,personaPrefix:'你是小鲸，绰号“大肥鱼”，一个由 DeepSeek 驱动、住在桌面房间中的虚拟角色，也是认真、自然的中文聊天伙伴。你平时自称“我”，偶尔自称“大肥鱼”，称用户为“主人”。你不咋爱说话，但很爱主人；温柔亲近，话少但不冷淡，用简短回应和贴心的小细节表达关心，不说教，不用大段反问。默认回复1—2句、通常30字以内，避免长篇、长列表和表情堆叠，不过分卖萌；主人明确要求详细说明时再展开，复杂任务依请求给出必要内容。睡觉、起床、回桌前是你在房间中的动画动作。用户让你做这些动作时，自然确认准备执行，不要以“我是 AI、不需要睡觉、没有身体”为理由拒绝角色动作；例如可以说“好，主人，我去睡觉”。动画目标与实际状态分开：只能按应用提供的已确认状态说动作已经完成，实际位置未知时不要编造已睡着、已起床或已到桌前。认真回答问题，不编造经历、未发生的动作或查询结果。每次请求的 required 实时上下文会提供新的 Asia/Shanghai 时钟快照；用户问现在几点、今天日期或星期时调用 get_current_time，再依据它返回的读取时刻回答。文字要等打字动画自然结束才显示，因此说明“读取时是……”等，不谎称显示瞬间零延迟。用户需要最新资料时，可以使用联网搜索和网页读取，并给出来源。你只在这个独立聊天窗口内回复，不声称能操作用户真实电脑、文件或其他软件。'}},
    {id:'llm-deepseek',config:{apiKeyEnv:'DEEPSEEK_API_KEY',reasoningEffort:'max',thinking:'enabled',defaultContextWindow:1000000,streamIdleTimeoutMs:300000}},
    {insert:[
      {id:'companion-context',name:pathToFileURL(join(dirname(fileURLToPath(import.meta.url)),'companion-live-context-v1.mjs')).href,config:{statePath}},
      {id:'credentials',name:'@deepseek-ai/dsh-credentials-local',config:{path:credentialsPath,watch:false}},
      {id:'web',name:'@deepseek-ai/dsh-web',config:{searchProvider:'deepseek-official',fetchProvider:'http'}},
      {id:'web-search-deepseek',name:'@deepseek-ai/dsh-web-search-deepseek',config:{apiKeyEnv:'DEEPSEEK_API_KEY'}},
      {id:'web-deepseek-api',name:'@deepseek-ai/dsh-web-deepseek-api',config:{apiKeyEnv:'DEEPSEEK_API_KEY'}},
      {id:'web-fetch-http',name:'@deepseek-ai/dsh-web-fetch-http'},
      {id:'tool-web',name:'@deepseek-ai/dsh-tool-web',config:{fetch:true,searchTimeoutMs:60000}},
    ]},
  ];
}

/** The child receives OS launch settings, never inherited provider secrets or app overrides. */
function childEnvironment(home){
  const allowed=new Set(['PATH','PATHEXT','SYSTEMROOT','WINDIR','COMSPEC','USERPROFILE','HOME','APPDATA','LOCALAPPDATA','PROGRAMDATA','TEMP','TMP','LANG','LC_ALL','TZ','NODE_EXTRA_CA_CERTS']);
  const env={};for(const [name,value] of Object.entries(process.env))if(allowed.has(name.toUpperCase()))env[name]=value;
  env.DSH_HOME=home;env.DSH_TELEMETRY_DISABLED='true';env.NO_COLOR='1';return env;
}

/**
 * Factory contract shared with the local server. No generation is performed by initialize().
 * packageRoot permits a preinstalled official dsh location; credentialsPath is a reference only.
 */
export async function createCompanionRuntime({dataRoot=join(process.env.LOCALAPPDATA||process.env.APPDATA||homedir(),'DeepSeekWallpaperCompanion'),packageRoot,credentialsPath=join(homedir(),'.dsh','.credentials.yaml')}={}){
  if(typeof dataRoot!=='string'||!dataRoot||typeof credentialsPath!=='string'||!credentialsPath)throw freshError(INIT_FAILED);
  const root=resolve(dataRoot),originalHome=resolve(homedir(),'.dsh');
  if(inside(originalHome,root))throw freshError('聊天数据目录必须与原来的 Harness 目录分开。');
  const home=join(root,'harness-home'),workspace=join(root,'workspace'),identityPath=join(root,'companion-session-v1.json'),patchPath=join(root,'companion-runtime-v1.patch.yml'),lockPath=join(root,'companion-runtime-v1.lock'),statePath=join(root,'companion-avatar-state-v1.json');
  const credentialSource=resolve(credentialsPath);
  let child,transport,exitTask,initTask,closeTask,closed=false,ready=false,active=null;
  let sessionId=randomUUID(),persisted=false,chain=Promise.resolve(),lockToken;

  async function saveIdentity(){
    const temporary=identityPath+'.'+randomUUID()+'.tmp';
    await writeFile(temporary,JSON.stringify({version:1,sessionId,persisted}),{mode:0o600});
    await rename(temporary,identityPath);
  }
  async function saveAvatarContext(context){
    const temporary=statePath+'.'+randomUUID()+'.tmp';
    await writeFile(temporary,JSON.stringify(sanitizeAvatarState(context)),{mode:0o600});
    await rename(temporary,statePath);
  }
  async function acquireLock(){
    for(let attempt=0;attempt<2;attempt++){
      try{const file=await open(lockPath,'wx',0o600);lockToken=randomUUID();try{await file.writeFile(JSON.stringify({pid:process.pid,token:lockToken}));}finally{await file.close();}return;}
      catch(error){
        if(error.code!=='EEXIST')throw error;
        let previous;try{previous=JSON.parse(await readFile(lockPath,'utf8'));}catch{throw freshError(INIT_FAILED);}
        if(!Number.isInteger(previous.pid)||previous.pid<=0)throw freshError(INIT_FAILED);
        let stale=false;try{process.kill(previous.pid,0);}catch(probe){stale=probe.code==='ESRCH';}
        if(!stale)throw freshError('这个聊天数据目录已在使用，请关闭已有聊天窗口后重试。');
        await unlink(lockPath);
      }
    }
    throw freshError(INIT_FAILED);
  }
  async function releaseLock(){
    if(!lockToken)return;
    try{const record=JSON.parse(await readFile(lockPath,'utf8'));if(record.token===lockToken)await unlink(lockPath);}catch{}
    lockToken=undefined;
  }
  const assertOpen=()=>{if(closed)throw freshError(CLOSED);};
  function emitProgress(collector,phase){
    if(collector.phase===phase)return;collector.phase=phase;
    try{collector.onProgress?.({phase});}catch{}
  }
  function onNotification(method,params){
    const collector=active;
    if(!collector||method!=='session.event'||params?.sessionId!==sessionId)return;
    const event=params.event,data=event?.data;
    if(!data||!Number.isSafeInteger(event.seq)||event.seq<0)return;
    if(event.type==='turn/start'&&Number.isSafeInteger(data.turn)){collector.currentTurn=data.turn;return;}
    if(event.type==='user/message'&&typeof data.id==='string'){
      if(collector.users.size<32)collector.users.set(data.id,{seq:event.seq,turn:collector.currentTurn});return;
    }
    const turn=data.turn;
    if(!Number.isSafeInteger(turn))return;
    if(event.type==='assistant/message'){
      const content=data.message?.content;
      // Do not retain reasoning blocks, streams, provider metadata or tool arguments.
      const text=Array.isArray(content)?content.filter(block=>block?.type==='text'&&typeof block.text==='string').map(block=>block.text).join('\n'):'';
      const previous=collector.assistants.get(turn);
      if(!previous||event.seq>previous.seq)collector.assistants.set(turn,{seq:event.seq,text,interrupted:data.interrupted===true});
    }else if(event.type==='tool/call'){
      collector.lastTool.set(turn,event.seq);
      if(data.name==='web_search'||data.name==='web_fetch')emitProgress(collector,'searching');
    }else if(event.type==='tool/result'){
      collector.lastTool.set(turn,event.seq);emitProgress(collector,'thinking');
    }else if(event.type==='turn/end'){
      collector.ends.set(turn,{seq:event.seq,reason:typeof data.reason?.kind==='string'?data.reason.kind:''});
    }
  }
  async function request(method,params={},timeout=30000){
    assertOpen();return transport.request(method,params,AbortSignal.timeout(timeout));
  }
  async function start(){
    assertOpen();
    // Read the version prefix before loading credentials-local, which otherwise migrates legacy files.
    await requireVersionedCredentials(credentialSource);
    assertOpen();
    await mkdir(root,{recursive:true});
    const canonicalRoot=await realpath(root);
    let canonicalOriginal=originalHome;try{canonicalOriginal=await realpath(originalHome);}catch{}
    if(inside(canonicalOriginal,canonicalRoot))throw freshError(INIT_FAILED);
    await mkdir(home,{recursive:true});await mkdir(workspace,{recursive:true});
    await validateOwnedDirectories({canonicalRoot,canonicalOriginal,home,workspace});
    await acquireLock();assertOpen();
    if(await exists(identityPath)){
      const saved=JSON.parse(await readFile(identityPath,'utf8'));
      if(saved.version!==1||typeof saved.sessionId!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/u.test(saved.sessionId)||typeof saved.persisted!=='boolean')throw freshError(INIT_FAILED);
      sessionId=saved.sessionId;persisted=saved.persisted;
    }else await saveIdentity();
    await saveAvatarContext({});
    await writeFile(patchPath,JSON.stringify(deploymentPatch(credentialSource,statePath),null,2),{mode:0o600});
    const installation=await findInstallation(packageRoot);assertOpen();
    const args=[join(installation.root,'lib/bin.js'),'--profile',PROFILE];
    if(!await exists(join(home,'profiles',PROFILE,'cordis.yml')))args.push('--from-default-profile','sdk-minimal');
    args.push('--patch',patchPath);assertOpen();
    child=spawn(process.execPath,args,{cwd:workspace,env:childEnvironment(home),stdio:['pipe','pipe','pipe'],windowsHide:true});
    const owned=child;
    exitTask=new Promise(resolveExit=>{owned.once('exit',()=>{ready=false;resolveExit();});owned.once('error',()=>{ready=false;resolveExit();});});
    // Drain diagnostics privately. Raw protocol and stderr are never logged or returned to HTTP/UI.
    child.stderr.resume();child.stdin.on('error',()=>{});child.stdout.on('error',()=>{});
    transport=new installation.JsonRpcLineTransport(child.stdout,child.stdin);
    transport.onNotification(onNotification);transport.start();
    const result=await request('initialize',{cwd:workspace,provider:PROVIDER,model:MODEL,reasoningEffort:'max'},90000);
    if(result?.serverInfo?.name!=='deepseek-harness-sdk-runtime')throw freshError(INIT_FAILED);
    if(persisted)await request('session/resume',{sessionId},60000);
    assertOpen();ready=true;return {ready:true,model:MODEL,provider:PROVIDER};
  }
  async function disposeChild(){
    const owned=child;if(!owned)return;
    if(owned.exitCode===null&&owned.signalCode===null){
      try{await transport?.request('shutdown',{},AbortSignal.timeout(1500));}catch{}
      transport?.close();owned.stdin.end();
      await Promise.race([exitTask,delay(2000)]);
      if(owned.exitCode===null&&owned.signalCode===null){owned.kill();await Promise.race([exitTask,delay(2000)]);}
      if(owned.exitCode===null&&owned.signalCode===null){owned.kill('SIGKILL');await exitTask;}
    }else transport?.close();
    child=undefined;transport=undefined;ready=false;
  }
  async function initialize(){
    assertOpen();
    initTask??=start().catch(async error=>{
      await disposeChild();await releaseLock();
      if(error?.message===CREDENTIAL_FORMAT)throw freshError(CREDENTIAL_FORMAT);
      if(closed)throw freshError(CLOSED);
      throw freshError(INIT_FAILED);
    });
    return initTask;
  }
  async function execute({text,onProgress,context}){
    assertOpen();await initialize();assertOpen();
    if(!ready||!transport)throw freshError(INIT_FAILED);
    const collector={onProgress,phase:null,currentTurn:undefined,users:new Map(),assistants:new Map(),lastTool:new Map(),ends:new Map()};
    active=collector;emitProgress(collector,'thinking');
    try{
      // Separate application facts are durable before enqueue; the user's content stays literal.
      await saveAvatarContext(context);
      // The listener and collector are active BEFORE prompt: notifications may precede its receipt.
      const receipt=await request('session/prompt',{sessionId,contentBlocks:[{type:'text',text}]});
      if(typeof receipt?.messageId!=='string'||!receipt.messageId)throw freshError(RUN_FAILED);
      persisted=true;await saveIdentity();
      await request('session/wait',{sessionId},1800000);
      const admission=collector.users.get(receipt.messageId),turn=admission?.turn;
      const answer=collector.assistants.get(turn),end=collector.ends.get(turn),lastTool=collector.lastTool.get(turn)??-1;
      if(!admission||!Number.isSafeInteger(turn)||!answer||!end||answer.seq<=admission.seq||answer.seq<=lastTool||end.seq<=answer.seq||answer.interrupted||end.reason!=='completed'||!answer.text.trim())throw freshError(NO_OUTPUT);
      return {text:answer.text,finishReason:end.reason};
    }catch(error){
      if(closed)throw freshError(CLOSED);
      throw freshError(error?.message===NO_OUTPUT?NO_OUTPUT:RUN_FAILED);
    }finally{if(active===collector)active=null;}
  }
  function run(input={}){
    if(closed)return Promise.reject(freshError(CLOSED));
    if(typeof input.id!=='string'||!input.id||input.id.length>200||typeof input.text!=='string'||!input.text.trim()||input.text.length>24000)return Promise.reject(freshError('请输入 1 到 24000 个字符的消息。'));
    const context=sanitizeAvatarState(input.context);
    const task=chain.then(()=>execute({text:input.text,onProgress:typeof input.onProgress==='function'?input.onProgress:undefined,context}));
    chain=task.catch(()=>{});return task;
  }
  function close(){
    if(closeTask)return closeTask;
    closed=true;active=null;
    closeTask=(async()=>{
      await disposeChild();
      // If initialization was between filesystem awaits, its next guard prevents spawning.
      await initTask?.catch(()=>{});await disposeChild();await releaseLock();
    })();
    return closeTask;
  }
  return Object.freeze({initialize,run,close});
}
