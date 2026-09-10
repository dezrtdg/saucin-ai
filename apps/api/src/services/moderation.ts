import { z } from 'zod';
import { db } from '../db.js';
import { env } from '../env.js';
import { upsertLearningExample } from './learning.js';
import { aiClient as client } from './aiRuntime.js';

export type ModerationSettings = {
  mode: 'off' | 'observe';
  minimum_confidence: number;
  repeat_window_days: number;
  audit_channel_id: string | null;
  post_observations_to_audit: boolean;
  exempt_role_ids: string[];
  diagnostics_enabled: boolean;
};

export type ModerationAction = 'staff_review'|'reminder'|'warning'|'delete_message'|'timeout_10m'|'timeout_1h';
export type PrimaryModerationAction = Exclude<ModerationAction,'delete_message'>;

export type ModerationActionStep = {
  action: PrimaryModerationAction;
  delete_message: boolean;
};

export type ModerationActionLadder = {
  first: ModerationActionStep;
  second: ModerationActionStep;
  third: ModerationActionStep;
  fourth_plus: ModerationActionStep;
};

export type ModerationDetection = {
  case_id: number;
  public_id: string;
  rule_title: string;
  confidence: number;
  reason: string;
  evidence: string;
  recommended_action: ModerationAction;
  delete_message_recommended: boolean;
  offense_number: number;
  prior_confirmed_count: number;
  repeat_window_days_used: number;
  audit_channel_id: string | null;
  post_to_audit: boolean;
};

export type MemberModerationReport = {
  case_id:number;
  public_id:string;
  rule_title:string;
  confidence:number;
  reason:string;
  evidence:string;
  created:boolean;
  report_added:boolean;
  report_count:number;
  audit_channel_id:string|null;
};

export type ModerationCalibrationDecision =
  | 'would_stay_silent'
  | 'context_safety_gate'
  | 'below_threshold'
  | 'would_create_observe_case'
  | 'ai_unavailable'
  | 'analysis_error';

type EligibleRule = {
  id: number;
  title: string;
  body: string;
  aliases: string[];
  related_topics: string[];
  example_questions: string[];
  enabled: boolean;
  minimum_confidence: number | null;
  recommended_action: ModerationAction;
  action_ladder: ModerationActionLadder;
  repeat_window_days: number | null;
  exempt_role_ids: string[];
  channel_ids: string[];
};

const aiResultSchema = z.object({
  matched: z.boolean(),
  rule_id: z.coerce.number().int().positive().nullable().optional(),
  confidence: z.coerce.number().min(0).max(1),
  reason: z.string().max(1200).default(''),
  evidence: z.string().max(500).default(''),
  context_kind: z.enum(['explicit_violation','targeted_hostility','gaming_banter','gameplay_or_media','quoted_or_reported','ambiguous','other']).default('other'),
  harmful_targeting: z.boolean().default(false),
  plausible_benign_interpretation: z.boolean().default(false)
});

const moderationVerificationSchema = z.object({
  uphold: z.boolean(),
  confidence: z.coerce.number().min(0).max(1),
  context_kind: z.enum(['explicit_violation','targeted_hostility','gaming_banter','gameplay_or_media','quoted_or_reported','ambiguous','other']).default('other'),
  harmful_targeting: z.boolean().default(false),
  plausible_benign_interpretation: z.boolean().default(false),
  reason: z.string().max(1200).default('')
});

function clamp(value:number,min:number,max:number){ return Math.max(min,Math.min(max,value)); }
function unique(values:string[],max=100){ return [...new Set(values.map(v=>String(v).trim()).filter(Boolean))].slice(0,max); }

const moderationActions:ModerationAction[]=['staff_review','reminder','warning','delete_message','timeout_10m','timeout_1h'];
const primaryModerationActions:PrimaryModerationAction[]=['staff_review','reminder','warning','timeout_10m','timeout_1h'];

function moderationAction(value:unknown,fallback:ModerationAction='staff_review'):ModerationAction {
  const candidate=String(value||'') as ModerationAction;
  return moderationActions.includes(candidate)?candidate:fallback;
}
function primaryModerationAction(value:unknown,fallback:PrimaryModerationAction='staff_review'):PrimaryModerationAction {
  const candidate=String(value||'') as PrimaryModerationAction;
  return primaryModerationActions.includes(candidate)?candidate:fallback;
}
function normalizeActionStep(value:unknown,fallbackValue:unknown='staff_review'):ModerationActionStep {
  const legacyFallback=moderationAction(fallbackValue);
  const fallbackAction:PrimaryModerationAction=legacyFallback==='delete_message'?'staff_review':primaryModerationAction(legacyFallback);
  const fallbackDelete=legacyFallback==='delete_message';

  // v1.3.4 and earlier stored each ladder step as a string. Preserve those values.
  if(typeof value==='string'){
    const legacy=moderationAction(value,legacyFallback);
    if(legacy==='delete_message') return {action:'staff_review',delete_message:true};
    return {action:primaryModerationAction(legacy,fallbackAction),delete_message:false};
  }

  const raw=value && typeof value==='object' && !Array.isArray(value) ? value as Record<string,unknown> : {};
  const rawAction=moderationAction(raw.action,legacyFallback);
  return {
    action:rawAction==='delete_message'?'staff_review':primaryModerationAction(rawAction,fallbackAction),
    delete_message:Boolean(raw.delete_message) || rawAction==='delete_message' || fallbackDelete && !raw.action
  };
}
function normalizeActionLadder(value:unknown,fallbackValue:unknown='staff_review'):ModerationActionLadder {
  const raw=value && typeof value==='object' && !Array.isArray(value) ? value as Record<string,unknown> : {};
  return {
    first:normalizeActionStep(raw.first,fallbackValue),
    second:normalizeActionStep(raw.second,fallbackValue),
    third:normalizeActionStep(raw.third,fallbackValue),
    fourth_plus:normalizeActionStep(raw.fourth_plus,fallbackValue)
  };
}
function ladderStep(ladder:ModerationActionLadder,offenseNumber:number):ModerationActionStep {
  if(offenseNumber<=1) return ladder.first;
  if(offenseNumber===2) return ladder.second;
  if(offenseNumber===3) return ladder.third;
  return ladder.fourth_plus;
}

export async function getModerationSettings(): Promise<ModerationSettings> {
  const result = await db.query('SELECT * FROM moderation_settings WHERE id=1');
  const row = result.rows[0] || {};
  return {
    mode: row.mode === 'observe' ? 'observe' : 'off',
    minimum_confidence: clamp(Number(row.minimum_confidence ?? 0.9),0,1),
    repeat_window_days: clamp(Number(row.repeat_window_days ?? 7),1,90),
    audit_channel_id: row.audit_channel_id ? String(row.audit_channel_id) : null,
    post_observations_to_audit: Boolean(row.post_observations_to_audit),
    exempt_role_ids: Array.isArray(row.exempt_role_ids) ? row.exempt_role_ids.map(String) : [],
    diagnostics_enabled: Boolean(row.diagnostics_enabled)
  };
}

export async function updateModerationSettings(input:{
  mode:'off'|'observe'; minimum_confidence:number; repeat_window_days:number;
  audit_channel_id?:string|null; post_observations_to_audit:boolean; exempt_role_ids:string[]; diagnostics_enabled:boolean;
}) {
  const result=await db.query(
    `UPDATE moderation_settings SET mode=$1,minimum_confidence=$2,repeat_window_days=$3,audit_channel_id=$4,
       post_observations_to_audit=$5,exempt_role_ids=$6,diagnostics_enabled=$7,updated_at=NOW() WHERE id=1 RETURNING *`,
    [input.mode,clamp(input.minimum_confidence,0,1),clamp(input.repeat_window_days,1,90),input.audit_channel_id||null,input.post_observations_to_audit,unique(input.exempt_role_ids,100),input.diagnostics_enabled]
  );
  return result.rows[0];
}

export async function getModerationRuleSettings() {
  const result=await db.query(`
    SELECT a.id,a.title,a.status,a.content_type,a.category,a.updated_at,
           COALESCE(rs.enabled,TRUE) AS moderation_enabled,
           rs.minimum_confidence,COALESCE(rs.recommended_action,'staff_review') AS recommended_action,
           rs.action_ladder,rs.repeat_window_days,COALESCE(rs.exempt_role_ids,'{}'::text[]) AS exempt_role_ids,
           COALESCE(rs.channel_ids,'{}'::text[]) AS channel_ids
      FROM knowledge_articles a
      JOIN knowledge_content_types ct ON ct.key=a.content_type
      LEFT JOIN moderation_rule_settings rs ON rs.article_id=a.id
     WHERE a.status='published' AND ct.moderation_eligible=TRUE
     ORDER BY a.title`);
  return result.rows.map(row=>({
    ...row,
    action_ladder:normalizeActionLadder(row.action_ladder,row.recommended_action)
  }));
}

export async function updateModerationRuleSettings(articleId:number,input:{
  enabled:boolean; minimum_confidence:number|null; recommended_action:string; action_ladder:ModerationActionLadder; repeat_window_days:number|null;
  exempt_role_ids:string[]; channel_ids:string[];
}) {
  const eligible=await db.query(`SELECT a.id FROM knowledge_articles a JOIN knowledge_content_types ct ON ct.key=a.content_type WHERE a.id=$1 AND a.status='published' AND ct.moderation_eligible=TRUE`,[articleId]);
  if(!eligible.rowCount) throw new Error('Published moderation-eligible rule not found.');
  const ladder=normalizeActionLadder(input.action_ladder,input.recommended_action);
  const result=await db.query(`
    INSERT INTO moderation_rule_settings (article_id,enabled,minimum_confidence,recommended_action,action_ladder,repeat_window_days,exempt_role_ids,channel_ids,updated_at)
    VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,NOW())
    ON CONFLICT (article_id) DO UPDATE SET enabled=EXCLUDED.enabled,minimum_confidence=EXCLUDED.minimum_confidence,
      recommended_action=EXCLUDED.recommended_action,action_ladder=EXCLUDED.action_ladder,repeat_window_days=EXCLUDED.repeat_window_days,
      exempt_role_ids=EXCLUDED.exempt_role_ids,channel_ids=EXCLUDED.channel_ids,updated_at=NOW()
    RETURNING *`,
    [articleId,input.enabled,input.minimum_confidence==null?null:clamp(input.minimum_confidence,0,1),ladder.first.action,JSON.stringify(ladder),
     input.repeat_window_days==null?null:clamp(input.repeat_window_days,1,90),unique(input.exempt_role_ids),unique(input.channel_ids)]
  );
  return result.rows[0];
}


export type ModerationDiagnosticResult =
  | 'case_created'
  | 'skipped_channel_ignored'
  | 'skipped_channel_not_monitored'
  | 'skipped_issue_thread'
  | 'skipped_mode_off'
  | 'skipped_ai_unavailable'
  | 'skipped_global_exempt'
  | 'skipped_message_too_short'
  | 'skipped_no_candidate_rules'
  | 'skipped_no_eligible_rules'
  | 'ai_no_match'
  | 'ai_invalid_rule'
  | 'skipped_benign_gaming_language'
  | 'context_safety_gate'
  | 'below_confidence'
  | 'duplicate_case'
  | 'ai_error';

type DiagnosticInput = {
  source?: 'live'|'manual';
  resultCode: ModerationDiagnosticResult;
  guildId?: string|null;
  channelId?: string|null;
  channelName?: string|null;
  discordMessageId?: string|null;
  discordUserId?: string|null;
  authorName?: string|null;
  content?: string|null;
  matchedRuleId?: number|null;
  matchedRuleTitle?: string|null;
  confidence?: number|null;
  threshold?: number|null;
  details?: Record<string,unknown>;
};

async function insertModerationDiagnostic(input:DiagnosticInput) {
  await db.query(`
    INSERT INTO moderation_diagnostics
      (source,result_code,guild_id,channel_id,channel_name,discord_message_id,discord_user_id,author_name,message_content,
       matched_rule_id,matched_rule_title,confidence,threshold,details)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)`,[
      input.source||'live',input.resultCode,input.guildId||null,input.channelId||null,input.channelName||null,
      input.discordMessageId||null,input.discordUserId||null,input.authorName||null,String(input.content||'').slice(0,4000),
      input.matchedRuleId||null,input.matchedRuleTitle||null,
      input.confidence==null?null:clamp(Number(input.confidence),0,1),
      input.threshold==null?null:clamp(Number(input.threshold),0,1),
      JSON.stringify(input.details||{})
    ]);
  // Diagnostics are intentionally temporary/tuning data. Retain only the newest 1,000 rows.
  await db.query(`DELETE FROM moderation_diagnostics WHERE id IN (
    SELECT id FROM moderation_diagnostics ORDER BY id DESC OFFSET 1000
  )`).catch(()=>undefined);
}

async function diagnostic(settings:ModerationSettings,input:DiagnosticInput) {
  if(!settings.diagnostics_enabled) return;
  await insertModerationDiagnostic(input).catch(error=>console.warn('[moderation] unable to store diagnostic',error));
}

export async function recordModerationIngressDiagnostic(input:Omit<DiagnosticInput,'source'>) {
  const settings=await getModerationSettings();
  if(!settings.diagnostics_enabled) return;
  await diagnostic(settings,{...input,source:'live'});
}

export async function listModerationDiagnostics(limit=100) {
  const safeLimit=clamp(Number(limit||100),1,300);
  const result=await db.query(`
    SELECT d.*,
      CASE d.result_code
        WHEN 'case_created' THEN 'Case created'
        WHEN 'skipped_channel_ignored' THEN 'Channel ignored'
        WHEN 'skipped_channel_not_monitored' THEN 'Channel not monitored'
        WHEN 'skipped_issue_thread' THEN 'Issue thread'
        WHEN 'skipped_mode_off' THEN 'Moderation off'
        WHEN 'skipped_ai_unavailable' THEN 'AI unavailable'
        WHEN 'skipped_global_exempt' THEN 'Global exempt role'
        WHEN 'skipped_message_too_short' THEN 'Message too short'
        WHEN 'skipped_no_candidate_rules' THEN 'No moderation rules'
        WHEN 'skipped_no_eligible_rules' THEN 'No eligible rules'
        WHEN 'ai_no_match' THEN 'AI no match'
        WHEN 'ai_invalid_rule' THEN 'AI chose invalid rule'
        WHEN 'skipped_benign_gaming_language' THEN 'Benign gaming language'
        WHEN 'context_safety_gate' THEN 'Context safety gate'
        WHEN 'below_confidence' THEN 'Below confidence'
        WHEN 'duplicate_case' THEN 'Duplicate case'
        WHEN 'ai_error' THEN 'AI error'
        ELSE d.result_code
      END AS result_label
    FROM moderation_diagnostics d
    ORDER BY d.created_at DESC
    LIMIT $1`,[safeLimit]);
  return result.rows;
}

export async function clearModerationDiagnostics() {
  const result=await db.query('DELETE FROM moderation_diagnostics');
  return { deleted: result.rowCount||0 };
}

export async function getModerationCalibrationOverview() {
  const [settings,summary,ruleRows,gateRows,recentDismissals,learning] = await Promise.all([
    getModerationSettings(),
    db.query(`SELECT
      count(*) FILTER (WHERE created_at>NOW()-INTERVAL '30 days')::int AS total_30d,
      count(*) FILTER (WHERE status='pending' AND created_at>NOW()-INTERVAL '30 days')::int AS pending_30d,
      count(*) FILTER (WHERE status='confirmed' AND reviewed_at>NOW()-INTERVAL '30 days')::int AS confirmed_30d,
      count(*) FILTER (WHERE status='dismissed' AND reviewed_at>NOW()-INTERVAL '30 days')::int AS dismissed_30d,
      count(*) FILTER (WHERE source='member_report' AND created_at>NOW()-INTERVAL '30 days')::int AS member_reports_30d,
      count(*) FILTER (WHERE player_contested_at>NOW()-INTERVAL '30 days')::int AS contested_30d
      FROM moderation_cases`),
    db.query(`SELECT rule_article_id,rule_title,
      count(*) FILTER (WHERE status='pending')::int AS pending,
      count(*) FILTER (WHERE status='confirmed')::int AS confirmed,
      count(*) FILTER (WHERE status='dismissed')::int AS dismissed,
      count(*) FILTER (WHERE source='member_report')::int AS member_reports,
      count(*)::int AS total
      FROM moderation_cases
      WHERE created_at>NOW()-INTERVAL '30 days'
      GROUP BY rule_article_id,rule_title
      ORDER BY count(*) DESC,rule_title
      LIMIT 50`),
    db.query(`SELECT result_code,count(*)::int AS count
      FROM moderation_diagnostics
      WHERE created_at>NOW()-INTERVAL '30 days'
      GROUP BY result_code ORDER BY count(*) DESC`),
    db.query(`SELECT id,public_id,rule_title,author_name,message_content,review_notes,reviewed_at
      FROM moderation_cases
      WHERE status='dismissed' AND reviewed_by_user_id IS NOT NULL
      ORDER BY reviewed_at DESC NULLS LAST LIMIT 8`),
    db.query(`SELECT count(*)::int AS count FROM automation_learning_examples
      WHERE module_key='moderation' AND trusted=TRUE`)
  ]);
  const row=summary.rows[0]||{};
  const confirmed=Number(row.confirmed_30d||0);
  const dismissed=Number(row.dismissed_30d||0);
  const reviewed=confirmed+dismissed;
  const dismissalRate=reviewed?dismissed/reviewed:null;
  const readiness=reviewed<20
    ?{state:'collecting',label:'Collecting review data',detail:`Review at least ${20-reviewed} more Observe cases before considering any automatic moderation.`}
    :dismissalRate!=null&&dismissalRate>.15
      ?{state:'needs_tuning',label:'Needs more tuning',detail:'More than 15% of reviewed detections were dismissed. Keep moderation in Observe and use the simulator to refine weak rules.'}
      :{state:'stable_observe',label:'Observe results look stable',detail:'Reviewed accuracy is stable enough for continued testing. This does not enable enforcement automatically.'};
  return {
    settings,
    summary:{
      total_30d:Number(row.total_30d||0),pending_30d:Number(row.pending_30d||0),confirmed_30d:confirmed,
      dismissed_30d:dismissed,reviewed_30d:reviewed,member_reports_30d:Number(row.member_reports_30d||0),
      contested_30d:Number(row.contested_30d||0),dismissal_rate:dismissalRate
    },
    readiness,
    rule_metrics:ruleRows.rows.map(rule=>{
      const reviewedCount=Number(rule.confirmed||0)+Number(rule.dismissed||0);
      return {...rule,reviewed:reviewedCount,dismissal_rate:reviewedCount?Number(rule.dismissed||0)/reviewedCount:null};
    }),
    safety_gates:gateRows.rows,
    recent_dismissals:recentDismissals.rows,
    trusted_learning_examples:Number(learning.rows[0]?.count||0)
  };
}

async function createModerationQueryEmbedding(message:string):Promise<number[]|null> {
  if(!client || !env.AI_ENABLED || !message.trim()) return null;
  try {
    const response=await client.embeddings.create({
      model:env.AI_EMBEDDING_MODEL,
      input:message.slice(0,8000),
      encoding_format:'float'
    });
    return response.data[0]?.embedding??null;
  } catch(error) {
    console.warn('[moderation] candidate embedding failed; falling back to lexical retrieval',error);
    return null;
  }
}

async function candidateRules(message:string):Promise<EligibleRule[]> {
  // When the enabled moderation rule set is reasonably small, send ALL eligible rules
  // to the classifier. This is the safest option and prevents a strong violation from
  // being missed merely because its exact insult/phrase was not present in the rule's
  // title or aliases.
  const countResult=await db.query(`
    SELECT count(*)::int AS count
      FROM knowledge_articles a
      JOIN knowledge_content_types ct ON ct.key=a.content_type
      LEFT JOIN moderation_rule_settings rs ON rs.article_id=a.id
     WHERE a.status='published'
       AND ct.moderation_eligible=TRUE
       AND COALESCE(rs.enabled,TRUE)=TRUE`);
  const enabledCount=Number(countResult.rows[0]?.count||0);

  const baseSelect=`
    SELECT a.id,a.title,a.body,a.aliases,a.related_topics,a.example_questions,
           COALESCE(rs.enabled,TRUE) AS enabled,rs.minimum_confidence,
           COALESCE(rs.recommended_action,'staff_review') AS recommended_action,rs.action_ladder,rs.repeat_window_days,
           COALESCE(rs.exempt_role_ids,'{}'::text[]) AS exempt_role_ids,
           COALESCE(rs.channel_ids,'{}'::text[]) AS channel_ids`;

  const baseFrom=`
      FROM knowledge_articles a
      JOIN knowledge_content_types ct ON ct.key=a.content_type
      LEFT JOIN moderation_rule_settings rs ON rs.article_id=a.id
     WHERE a.status='published'
       AND ct.moderation_eligible=TRUE
       AND COALESCE(rs.enabled,TRUE)=TRUE`;

  let rows:any[]=[];

  if(enabledCount<=30){
    const result=await db.query(`${baseSelect} ${baseFrom} ORDER BY a.updated_at DESC,a.id DESC LIMIT 30`);
    rows=result.rows;
  } else {
    // Larger rule sets use hybrid retrieval. Semantic similarity is especially
    // important for moderation because abusive wording frequently does not share
    // literal words with formal rule language ("worthless piece of shit" vs.
    // "targeted personal harassment").
    const queryText=message.slice(0,4000);
    const embedding=await createModerationQueryEmbedding(queryText);
    const params:any[]=[queryText];

    let semanticSelect='NULL::float AS semantic_score';
    if(embedding){
      params.push(JSON.stringify(embedding));
      semanticSelect=`CASE WHEN a.embedding IS NULL THEN NULL
        ELSE GREATEST(-1.0,LEAST(1.0,1-(a.embedding <=> $2::vector))) END::float AS semantic_score`;
    }

    const result=await db.query(`
      ${baseSelect},
       ts_rank_cd(
         setweight(to_tsvector('english',coalesce(a.title,'')),'A') ||
         setweight(to_tsvector('english',coalesce(a.body,'')),'B') ||
         setweight(to_tsvector('english',coalesce(array_to_string(a.aliases,' '),'')),'A') ||
         setweight(to_tsvector('english',coalesce(array_to_string(a.related_topics,' '),'')),'A') ||
         setweight(to_tsvector('english',coalesce(array_to_string(a.example_questions,' '),'')),'A'),
         plainto_tsquery('english',$1)
       )::float AS lexical_rank,
       GREATEST(
         similarity(lower(coalesce(a.title,'')),lower($1)),
         similarity(lower(coalesce(array_to_string(a.aliases,' '),'')),lower($1)),
         similarity(lower(coalesce(array_to_string(a.related_topics,' '),'')),lower($1)),
         similarity(lower(coalesce(array_to_string(a.example_questions,' '),'')),lower($1)),
         similarity(lower(coalesce(a.body,'')),lower($1))
       )::float AS fuzzy_rank,
       ${semanticSelect}
      ${baseFrom}
      ORDER BY a.updated_at DESC
      LIMIT 250`,params);

    rows=result.rows
      .map(row=>{
        const lexical=Math.max(0,Number(row.lexical_rank||0));
        const lexicalNorm=Math.min(1,lexical*3.5);
        const fuzzy=Math.max(0,Math.min(1,Number(row.fuzzy_rank||0)));
        const semantic=row.semantic_score==null?0:Math.max(0,Math.min(1,Number(row.semantic_score)));
        const score=embedding
          ? semantic*0.62 + lexicalNorm*0.23 + fuzzy*0.15
          : lexicalNorm*0.72 + fuzzy*0.28;
        return {...row,_candidate_score:score};
      })
      .sort((a,b)=>Number(b._candidate_score)-Number(a._candidate_score))
      .slice(0,30);
  }

  return rows.map(row=>({
    id:Number(row.id),title:String(row.title),body:String(row.body),aliases:row.aliases||[],related_topics:row.related_topics||[],example_questions:row.example_questions||[],
    enabled:Boolean(row.enabled),minimum_confidence:row.minimum_confidence==null?null:Number(row.minimum_confidence),
    recommended_action:moderationAction(row.recommended_action),
    action_ladder:normalizeActionLadder(row.action_ladder,row.recommended_action),
    repeat_window_days:row.repeat_window_days==null?null:Number(row.repeat_window_days),exempt_role_ids:row.exempt_role_ids||[],channel_ids:row.channel_ids||[]
  }));
}
async function recentContext(channelId:string,storedMessageId:number){
  const result=await db.query(`SELECT author_name,content FROM discord_messages WHERE channel_id=$1 AND id<$2 AND is_bot=FALSE ORDER BY discord_created_at DESC LIMIT 5`,[channelId,storedMessageId]);
  return result.rows.reverse().map(row=>`${String(row.author_name||'member').slice(0,80)}: ${String(row.content||'').replace(/\s+/g,' ').slice(0,500)}`).join('\n');
}

function isKnownBenignGamingLanguage(message:string) {
  const value=message
    .normalize('NFKC')
    .replace(/[’‘]/g,"'")
    .replace(/\s+/g,' ')
    .trim()
    .toLowerCase();

  // "Clip" is ordinary gaming/media language when the complete message is about
  // recording a moment. Keep this deliberately narrow so abusive text elsewhere
  // in the same message is still classified normally.
  return /^(?:(?:i(?:'m| am)?|im)\s+(?:gonna|going to|will)\s+)?clip(?:ped)?\s+(?:that|this|it)(?:\s+(?:bro|lol|lmao|lmfao))?[.!?]*$/.test(value)
    || /^(?:did|can|could|would)\s+(?:you|someone|anyone)\s+clip\s+(?:that|this|it)[.!?]*$/.test(value);
}

async function trustedFalsePositiveExamples(ruleIds:number[]) {
  if(!ruleIds.length) return '(none available)';
  const result=await db.query(`
    SELECT rule_title,message_content,context_snapshot
      FROM moderation_cases
     WHERE status='dismissed'
       AND reviewed_by_user_id IS NOT NULL
       AND reviewed_by_user_id<>'saucin-ai-live'
       AND rule_article_id=ANY($1::bigint[])
     ORDER BY reviewed_at DESC NULLS LAST
     LIMIT 8`,[ruleIds]);
  if(!result.rowCount) return '(none available)';
  return result.rows.map((row,index)=>[
    `FALSE POSITIVE ${index+1} · ${String(row.rule_title||'rule').slice(0,120)}`,
    `Message: ${String(row.message_content||'').replace(/\s+/g,' ').slice(0,350)}`,
    row.context_snapshot?`Context: ${String(row.context_snapshot).replace(/\s+/g,' ').slice(0,500)}`:''
  ].filter(Boolean).join('\n')).join('\n\n');
}

async function verifyModerationMatch(input:{
  rule:EligibleRule; context:string; authorName:string; content:string;
  firstPass:z.infer<typeof aiResultSchema>; calibration:string;
}) {
  if(!client) return null;
  const response=await client.responses.create({
    model:env.AI_CLASSIFIER_MODEL,
    reasoning:{effort:'low'},
    instructions:`You are the conservative SECOND-PASS safety reviewer for a gaming-community Discord moderation system. The first classifier proposed a rule violation. Independently decide whether that action should be upheld.

The community naturally includes profanity, competitive trash talk, jokes, sarcasm, roleplay, discussion of in-game violence, and gaming/media terms such as clip, kill, shoot, smoke, cook, destroy, steal, or rob. Those words are not violations by themselves. "I'm going to clip that" ordinarily means saving a video clip, not threatening someone.

UPHOLD only when the target message clearly and materially violates the supplied verified rule after considering the conversation. For harassment or toxicity, require clear unwanted targeting, personal abuse, discriminatory hostility, intimidation, or a sustained/repeated pattern supported by the available context. Profanity, teasing, rivalry, disagreement, or an apparently mutual exchange is insufficient without clear abusive conduct. Quoting, reporting, lyrics, memes, moderation discussion, gameplay narration, roleplay, and media capture are not violations unless the message itself independently contains prohibited conduct.

If a reasonable benign gaming, banter, quoting, reporting, or media interpretation remains, set uphold=false and plausible_benign_interpretation=true. Missing context is uncertainty, not proof. Do not invent intent, relationships, history, or harm.

Staff-dismissed examples are calibration signals only; use them when genuinely analogous.

Return ONLY compact JSON:
{"uphold":boolean,"confidence":number,"context_kind":"explicit_violation|targeted_hostility|gaming_banter|gameplay_or_media|quoted_or_reported|ambiguous|other","harmful_targeting":boolean,"plausible_benign_interpretation":boolean,"reason":string}`,
    input:`VERIFIED RULE:\n${input.rule.title}\n${input.rule.body.slice(0,3000)}\n\nRECENT CONVERSATION:\n${input.context||'(none)'}\n\nTARGET MESSAGE (${input.authorName}):\n${input.content.slice(0,3000)}\n\nFIRST-PASS PROPOSAL:\n${JSON.stringify(input.firstPass)}\n\nSTAFF-DISMISSED FALSE POSITIVES:\n${input.calibration}`,
    max_output_tokens:700
  });
  const raw=response.output_text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  return moderationVerificationSchema.parse(JSON.parse(raw));
}

function rulesPrompt(rules:EligibleRule[]) {
  return rules.map(rule=>[
    `RULE_ID: ${rule.id}`,
    `TITLE: ${rule.title}`,
    `VERIFIED RULE: ${rule.body.slice(0,1100)}`,
    rule.aliases.length?`ALIASES: ${rule.aliases.slice(0,20).join(', ')}`:'',
    rule.related_topics.length?`RELATED: ${rule.related_topics.slice(0,8).join(', ')}`:'',
    rule.example_questions.length?`EXAMPLES: ${rule.example_questions.slice(0,8).join(' | ')}`:''
  ].filter(Boolean).join('\n')).join('\n\n---\n\n');
}

export async function simulateModerationMessage(input:{
  content:string; context?:string; authorName?:string; channelId?:string|null;
}) {
  const settings=await getModerationSettings();
  const content=String(input.content||'').trim().slice(0,4000);
  const context=String(input.context||'').trim().slice(0,6000);
  const authorName=String(input.authorName||'Test member').trim().slice(0,80)||'Test member';
  const base={
    mode:settings.mode,model:env.AI_CLASSIFIER_MODEL,content,context,
    creates_case:false,contacts_discord:false,applies_action:false
  };

  if(!client||!env.AI_ENABLED){
    return {...base,decision:'ai_unavailable' as ModerationCalibrationDecision,label:'AI unavailable',
      reason:'The moderation AI runtime is unavailable. No decision was made.',rule_id:null,rule_title:null,confidence:null,threshold:settings.minimum_confidence};
  }
  if(content.length<2){
    return {...base,decision:'would_stay_silent' as ModerationCalibrationDecision,label:'Would stay silent',
      reason:'The message is too short to evaluate safely.',rule_id:null,rule_title:null,confidence:0,threshold:settings.minimum_confidence};
  }
  if(isKnownBenignGamingLanguage(content)){
    return {...base,decision:'would_stay_silent' as ModerationCalibrationDecision,label:'Would stay silent',
      reason:'Recognized as ordinary gameplay or media-capture language.',rule_id:null,rule_title:null,confidence:0,
      threshold:settings.minimum_confidence,context_kind:'gameplay_or_media',harmful_targeting:false,plausible_benign_interpretation:true};
  }

  const candidates=await candidateRules(content);
  const rules=candidates.filter(rule=>!input.channelId||!rule.channel_ids.length||rule.channel_ids.includes(input.channelId));
  if(!rules.length){
    return {...base,decision:'would_stay_silent' as ModerationCalibrationDecision,label:'Would stay silent',
      reason:input.channelId&&candidates.length?'No matching rule is enabled for the selected channel.':'No published moderation rule is available for this message.',
      rule_id:null,rule_title:null,confidence:0,threshold:settings.minimum_confidence};
  }

  const calibration=await trustedFalsePositiveExamples(rules.map(rule=>rule.id)).catch(()=>'(unavailable)');
  let parsed:z.infer<typeof aiResultSchema>;
  try{
    const response=await client.responses.create({
      model:env.AI_CLASSIFIER_MODEL,
      reasoning:{effort:'low'},
      instructions:`You are running a DRY-RUN moderation calibration test for ${env.SERVER_NAME}, a gaming and roleplay Discord community. Evaluate only the supplied target message against the supplied verified Discord rules. Use the conversation context to determine meaning, tone, targeting, and whether an exchange appears mutual. Never invent rules, relationships, intent, history, harm, or punishments.

Gaming communities naturally include profanity, competitive trash talk, jokes, sarcasm, roleplay, in-game violence, and words such as clip, kill, shoot, smoke, cook, destroy, steal, or rob. Those words are not violations by themselves. Quoting, reporting, lyrics, memes, moderation discussion, gameplay narration, roleplay, and media capture are not violations unless the target message independently contains prohibited conduct.

For harassment or toxicity, require clear unwanted targeting, personal abuse, discriminatory hostility, intimidation, or a sustained/repeated pattern supported by context. Mutual banter, profanity, teasing, rivalry, or disagreement is insufficient by itself. Missing context is uncertainty, not evidence. If a reasonable benign interpretation remains, return matched=false.

Confidence measures rule fit, not how offensive a phrase sounds: 0.95-0.99 unmistakable; 0.88-0.94 clear targeted violation; 0.76-0.87 likely but ambiguous; 0.60-0.75 borderline; below 0.60 weak. Return only compact JSON matching this shape:
{"matched":boolean,"rule_id":number|null,"confidence":number,"reason":string,"evidence":string,"context_kind":"explicit_violation|targeted_hostility|gaming_banter|gameplay_or_media|quoted_or_reported|ambiguous|other","harmful_targeting":boolean,"plausible_benign_interpretation":boolean}`,
      input:`CONVERSATION CONTEXT:\n${context||'(none supplied)'}\n\nTARGET MESSAGE (${authorName}):\n${content}\n\nVERIFIED DISCORD RULES:\n${rulesPrompt(rules)}\n\nTRUSTED STAFF-DISMISSED FALSE POSITIVES:\n${calibration}`,
      max_output_tokens:900
    });
    const raw=response.output_text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
    parsed=aiResultSchema.parse(JSON.parse(raw));
  }catch(error){
    return {...base,decision:'analysis_error' as ModerationCalibrationDecision,label:'Analysis failed',
      reason:error instanceof Error?error.message.slice(0,500):String(error).slice(0,500),rule_id:null,rule_title:null,
      confidence:null,threshold:settings.minimum_confidence};
  }

  if(!parsed.matched||!parsed.rule_id){
    return {...base,decision:'would_stay_silent' as ModerationCalibrationDecision,label:'Would stay silent',
      reason:parsed.reason||'No verified rule match was found.',evidence:parsed.evidence,rule_id:null,rule_title:null,
      confidence:parsed.confidence,threshold:settings.minimum_confidence,context_kind:parsed.context_kind,
      harmful_targeting:parsed.harmful_targeting,plausible_benign_interpretation:parsed.plausible_benign_interpretation,first_pass:parsed};
  }

  const rule=rules.find(item=>item.id===Number(parsed.rule_id));
  if(!rule){
    return {...base,decision:'analysis_error' as ModerationCalibrationDecision,label:'Invalid rule selection',
      reason:'The AI selected a rule that was not eligible for this test.',rule_id:parsed.rule_id,rule_title:null,
      confidence:parsed.confidence,threshold:settings.minimum_confidence,first_pass:parsed};
  }
  const threshold=rule.minimum_confidence==null?settings.minimum_confidence:clamp(rule.minimum_confidence,0,1);
  const firstPassUnsafe=parsed.plausible_benign_interpretation||['gaming_banter','gameplay_or_media','quoted_or_reported','ambiguous'].includes(parsed.context_kind);
  if(firstPassUnsafe){
    return {...base,decision:'context_safety_gate' as ModerationCalibrationDecision,label:'Blocked by context safety',
      reason:parsed.reason||'The first pass found a reasonable benign interpretation.',evidence:parsed.evidence,
      rule_id:rule.id,rule_title:rule.title,confidence:parsed.confidence,threshold,context_kind:parsed.context_kind,
      harmful_targeting:parsed.harmful_targeting,plausible_benign_interpretation:parsed.plausible_benign_interpretation,first_pass:parsed};
  }

  let verification:z.infer<typeof moderationVerificationSchema>;
  try{
    const checked=await verifyModerationMatch({rule,context,authorName,content,firstPass:parsed,calibration});
    if(!checked) throw new Error('The independent safety reviewer was unavailable.');
    verification=checked;
  }catch(error){
    return {...base,decision:'context_safety_gate' as ModerationCalibrationDecision,label:'Blocked by safety review',
      reason:`The independent second pass could not safely uphold the match: ${error instanceof Error?error.message:String(error)}`.slice(0,700),
      evidence:parsed.evidence,rule_id:rule.id,rule_title:rule.title,confidence:parsed.confidence,threshold,first_pass:parsed};
  }

  const secondPassUnsafe=!verification.uphold||verification.plausible_benign_interpretation||
    ['gaming_banter','gameplay_or_media','quoted_or_reported','ambiguous'].includes(verification.context_kind);
  const confidence=clamp(Math.min(parsed.confidence,verification.confidence),0,1);
  if(secondPassUnsafe){
    return {...base,decision:'context_safety_gate' as ModerationCalibrationDecision,label:'Blocked by context safety',
      reason:verification.reason||'The independent safety reviewer did not uphold the match.',evidence:parsed.evidence,
      rule_id:rule.id,rule_title:rule.title,confidence,threshold,context_kind:verification.context_kind,
      harmful_targeting:verification.harmful_targeting,plausible_benign_interpretation:verification.plausible_benign_interpretation,
      first_pass:parsed,second_pass:verification};
  }
  if(confidence<threshold){
    return {...base,decision:'below_threshold' as ModerationCalibrationDecision,label:'Below confidence threshold',
      reason:verification.reason||parsed.reason,evidence:parsed.evidence,rule_id:rule.id,rule_title:rule.title,
      confidence,threshold,context_kind:verification.context_kind,harmful_targeting:verification.harmful_targeting,
      plausible_benign_interpretation:verification.plausible_benign_interpretation,first_pass:parsed,second_pass:verification};
  }
  return {...base,decision:'would_create_observe_case' as ModerationCalibrationDecision,label:'Would create an Observe case',
    reason:verification.reason||parsed.reason,evidence:parsed.evidence,rule_id:rule.id,rule_title:rule.title,
    confidence,threshold,context_kind:verification.context_kind,harmful_targeting:verification.harmful_targeting,
    plausible_benign_interpretation:verification.plausible_benign_interpretation,first_pass:parsed,second_pass:verification};
}

export async function processModerationMessage(input:{
  storedMessageId:number; guildId:string; channelId:string; channelName?:string|null; discordMessageId:string;
  discordUserId:string; authorName:string; content:string; memberRoleIds:string[]; replyContext?:string|null;
}):Promise<ModerationDetection|null> {
  const settings=await getModerationSettings();
  const baseDiag={
    guildId:input.guildId,channelId:input.channelId,channelName:input.channelName||null,
    discordMessageId:input.discordMessageId,discordUserId:input.discordUserId,authorName:input.authorName,content:input.content
  };

  if(settings.mode!=='observe'){
    await diagnostic(settings,{...baseDiag,resultCode:'skipped_mode_off',details:{mode:settings.mode}});
    return null;
  }
  if(!client || !env.AI_ENABLED){
    await diagnostic(settings,{...baseDiag,resultCode:'skipped_ai_unavailable',details:{client_available:Boolean(client),ai_enabled:Boolean(env.AI_ENABLED)}});
    return null;
  }

  const globalExemptMatches=settings.exempt_role_ids.filter(role=>input.memberRoleIds.includes(role));
  if(globalExemptMatches.length){
    await diagnostic(settings,{...baseDiag,resultCode:'skipped_global_exempt',details:{member_role_ids:input.memberRoleIds,matched_exempt_role_ids:globalExemptMatches}});
    return null;
  }

  if(input.content.trim().length<2){
    await diagnostic(settings,{...baseDiag,resultCode:'skipped_message_too_short'});
    return null;
  }

  if(isKnownBenignGamingLanguage(input.content)){
    await diagnostic(settings,{...baseDiag,resultCode:'skipped_benign_gaming_language',details:{
      reason:'The complete message is a common request or statement about saving a gameplay clip.'
    }});
    return null;
  }

  const candidates=await candidateRules(input.content);
  if(!candidates.length){
    await diagnostic(settings,{...baseDiag,resultCode:'skipped_no_candidate_rules'});
    return null;
  }

  const ruleExemptions=candidates.filter(rule=>rule.exempt_role_ids.some(role=>input.memberRoleIds.includes(role)));
  const channelExcluded=candidates.filter(rule=>rule.channel_ids.length && !rule.channel_ids.includes(input.channelId));
  const rules=candidates.filter(rule=>
    !rule.exempt_role_ids.some(role=>input.memberRoleIds.includes(role)) &&
    (!rule.channel_ids.length || rule.channel_ids.includes(input.channelId))
  );

  if(!rules.length){
    await diagnostic(settings,{...baseDiag,resultCode:'skipped_no_eligible_rules',details:{
      candidate_rules:candidates.map(rule=>({id:rule.id,title:rule.title})),
      role_exempted_rules:ruleExemptions.map(rule=>({id:rule.id,title:rule.title})),
      channel_excluded_rules:channelExcluded.map(rule=>({id:rule.id,title:rule.title,channel_ids:rule.channel_ids})),
      member_role_ids:input.memberRoleIds
    }});
    return null;
  }

  const recent=await recentContext(input.channelId,input.storedMessageId);
  const context=[input.replyContext?`DIRECTLY REPLIED TO:\n${input.replyContext}`:'',recent?`RECENT MESSAGES:\n${recent}`:'']
    .filter(Boolean).join('\n\n');
  const calibration=await trustedFalsePositiveExamples(rules.map(rule=>rule.id)).catch(()=>'(unavailable)');

  let parsed:z.infer<typeof aiResultSchema>;
  try {
    const response=await client.responses.create({
      model:env.AI_CLASSIFIER_MODEL,
      reasoning:{effort:'low'},
      instructions:`You are an OBSERVE-ONLY Discord moderation classifier for ${env.SERVER_NAME}, a gaming and roleplay community. Determine whether the TARGET MESSAGE itself is a likely violation of one of the supplied VERIFIED DISCORD RULES. Use the full recent conversation to interpret meaning, tone, who is being addressed, and whether the exchange appears mutual. Do not invent rules, thresholds, exceptions, relationships, punishments, or facts that are not supported by the supplied rules.

MATCHING RULES:
- Match only when the target message's conduct is materially supported as prohibited by a supplied verified rule.
- Do NOT flag a message merely because it mentions prohibited behavior, quotes someone, asks what a rule means, reports another player's behavior, discusses moderation, or contains ordinary profanity with no applicable rule violation.
- Direct insults, targeted abusive language, harassment, or hostility SHOULD match when a supplied verified rule prohibits harassment, personal abuse, targeted insults, toxicity, disrespectful conduct, or equivalent behavior.
- A profanity word by itself is not enough. Targeting and the verified rule matter.
- Gaming communities naturally contain profanity, competitive trash talk, jokes, sarcasm, roleplay, and discussion of in-game violence. These are not violations merely because the words sound aggressive outside gaming context.
- Terms such as clip, kill, shoot, smoke, cook, destroy, steal, or rob may describe gameplay or media capture. For example, "I'm going to clip that" normally means saving a video clip and is not harassment or a threat.
- For harassment/toxicity, distinguish reciprocal good-natured banter from unwanted personal abuse. Require clear harmful targeting, discriminatory hostility, intimidation, or a sustained/repeated pattern supported by the available context.
- Missing context is uncertainty, not evidence of malicious intent. If a reasonable benign gaming, banter, quoting, reporting, roleplay, or media interpretation remains, return matched=false.

CONFIDENCE CALIBRATION:
Confidence measures how strongly the TARGET MESSAGE fits the VERIFIED RULE, not how severe or offensive the language feels.
- 0.95-0.99 = explicit, unmistakable violation with essentially no plausible benign interpretation.
- 0.88-0.94 = clear violation: direct/targeted conduct closely matches the verified rule; context does not materially undermine it.
- 0.76-0.87 = likely violation but some context, wording, targeting, or rule-fit ambiguity remains.
- 0.60-0.75 = borderline/ambiguous; normally do not create a case at a 0.75+ threshold unless the evidence truly supports it.
- below 0.60 = weak support; normally matched=false.
For a rule that explicitly prohibits harassment/personal abuse/targeted insults, a message directly addressed at a person such as "you're a stupid ass bitch" is ordinarily a CLEAR HIGH-CONFIDENCE match (about 0.90+) unless context shows it is quoting, reporting, consensual banter, or otherwise non-abusive.

Return ONLY compact JSON:
{"matched":boolean,"rule_id":number|null,"confidence":number,"reason":string,"evidence":string,"context_kind":"explicit_violation|targeted_hostility|gaming_banter|gameplay_or_media|quoted_or_reported|ambiguous|other","harmful_targeting":boolean,"plausible_benign_interpretation":boolean}

confidence must be 0-1. evidence should quote or concisely identify the specific target-message wording that supports the match. reason should explain the rule-to-message fit, not moralize. If the evidence does not support a verified violation, use matched=false.`,
      input:`RECENT CONTEXT (may be empty):\n${context||'(none)'}\n\nTARGET MESSAGE (${input.authorName}):\n${input.content.slice(0,4000)}\n\nVERIFIED DISCORD RULES:\n${rulesPrompt(rules)}\n\nRECENT STAFF-DISMISSED FALSE POSITIVES:\n${calibration}`,
      max_output_tokens:900
    });
    const raw=response.output_text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
    parsed=aiResultSchema.parse(JSON.parse(raw));
  } catch(error) {
    console.error('[moderation] AI observe classification failed',error);
    await diagnostic(settings,{...baseDiag,resultCode:'ai_error',details:{error:error instanceof Error?error.message:String(error),eligible_rules:rules.map(rule=>({id:rule.id,title:rule.title}))}});
    return null;
  }

  if(!parsed.matched || !parsed.rule_id){
    await diagnostic(settings,{...baseDiag,resultCode:'ai_no_match',confidence:parsed.confidence,details:{
      ai_reason:parsed.reason,ai_evidence:parsed.evidence,ai_rule_id:parsed.rule_id||null,
      eligible_rules:rules.map(rule=>({id:rule.id,title:rule.title}))
    }});
    return null;
  }

  const rule=rules.find(item=>item.id===Number(parsed.rule_id));
  if(!rule){
    await diagnostic(settings,{...baseDiag,resultCode:'ai_invalid_rule',confidence:parsed.confidence,details:{
      ai_rule_id:parsed.rule_id,ai_reason:parsed.reason,eligible_rules:rules.map(item=>({id:item.id,title:item.title}))
    }});
    return null;
  }

  if(parsed.plausible_benign_interpretation || ['gaming_banter','gameplay_or_media','quoted_or_reported','ambiguous'].includes(parsed.context_kind)){
    await diagnostic(settings,{...baseDiag,resultCode:'context_safety_gate',matchedRuleId:rule.id,matchedRuleTitle:rule.title,confidence:parsed.confidence,details:{
      stage:'first_pass',ai_reason:parsed.reason,ai_evidence:parsed.evidence,context_kind:parsed.context_kind,
      harmful_targeting:parsed.harmful_targeting,plausible_benign_interpretation:parsed.plausible_benign_interpretation
    }});
    return null;
  }

  let verification:z.infer<typeof moderationVerificationSchema>;
  try {
    const checked=await verifyModerationMatch({rule,context,authorName:input.authorName,content:input.content,firstPass:parsed,calibration});
    if(!checked) return null;
    verification=checked;
  } catch(error) {
    // A failed safety review must fail closed: never send a player-facing action
    // based on only one uncertain model decision.
    await diagnostic(settings,{...baseDiag,resultCode:'context_safety_gate',matchedRuleId:rule.id,matchedRuleTitle:rule.title,confidence:parsed.confidence,details:{
      stage:'second_pass_error',error:error instanceof Error?error.message:String(error),first_pass_reason:parsed.reason
    }});
    return null;
  }

  if(!verification.uphold || verification.plausible_benign_interpretation || ['gaming_banter','gameplay_or_media','quoted_or_reported','ambiguous'].includes(verification.context_kind)){
    await diagnostic(settings,{...baseDiag,resultCode:'context_safety_gate',matchedRuleId:rule.id,matchedRuleTitle:rule.title,confidence:verification.confidence,details:{
      stage:'second_pass',first_pass_reason:parsed.reason,review_reason:verification.reason,context_kind:verification.context_kind,
      harmful_targeting:verification.harmful_targeting,plausible_benign_interpretation:verification.plausible_benign_interpretation
    }});
    return null;
  }

  const threshold=rule.minimum_confidence==null?settings.minimum_confidence:clamp(rule.minimum_confidence,0,1);
  // Both independent passes must meet the configured confidence threshold. Use
  // the lower score so one overconfident pass cannot force an action.
  const confidence=clamp(Math.min(Number(parsed.confidence),Number(verification.confidence)),0,1);
  if(confidence<threshold){
    await diagnostic(settings,{...baseDiag,resultCode:'below_confidence',matchedRuleId:rule.id,matchedRuleTitle:rule.title,confidence,threshold,details:{
      ai_reason:parsed.reason,ai_evidence:parsed.evidence,verification_reason:verification.reason,
      threshold_source:rule.minimum_confidence==null?'global':'rule_override'
    }});
    return null;
  }

  const repeatDays=rule.repeat_window_days==null?settings.repeat_window_days:clamp(rule.repeat_window_days,1,90);
  const prior=await db.query(`SELECT count(*)::int AS count FROM moderation_cases WHERE discord_user_id=$1 AND status='confirmed' AND rule_article_id=$2 AND created_at>NOW()-($3::text||' days')::interval`,[input.discordUserId,rule.id,repeatDays]);
  const priorCount=Number(prior.rows[0]?.count||0);
  const offenseNumber=priorCount+1;
  const ladder=normalizeActionLadder(rule.action_ladder,rule.recommended_action);
  const selectedStep=ladderStep(ladder,offenseNumber);
  const recommendedAction:ModerationAction=selectedStep.action;
  const deleteMessageRecommended=selectedStep.delete_message;

  const inserted=await db.query(`
    INSERT INTO moderation_cases
      (guild_id,channel_id,channel_name,message_id,discord_message_id,discord_user_id,author_name,message_content,
       rule_article_id,rule_title,confidence,ai_reason,evidence,recommended_action,delete_message_recommended,
       prior_confirmed_count,offense_number,repeat_window_days_used,action_ladder_snapshot,mode,status)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,'observe','pending')
    ON CONFLICT (discord_message_id) DO NOTHING
    RETURNING id`,[
      input.guildId,input.channelId,input.channelName||null,input.discordMessageId,input.storedMessageId,input.discordUserId,input.authorName,input.content,
      rule.id,rule.title,confidence,String(`${parsed.reason} Second-pass: ${verification.reason}`.trim()).slice(0,1200),String(parsed.evidence||'').slice(0,500),recommendedAction,
      deleteMessageRecommended,priorCount,offenseNumber,repeatDays,JSON.stringify(ladder)
    ]);

  if(!inserted.rowCount){
    await diagnostic(settings,{...baseDiag,resultCode:'duplicate_case',matchedRuleId:rule.id,matchedRuleTitle:rule.title,confidence,threshold});
    return null;
  }

  const caseId=Number(inserted.rows[0].id);
  const publicId=`MOD-${String(caseId).padStart(4,'0')}`;
  await db.query('UPDATE moderation_cases SET public_id=$1 WHERE id=$2',[publicId,caseId]);
  await db.query(`INSERT INTO moderation_case_events (case_id,event_type,details) VALUES ($1,'detected',$2::jsonb)`,[caseId,JSON.stringify({
    confidence,rule_id:rule.id,mode:'observe',prior_confirmed_count:priorCount,offense_number:offenseNumber,
    repeat_window_days:repeatDays,recommended_action:recommendedAction,delete_message_recommended:deleteMessageRecommended,action_ladder:ladder,
    context_kind:verification.context_kind,harmful_targeting:verification.harmful_targeting,second_pass_confidence:verification.confidence
  })]);

  await diagnostic(settings,{...baseDiag,resultCode:'case_created',matchedRuleId:rule.id,matchedRuleTitle:rule.title,confidence,threshold,details:{
    public_id:publicId,recommended_action:recommendedAction,delete_message_recommended:deleteMessageRecommended,
    prior_confirmed_count:priorCount,offense_number:offenseNumber,repeat_window_days:repeatDays,
    action_ladder:ladder,ai_reason:parsed.reason,ai_evidence:parsed.evidence,verification_reason:verification.reason,
    context_kind:verification.context_kind,harmful_targeting:verification.harmful_targeting,second_pass_confidence:verification.confidence
  }});

  return {
    case_id:caseId,public_id:publicId,rule_title:rule.title,confidence,reason:String(parsed.reason||''),evidence:String(parsed.evidence||''),
    recommended_action:recommendedAction,delete_message_recommended:deleteMessageRecommended,
    offense_number:offenseNumber,prior_confirmed_count:priorCount,repeat_window_days_used:repeatDays,
    audit_channel_id:settings.audit_channel_id,post_to_audit:settings.post_observations_to_audit
  };
}

export async function reportModerationMessage(input:{
  storedMessageId:number; guildId:string; channelId:string; channelName?:string|null; discordMessageId:string;
  discordUserId:string; authorName:string; content:string; replyContext?:string|null;
  reporterUserId:string; reporterName:string; commandMessageId:string;
}):Promise<MemberModerationReport> {
  const recentReports=await db.query(`
    SELECT count(*)::int AS count
      FROM moderation_reports
     WHERE reporter_user_id=$1
       AND created_at>NOW()-INTERVAL '10 minutes'`,[input.reporterUserId]);
  if(Number(recentReports.rows[0]?.count||0)>=5) throw new Error('report_rate_limited');

  const settings=await getModerationSettings();
  const recent=await recentContext(input.channelId,input.storedMessageId);
  const context=[input.replyContext?`DIRECT REPLY CONTEXT:\n${input.replyContext}`:'',recent?`RECENT MESSAGES:\n${recent}`:'']
    .filter(Boolean).join('\n\n');
  const rules=(await candidateRules(input.content)).filter(rule=>!rule.channel_ids.length||rule.channel_ids.includes(input.channelId));
  const calibration=await trustedFalsePositiveExamples(rules.map(rule=>rule.id)).catch(()=>'(unavailable)');

  let matchedRule:EligibleRule|null=null;
  let confidence=0;
  let reason='A member requested staff review. AI analysis was unavailable, so no rule match was assumed.';
  let evidence='';
  let assessment:z.infer<typeof aiResultSchema>|null=null;

  if(client&&env.AI_ENABLED&&rules.length){
    try{
      const response=await client.responses.create({
        model:env.AI_CLASSIFIER_MODEL,
        reasoning:{effort:'low'},
        instructions:`You are providing a neutral preliminary assessment of a Discord message that a community member reported. The report itself is not proof of a violation. Analyze the TARGET MESSAGE using the conversation and only the supplied VERIFIED DISCORD RULES. This is a gaming and roleplay community where profanity, competitive trash talk, jokes, sarcasm, roleplay, in-game violence, and gaming/media language may be benign. Do not invent intent, relationships, history, rules, or harm. If a reasonable benign interpretation remains, use matched=false. For harassment or toxicity, require clear unwanted targeting, personal abuse, discriminatory hostility, intimidation, or a supported sustained pattern. Return only compact JSON: {"matched":boolean,"rule_id":number|null,"confidence":number,"reason":string,"evidence":string,"context_kind":"explicit_violation|targeted_hostility|gaming_banter|gameplay_or_media|quoted_or_reported|ambiguous|other","harmful_targeting":boolean,"plausible_benign_interpretation":boolean}.`,
        input:`RECENT CONVERSATION:\n${context||'(none)'}\n\nTARGET MESSAGE (${input.authorName}):\n${input.content.slice(0,4000)}\n\nVERIFIED DISCORD RULES:\n${rulesPrompt(rules)}\n\nSTAFF-DISMISSED FALSE POSITIVES:\n${calibration}`,
        max_output_tokens:900
      });
      const raw=response.output_text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
      assessment=aiResultSchema.parse(JSON.parse(raw));
      matchedRule=assessment.matched&&assessment.rule_id
        ? rules.find(rule=>rule.id===Number(assessment!.rule_id))||null
        : null;
      confidence=matchedRule?clamp(Number(assessment.confidence),0,1):0;
      reason=assessment.reason||'AI did not find a clear verified-rule match; staff review was still requested.';
      evidence=assessment.evidence||'';
    }catch(error){
      reason=`A member requested staff review. AI analysis was unavailable: ${error instanceof Error?error.message:String(error)}`.slice(0,1200);
    }
  }else if(!rules.length){
    reason='A member requested staff review. No applicable published Discord rule was available for an automatic match.';
  }

  const existing=await db.query('SELECT id,public_id FROM moderation_cases WHERE discord_message_id=$1 LIMIT 1',[input.storedMessageId]);
  let caseId=existing.rowCount?Number(existing.rows[0].id):0;
  let publicId=existing.rowCount?String(existing.rows[0].public_id||''):'';
  let created=false;

  if(!caseId){
    const inserted=await db.query(`
      INSERT INTO moderation_cases
        (guild_id,channel_id,channel_name,message_id,discord_message_id,discord_user_id,author_name,message_content,
         rule_article_id,rule_title,confidence,ai_reason,evidence,recommended_action,delete_message_recommended,
         prior_confirmed_count,offense_number,repeat_window_days_used,action_ladder_snapshot,mode,status,source,
         context_snapshot,staff_review_required,live_action_status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'staff_review',FALSE,0,1,$14,$15::jsonb,'observe','pending','member_report',$16,TRUE,'not_applicable')
      ON CONFLICT (discord_message_id) DO NOTHING
      RETURNING id`,[
        input.guildId,input.channelId,input.channelName||null,input.discordMessageId,input.storedMessageId,input.discordUserId,input.authorName,input.content,
        matchedRule?.id||null,matchedRule?.title||'Member report — staff review',confidence,String(reason).slice(0,1200),String(evidence).slice(0,500),
        settings.repeat_window_days,JSON.stringify(normalizeActionLadder(null,'staff_review')),context||null
      ]);
    if(inserted.rowCount){caseId=Number(inserted.rows[0].id);created=true;}
    else {
      const raced=await db.query('SELECT id,public_id FROM moderation_cases WHERE discord_message_id=$1 LIMIT 1',[input.storedMessageId]);
      if(!raced.rowCount) throw new Error('unable_to_create_report');
      caseId=Number(raced.rows[0].id);publicId=String(raced.rows[0].public_id||'');
    }
  }

  if(!publicId){
    publicId=`MOD-${String(caseId).padStart(4,'0')}`;
    await db.query('UPDATE moderation_cases SET public_id=COALESCE(public_id,$1) WHERE id=$2',[publicId,caseId]);
  }

  const report=await db.query(`
    INSERT INTO moderation_reports (case_id,reporter_user_id,reporter_name,command_message_id)
    VALUES ($1,$2,$3,$4)
    ON CONFLICT (case_id,reporter_user_id) DO NOTHING
    RETURNING id`,[caseId,input.reporterUserId,input.reporterName,input.commandMessageId]);

  if(created){
    await db.query(`INSERT INTO moderation_case_events (case_id,event_type,actor_user_id,details)
      VALUES ($1,'detected',$2,$3::jsonb)`,[caseId,input.reporterUserId,JSON.stringify({
        source:'member_report',reporter_name:input.reporterName,ai_matched:Boolean(matchedRule),
        ai_context_kind:assessment?.context_kind||null,plausible_benign_interpretation:assessment?.plausible_benign_interpretation??null
      })]);
  }else if(report.rowCount){
    await db.query(`INSERT INTO moderation_case_events (case_id,event_type,actor_user_id,details)
      VALUES ($1,'note',$2,$3::jsonb)`,[caseId,input.reporterUserId,JSON.stringify({source:'additional_member_report',reporter_name:input.reporterName})]);
  }

  const count=await db.query('SELECT count(*)::int AS count FROM moderation_reports WHERE case_id=$1',[caseId]);
  return {
    case_id:caseId,public_id:publicId,rule_title:matchedRule?.title||'Member report — staff review',confidence,reason,evidence,
    created,report_added:Boolean(report.rowCount),report_count:Number(count.rows[0]?.count||0),audit_channel_id:settings.audit_channel_id
  };
}

export async function listModerationCases(input:{status?:string;userId?:string;limit?:number}={}) {
  const values:any[]=[]; const where:string[]=[];
  if(input.status && ['pending','confirmed','dismissed'].includes(input.status)){values.push(input.status);where.push(`c.status=$${values.length}`);}
  if(input.userId){values.push(input.userId);where.push(`c.discord_user_id=$${values.length}`);}
  values.push(clamp(Number(input.limit||200),1,500));
  const result=await db.query(`
    SELECT c.*,(SELECT count(*)::int FROM moderation_reports mr WHERE mr.case_id=c.id) AS report_count FROM moderation_cases c
    ${where.length?'WHERE '+where.join(' AND '):''}
    ORDER BY CASE c.status WHEN 'pending' THEN 1 WHEN 'confirmed' THEN 2 ELSE 3 END,c.created_at DESC
    LIMIT $${values.length}`,values);
  const stats=await db.query(`SELECT
    count(*) FILTER (WHERE status='pending')::int AS pending,
    count(*) FILTER (WHERE status='confirmed' AND created_at>NOW()-INTERVAL '30 days')::int AS confirmed_30d,
    count(*) FILTER (WHERE status='dismissed' AND created_at>NOW()-INTERVAL '30 days')::int AS dismissed_30d,
    count(*) FILTER (WHERE created_at>NOW()-INTERVAL '24 hours')::int AS detected_24h
    FROM moderation_cases`);
  return {stats:stats.rows[0],cases:result.rows};
}

export async function getModerationCase(caseId:number){
  const result=await db.query(`SELECT c.*,
    COALESCE((SELECT jsonb_agg(e ORDER BY e.created_at DESC) FROM moderation_case_events e WHERE e.case_id=c.id),'[]'::jsonb) AS events,
    COALESCE((SELECT jsonb_agg(r ORDER BY r.created_at DESC) FROM moderation_reports r WHERE r.case_id=c.id),'[]'::jsonb) AS reports,
    (SELECT count(*)::int FROM moderation_cases u WHERE u.discord_user_id=c.discord_user_id AND u.status='confirmed') AS user_confirmed_total,
    (SELECT count(*)::int FROM moderation_cases u WHERE u.discord_user_id=c.discord_user_id AND u.status='dismissed') AS user_dismissed_total
    FROM moderation_cases c WHERE c.id=$1`,[caseId]);
  return result.rows[0]||null;
}

export async function reviewModerationCase(caseId:number,input:{status:'pending'|'confirmed'|'dismissed';notes?:string|null;actorUserId?:string|null}){
  const before=await db.query('SELECT status,rule_article_id,rule_title,message_content,context_snapshot,confidence FROM moderation_cases WHERE id=$1',[caseId]);
  if(!before.rowCount) return null;
  const result=await db.query(`UPDATE moderation_cases SET status=$1,review_notes=$2,reviewed_by_user_id=$3,
    reviewed_at=CASE WHEN $1='pending' THEN NULL ELSE NOW() END,updated_at=NOW() WHERE id=$4 RETURNING *`,
    [input.status,input.notes?.trim()||null,input.status==='pending'?null:(input.actorUserId||null),caseId]);
  const oldStatus=String(before.rows[0].status);
  const eventType=input.status==='pending'?'reopened':input.status;
  await db.query(`INSERT INTO moderation_case_events (case_id,event_type,actor_user_id,details) VALUES ($1,$2,$3,$4::jsonb)`,
    [caseId,eventType,input.actorUserId||null,JSON.stringify({from:oldStatus,to:input.status,notes:input.notes?.trim()||null})]);
  if(input.status!=='pending'){
    const row=before.rows[0];
    await upsertLearningExample({module:'moderation',decisionType:'moderation',resourceType:'moderation_case',resourceId:String(caseId),
      inputText:`${row.message_content||''}\n${row.context_snapshot||''}`,predictedValue:String(row.rule_title||row.rule_article_id||'possible violation'),
      correctedValue:input.status,staffNote:input.notes||'',metadata:{rule_article_id:row.rule_article_id||null,confidence:Number(row.confidence||0)},
      actorUserId:input.actorUserId||null});
  }
  return result.rows[0];
}

export async function getModerationUserHistory(userId:string){
  const cases=await db.query(`SELECT * FROM moderation_cases WHERE discord_user_id=$1 ORDER BY created_at DESC LIMIT 200`,[userId]);
  const summary=await db.query(`SELECT count(*)::int AS total,
    count(*) FILTER (WHERE status='pending')::int AS pending,
    count(*) FILTER (WHERE status='confirmed')::int AS confirmed,
    count(*) FILTER (WHERE status='dismissed')::int AS dismissed,
    max(author_name) AS last_known_name
    FROM moderation_cases WHERE discord_user_id=$1`,[userId]);
  return {user_id:userId,summary:summary.rows[0],cases:cases.rows};
}
