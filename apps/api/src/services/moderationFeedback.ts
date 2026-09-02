import OpenAI from 'openai';
import { z } from 'zod';
import { db } from '../db.js';
import { env } from '../env.js';

const client = env.OPENAI_API_KEY ? new OpenAI({ apiKey: env.OPENAI_API_KEY }) : null;

const reanalysisSchema = z.object({
  matched: z.boolean(),
  confidence: z.coerce.number().min(0).max(1),
  reason: z.string().max(1200).default(''),
  context_factors: z.array(z.string().max(300)).max(6).default([])
});

export type ModerationPlayerFeedbackType = 'understood'|'incorrect';

function cleanContext(value: unknown) {
  return String(value || '').replace(/\r/g,'').trim().slice(0,6000);
}

async function getCase(caseId:number) {
  const result = await db.query(`
    SELECT c.id,c.public_id,c.discord_user_id,c.rule_article_id,c.rule_title,c.message_content,
           c.context_snapshot,c.ai_reason,c.evidence,c.status,c.reviewed_by_user_id,
           CASE WHEN a.status='published' AND a.content_type='discord_rule' THEN a.body ELSE NULL END AS rule_body
      FROM moderation_cases c
      LEFT JOIN knowledge_articles a ON a.id=c.rule_article_id
     WHERE c.id=$1
     LIMIT 1`,[caseId]);
  return result.rows[0] || null;
}

async function reconstructContext(caseRow:any) {
  if (cleanContext(caseRow.context_snapshot)) return cleanContext(caseRow.context_snapshot);
  const result = await db.query(`
    SELECT string_agg(COALESCE(x.author_name,'member') || ': ' || x.clean_content,E'\n' ORDER BY x.id) AS context
      FROM (
        SELECT dm.id,dm.author_name,
               left(regexp_replace(COALESCE(dm.content,''),E'[\\n\\r\\t ]+',' ','g'),500) AS clean_content
          FROM discord_messages dm
          JOIN moderation_cases c ON c.id=$1
         WHERE dm.channel_id=c.channel_id
           AND dm.id<c.discord_message_id
           AND dm.is_bot=FALSE
           AND btrim(COALESCE(dm.content,''))<>''
         ORDER BY dm.id DESC
         LIMIT 5
      ) x`,[caseRow.id]);
  const context = cleanContext(result.rows[0]?.context);
  if (context) {
    await db.query('UPDATE moderation_cases SET context_snapshot=$2,updated_at=NOW() WHERE id=$1 AND (context_snapshot IS NULL OR btrim(context_snapshot)=\'\')',[caseRow.id,context]).catch(()=>undefined);
  }
  return context;
}

async function reanalyze(caseRow:any,context:string) {
  if (!client || !env.AI_ENABLED || !caseRow.rule_body) {
    return {available:false,reason:'AI re-analysis unavailable or verified Discord Rule body is unavailable.'};
  }
  try {
    const response = await client.responses.create({
      model: env.AI_CLASSIFIER_MODEL,
      reasoning: { effort:'low' },
      instructions: `You are performing a SECOND-PASS moderation review because the moderated Discord member clicked Incorrect. Re-evaluate only whether the TARGET MESSAGE violates the supplied VERIFIED DISCORD RULE when the saved preceding conversation context is considered. Do not invent rules, punishments, exceptions, or facts. A player's disagreement is not evidence that the original decision was wrong. Pay special attention to quoting, reporting, consensual banter, sarcasm, references to another speaker, and context that changes who the target is. Return only compact JSON: {"matched":boolean,"confidence":number,"reason":string,"context_factors":string[]}.`,
      input: `VERIFIED DISCORD RULE:\n${String(caseRow.rule_body).slice(0,4000)}\n\nSAVED PRECEDING CONTEXT:\n${context || '(none captured)'}\n\nTARGET MESSAGE:\n${String(caseRow.message_content).slice(0,3000)}\n\nORIGINAL AI REASON:\n${String(caseRow.ai_reason||'').slice(0,1000)}\n\nORIGINAL EVIDENCE:\n${String(caseRow.evidence||'').slice(0,600)}`,
      max_output_tokens: 700
    });
    const raw = response.output_text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
    const parsed = reanalysisSchema.parse(JSON.parse(raw));
    return {available:true,...parsed,model:env.AI_CLASSIFIER_MODEL};
  } catch (error) {
    return {available:false,reason:error instanceof Error ? error.message.slice(0,500) : String(error).slice(0,500)};
  }
}

export async function recordModerationPlayerFeedback(caseId:number,userId:string,feedbackType:ModerationPlayerFeedbackType) {
  const caseRow = await getCase(caseId);
  if (!caseRow) return {ok:false,reason:'not_found' as const};
  if (String(caseRow.discord_user_id)!==String(userId)) return {ok:false,reason:'not_owner' as const};

  const context = await reconstructContext(caseRow);
  const inserted = await db.query(`
    INSERT INTO moderation_player_feedback (case_id,discord_user_id,feedback_type,context_snapshot)
    VALUES ($1,$2,$3,$4)
    ON CONFLICT (case_id,discord_user_id,feedback_type) DO NOTHING
    RETURNING id,created_at`,[caseId,userId,feedbackType,context||null]);

  if (!inserted.rowCount) {
    return {ok:true,already_recorded:true,feedback_type:feedbackType,case_id:caseId,public_id:caseRow.public_id};
  }

  if (feedbackType==='understood') {
    await db.query('UPDATE moderation_cases SET player_acknowledged_at=COALESCE(player_acknowledged_at,NOW()),updated_at=NOW() WHERE id=$1',[caseId]);
    await db.query(`INSERT INTO moderation_case_events (case_id,event_type,actor_user_id,details) VALUES ($1,'player_acknowledged',$2,$3::jsonb)`,[
      caseId,userId,JSON.stringify({source:'discord_button'})
    ]);
    return {ok:true,already_recorded:false,feedback_type:feedbackType,case_id:caseId,public_id:caseRow.public_id};
  }

  await db.query('UPDATE moderation_cases SET player_contested_at=COALESCE(player_contested_at,NOW()),updated_at=NOW() WHERE id=$1',[caseId]);
  await db.query(`INSERT INTO moderation_case_events (case_id,event_type,actor_user_id,details) VALUES ($1,'player_contested',$2,$3::jsonb)`,[
    caseId,userId,JSON.stringify({source:'discord_button',context_snapshot:context||null})
  ]);

  const secondPass = await reanalyze(caseRow,context);
  await db.query('UPDATE moderation_player_feedback SET reanalysis=$2::jsonb WHERE id=$1',[Number(inserted.rows[0].id),JSON.stringify(secondPass)]);
  await db.query(`INSERT INTO moderation_case_events (case_id,event_type,actor_user_id,details) VALUES ($1,'feedback_reanalyzed','saucin-ai',$2::jsonb)`,[
    caseId,JSON.stringify(secondPass)
  ]).catch(()=>undefined);

  return {ok:true,already_recorded:false,feedback_type:feedbackType,case_id:caseId,public_id:caseRow.public_id,reanalysis:secondPass};
}

export async function getModerationFeedback(caseId:number) {
  const result = await db.query(`
    SELECT f.id,f.feedback_type,f.context_snapshot,f.reanalysis,f.created_at,
           c.status AS case_status,c.reviewed_by_user_id,c.reviewed_at,
           CASE
             WHEN c.status IN ('confirmed','dismissed')
              AND c.reviewed_by_user_id IS NOT NULL
              AND c.reviewed_by_user_id<>'saucin-ai-live'
             THEN TRUE ELSE FALSE
           END AS trusted_staff_outcome
      FROM moderation_player_feedback f
      JOIN moderation_cases c ON c.id=f.case_id
     WHERE f.case_id=$1
     ORDER BY f.created_at DESC`,[caseId]);
  return result.rows;
}

export async function getContestedModerationCases(limit=25) {
  const safeLimit=Math.max(1,Math.min(100,Number(limit)||25));
  const result=await db.query(`
    SELECT id,public_id,author_name,discord_user_id,rule_title,message_content,confidence,status,
           offense_number,player_contested_at,reviewed_by_user_id,reviewed_at
      FROM moderation_cases
     WHERE player_contested_at IS NOT NULL
       AND (reviewed_by_user_id IS NULL OR reviewed_by_user_id='saucin-ai-live')
     ORDER BY player_contested_at DESC
     LIMIT $1`,[safeLimit]);
  return result.rows;
}
