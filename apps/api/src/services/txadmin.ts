import { createHash } from 'node:crypto';
import { db } from '../db.js';

export type TxAdminEventInput = {
  occurred_at: string;
  severity: 'info'|'warning'|'error'|'critical';
  event_type: string;
  category: string;
  resource_name?: string|null;
  message: string;
  fingerprint?: string|null;
  source_file?: string|null;
  line_number?: number|null;
  metadata?: Record<string,unknown>;
};

export type TxAdminIngestInput = {
  collector_id: string;
  server_name: string;
  hostname: string;
  txdata_path: string;
  collector_version: string;
  heartbeat_at: string;
  metadata?: Record<string,unknown>;
  events: TxAdminEventInput[];
};

export type TxAdminSettings = {
  group_window_minutes:number;
  auto_draft_enabled:boolean;
  draft_min_occurrences:number;
  alert_channel_id:string|null;
  alert_role_ids:string[];
  notify_critical:boolean;
  notify_recurring_errors:boolean;
  hide_alert_mentions:boolean;
  noise_patterns:string[];
  auto_link_issue_reports:boolean;
  correlation_min_confidence:number;
};

export type TxAdminAttentionKind='routine'|'update_available'|'startup_blocker'|'runtime_failure'|'server_offline';

type TxAdminAlert = {
  eventId:number;severity:'error'|'critical';eventType:string;category:string;resourceName:string|null;
  message:string;repeatCount:number;matchedIssueId:number|null;candidateId:number|null;
};

const secretPatterns: Array<[RegExp,string]> = [
  [/\b(?:license|license2|steam|discord|fivem|xbl|live):[a-z0-9]+\b/gi,'[player-id redacted]'],
  [/\b(token|secret|password|passwd|api[_-]?key|authorization)\s*[:=]\s*[^\s,;]+/gi,'$1=[secret redacted]'],
  [/\b(?:Bearer)\s+[A-Za-z0-9._~+\/-]+=*/gi,'Bearer [secret redacted]'],
  [/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b/g,'[ip redacted]'],
  [/(?:\b(?:[0-9a-f]{1,4}:){3,}[0-9a-f]{0,4}\b|\b[0-9a-f]{0,4}::[0-9a-f:]{0,}\b)(?:%[\w.-]+)?/gi,'[ip redacted]'],
  [/([?&](?:token|secret|key|password|auth)=)[^&#\s]+/gi,'$1[redacted]']
];

export function redactTxAdminText(input: string) {
  let value=String(input||'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();
  for(const [pattern,replacement] of secretPatterns)value=value.replace(pattern,replacement);
  return value.slice(0,4000);
}

function sanitizeJson(value:unknown,depth=0):unknown{
  if(depth>4)return '[nested data omitted]';
  if(typeof value==='string')return redactTxAdminText(value).slice(0,1000);
  if(typeof value==='number')return Number.isFinite(value)?value:null;
  if(typeof value==='boolean'||value===null)return value;
  if(Array.isArray(value))return value.slice(0,50).map(item=>sanitizeJson(item,depth+1));
  if(typeof value==='object'){
    const output:Record<string,unknown>={};
    for(const [key,item] of Object.entries(value as Record<string,unknown>).slice(0,50)){
      const cleanKey=key.replace(/[^a-zA-Z0-9_.-]/g,'_').slice(0,80);
      output[cleanKey]=sanitizeJson(item,depth+1);
    }
    return output;
  }
  return null;
}

function canonicalMessage(value:string){
  return value.toLowerCase()
    .replace(/\b\d{2,}\b/g,'#')
    .replace(/0x[0-9a-f]+/g,'0x#')
    .replace(/\s+/g,' ')
    .trim();
}

function eventFingerprint(event:TxAdminEventInput,message:string,resourceName:string|null){
  return createHash('sha256').update(`${event.event_type}|${resourceName||''}|${canonicalMessage(message)}`).digest('hex');
}

function safeOccurredAt(value:string){
  const parsed=new Date(value);
  const now=Date.now();
  if(!Number.isFinite(parsed.getTime())||Math.abs(parsed.getTime()-now)>7*24*60*60*1000)return new Date();
  return parsed;
}

function normalizedSettings(row:any):TxAdminSettings{
  return {
    group_window_minutes:Math.min(1440,Math.max(5,Number(row?.group_window_minutes||60))),
    auto_draft_enabled:Boolean(row?.auto_draft_enabled??true),
    draft_min_occurrences:Math.min(1000,Math.max(2,Number(row?.draft_min_occurrences||5))),
    alert_channel_id:row?.alert_channel_id?String(row.alert_channel_id):null,
    alert_role_ids:Array.isArray(row?.alert_role_ids)?row.alert_role_ids.map(String):[],
    notify_critical:Boolean(row?.notify_critical??true),
    notify_recurring_errors:Boolean(row?.notify_recurring_errors??true),
    hide_alert_mentions:Boolean(row?.hide_alert_mentions??true),
    noise_patterns:Array.isArray(row?.noise_patterns)?row.noise_patterns.map(String).map((value:string)=>value.trim()).filter(Boolean):[],
    auto_link_issue_reports:Boolean(row?.auto_link_issue_reports??true),
    correlation_min_confidence:Math.min(.95,Math.max(.4,Number(row?.correlation_min_confidence||.55)))
  };
}

export async function getTxAdminSettings(){
  const result=await db.query('SELECT * FROM txadmin_settings WHERE id=1');
  return normalizedSettings(result.rows[0]);
}

export async function updateTxAdminSettings(input:TxAdminSettings){
  const result=await db.query(`
    UPDATE txadmin_settings SET group_window_minutes=$1,auto_draft_enabled=$2,draft_min_occurrences=$3,
      alert_channel_id=$4,alert_role_ids=$5,notify_critical=$6,notify_recurring_errors=$7,
      hide_alert_mentions=$8,noise_patterns=$9,auto_link_issue_reports=$10,
      correlation_min_confidence=$11,updated_at=NOW()
    WHERE id=1 RETURNING *`,[
    Math.min(1440,Math.max(5,input.group_window_minutes)),input.auto_draft_enabled,
    Math.min(1000,Math.max(2,input.draft_min_occurrences)),input.alert_channel_id||null,
    [...new Set(input.alert_role_ids)],input.notify_critical,input.notify_recurring_errors,
    input.hide_alert_mentions,[...new Set(input.noise_patterns.map(value=>value.trim()).filter(Boolean))],
    input.auto_link_issue_reports,Math.min(.95,Math.max(.4,input.correlation_min_confidence))
  ]);
  return normalizedSettings(result.rows[0]);
}

function suppressionFor(event:TxAdminEventInput,message:string,resourceName:string|null,settings:TxAdminSettings){
  if(event.severity==='info'&&['resource.started','resource.stopped'].includes(event.event_type))return 'Routine resource lifecycle';
  const searchable=`${resourceName||''} ${message}`.toLowerCase();
  const matched=settings.noise_patterns.find(pattern=>pattern.length>=3&&searchable.includes(pattern.toLowerCase()));
  return matched?`Matched noise pattern: ${matched}`:null;
}

function attentionFor(event:TxAdminEventInput,message:string):{kind:TxAdminAttentionKind;actionable:boolean;reason:string|null}{
  const text=message.toLowerCase();
  const updateAvailable=/\b(update|new version|upgrade)\b[\s\S]{0,60}\b(available|released|ready)\b|\b(outdated|update available|newer version)\b/i.test(message)&&
    !/\b(up[ -]?to[ -]?date|latest version|no updates?|checking for updates?)\b/i.test(message);
  if(event.event_type==='resource.update_available'||updateAvailable){
    return {kind:'update_available',actionable:true,reason:'A script or resource reports that an update is available.'};
  }
  if(['server.process_stopped','server.crash'].includes(event.event_type)||/\b(fatal|access violation|segmentation fault)\b/i.test(message)){
    return {kind:'server_offline',actionable:true,reason:'FXServer stopped or crashed.'};
  }
  if(event.event_type==='resource.start_failed'||/\b(failed to start|couldn(?:\'|’)t start|unable to start|failed dependency|missing dependency)\b/i.test(message)){
    return {kind:'startup_blocker',actionable:true,reason:'A resource could not start or a required dependency is missing.'};
  }
  const runtimeFailure=/\b(script error|uncaught|unhandled|no such export|could not load|unable to load|parse error|syntax error|runtime error|resource stopped unexpectedly|failed to execute)\b/i.test(message);
  if(runtimeFailure){
    return {kind:'runtime_failure',actionable:true,reason:'The error appears capable of preventing a resource from running correctly.'};
  }
  if(['error','critical'].includes(event.severity)&&event.event_type!=='database.error'&&/\b(crash|terminated|not running|stopped unexpectedly)\b/i.test(text)){
    return {kind:'runtime_failure',actionable:true,reason:'The event indicates that a server component may no longer be running.'};
  }
  return {kind:'routine',actionable:false,reason:null};
}

async function createRecurringDraft(client:any,input:{
  settings:TxAdminSettings;eventId:number;event:TxAdminEventInput;message:string;resourceName:string|null;
  fingerprint:string;repeatCount:number;matchedIssueId:number|null;suppressed:boolean;actionable:boolean;
}){
  if(!input.settings.auto_draft_enabled||input.suppressed||!input.actionable||input.matchedIssueId||
     !['error','critical'].includes(input.event.severity)||input.repeatCount<input.settings.draft_min_occurrences)return null;
  const candidateFingerprint=createHash('sha256').update(`txadmin|${input.fingerprint}`).digest('hex');
  const topic=`${input.resourceName?`${input.resourceName} · `:''}${input.message}`.replace(/\s+/g,' ').slice(0,160);
  const related=[input.resourceName,input.event.category,input.event.event_type].filter(Boolean).map(String);
  const candidate=await client.query(`
    INSERT INTO issue_candidates
      (fingerprint,sample_text,normalized_text,topic,related_terms,occurrence_count,status,source,first_seen,last_seen,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,'detected','txadmin',NOW(),NOW(),NOW())
    ON CONFLICT(fingerprint) DO UPDATE SET
      sample_text=EXCLUDED.sample_text,topic=EXCLUDED.topic,
      related_terms=ARRAY(SELECT DISTINCT term FROM unnest(issue_candidates.related_terms||EXCLUDED.related_terms) AS t(term)),
      occurrence_count=GREATEST(issue_candidates.occurrence_count,EXCLUDED.occurrence_count),last_seen=NOW(),updated_at=NOW()
    RETURNING id,matched_issue_id`,[
    candidateFingerprint,input.message,canonicalMessage(input.message).slice(0,1000),topic,related,input.repeatCount
  ]);
  const candidateId=Number(candidate.rows[0].id);
  const linkedIssueId=candidate.rows[0].matched_issue_id?Number(candidate.rows[0].matched_issue_id):null;
  await client.query(`UPDATE service_events SET issue_candidate_id=$1,draft_created_at=COALESCE(draft_created_at,NOW()),
    matched_issue_id=COALESCE(matched_issue_id,$2) WHERE id=$3`,[candidateId,linkedIssueId,input.eventId]);
  return {candidateId,linkedIssueId};
}

async function dispatchTxAdminAlerts(alerts:TxAdminAlert[],settings:TxAdminSettings){
  if(!alerts.length||!settings.alert_channel_id)return;
  const {sendTxAdminEventAlert}=await import('../discord/client.js');
  for(const alert of alerts){
    try{
      const sent=await sendTxAdminEventAlert({...alert,channelId:settings.alert_channel_id,
        roleIds:settings.alert_role_ids,hideMentions:settings.hide_alert_mentions});
      if(sent)await db.query(`UPDATE service_events SET notified_at=NOW() WHERE id=$1 AND notified_at IS NULL`,[alert.eventId]);
    }catch(error){console.warn('[txadmin] Discord alert failed',error);}
  }
}

export async function ingestTxAdminBatch(input:TxAdminIngestInput){
  const client=await db.connect();
  let accepted=0;let deduplicated=0;let matched=0;let drafts=0;let suppressed=0;
  let settings:TxAdminSettings=normalizedSettings(null);
  const alerts:TxAdminAlert[]=[];
  const actionableEventIds=new Set<number>();
  try{
    await client.query('BEGIN');
    const settingsResult=await client.query('SELECT * FROM txadmin_settings WHERE id=1');
    settings=normalizedSettings(settingsResult.rows[0]);
    await client.query(`
      INSERT INTO txadmin_collectors
        (collector_id,server_name,hostname,txdata_path,collector_version,last_heartbeat_at,metadata,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,NOW())
      ON CONFLICT(collector_id) DO UPDATE SET
        server_name=EXCLUDED.server_name,hostname=EXCLUDED.hostname,txdata_path=EXCLUDED.txdata_path,
        collector_version=EXCLUDED.collector_version,last_heartbeat_at=EXCLUDED.last_heartbeat_at,
        metadata=EXCLUDED.metadata,updated_at=NOW()`,[
      input.collector_id,input.server_name,input.hostname,input.txdata_path,input.collector_version,
      safeOccurredAt(input.heartbeat_at),JSON.stringify(sanitizeJson(input.metadata||{}))
    ]);

    const issueRows=await client.query(`
      SELECT id,log_patterns FROM issues
       WHERE status NOT IN ('resolved','wont_fix') AND cardinality(log_patterns)>0`);
    const patterns=issueRows.rows.flatMap((row:any)=>(row.log_patterns||[])
      .map((pattern:unknown)=>String(pattern||'').trim().toLowerCase())
      .filter((pattern:string)=>pattern.length>=5)
      .map((pattern:string)=>({issueId:Number(row.id),pattern,canonical:canonicalMessage(pattern)})))
      .sort((a:any,b:any)=>b.pattern.length-a.pattern.length);

    for(const event of input.events){
      const message=redactTxAdminText(event.message);
      if(!message)continue;
      const resourceName=event.resource_name?redactTxAdminText(event.resource_name).slice(0,160):null;
      const sourceFile=event.source_file?redactTxAdminText(event.source_file).replace(/\\/g,'/').slice(-500):null;
      const occurredAt=safeOccurredAt(event.occurred_at);
      const fingerprint=eventFingerprint(event,message,resourceName);
      const searchable=`${resourceName||''} ${message}`.toLowerCase();
      const canonicalSearchable=canonicalMessage(searchable);
      const issueMatch=patterns.find((candidate:any)=>searchable.includes(candidate.pattern)||
        candidate.canonical.length>=5&&canonicalSearchable.includes(candidate.canonical));
      const matchedIssueId=issueMatch?.issueId||null;
      if(matchedIssueId)matched++;
      const suppressionReason=suppressionFor(event,message,resourceName,settings);
      const isSuppressed=Boolean(suppressionReason);
      const attention=attentionFor(event,message);
      if(isSuppressed)suppressed++;
      const groupCutoff=new Date(occurredAt.getTime()-settings.group_window_minutes*60_000);

      const updated=await client.query(`
        UPDATE service_events SET
          repeat_count=repeat_count+1,last_seen_at=GREATEST(last_seen_at,$2),occurred_at=GREATEST(occurred_at,$2),
          severity=$3,message=$4,payload=payload||$5::jsonb,matched_issue_id=COALESCE(matched_issue_id,$6),
          suppressed=$9,suppression_reason=$10,attention_kind=$11,actionable=$12,actionability_reason=$13
         WHERE id=(
           SELECT id FROM service_events
            WHERE source='txadmin' AND collector_id=$1 AND fingerprint=$7 AND status<>'resolved'
              AND last_seen_at > $8
            ORDER BY last_seen_at DESC LIMIT 1
         ) RETURNING id,repeat_count,matched_issue_id,issue_candidate_id,notified_at,actionable`,[
        input.collector_id,occurredAt,event.severity,message,JSON.stringify(sanitizeJson(event.metadata||{})),matchedIssueId,fingerprint,
        groupCutoff,isSuppressed,suppressionReason,attention.kind,attention.actionable,attention.reason
      ]);
      let eventRow:any;
      if(updated.rowCount){deduplicated++;eventRow=updated.rows[0];}
      else{
        const inserted=await client.query(`
          INSERT INTO service_events
          (source,event_type,severity,message,payload,occurred_at,collector_id,category,resource_name,
           fingerprint,repeat_count,first_seen_at,last_seen_at,status,matched_issue_id,source_file,line_number,suppressed,suppression_reason,
           attention_kind,actionable,actionability_reason)
          VALUES ('txadmin',$1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,1,$5,$5,'open',$10,$11,$12,$13,$14,$15,$16,$17)
          RETURNING id,repeat_count,matched_issue_id,issue_candidate_id,notified_at,actionable`,[
          event.event_type,event.severity,message,JSON.stringify(sanitizeJson(event.metadata||{})),occurredAt,
          input.collector_id,event.category,resourceName,fingerprint,matchedIssueId,sourceFile,event.line_number||null,
          isSuppressed,suppressionReason,attention.kind,attention.actionable,attention.reason
        ]);
        eventRow=inserted.rows[0];accepted++;
      }
      if(Boolean(eventRow.actionable))actionableEventIds.add(Number(eventRow.id));

      const draft=await createRecurringDraft(client,{settings,eventId:Number(eventRow.id),event,message,resourceName,
        fingerprint,repeatCount:Number(eventRow.repeat_count||1),matchedIssueId:eventRow.matched_issue_id?Number(eventRow.matched_issue_id):matchedIssueId,
        suppressed:isSuppressed,actionable:Boolean(eventRow.actionable)});
      if(draft&&eventRow.issue_candidate_id==null)drafts++;
      const candidateId=draft?.candidateId||(eventRow.issue_candidate_id?Number(eventRow.issue_candidate_id):null);
      const finalIssueId=draft?.linkedIssueId||(eventRow.matched_issue_id?Number(eventRow.matched_issue_id):matchedIssueId);
      const shouldAlert=Boolean(eventRow.actionable)&&(!isSuppressed&&!eventRow.notified_at&&event.severity==='critical'&&settings.notify_critical||
        !isSuppressed&&!eventRow.notified_at&&event.severity==='error'&&Boolean(candidateId)&&settings.notify_recurring_errors);
      if(shouldAlert)alerts.push({eventId:Number(eventRow.id),severity:event.severity as 'error'|'critical',eventType:event.event_type,
        category:event.category,resourceName,message,repeatCount:Number(eventRow.repeat_count||1),matchedIssueId:finalIssueId,candidateId});
    }
    await client.query('COMMIT');
  }catch(error){
    await client.query('ROLLBACK');throw error;
  }finally{client.release();}
  if(settings.auto_link_issue_reports){
    for(const eventId of actionableEventIds)await correlateTxAdminEvent(eventId,settings.correlation_min_confidence)
      .catch(error=>console.warn('[txadmin] issue correlation failed',error));
  }
  await dispatchTxAdminAlerts(alerts,settings);
  return {ok:true,accepted,deduplicated,matched_issues:matched,drafts_created:drafts,suppressed,heartbeat_at:new Date().toISOString()};
}

const correlationStopWords=new Set([
  'about','after','again','been','before','being','could','does','error','failed','fivem','from','have','into','issue',
  'more','player','players','problem','report','resource','script','server','should','some','that','their','there','these',
  'they','this','unable','when','where','which','while','with','would','your'
]);

function correlationTokens(value:string){
  const expanded=value.replace(/([a-z])([A-Z])/g,'$1 $2').toLowerCase().replace(/[^a-z0-9]+/g,' ');
  return [...new Set(expanded.split(/\s+/).map(token=>{
    if(token.length>5&&token.endsWith('ies'))return `${token.slice(0,-3)}y`;
    if(token.length>4&&token.endsWith('s'))return token.slice(0,-1);
    return token;
  }).filter(token=>token.length>=4&&!correlationStopWords.has(token)))];
}

function normalizedResource(value:unknown){return String(value||'').toLowerCase().replace(/[^a-z0-9]/g,'');}

function scoreIssueEvent(issue:any,event:any){
  const issueParts=[issue.title,issue.description,issue.category,issue.resource_name,...(issue.aliases||[]),...(issue.symptoms||[])].filter(Boolean).map(String);
  const eventText=`${event.resource_name||''} ${event.message||''} ${event.event_type||''}`.toLowerCase();
  const compactEvent=normalizedResource(eventText);
  const matchTypes:string[]=[];
  let score=0;

  const patterns=(issue.log_patterns||[]).map((value:unknown)=>String(value||'').trim().toLowerCase()).filter((value:string)=>value.length>=5);
  if(patterns.some((pattern:string)=>eventText.includes(pattern)||canonicalMessage(eventText).includes(canonicalMessage(pattern)))){
    score=.99;matchTypes.push('log pattern');
  }

  const issueResource=normalizedResource(issue.resource_name);
  const eventResource=normalizedResource(event.resource_name);
  if(issueResource&&eventResource){
    if(issueResource===eventResource){score=Math.max(score,.98);matchTypes.push('exact resource');}
    else if(issueResource.length>=5&&eventResource.includes(issueResource)||eventResource.length>=5&&issueResource.includes(eventResource)){
      score=Math.max(score,.90);matchTypes.push('resource name');
    }
  }

  const tokens=correlationTokens(issueParts.join(' '));
  const hits=tokens.filter(token=>eventText.includes(token)||compactEvent.includes(token));
  const resourceHits=hits.filter(token=>eventResource.includes(token));
  if(hits.length){
    const lexical=Math.min(.82,(hits.length===1?(hits[0].length>=6?.58:.50):.66+(hits.length-2)*.06)+(resourceHits.length?.10:0));
    score=Math.max(score,lexical);
    matchTypes.push(resourceHits.length?'resource term':'issue term');
  }

  if(score>=.5&&new Date(event.last_seen_at).getTime()>=Date.now()-7*24*60*60*1000)score=Math.min(.99,score+.03);
  const distinctTypes=[...new Set(matchTypes)];
  const reason=distinctTypes.length
    ? `${distinctTypes.join(' + ')} matched${hits.length?`: ${hits.slice(0,4).join(', ')}`:''}.`
    : 'No specific issue evidence matched this event.';
  return {score,matchTypes:distinctTypes,reason};
}

async function saveIssueEventLink(issueId:number,eventId:number,match:{score:number;matchTypes:string[];reason:string}){
  await db.query(`
    INSERT INTO issue_txadmin_links(issue_id,service_event_id,confidence,match_types,reason,linked_by,last_confirmed_at)
    VALUES ($1,$2,$3,$4,$5,'automatic',NOW())
    ON CONFLICT(issue_id,service_event_id) DO UPDATE SET
      confidence=EXCLUDED.confidence,match_types=EXCLUDED.match_types,reason=EXCLUDED.reason,last_confirmed_at=NOW()`,
    [issueId,eventId,match.score,match.matchTypes,match.reason]);
  await db.query(`UPDATE service_events SET matched_issue_id=COALESCE(matched_issue_id,$1) WHERE id=$2`,[issueId,eventId]);
}

export async function correlateIssueWithTxAdmin(issueId:number,minConfidence?:number){
  const [issueResult,settingsResult,eventsResult]=await Promise.all([
    db.query(`SELECT id,title,description,category,resource_name,aliases,symptoms,log_patterns FROM issues WHERE id=$1`,[issueId]),
    db.query(`SELECT auto_link_issue_reports,correlation_min_confidence FROM txadmin_settings WHERE id=1`),
    db.query(`SELECT id,event_type,category,resource_name,message,last_seen_at,attention_kind
                FROM service_events
               WHERE source='txadmin' AND actionable=TRUE AND attention_kind<>'update_available'
                 AND last_seen_at>NOW()-INTERVAL '30 days' AND (matched_issue_id IS NULL OR matched_issue_id=$1)
                 AND NOT EXISTS (SELECT 1 FROM issue_txadmin_links l WHERE l.issue_id=$1 AND l.service_event_id=service_events.id)
               ORDER BY last_seen_at DESC LIMIT 300`,[issueId])
  ]);
  if(!issueResult.rowCount)return {linked:0};
  const setting=settingsResult.rows[0]||{};
  if(setting.auto_link_issue_reports===false)return {linked:0};
  const threshold=Math.min(.95,Math.max(.4,Number(minConfidence??setting.correlation_min_confidence??.55)));
  const scored=eventsResult.rows.map(event=>({event,match:scoreIssueEvent(issueResult.rows[0],event)}))
    .filter(item=>item.match.score>=threshold).sort((a,b)=>b.match.score-a.match.score).slice(0,12);
  for(const item of scored)await saveIssueEventLink(issueId,Number(item.event.id),item.match);
  return {linked:scored.length};
}

export async function correlateTxAdminEvent(eventId:number,minConfidence?:number){
  const [eventResult,settingsResult,issuesResult]=await Promise.all([
    db.query(`SELECT id,event_type,category,resource_name,message,last_seen_at,attention_kind,actionable,matched_issue_id
                FROM service_events WHERE id=$1 AND source='txadmin'`,[eventId]),
    db.query(`SELECT auto_link_issue_reports,correlation_min_confidence FROM txadmin_settings WHERE id=1`),
    db.query(`SELECT id,title,description,category,resource_name,aliases,symptoms,log_patterns
                FROM issues WHERE status NOT IN ('resolved','wont_fix') ORDER BY last_seen DESC LIMIT 400`)
  ]);
  const event=eventResult.rows[0];const setting=settingsResult.rows[0]||{};
  if(!event||!event.actionable||event.attention_kind==='update_available'||setting.auto_link_issue_reports===false)return null;
  if(event.matched_issue_id){
    const issue=issuesResult.rows.find(row=>Number(row.id)===Number(event.matched_issue_id));
    if(issue){const match=scoreIssueEvent(issue,event);await saveIssueEventLink(Number(issue.id),eventId,{...match,score:Math.max(.99,match.score),matchTypes:[...new Set(['known log pattern',...match.matchTypes])],reason:'Matched an existing known-issue log pattern.'});}
    return event.matched_issue_id;
  }
  const threshold=Math.min(.95,Math.max(.4,Number(minConfidence??setting.correlation_min_confidence??.55)));
  const best=issuesResult.rows.map(issue=>({issue,match:scoreIssueEvent(issue,event)})).sort((a,b)=>b.match.score-a.match.score)[0];
  if(!best||best.match.score<threshold)return null;
  await saveIssueEventLink(Number(best.issue.id),eventId,best.match);
  return Number(best.issue.id);
}

export async function backfillIssueTxAdminCorrelations(limit=100){
  const settings=await getTxAdminSettings();
  if(!settings.auto_link_issue_reports)return 0;
  const issues=await db.query(`SELECT id FROM issues WHERE status NOT IN ('resolved','wont_fix') ORDER BY last_seen DESC LIMIT $1`,[limit]);
  let linked=0;
  for(const row of issues.rows){
    const result=await correlateIssueWithTxAdmin(Number(row.id),settings.correlation_min_confidence);
    linked+=result.linked;
  }
  return linked;
}

export async function getTxAdminOverview(){
  const [collectorResult,statsResult]=await Promise.all([
    db.query(`SELECT collector_id,server_name,hostname,txdata_path,collector_version,first_seen_at,last_heartbeat_at,metadata
                FROM txadmin_collectors ORDER BY last_heartbeat_at DESC LIMIT 1`),
    db.query(`SELECT
      count(*) FILTER (WHERE status='open' AND NOT suppressed AND actionable)::int AS attention_open,
      count(*) FILTER (WHERE status='open' AND NOT suppressed AND attention_kind='update_available')::int AS updates_available,
      count(*) FILTER (WHERE status='open' AND NOT suppressed AND attention_kind='startup_blocker')::int AS startup_blockers,
      count(*) FILTER (WHERE status='open' AND NOT suppressed AND attention_kind IN ('runtime_failure','server_offline'))::int AS runtime_failures,
      count(*) FILTER (WHERE matched_issue_id IS NOT NULL AND actionable AND last_seen_at>NOW()-INTERVAL '24 hours')::int AS matched_issues_24h,
      count(*) FILTER (WHERE issue_candidate_id IS NOT NULL AND draft_created_at>NOW()-INTERVAL '24 hours')::int AS drafts_24h,
      count(*) FILTER (WHERE suppressed AND last_seen_at>NOW()-INTERVAL '24 hours')::int AS suppressed_24h,
      count(*) FILTER (WHERE NOT actionable AND last_seen_at>NOW()-INTERVAL '24 hours')::int AS routine_24h,
      COALESCE(sum(repeat_count) FILTER (WHERE actionable AND last_seen_at>NOW()-INTERVAL '24 hours'),0)::int AS actionable_occurrences_24h
      FROM service_events WHERE source='txadmin'`)
  ]);
  const collector=collectorResult.rows[0]||null;
  const heartbeatAge=collector?Date.now()-new Date(collector.last_heartbeat_at).getTime():null;
  const connection=!collector?'not_configured':heartbeatAge!==null&&heartbeatAge<=90_000?'online':heartbeatAge!==null&&heartbeatAge<=5*60_000?'stale':'offline';
  return {connection,collector,stats:statsResult.rows[0]};
}

export async function listTxAdminEvents(input:{status?:string;severity?:string;category?:string;resource?:string;query?:string;noise?:'hide'|'only'|'all';view?:'attention'|'updates'|'failures'|'history';limit?:number}){
  const values:unknown[]=[];const where=[`e.source='txadmin'`];
  const add=(sql:string,value:unknown)=>{values.push(value);where.push(sql.replace('?',`$${values.length}`));};
  if(input.view==='updates')where.push(`e.actionable=TRUE AND e.attention_kind='update_available'`);
  else if(input.view==='failures')where.push(`e.actionable=TRUE AND e.attention_kind IN ('startup_blocker','runtime_failure','server_offline')`);
  else if(input.view!=='history')where.push('e.actionable=TRUE');
  if(input.noise==='only')where.push('e.suppressed=TRUE');
  else if(input.noise!=='all')where.push('e.suppressed=FALSE');
  if(input.status&&input.status!=='all')add('e.status=?',input.status);
  if(input.severity&&input.severity!=='all')add('e.severity=?',input.severity);
  if(input.category&&input.category!=='all')add('e.category=?',input.category);
  if(input.resource)add('lower(COALESCE(e.resource_name,\'\')) LIKE ?',`%${input.resource.toLowerCase()}%`);
  if(input.query)add(`lower(e.message||' '||COALESCE(e.resource_name,'')) LIKE ?`,`%${input.query.toLowerCase()}%`);
  values.push(Math.min(Math.max(input.limit||100,1),300));
  const result=await db.query(`
    SELECT e.id,e.event_type,e.severity,e.category,e.resource_name,e.message,e.payload,e.occurred_at,
           e.first_seen_at,e.last_seen_at,e.repeat_count,e.status,e.source_file,e.line_number,
           e.acknowledged_at,e.acknowledged_by_user_id,e.matched_issue_id,e.issue_candidate_id,e.suppressed,e.suppression_reason,
           e.attention_kind,e.actionable,e.actionability_reason,
           i.public_id AS issue_public_id,i.title AS issue_title
      FROM service_events e LEFT JOIN issues i ON i.id=e.matched_issue_id
     WHERE ${where.join(' AND ')} ORDER BY e.last_seen_at DESC LIMIT $${values.length}`,values);
  return result.rows;
}

export async function acknowledgeTxAdminEvent(id:number,userId:string){
  const result=await db.query(`UPDATE service_events SET status='acknowledged',acknowledged_at=NOW(),acknowledged_by_user_id=$2
    WHERE id=$1 AND source='txadmin' RETURNING id,status,acknowledged_at,acknowledged_by_user_id`,[id,userId]);
  return result.rows[0]||null;
}

export async function resolveTxAdminEvent(id:number,userId:string){
  const result=await db.query(`UPDATE service_events SET status='resolved',acknowledged_at=COALESCE(acknowledged_at,NOW()),
    acknowledged_by_user_id=COALESCE(acknowledged_by_user_id,$2) WHERE id=$1 AND source='txadmin'
    RETURNING id,status,acknowledged_at,acknowledged_by_user_id`,[id,userId]);
  return result.rows[0]||null;
}
