import OpenAI from 'openai';
import { db } from '../db.js';
import { env } from '../env.js';

type AiErrorKind='authentication'|'quota'|'rate_limit'|'provider'|'network'|'request';

let cooldownUntilMs=0;

function cleanMessage(value:string){
  return value
    .replace(/sk-[A-Za-z0-9_-]+/g,'[redacted]')
    .replace(/Bearer\s+\S+/gi,'Bearer [redacted]')
    .replace(/\s+/g,' ')
    .trim()
    .slice(0,500);
}

function failureKind(status:number,message:string):AiErrorKind{
  const value=message.toLowerCase();
  if(status===401||status===403)return 'authentication';
  if(status===429&&/(insufficient_quota|quota|billing|credits)/.test(value))return 'quota';
  if(status===429)return 'rate_limit';
  if(status>=500)return 'provider';
  return 'request';
}

function cooldownMs(kind:AiErrorKind){
  if(kind==='authentication'||kind==='quota')return 15*60_000;
  if(kind==='rate_limit')return 60_000;
  if(kind==='provider'||kind==='network')return 30_000;
  return 10_000;
}

function recordSuccess(){
  cooldownUntilMs=0;
  void db.query(`UPDATE ai_runtime_health SET status='healthy',consecutive_failures=0,
    total_requests=total_requests+1,last_request_at=NOW(),last_success_at=NOW(),
    last_error_kind=NULL,last_error_message=NULL,cooldown_until=NULL,updated_at=NOW() WHERE id=1`)
    .catch(error=>console.warn('[ai-runtime] unable to record successful request',error));
}

function recordFailure(kind:AiErrorKind,message:string){
  const duration=cooldownMs(kind);
  cooldownUntilMs=Math.max(cooldownUntilMs,Date.now()+duration);
  const status=kind==='request'?'degraded':'cooling_down';
  void db.query(`UPDATE ai_runtime_health SET status=$1,consecutive_failures=consecutive_failures+1,
    total_requests=total_requests+1,total_failures=total_failures+1,last_request_at=NOW(),last_failure_at=NOW(),
    last_error_kind=$2,last_error_message=$3,cooldown_until=NOW()+($4::text||' milliseconds')::interval,updated_at=NOW()
    WHERE id=1`,[status,kind,cleanMessage(message)||'OpenAI request failed.',duration])
    .catch(error=>console.warn('[ai-runtime] unable to record failed request',error));
}

const trackedFetch:typeof fetch=async(input,init)=>{
  if(Date.now()<cooldownUntilMs){
    return new Response(JSON.stringify({error:{message:'Saucin AI is temporarily cooling down after a provider failure.',type:'ai_runtime_cooldown'}}),{
      status:429,headers:{'content-type':'application/json'}
    });
  }
  try{
    const response=await globalThis.fetch(input,init);
    if(response.ok)recordSuccess();
    else {
      const message=await response.clone().text().catch(()=>response.statusText);
      recordFailure(failureKind(response.status,message),message||response.statusText);
    }
    return response;
  }catch(error){
    recordFailure('network',error instanceof Error?error.message:String(error));
    throw error;
  }
};

export const aiClient=env.OPENAI_API_KEY
  ?new OpenAI({apiKey:env.OPENAI_API_KEY,maxRetries:0,fetch:trackedFetch})
  :null;

export async function getAiRuntimeHealth(){
  if(!env.AI_ENABLED){
    return {status:'disabled',configured:Boolean(env.OPENAI_API_KEY),enabled:false,needs_attention:false,
      summary:'AI features are disabled. Discord monitoring and rule-based fallbacks remain active.'};
  }
  if(!env.OPENAI_API_KEY){
    return {status:'unconfigured',configured:false,enabled:true,needs_attention:true,
      summary:'OpenAI is not configured. Discord monitoring and rule-based fallbacks remain active.'};
  }
  const result=await db.query(`SELECT *,GREATEST(0,CEIL(EXTRACT(EPOCH FROM (cooldown_until-NOW()))))::int AS cooldown_remaining_seconds
    FROM ai_runtime_health WHERE id=1`);
  const row=result.rows[0]||{};
  const cooling=Number(row.cooldown_remaining_seconds||0)>0;
  const status=cooling?'cooling_down':row.status==='cooling_down'?'degraded':String(row.status||'unknown');
  const kind=String(row.last_error_kind||'');
  const summary=status==='healthy'?'AI requests are operating normally.'
    :status==='unknown'?'AI is configured and waiting for its first request.'
    :cooling?`AI is temporarily paused after a ${kind.replaceAll('_',' ')||'provider'} error.`
    :`AI recently encountered a ${kind.replaceAll('_',' ')||'provider'} error and will retry automatically.`;
  return {
    status,configured:true,enabled:true,needs_attention:['authentication','quota'].includes(kind)&&status!=='healthy',
    summary,consecutive_failures:Number(row.consecutive_failures||0),total_requests:Number(row.total_requests||0),
    total_failures:Number(row.total_failures||0),last_request_at:row.last_request_at,last_success_at:row.last_success_at,
    last_failure_at:row.last_failure_at,last_error_kind:row.last_error_kind,last_error_message:row.last_error_message,
    cooldown_until:row.cooldown_until,cooldown_remaining_seconds:Number(row.cooldown_remaining_seconds||0)
  };
}
