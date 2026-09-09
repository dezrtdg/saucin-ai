import { db } from '../db.js';
import { applyPriorityCalibration,getLearningStats,upsertLearningExample } from './learning.js';

export type AutomationModuleKey='tickets'|'issues'|'suggestions'|'knowledge'|'moderation'|'txadmin';
export type AutonomyLevel='off'|'observe'|'assist'|'auto_safe';
export type AutomationFeedbackOutcome='reviewed'|'helpful'|'incorrect'|'reopened';

type Access={permissions:string[];ownerBypass?:boolean};
type QueueItem={
  key:string;module:AutomationModuleKey;resource_type:string;resource_id:string;title:string;detail:string;
  reason:string;href:string;priority:'urgent'|'high'|'normal'|'low';priority_score:number;created_at:string;
  status:string;review_outcome?:string|null;reviewed_at?:string|null;
};

const moduleCatalog:Record<AutomationModuleKey,{
  label:string;permission:string;maxLevel:AutonomyLevel;summary:string;safeActions:string;humanBoundary:string;settingsHref:string;
}>={
  tickets:{label:'Private tickets',permission:'tickets.view',maxLevel:'assist',summary:'Routes support work and surfaces unclaimed tickets.',safeActions:'Organize, summarize, and recommend the next response.',humanBoundary:'Punishments, reversals, and sensitive staff decisions remain human-controlled.',settingsHref:'/settings/tickets'},
  issues:{label:'Issues',permission:'issues.view',maxLevel:'auto_safe',summary:'Groups reports and connects player symptoms with server evidence.',safeActions:'Categorize, deduplicate, refine evidence, and link likely txAdmin failures.',humanBoundary:'Possible causes remain unverified until staff confirms them.',settingsHref:'/settings/issues'},
  suggestions:{label:'Suggestions',permission:'suggestions.view',maxLevel:'auto_safe',summary:'Organizes community ideas and keeps Discord discussions synchronized.',safeActions:'Categorize, deduplicate, summarize, tag, and update forum discussions.',humanBoundary:'Acceptance, release promises, and deletion remain staff decisions.',settingsHref:'/settings/suggestions'},
  knowledge:{label:'Knowledge',permission:'knowledge.gaps.view',maxLevel:'assist',summary:'Finds unanswered questions and prepares verified-information drafts.',safeActions:'Deduplicate gaps, gather context, and prepare staff-editable drafts.',humanBoundary:'AI-created information can never publish itself as verified knowledge.',settingsHref:'/settings/knowledge'},
  moderation:{label:'Moderation',permission:'moderation.view',maxLevel:'observe',summary:'Detects possible Discord-rule violations for contextual human review.',safeActions:'Observe, preserve context, and prioritize review.',humanBoundary:'This center cannot warn, delete, timeout, kick, or ban members.',settingsHref:'/settings/moderation'},
  txadmin:{label:'txAdmin',permission:'txadmin.view',maxLevel:'auto_safe',summary:'Reduces log noise to script updates and server-impacting failures.',safeActions:'Group events, identify actionable failures, and suggest issue links.',humanBoundary:'Logs are private evidence and never become public facts automatically.',settingsHref:'/txadmin'}
};

const levelRank:Record<AutonomyLevel,number>={off:0,observe:1,assist:2,auto_safe:3};
function allowed(access:Access,permission:string){return Boolean(access.ownerBypass||access.permissions.includes(permission));}
function iso(value:unknown){return new Date(String(value)).toISOString();}

export async function getAutomationModuleSettings(){
  const result=await db.query('SELECT module_key,autonomy_level,updated_by_user_id,updated_at FROM automation_module_settings');
  const rows=new Map(result.rows.map(row=>[String(row.module_key),row]));
  return (Object.entries(moduleCatalog) as Array<[AutomationModuleKey,typeof moduleCatalog[AutomationModuleKey]]>).map(([key,meta])=>{
    const row=rows.get(key)||{};
    return {key,...meta,autonomy_level:(row.autonomy_level||'observe') as AutonomyLevel,updated_by_user_id:row.updated_by_user_id||null,updated_at:row.updated_at||null};
  });
}

export async function updateAutomationModuleSetting(moduleKey:AutomationModuleKey,level:AutonomyLevel,actorUserId:string|null){
  const meta=moduleCatalog[moduleKey];
  if(!meta)throw new Error('Unknown automation module.');
  if(levelRank[level]>levelRank[meta.maxLevel])throw new Error(`${meta.label} cannot exceed ${meta.maxLevel.replace('_',' ')} because its protected actions require human review.`);
  const result=await db.query(`
    INSERT INTO automation_module_settings(module_key,autonomy_level,updated_by_user_id,updated_at)
    VALUES ($1,$2,$3,NOW())
    ON CONFLICT(module_key) DO UPDATE SET autonomy_level=EXCLUDED.autonomy_level,updated_by_user_id=EXCLUDED.updated_by_user_id,updated_at=NOW()
    RETURNING *`,[moduleKey,level,actorUserId]);
  await db.query(`INSERT INTO automation_feedback_events(module_key,resource_type,resource_id,outcome,note,actor_user_id,metadata)
    VALUES ($1,'module_policy',$1,'reviewed',$2,$3,$4::jsonb)`,[moduleKey,`Automation ceiling changed to ${level.replace('_',' ')}.`,actorUserId,JSON.stringify({autonomy_level:level})]);
  return result.rows[0];
}

async function queueRows(access:Access,includeReviewed=false){
  // One union query is considerably cheaper than opening six database requests
  // every time the live inbox refreshes. Each branch keeps its own small limit.
  const result=await db.query(`
    WITH queue AS (
      SELECT 'tickets'::text AS module_key,'ticket'::text AS resource_type,t.id::text AS resource_id,
        to_jsonb(t) AS payload
      FROM (SELECT id,public_id,subject,description,priority,status,created_at FROM tickets
        WHERE $1::boolean AND status='open' AND claimed_by_user_id IS NULL
        ORDER BY CASE priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 ELSE 3 END,created_at LIMIT 40) t
      UNION ALL
      SELECT 'issues','issue_candidate',i.id::text,to_jsonb(i)
      FROM (SELECT id,topic,sample_text,occurrence_count,confirmed_count,status,last_seen FROM issue_candidates
        WHERE $2::boolean AND status IN ('detected','reported')
        ORDER BY confirmed_count DESC,occurrence_count DESC,last_seen DESC LIMIT 40) i
      UNION ALL
      SELECT 'suggestions','suggestion',s.id::text,to_jsonb(s)
      FROM (SELECT id,public_id,title,summary,status,mention_count,last_seen FROM suggestions
        WHERE $3::boolean AND status IN ('candidate','reviewing')
        ORDER BY mention_count DESC,last_seen DESC LIMIT 40) s
      UNION ALL
      SELECT 'knowledge','knowledge_gap',g.id::text,to_jsonb(g)
      FROM (SELECT id,COALESCE(display_question,sample_question) AS question,topic,occurrences,status,last_seen FROM knowledge_gaps
        WHERE $4::boolean AND status='open' ORDER BY occurrences DESC,last_seen DESC LIMIT 40) g
      UNION ALL
      SELECT 'knowledge','issue_resolution',r.id::text,to_jsonb(r)
      FROM (SELECT i.id,i.public_id,i.title,i.resolution_summary,i.workaround,i.public_response,i.resolved_at,i.status,
          i.resolution_article_id,(SELECT count(*)::int FROM issue_knowledge_gap_matches m WHERE m.issue_id=i.id AND m.review_status='suggested') AS suggested_gap_count
        FROM issues i WHERE $4::boolean AND i.status='resolved' AND
          (i.resolution_article_id IS NULL OR EXISTS(SELECT 1 FROM issue_knowledge_gap_matches m WHERE m.issue_id=i.id AND m.review_status='suggested'))
        ORDER BY i.resolved_at DESC NULLS LAST,i.updated_at DESC LIMIT 30) r
      UNION ALL
      SELECT 'moderation','moderation_case',m.id::text,to_jsonb(m)
      FROM (SELECT id,public_id,rule_title,author_name,message_content,confidence,status,source,created_at,
        (SELECT count(*)::int FROM moderation_reports r WHERE r.case_id=moderation_cases.id) AS report_count
        FROM moderation_cases WHERE $5::boolean AND status='pending'
        ORDER BY CASE WHEN source='member_report' THEN 1 ELSE 2 END,created_at DESC LIMIT 40) m
      UNION ALL
      SELECT 'txadmin','txadmin_event',x.id::text,to_jsonb(x)
      FROM (SELECT id,attention_kind,severity,resource_name,message,repeat_count,status,last_seen_at FROM service_events
        WHERE $6::boolean AND source='txadmin' AND actionable=TRUE AND suppressed=FALSE AND status='open'
        ORDER BY CASE attention_kind WHEN 'server_offline' THEN 1 WHEN 'startup_blocker' THEN 2 WHEN 'runtime_failure' THEN 3 ELSE 4 END,last_seen_at DESC LIMIT 50) x
    )
    SELECT q.*,r.outcome AS review_outcome,r.reviewed_at
    FROM queue q
    LEFT JOIN automation_review_state r ON r.module_key=q.module_key AND r.resource_type=q.resource_type AND r.resource_id=q.resource_id
    WHERE $7::boolean OR r.outcome IS NULL`,[
      allowed(access,'tickets.view'),allowed(access,'issues.view'),allowed(access,'suggestions.view'),
      allowed(access,'knowledge.gaps.view'),allowed(access,'moderation.view'),allowed(access,'txadmin.view'),includeReviewed
    ]);

  const items:QueueItem[]=[];
  const reviewed=(item:QueueItem,row:any)=>({...item,review_outcome:row.review_outcome||null,reviewed_at:row.reviewed_at?iso(row.reviewed_at):null});
  for(const resultRow of result.rows){
    const row=resultRow.payload||{};const module=String(resultRow.module_key) as AutomationModuleKey;const resourceType=String(resultRow.resource_type);
    if(module==='tickets'){
      const score=row.priority==='urgent'?100:row.priority==='high'?90:75;
      items.push(reviewed({key:`tickets:ticket:${row.id}`,module,resource_type:'ticket',resource_id:String(row.id),title:`${row.public_id||`Ticket ${row.id}`} · ${row.subject}`,detail:String(row.description||'').slice(0,280),reason:`Unclaimed ${row.priority} priority ticket.`,href:`/tickets/${row.id}`,priority:score>=95?'urgent':score>=85?'high':'normal',priority_score:score,created_at:iso(row.created_at),status:row.status},resultRow));
    }else if(module==='issues'){
      const score=Number(row.confirmed_count)>0?88:Number(row.occurrence_count)>=3?76:66;
      items.push(reviewed({key:`issues:issue_candidate:${row.id}`,module,resource_type:'issue_candidate',resource_id:String(row.id),title:String(row.topic||row.sample_text).slice(0,180),detail:String(row.sample_text||'').slice(0,280),reason:`${row.confirmed_count||0} confirmation(s) · ${row.occurrence_count||1} occurrence(s).`,href:'/issues?incoming=open',priority:score>=85?'high':'normal',priority_score:score,created_at:iso(row.last_seen),status:row.status},resultRow));
    }else if(module==='suggestions'){
      const score=Math.min(82,58+Number(row.mention_count||1)*3);
      items.push(reviewed({key:`suggestions:suggestion:${row.id}`,module,resource_type:'suggestion',resource_id:String(row.id),title:`${row.public_id||`Suggestion ${row.id}`} · ${row.title}`,detail:String(row.summary||'').slice(0,280),reason:`${row.mention_count||1} community mention(s); ${row.status==='candidate'?'awaiting initial review':'currently under review'}.`,href:`/suggestions/${row.id}`,priority:score>=75?'high':'normal',priority_score:score,created_at:iso(row.last_seen),status:row.status},resultRow));
    }else if(module==='knowledge'){
      if(resourceType==='issue_resolution'){
        const suggested=Number(row.suggested_gap_count||0);const score=row.resolution_article_id?68:74;
        items.push(reviewed({key:`knowledge:issue_resolution:${row.id}`,module,resource_type:'issue_resolution',resource_id:String(row.id),title:`${row.public_id||`Issue ${row.id}`} · ${row.title}`,detail:String(row.resolution_summary||row.workaround||row.public_response||'Add the confirmed final fix before building reusable knowledge.').slice(0,280),reason:row.resolution_article_id?`${suggested} possible knowledge-gap match(es) need review.`:'Resolved issue has not completed the knowledge loop.',href:`/issues/${row.id}`,priority:score>=70?'high':'normal',priority_score:score,created_at:iso(row.resolved_at||new Date()),status:'resolution_review'},resultRow));
      }else{
        const score=Math.min(80,45+Number(row.occurrences||1)*7);
        items.push(reviewed({key:`knowledge:knowledge_gap:${row.id}`,module,resource_type:'knowledge_gap',resource_id:String(row.id),title:String(row.question).slice(0,180),detail:String(row.topic||'Missing verified server information.'),reason:`Asked ${row.occurrences||1} time(s) without a confident verified answer.`,href:'/knowledge-gaps?status=open',priority:score>=70?'high':score>=55?'normal':'low',priority_score:score,created_at:iso(row.last_seen),status:row.status},resultRow));
      }
    }else if(module==='moderation'){
      const reports=Number(row.report_count||0);const score=row.source==='member_report'?Math.min(100,88+reports*3):Math.min(92,68+Number(row.confidence||0)*20);
      items.push(reviewed({key:`moderation:moderation_case:${row.id}`,module,resource_type:'moderation_case',resource_id:String(row.id),title:`${row.public_id||`Case ${row.id}`} · ${row.rule_title}`,detail:`${row.author_name||'Member'}: ${String(row.message_content||'').slice(0,220)}`,reason:row.source==='member_report'?`${reports||1} member report(s); human review is required.`:`AI detection at ${Math.round(Number(row.confidence||0)*100)}% confidence; no trusted outcome yet.`,href:`/moderation/${row.id}`,priority:score>=95?'urgent':score>=84?'high':'normal',priority_score:score,created_at:iso(row.created_at),status:row.status},resultRow));
    }else if(module==='txadmin'){
      const score=row.attention_kind==='server_offline'?100:row.attention_kind==='startup_blocker'?94:row.attention_kind==='runtime_failure'?86:58;
      items.push(reviewed({key:`txadmin:txadmin_event:${row.id}`,module,resource_type:'txadmin_event',resource_id:String(row.id),title:`${row.resource_name?`${row.resource_name} · `:''}${String(row.message).slice(0,180)}`,detail:`${String(row.attention_kind).replaceAll('_',' ')} · ${row.repeat_count||1} occurrence(s)`,reason:row.attention_kind==='update_available'?'A script reports an available update.':'This event may prevent FXServer or a resource from starting or running.',href:`/txadmin?view=attention&q=${encodeURIComponent(row.resource_name||String(row.message).slice(0,80))}`,priority:score>=95?'urgent':score>=84?'high':score>=65?'normal':'low',priority_score:score,created_at:iso(row.last_seen_at),status:row.status},resultRow));
    }
  }
  return items;
}

export async function getAutomationCenter(input:{access:Access;includeReviewed?:boolean}){
  const [modules,items,learning]=await Promise.all([
    getAutomationModuleSettings(),queueRows(input.access,Boolean(input.includeReviewed)),getLearningStats()
  ]);
  const moduleMap=new Map(modules.map(module=>[module.key,module]));
  const calibrated=await applyPriorityCalibration(items);
  const visible=calibrated.filter(item=>moduleMap.get(item.module)?.autonomy_level!=='off')
    .sort((a,b)=>b.priority_score-a.priority_score||new Date(b.created_at).getTime()-new Date(a.created_at).getTime());
  const counts=Object.fromEntries((Object.keys(moduleCatalog) as AutomationModuleKey[]).map(key=>[key,visible.filter(item=>item.module===key).length]));
  return {generated_at:new Date().toISOString(),modules:modules.filter(module=>allowed(input.access,module.permission)),items:visible.slice(0,200),counts,total:visible.length,learning};
}

async function learningSnapshot(executor:{query:(text:string,values?:unknown[])=>Promise<any>},input:{module:AutomationModuleKey;resourceType:string;resourceId:string}){
  if(input.resourceType==='txadmin_match'){
    const [issueText,eventText]=input.resourceId.split(':');
    const result=await executor.query(`SELECT i.title,i.description,i.category,i.resource_name AS issue_resource,
      e.resource_name AS event_resource,e.message,e.event_type,e.attention_kind
      FROM issues i JOIN service_events e ON e.id=$2 WHERE i.id=$1`,[Number(issueText),Number(eventText)]);
    const row=result.rows[0];if(!row)return null;
    return {text:`Issue: ${row.title}\n${row.description||''}\nIssue resource: ${row.issue_resource||''}\nServer event: ${row.event_resource||''} ${row.message||''}`,
      metadata:{issue_resource:row.issue_resource||null,event_resource:row.event_resource||null,event_type:row.event_type,attention_kind:row.attention_kind}};
  }
  const query=input.resourceType==='ticket'
    ? `SELECT subject||E'\n'||COALESCE(description,'') AS text,priority,status FROM tickets WHERE id=$1`
    : input.resourceType==='issue_candidate'
      ? `SELECT COALESCE(topic,'')||E'\n'||COALESCE(sample_text,'') AS text,status,occurrence_count,confirmed_count FROM issue_candidates WHERE id=$1`
      : input.resourceType==='suggestion'
        ? `SELECT COALESCE(title,'')||E'\n'||COALESCE(summary,'')||E'\n'||COALESCE(community_context,'') AS text,status,category,mention_count FROM suggestions WHERE id=$1`
        : input.resourceType==='knowledge_gap'
          ? `SELECT COALESCE(display_question,sample_question,'')||E'\n'||COALESCE(topic,'')||E'\n'||COALESCE(conversation_context,'') AS text,status,occurrences FROM knowledge_gaps WHERE id=$1`
          : input.resourceType==='issue_resolution'
            ? `SELECT COALESCE(title,'')||E'\n'||COALESCE(description,'')||E'\n'||COALESCE(resolution_summary,workaround,public_response,'') AS text,status,category,resource_name FROM issues WHERE id=$1`
          : input.resourceType==='moderation_case'
            ? `SELECT COALESCE(message_content,'')||E'\n'||COALESCE(context_snapshot,'') AS text,status,rule_article_id,rule_title,confidence FROM moderation_cases WHERE id=$1`
            : input.resourceType==='txadmin_event'
              ? `SELECT COALESCE(resource_name,'')||E'\n'||COALESCE(message,'') AS text,status,event_type,attention_kind,severity FROM service_events WHERE id=$1`
              : null;
  if(!query)return null;
  const result=await executor.query(query,[Number(input.resourceId)]);const row=result.rows[0];
  if(!row)return null;const {text,...metadata}=row;return {text:String(text||''),metadata};
}

export async function recordAutomationFeedback(input:{
  module:AutomationModuleKey;resourceType:string;resourceId:string;outcome:AutomationFeedbackOutcome;note?:string;actorUserId:string|null;
  correctedModule?:AutomationModuleKey|null;correctedPriority?:'urgent'|'high'|'normal'|'low'|null;
}){
  const client=await db.connect();
  try{
    await client.query('BEGIN');
    if(input.outcome==='reopened'){
      await client.query(`DELETE FROM automation_review_state WHERE module_key=$1 AND resource_type=$2 AND resource_id=$3`,[input.module,input.resourceType,input.resourceId]);
    }else{
      await client.query(`INSERT INTO automation_review_state(module_key,resource_type,resource_id,outcome,note,reviewed_by_user_id,reviewed_at,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW()) ON CONFLICT(module_key,resource_type,resource_id) DO UPDATE SET
        outcome=EXCLUDED.outcome,note=EXCLUDED.note,reviewed_by_user_id=EXCLUDED.reviewed_by_user_id,reviewed_at=NOW(),updated_at=NOW()`,
        [input.module,input.resourceType,input.resourceId,input.outcome,input.note||'',input.actorUserId]);
    }
    if(input.resourceType==='txadmin_match'){
      const [issueText,eventText]=input.resourceId.split(':');const issueId=Number(issueText);const eventId=Number(eventText);
      if(!Number.isInteger(issueId)||!Number.isInteger(eventId))throw new Error('Invalid txAdmin match reference.');
      if(input.outcome==='helpful'){
        await client.query(`UPDATE issue_txadmin_links SET review_status='confirmed',reviewed_by_user_id=$3,reviewed_at=NOW(),last_confirmed_at=NOW()
          WHERE issue_id=$1 AND service_event_id=$2`,[issueId,eventId,input.actorUserId]);
      }else if(input.outcome==='incorrect'){
        await client.query(`UPDATE issue_txadmin_links SET review_status='dismissed',reviewed_by_user_id=$3,reviewed_at=NOW()
          WHERE issue_id=$1 AND service_event_id=$2`,[issueId,eventId,input.actorUserId]);
        await client.query(`UPDATE service_events SET matched_issue_id=NULL WHERE id=$2 AND matched_issue_id=$1`,[issueId,eventId]);
      }
    }
    if(input.outcome==='helpful'||input.outcome==='incorrect'){
      const snapshot=await learningSnapshot(client,input);
      if(snapshot){
        if(input.resourceType==='txadmin_match'){
          await upsertLearningExample({module:'txadmin',decisionType:'txadmin_match',resourceType:input.resourceType,resourceId:input.resourceId,
            inputText:snapshot.text,predictedValue:'suggested',correctedValue:input.outcome==='helpful'?'confirmed':'dismissed',
            staffNote:input.note,metadata:snapshot.metadata,actorUserId:input.actorUserId},client);
        }else{
          if(input.outcome==='helpful'||input.correctedModule){
            await upsertLearningExample({module:input.module,decisionType:'routing',resourceType:input.resourceType,resourceId:input.resourceId,
              inputText:snapshot.text,predictedValue:input.module,correctedValue:input.correctedModule||input.module,
              staffNote:input.note,metadata:snapshot.metadata,actorUserId:input.actorUserId},client);
          }
          if(input.correctedPriority){
            await upsertLearningExample({module:input.module,decisionType:'priority',resourceType:input.resourceType,resourceId:input.resourceId,
              inputText:snapshot.text,predictedValue:'automatic',correctedValue:input.correctedPriority,
              staffNote:input.note,metadata:snapshot.metadata,actorUserId:input.actorUserId},client);
          }
          if(input.outcome==='incorrect'&&!input.correctedModule&&!input.correctedPriority){
            await upsertLearningExample({module:input.module,decisionType:'general',resourceType:input.resourceType,resourceId:input.resourceId,
              inputText:snapshot.text,predictedValue:input.module,correctedValue:'staff correction',
              staffNote:input.note,metadata:snapshot.metadata,actorUserId:input.actorUserId},client);
          }
        }
      }
    }
    await client.query(`INSERT INTO automation_feedback_events(module_key,resource_type,resource_id,outcome,note,actor_user_id)
      VALUES ($1,$2,$3,$4,$5,$6)`,[input.module,input.resourceType,input.resourceId,input.outcome,input.note||'',input.actorUserId]);
    await client.query('COMMIT');
    return {ok:true};
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
