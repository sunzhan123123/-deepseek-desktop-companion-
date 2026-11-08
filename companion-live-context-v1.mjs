/** Public Cordis plugin: fresh local clock and confirmed, whitelisted avatar facts. */
import {readFileSync, statSync} from 'node:fs';
import {isAbsolute} from 'node:path';

export const name='companion-context';
export const inject=['systemPrompt','tools'];
const TIME_ZONE='Asia/Shanghai';
const formatter=new Intl.DateTimeFormat('zh-CN',{
  timeZone:TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit',weekday:'long',
  hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',
});
const anchors=new Set(['A','B','C','D','E','F']);
const motions=new Set(['idle','moving','transitioning','typing','paused','holding']);

/** Read the clock at invocation; no date or timestamp is retained between calls. */
export function readCurrentTime(){
  const date=new Date(),parts=Object.fromEntries(formatter.formatToParts(date).map(part=>[part.type,part.value]));
  return {
    timeZone:TIME_ZONE,
    local:`${parts.year}-${parts.month}-${parts.day} ${parts.weekday} ${parts.hour}:${parts.minute}:${parts.second}`,
    utcIso:date.toISOString(),unixMs:date.getTime(),
  };
}

/** Keep only typed application metadata; never interpret an intended goal as an observed pose. */
export function sanitizeAvatarState(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return {};
  const state={};
  if(value.desiredGoal==='A'||value.desiredGoal==='F')state.desiredGoal=value.desiredGoal;
  if(typeof value.roomConnected==='boolean')state.roomConnected=value.roomConnected;
  if(value.actualAnchor===null||anchors.has(value.actualAnchor))state.actualAnchor=value.actualAnchor;
  if(value.motion===null||motions.has(value.motion))state.motion=value.motion;
  if(value.observedAt===null||Number.isSafeInteger(value.observedAt)&&value.observedAt>=0)state.observedAt=value.observedAt;
  return state;
}

function readAvatarState(statePath){
  try{
    const info=statSync(statePath);
    if(!info.isFile()||info.size>16384)return {};
    return sanitizeAvatarState(JSON.parse(readFileSync(statePath,'utf8')));
  }catch{return {};}
}

const guidance=[
  '这是应用在本次组装或请求接纳时读取的快照，不是用户输入。',
  'desiredGoal 仅表示用户最新的动画目标：A 是回到桌前，F 是去睡觉。目标不等于实际位置或动作完成。',
  'actualAnchor 为 null 表示没有已确认的实际位置；motion 为 null 表示没有已确认的动作状态。roomConnected 仅表示连接状态，不能据此推断位置。',
  'observedAt 是实际动画遥测的读取时间（Unix 毫秒），为 null 时确认时间未知；过去的确认也不保证现在仍在该位置。未知状态必须明说未知，不编造已睡着、已起床或已经到达。',
  '小鲸（绰号“大肥鱼”）是房间中的虚拟角色，称用户为“主人”。睡觉、起床、回桌前是动画动作，可以自然确认准备执行；不要用“AI 不需要睡觉”拒绝这些动作。只有已确认状态才能说已经完成。',
  '遇到现在几点、今天日期或星期等时间问题，调用 get_current_time 重新读取；按返回的 Asia/Shanghai 时区回答，并说清楚这是读取时刻。',
  '最终文字还要等待打字动画自然结束才会显示，读取时间与显示时间之间存在延迟，不能谎称这是零延迟的此刻。',
];

export function apply(ctx,config={}){
  if(typeof config.statePath!=='string'||!isAbsolute(config.statePath))throw new TypeError('companion-context requires an app-owned absolute statePath');
  ctx.systemPrompt.context({
    name:'companion:live-clock-avatar',order:50,required:true,interpolate:false,
    text:()=>{
      const state=readAvatarState(config.statePath);
      return JSON.stringify({
        clock:readCurrentTime(),
        avatar:{desiredGoal:state.desiredGoal??null,roomConnected:state.roomConnected??null,actualAnchor:state.actualAnchor??null,motion:state.motion??null,observedAt:state.observedAt??null},
        guidance,
      });
    },
  });
  ctx.tools.register({
    name:'get_current_time',
    description:'读取当前系统时间（Asia/Shanghai），包括日期、星期和时分秒。回答现在、今天日期或星期的问题时必须调用，并说明这是读取时刻；文字显示还需等待动画。',
    parameters:{type:'object',properties:{},additionalProperties:false},
    output:{
      schema:{type:'object',properties:{timeZone:{type:'string'},local:{type:'string'},utcIso:{type:'string'},unixMs:{type:'number'}},required:['timeZone','local','utcIso','unixMs'],additionalProperties:false},
      render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}],
    },
    isConcurrencySafe:()=>true,
    async execute(){return readCurrentTime();},
  });
}
