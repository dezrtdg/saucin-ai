import crypto from 'node:crypto';
import OpenAI from 'openai';
import { db } from '../db.js';
import { env } from '../env.js';

export type IssueQueryPlan = {
  original: string;
  normalizedQuestion?: string;
  topic?: string;
  searchTerms?: string[];
  relatedTopics?: string[];
};

export type IssueMatch = {
  id: number;
  public_id: string | null;
  title: string;
  description: string;
  status: string;
  severity: string;
  public_response: string | null;
  workaround: string | null;
  resource_name: string | null;
  aliases: string[];
  symptoms: string[];
  log_patterns: string[];
  report_count: number;
  score: number;
  match_types: string[];
};

const client = env.OPENAI_API_KEY ? new OpenAI({ apiKey: env.OPENAI_API_KEY }) : null;

function unique(values: string[], max = 30) {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))].slice(0, max);
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\s/_-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1000);
}

function issueText(row: any) {
  return [
    row.title,
    row.description,
    row.category,
    row.resource_name,
    ...(row.aliases || []),
    ...(row.symptoms || []),
    ...(row.log_patterns || [])
  ].filter(Boolean).join('\n');
}

async function createEmbedding(input: string): Promise<number[] | null> {
  if (!client || !env.AI_ENABLED || !input.trim()) return null;
  try {
    const response = await client.embeddings.create({
      model: env.AI_EMBEDDING_MODEL,
      input: input.slice(0, 16000),
      encoding_format: 'float'
    });
    return response.data[0]?.embedding ?? null;
  } catch (error) {
    console.error('[issues] embedding request failed', error);
    return null;
  }
}

export async function refreshIssueEmbedding(issueId: number): Promise<boolean> {
  const result = await db.query(
    `SELECT id,title,description,category,resource_name,aliases,symptoms,log_patterns FROM issues WHERE id=$1`,
    [issueId]
  );
  if (!result.rowCount) return false;
  const embedding = await createEmbedding(issueText(result.rows[0]));
  if (!embedding) return false;
  await db.query('UPDATE issues SET embedding=$1::vector, embedding_updated_at=NOW() WHERE id=$2', [JSON.stringify(embedding), issueId]);
  return true;
}

export async function backfillIssueEmbeddings(limit = 200): Promise<number> {
  if (!client || !env.AI_ENABLED) return 0;
  const result = await db.query(
    `SELECT id,title,description,category,resource_name,aliases,symptoms,log_patterns
       FROM issues WHERE embedding IS NULL ORDER BY updated_at DESC LIMIT $1`,
    [limit]
  );
  let indexed = 0;
  for (const row of result.rows) {
    if (await refreshIssueEmbedding(Number(row.id))) indexed += 1;
  }
  if (indexed) console.log(`[issues] indexed ${indexed} issue embedding(s)`);
  return indexed;
}

function planText(plan: IssueQueryPlan) {
  return unique([
    plan.original,
    plan.normalizedQuestion || '',
    plan.topic || '',
    ...(plan.searchTerms || []),
    ...(plan.relatedTopics || [])
  ]).join(' ');
}

export async function findKnownIssue(plan: IssueQueryPlan): Promise<IssueMatch | null> {
  const expanded = planText(plan);
  const queryEmbedding = await createEmbedding(expanded);
  const params: unknown[] = [expanded, plan.original];
  let semanticSelect = 'NULL::float AS semantic_score';
  if (queryEmbedding) {
    params.push(JSON.stringify(queryEmbedding));
    semanticSelect = `CASE WHEN embedding IS NULL THEN NULL ELSE GREATEST(-1.0, LEAST(1.0, 1 - (embedding <=> $3::vector))) END::float AS semantic_score`;
  }

  const result = await db.query(
    `SELECT id,public_id,title,description,status,severity,public_response,workaround,resource_name,
            aliases,symptoms,log_patterns,report_count,last_seen,
            ts_rank_cd(
              setweight(to_tsvector('english', coalesce(title,'')), 'A') ||
              setweight(to_tsvector('english', coalesce(description,'')), 'B') ||
              setweight(to_tsvector('english', coalesce(array_to_string(aliases,' '),'')), 'A') ||
              setweight(to_tsvector('english', coalesce(array_to_string(symptoms,' '),'')), 'A') ||
              setweight(to_tsvector('english', coalesce(resource_name,'')), 'A'),
              websearch_to_tsquery('english', $1)
            )::float AS lexical_rank,
            GREATEST(
              similarity(lower(coalesce(title,'')), lower($2)),
              similarity(lower(coalesce(array_to_string(aliases,' '),'')), lower($2)),
              similarity(lower(coalesce(array_to_string(symptoms,' '),'')), lower($2)),
              similarity(lower(coalesce(description,'')), lower($2))
            )::float AS fuzzy_rank,
            ${semanticSelect}
       FROM issues
      WHERE status <> 'wont_fix'
      ORDER BY last_seen DESC
      LIMIT 400`,
    params
  );

  const terms = unique([...(plan.searchTerms || []), ...(plan.relatedTopics || [])]).map(term => term.toLowerCase());
  const scored = result.rows.map(row => {
    const semantic = row.semantic_score == null ? 0 : Math.max(0, Math.min(1, Number(row.semantic_score)));
    const lexical = Math.min(1, Number(row.lexical_rank || 0) * 3.5);
    const fuzzy = Math.max(0, Number(row.fuzzy_rank || 0));
    const haystack = issueText(row).toLowerCase();
    const hits = terms.filter(term => term.length > 2 && haystack.includes(term)).length;
    const coverage = terms.length ? Math.min(1, hits / Math.min(8, terms.length)) : 0;
    const statusWeight = row.status === 'resolved' ? 0.82 : 1;
    const score = (queryEmbedding
      ? semantic * 0.56 + lexical * 0.24 + fuzzy * 0.10 + coverage * 0.10
      : lexical * 0.58 + fuzzy * 0.20 + coverage * 0.22) * statusWeight;
    const matchTypes: string[] = [];
    if (semantic >= 0.58) matchTypes.push('semantic');
    if (lexical > 0) matchTypes.push('keyword');
    if (fuzzy >= 0.18) matchTypes.push('fuzzy');
    if (coverage > 0) matchTypes.push('concept');
    return { row, score, matchTypes };
  }).sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || (best.score < (queryEmbedding ? 0.26 : 0.10) && !best.matchTypes.includes('keyword'))) return null;
  const row = best.row;
  return {
    id: Number(row.id), public_id: row.public_id, title: row.title, description: row.description,
    status: row.status, severity: row.severity, public_response: row.public_response,
    workaround: row.workaround, resource_name: row.resource_name,
    aliases: row.aliases || [], symptoms: row.symptoms || [], log_patterns: row.log_patterns || [],
    report_count: Number(row.report_count || 0), score: best.score, match_types: best.matchTypes
  };
}

export async function addIssueReport(issueId: number, discordMessageId: number | null, discordUserId: string, reportText: string, source = 'discord') {
  const clientDb = await db.connect();
  try {
    await clientDb.query('BEGIN');
    const existing = await clientDb.query(
      'SELECT 1 FROM issue_reports WHERE issue_id=$1 AND discord_user_id=$2 LIMIT 1',
      [issueId, discordUserId]
    );
    if (existing.rowCount) {
      await clientDb.query('UPDATE issues SET last_seen=NOW(), updated_at=NOW() WHERE id=$1', [issueId]);
      await clientDb.query('COMMIT');
      return false;
    }
    await clientDb.query(
      `INSERT INTO issue_reports (issue_id, discord_message_id, discord_user_id, report_text, source)
       VALUES ($1,$2,$3,$4,$5)`,
      [issueId, discordMessageId, discordUserId, reportText, source]
    );
    await clientDb.query(
      `UPDATE issues SET report_count=report_count+1,last_seen=NOW(),updated_at=NOW() WHERE id=$1`,
      [issueId]
    );
    await clientDb.query('COMMIT');
    return true;
  } catch (error) {
    await clientDb.query('ROLLBACK');
    throw error;
  } finally {
    clientDb.release();
  }
}

export async function getIssue(issueId: number) {
  const result = await db.query('SELECT * FROM issues WHERE id=$1', [issueId]);
  return result.rows[0] ?? null;
}

async function saveCandidateEvent(candidateId: number, input: {
  text: string;
  discordUserId?: string;
  discordMessageId?: number | null;
}) {
  await db.query(
    `INSERT INTO issue_candidate_events (candidate_id,discord_message_id,discord_user_id,report_text)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (candidate_id,discord_message_id) WHERE discord_message_id IS NOT NULL DO NOTHING`,
    [candidateId, input.discordMessageId ?? null, input.discordUserId || null, input.text]
  );
}

export async function recordIssueCandidate(input: {
  text: string;
  normalizedText?: string;
  topic?: string;
  relatedTerms?: string[];
  discordUserId?: string;
  channelId?: string;
  discordMessageId?: number | null;
}) {
  const normalized = normalize(input.normalizedText || input.text) || normalize(input.text);
  const topic = String(input.topic || '').trim().slice(0, 160) || null;
  const similar = await db.query(
    `SELECT id FROM issue_candidates
      WHERE status IN ('detected','reported')
        AND (
          similarity(normalized_text,$1) >= 0.52
          OR ($2::text IS NOT NULL AND topic=$2 AND similarity(normalized_text,$1) >= 0.30)
        )
      ORDER BY similarity(normalized_text,$1) DESC,last_seen DESC LIMIT 1`,
    [normalized, topic]
  );
  if (similar.rowCount) {
    const candidateId = Number(similar.rows[0].id);
    const updated = await db.query(
      `UPDATE issue_candidates SET sample_text=$1,occurrence_count=occurrence_count+1,last_seen=NOW(),updated_at=NOW(),
              related_terms=ARRAY(SELECT DISTINCT term FROM unnest(issue_candidates.related_terms || $2::text[]) AS t(term))
        WHERE id=$3 RETURNING *`,
      [input.text, unique(input.relatedTerms || []), candidateId]
    );
    await saveCandidateEvent(candidateId, input).catch(error => console.error('[issues] failed to save candidate evidence', error));
    return updated.rows[0];
  }

  const fingerprint = crypto.createHash('sha256').update(normalized).digest('hex');
  const result = await db.query(
    `INSERT INTO issue_candidates
       (fingerprint,sample_text,normalized_text,topic,related_terms,discord_user_id,channel_id,discord_message_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (fingerprint) DO UPDATE SET
       sample_text=EXCLUDED.sample_text,occurrence_count=issue_candidates.occurrence_count+1,last_seen=NOW(),updated_at=NOW()
     RETURNING *`,
    [fingerprint, input.text, normalized, topic, unique(input.relatedTerms || []), input.discordUserId || null,
     input.channelId || null, input.discordMessageId ?? null]
  );
  const candidateId = Number(result.rows[0].id);
  await saveCandidateEvent(candidateId, input).catch(error => console.error('[issues] failed to save candidate evidence', error));
  return result.rows[0];
}

export async function confirmIssueCandidate(candidateId: number, discordUserId: string, confirmationType = 'report') {
  const clientDb = await db.connect();
  try {
    await clientDb.query('BEGIN');
    const inserted = await clientDb.query(
      `INSERT INTO issue_candidate_confirmations (candidate_id,discord_user_id,confirmation_type)
       VALUES ($1,$2,$3) ON CONFLICT (candidate_id,discord_user_id) DO NOTHING RETURNING candidate_id`,
      [candidateId, discordUserId, confirmationType]
    );
    if (inserted.rowCount) {
      await clientDb.query(
        `UPDATE issue_candidates SET confirmed_count=confirmed_count+1,status='reported',last_seen=NOW(),updated_at=NOW() WHERE id=$1`,
        [candidateId]
      );
    }
    const current = await clientDb.query('SELECT * FROM issue_candidates WHERE id=$1', [candidateId]);
    await clientDb.query('COMMIT');
    return { inserted: Boolean(inserted.rowCount), candidate: current.rows[0] ?? null };
  } catch (error) {
    await clientDb.query('ROLLBACK');
    throw error;
  } finally {
    clientDb.release();
  }
}

export async function dismissIssueCandidate(candidateId:number,discordUserId:string){
  const candidate=await db.query('SELECT * FROM issue_candidates WHERE id=$1',[candidateId]);
  if(!candidate.rowCount) return null;
  const row=candidate.rows[0];
  await db.query(`
    INSERT INTO issue_candidate_confirmations (candidate_id,discord_user_id,confirmation_type)
    VALUES ($1,$2,'ignored') ON CONFLICT (candidate_id,discord_user_id) DO NOTHING`,[candidateId,discordUserId]);
  if(String(row.discord_user_id||'')===discordUserId&&Number(row.confirmed_count||0)===0&&Number(row.occurrence_count||1)<=1){
    const dismissed=await db.query(`UPDATE issue_candidates SET status='dismissed',updated_at=NOW() WHERE id=$1 RETURNING *`,[candidateId]);
    return dismissed.rows[0]||row;
  }
  return row;
}

export async function promoteConfirmedIssueCandidate(candidateId:number){
  const initial=await db.query('SELECT * FROM issue_candidates WHERE id=$1',[candidateId]);
  if(!initial.rowCount) return null;
  if(initial.rows[0].matched_issue_id) return getIssue(Number(initial.rows[0].matched_issue_id));

  const categories=await db.query('SELECT key,label,description FROM issue_categories WHERE enabled=TRUE ORDER BY sort_order,label');
  const categoryKeys=categories.rows.map(row=>String(row.key));
  const fallbackCategory=categoryKeys.includes('general')?'general':categoryKeys[0]||'general';
  const sourceText=String(initial.rows[0].sample_text||'').trim();
  let draft:IssueDraftSuggestion={
    title:String(initial.rows[0].topic||sourceText||'Player-reported issue').replace(/\s+/g,' ').slice(0,200),
    description:sourceText.slice(0,12000),category:fallbackCategory,resource_name:'',severity:'medium',
    aliases:unique(initial.rows[0].related_terms||[],100),symptoms:sourceText?[sourceText.slice(0,400)]:[],
    log_patterns:[],workaround:'',staff_notes:'',authoring_note:'AI organization was unavailable; staff should review this automatically created issue.'
  };
  try{
    draft=await buildIssueDraft({sourceText,categories:categories.rows,categoryHint:fallbackCategory});
  }catch(error){
    console.warn('[issues] AI issue promotion fallback used',error);
  }

  const clientDb=await db.connect();
  let issueId:number;
  try{
    await clientDb.query('BEGIN');
    const locked=await clientDb.query('SELECT * FROM issue_candidates WHERE id=$1 FOR UPDATE',[candidateId]);
    if(!locked.rowCount){await clientDb.query('ROLLBACK');return null;}
    if(locked.rows[0].matched_issue_id){
      issueId=Number(locked.rows[0].matched_issue_id);
      await clientDb.query('COMMIT');
      return getIssue(issueId);
    }
    const created=await clientDb.query(`
      INSERT INTO issues
        (title,description,category,resource_name,severity,status,staff_notes,aliases,symptoms,log_patterns,report_count,first_seen,last_seen)
      VALUES ($1,$2,$3,$4,$5,'new',$6,$7,$8,$9,0,$10,$11) RETURNING id`,[
      draft.title,draft.description,draft.category,draft.resource_name||null,draft.severity,
      [draft.staff_notes,draft.authoring_note].filter(Boolean).join('\n\n')||null,
      draft.aliases,draft.symptoms,draft.log_patterns,locked.rows[0].first_seen,locked.rows[0].last_seen
    ]);
    issueId=Number(created.rows[0].id);
    await clientDb.query('UPDATE issues SET public_id=$1 WHERE id=$2',[`BUG-${String(issueId).padStart(4,'0')}`,issueId]);
    await clientDb.query(`UPDATE issue_candidates SET status='promoted',matched_issue_id=$1,updated_at=NOW() WHERE id=$2`,[issueId,candidateId]);
    await clientDb.query('COMMIT');
  }catch(error){
    await clientDb.query('ROLLBACK');
    throw error;
  }finally{clientDb.release();}
  const linked=await linkCandidateToIssue(candidateId,issueId);
  return linked.issue;
}

export async function linkCandidateToIssue(candidateId: number, issueId: number) {
  const clientDb = await db.connect();
  let insertedReports = 0;
  try {
    await clientDb.query('BEGIN');
    const candidateResult = await clientDb.query('SELECT * FROM issue_candidates WHERE id=$1 FOR UPDATE', [candidateId]);
    if (!candidateResult.rowCount) throw new Error('issue candidate not found');
    const candidate = candidateResult.rows[0];
    const issueResult = await clientDb.query('SELECT * FROM issues WHERE id=$1 FOR UPDATE', [issueId]);
    if (!issueResult.rowCount) throw new Error('issue not found');
    if (candidate.matched_issue_id && Number(candidate.matched_issue_id) !== issueId) throw new Error('candidate is already linked to another issue');

    const evidence = await clientDb.query(
      `SELECT DISTINCT ON (coalesce(e.discord_user_id,'')) e.discord_user_id,e.discord_message_id,e.report_text,e.created_at
         FROM issue_candidate_events e
        WHERE e.candidate_id=$1
        ORDER BY coalesce(e.discord_user_id,''),e.created_at DESC`,
      [candidateId]
    );

    const confirmations = await clientDb.query(
      `SELECT discord_user_id,confirmation_type,created_at FROM issue_candidate_confirmations WHERE candidate_id=$1`,
      [candidateId]
    );

    const reportInputs = new Map<string, { discordUserId: string; messageId: number | null; text: string; source: string }>();
    for (const row of evidence.rows) {
      if (!row.discord_user_id) continue;
      reportInputs.set(String(row.discord_user_id), {
        discordUserId: String(row.discord_user_id),
        messageId: row.discord_message_id == null ? null : Number(row.discord_message_id),
        text: String(row.report_text || candidate.sample_text),
        source: 'candidate_cluster'
      });
    }
    for (const row of confirmations.rows) {
      const userId = String(row.discord_user_id);
      if (!reportInputs.has(userId)) {
        reportInputs.set(userId, {
          discordUserId: userId,
          messageId: null,
          text: 'Confirmed this issue via the Discord report button.',
          source: 'candidate_confirmation'
        });
      }
    }
    if (candidate.discord_user_id && !reportInputs.has(String(candidate.discord_user_id))) {
      reportInputs.set(String(candidate.discord_user_id), {
        discordUserId: String(candidate.discord_user_id),
        messageId: candidate.discord_message_id == null ? null : Number(candidate.discord_message_id),
        text: String(candidate.sample_text),
        source: 'candidate_origin'
      });
    }

    for (const input of reportInputs.values()) {
      const inserted = await clientDb.query(
        `INSERT INTO issue_reports (issue_id,discord_message_id,discord_user_id,report_text,source)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (issue_id,discord_user_id) WHERE discord_user_id IS NOT NULL DO NOTHING
         RETURNING id`,
        [issueId, input.messageId, input.discordUserId, input.text, input.source]
      );
      insertedReports += inserted.rowCount || 0;
    }

    const mergeAliases = unique([
      ...(issueResult.rows[0].aliases || []),
      ...(candidate.related_terms || []),
      candidate.topic || ''
    ], 100);
    const mergeSymptoms = unique([
      ...(issueResult.rows[0].symptoms || []),
      candidate.sample_text || ''
    ], 150);

    await clientDb.query(
      `UPDATE issues SET aliases=$1,symptoms=$2,report_count=report_count+$3,
             first_seen=LEAST(first_seen,$4),last_seen=GREATEST(last_seen,$5),embedding=NULL,embedding_updated_at=NULL,updated_at=NOW()
       WHERE id=$6`,
      [mergeAliases, mergeSymptoms, insertedReports, candidate.first_seen, candidate.last_seen, issueId]
    );
    await clientDb.query(
      `UPDATE issue_candidates SET status='promoted',matched_issue_id=$1,updated_at=NOW() WHERE id=$2`,
      [issueId, candidateId]
    );
    await clientDb.query(
      `UPDATE service_events SET matched_issue_id=$1 WHERE source='txadmin' AND issue_candidate_id=$2`,
      [issueId, candidateId]
    );
    await clientDb.query(
      `INSERT INTO issue_updates (issue_id,update_type,from_value,to_value,note,created_by)
       VALUES ($1,'candidate_link',NULL,$2,$3,'dashboard')`,
      [issueId, String(candidateId), `Linked incoming candidate #${candidateId}; transferred ${insertedReports} unique report(s).`]
    );
    await clientDb.query('COMMIT');
  } catch (error) {
    await clientDb.query('ROLLBACK');
    throw error;
  } finally {
    clientDb.release();
  }

  await refreshIssueEmbedding(issueId).catch(error => console.error('[issues] linked issue embedding refresh failed', error));
  const issue = await getIssue(issueId);
  return { issue, insertedReports };
}

export type IssueAutomationSettings = {
  intake_channel_id: string | null;
  auto_create_threads: boolean;
  allow_player_details: boolean;
  auto_summarize_thread: boolean;
  auto_update_symptoms: boolean;
  auto_collect_workarounds: boolean;
  auto_collect_reproduction: boolean;
  auto_collect_locations: boolean;
  edit_original_status_message: boolean;
  post_status_updates_to_thread: boolean;
  auto_public_response: boolean;
  include_bug_id: boolean;
  include_workaround: boolean;
  include_affected_count: boolean;
};

export async function getIssueAutomationSettings(): Promise<IssueAutomationSettings> {
  const result = await db.query('SELECT * FROM issue_automation_settings WHERE id=1');
  const row = result.rows[0] || {};
  return {
    intake_channel_id: row.intake_channel_id ? String(row.intake_channel_id) : null,
    auto_create_threads: row.auto_create_threads !== false,
    allow_player_details: row.allow_player_details !== false,
    auto_summarize_thread: row.auto_summarize_thread !== false,
    auto_update_symptoms: row.auto_update_symptoms !== false,
    auto_collect_workarounds: row.auto_collect_workarounds !== false,
    auto_collect_reproduction: row.auto_collect_reproduction !== false,
    auto_collect_locations: row.auto_collect_locations !== false,
    edit_original_status_message: row.edit_original_status_message !== false,
    post_status_updates_to_thread: row.post_status_updates_to_thread !== false,
    auto_public_response: row.auto_public_response !== false,
    include_bug_id: row.include_bug_id !== false,
    include_workaround: row.include_workaround !== false,
    include_affected_count: row.include_affected_count === true
  };
}

function replaceTemplate(template: string, issue: any) {
  const values: Record<string,string> = {
    bug_id: String(issue.public_id || `BUG-${issue.id}`),
    title: String(issue.title || 'server issue'),
    description: String(issue.description || ''),
    status: String(issue.status || 'new').replaceAll('_', ' '),
    workaround: String(issue.workaround || ''),
    affected_count: String(issue.report_count || 0),
    resource: String(issue.resource_name || '')
  };
  return template.replace(/\{\{([a-z_]+)\}\}/gi, (_match, key: string) => values[key] ?? '').replace(/\n{3,}/g, '\n\n').trim();
}

export async function getIssuePublicMessage(issueOrId: any): Promise<string> {
  const issue = typeof issueOrId === 'number' ? await getIssue(issueOrId) : issueOrId;
  if (!issue) return 'This issue is no longer available.';
  const settings = await getIssueAutomationSettings();
  let body = String(issue.public_response || '').trim();
  if (!body && settings.auto_public_response) {
    const template = await db.query('SELECT template,enabled FROM issue_status_templates WHERE status=$1', [issue.status]);
    if (template.rowCount && template.rows[0].enabled) body = replaceTemplate(String(template.rows[0].template), issue);
  }
  if (!body) body = `We are tracking **${issue.title}**.`;

  const lines = [body];
  const metadata: string[] = [];
  if (settings.include_bug_id) metadata.push(`**${issue.public_id || `BUG-${issue.id}`}**`);
  metadata.push(`Status: **${String(issue.status).replaceAll('_',' ')}**`);
  if (settings.include_affected_count) metadata.push(`Affected: **${Number(issue.report_count || 0)}**`);
  if (metadata.length) lines.push(metadata.join(' · '));
  if (settings.include_workaround && issue.workaround) lines.push(`**Verified workaround:** ${issue.workaround}`);
  return lines.join('\n\n').trim();
}

type ThreadInsight = {
  summary: string;
  symptoms: string[];
  workarounds: string[];
  reproduction_steps: string[];
  locations: string[];
  clues: string[];
};

function cleanInsightValues(value: unknown, max: number, itemMax = 500) {
  if (!Array.isArray(value)) return [];
  return unique(value.map(item => String(item).replace(/\s+/g,' ').trim().slice(0,itemMax)), max);
}

async function extractThreadInsight(issue: any, content: string): Promise<ThreadInsight> {
  const empty: ThreadInsight = { summary: '', symptoms: [], workarounds: [], reproduction_steps: [], locations: [], clues: [] };
  if (!client || !env.AI_ENABLED) return empty;
  try {
    const response = await client.responses.create({
      model: env.AI_CLASSIFIER_MODEL,
      reasoning: { effort: 'low' },
      instructions: `You organize player-provided evidence for a FiveM server bug ticket. Return ONLY compact JSON with keys summary, symptoms, workarounds, reproduction_steps, locations, clues. Extract only facts or claims actually stated or strongly implied in the player's message. Do not invent causes, fixes, rules, resources, or reproduction steps. A workaround is something the player says made the problem better or avoided it; it is COMMUNITY-REPORTED, not verified. summary should be a concise UPDATED overall community summary (maximum 3 short sentences) that combines the existing community summary with any useful new evidence from this message. If the new message adds nothing useful, return the existing summary unchanged. Each array must contain concise standalone phrases and no duplicates.`,
      input: `KNOWN ISSUE:\n${issue.public_id || issue.id} ${issue.title}\nDescription: ${issue.description || ''}\nExisting community summary: ${issue.community_summary || ''}\n\nPLAYER MESSAGE:\n${content.slice(0,5000)}`,
      max_output_tokens: 500
    });
    const jsonText = response.output_text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
    const parsed = JSON.parse(jsonText) as Partial<ThreadInsight>;
    return {
      summary: String(parsed.summary || '').replace(/\s+/g,' ').trim().slice(0,900),
      symptoms: cleanInsightValues(parsed.symptoms, 12),
      workarounds: cleanInsightValues(parsed.workarounds, 10),
      reproduction_steps: cleanInsightValues(parsed.reproduction_steps, 12),
      locations: cleanInsightValues(parsed.locations, 10, 200),
      clues: cleanInsightValues(parsed.clues, 12)
    };
  } catch (error) {
    console.error('[issues] thread insight extraction failed', error);
    return empty;
  }
}

async function recordObservation(issueId: number, kind: 'symptom'|'workaround'|'reproduction'|'location'|'clue', value: string, userId?: string) {
  const normalizedValue = normalize(value).slice(0,700);
  if (!normalizedValue) return;
  const result = await db.query(
    `INSERT INTO issue_observations (issue_id,kind,value,normalized_value,confirmations)
     VALUES ($1,$2,$3,$4,0)
     ON CONFLICT (issue_id,kind,normalized_value) DO UPDATE SET value=EXCLUDED.value,last_seen=NOW(),updated_at=NOW()
     RETURNING id`,
    [issueId,kind,value.slice(0,1200),normalizedValue]
  );
  const observationId = Number(result.rows[0].id);
  if (userId) {
    const confirmation = await db.query(
      `INSERT INTO issue_observation_confirmations (observation_id,discord_user_id) VALUES ($1,$2)
       ON CONFLICT DO NOTHING RETURNING observation_id`,
      [observationId,userId]
    );
    if (confirmation.rowCount) await db.query('UPDATE issue_observations SET confirmations=confirmations+1,updated_at=NOW() WHERE id=$1',[observationId]);
  }
}

export async function processIssueThreadMessage(input: {
  issueId: number;
  discordMessageDbId: number | null;
  discordUserId: string;
  authorName?: string;
  content: string;
}) {
  const issue = await getIssue(input.issueId);
  if (!issue) return null;
  const settings = await getIssueAutomationSettings();
  if (!settings.allow_player_details) return { issue, insight: null };

  const insight = await extractThreadInsight(issue, input.content);
  const inserted = await db.query(
    `INSERT INTO issue_thread_entries (issue_id,discord_message_id,discord_user_id,author_name,content,extracted)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (discord_message_id) WHERE discord_message_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [input.issueId,input.discordMessageDbId,input.discordUserId,input.authorName || null,input.content,JSON.stringify(insight)]
  );
  if (!inserted.rowCount && input.discordMessageDbId) return { issue, insight };

  if (settings.auto_update_symptoms) for (const value of insight.symptoms) await recordObservation(input.issueId,'symptom',value,input.discordUserId);
  if (settings.auto_collect_workarounds) for (const value of insight.workarounds) await recordObservation(input.issueId,'workaround',value,input.discordUserId);
  if (settings.auto_collect_reproduction) for (const value of insight.reproduction_steps) await recordObservation(input.issueId,'reproduction',value,input.discordUserId);
  if (settings.auto_collect_locations) for (const value of insight.locations) await recordObservation(input.issueId,'location',value,input.discordUserId);
  for (const value of insight.clues) await recordObservation(input.issueId,'clue',value,input.discordUserId);

  const nextSymptoms = settings.auto_update_symptoms ? unique([...(issue.symptoms || []), ...insight.symptoms], 150) : (issue.symptoms || []);
  const nextReproduction = settings.auto_collect_reproduction ? unique([...(issue.reproduction_steps || []), ...insight.reproduction_steps], 100) : (issue.reproduction_steps || []);
  const nextLocations = settings.auto_collect_locations ? unique([...(issue.reported_locations || []), ...insight.locations], 100) : (issue.reported_locations || []);
  const nextSummary = settings.auto_summarize_thread && insight.summary
    ? insight.summary.slice(0,4000)
    : issue.community_summary;

  await db.query(
    `UPDATE issues SET symptoms=$1,reproduction_steps=$2,reported_locations=$3,community_summary=$4,
            thread_last_activity_at=NOW(),thread_summary_updated_at=CASE WHEN $5::boolean THEN NOW() ELSE thread_summary_updated_at END,
            embedding=NULL,embedding_updated_at=NULL,updated_at=NOW()
      WHERE id=$6`,
    [nextSymptoms,nextReproduction,nextLocations,nextSummary,Boolean(settings.auto_summarize_thread && insight.summary),input.issueId]
  );
  if (insight.symptoms.length || insight.reproduction_steps.length || insight.locations.length) {
    await refreshIssueEmbedding(input.issueId).catch(error => console.error('[issues] thread embedding refresh failed', error));
  }
  return { issue: await getIssue(input.issueId), insight };
}

export async function setIssueObservationStatus(issueId: number, observationId: number, status: 'community'|'verified'|'rejected') {
  const result = await db.query(
    `UPDATE issue_observations SET status=$1,updated_at=NOW() WHERE id=$2 AND issue_id=$3 RETURNING *`,
    [status,observationId,issueId]
  );
  if (!result.rowCount) return null;
  const row = result.rows[0];
  if (status === 'verified' && row.kind === 'workaround') {
    const issue = await getIssue(issueId);
    const existing = String(issue?.workaround || '').trim();
    const value = String(row.value).trim();
    if (!existing.toLowerCase().includes(value.toLowerCase())) {
      await db.query('UPDATE issues SET workaround=$1,updated_at=NOW() WHERE id=$2', [existing ? `${existing}\n${value}` : value, issueId]);
    }
  }
  return row;
}


export type IssueDraftSuggestion = {
  title: string;
  description: string;
  category: string;
  resource_name: string;
  severity: 'low'|'medium'|'high'|'critical';
  aliases: string[];
  symptoms: string[];
  log_patterns: string[];
  workaround: string;
  staff_notes: string;
  authoring_note: string;
};

function issueDraftList(values: unknown, max: number, itemMax: number) {
  if (!Array.isArray(values)) return [];
  return unique(values.map(value => String(value).replace(/\s+/g, ' ').trim().slice(0, itemMax)).filter(Boolean), max);
}

export async function buildIssueDraft(input: {
  sourceText: string;
  categories: Array<{key:string;label:string;description?:string|null}>;
  categoryHint?: string;
  resourceHint?: string;
  severityHint?: string;
}): Promise<IssueDraftSuggestion> {
  const sourceText = String(input.sourceText || '').trim();
  if (sourceText.length < 8) throw new Error('Provide more issue information before asking AI to build the known issue.');
  if (!client || !env.AI_ENABLED) throw new Error('AI issue authoring is unavailable because AI is disabled or no OpenAI API key is configured.');

  const categoryKeys = input.categories.map(row => row.key);
  const fallbackCategory = categoryKeys.includes(input.categoryHint || '') ? String(input.categoryHint) : (categoryKeys.includes('general') ? 'general' : (categoryKeys[0] || 'general'));
  const severities = ['low','medium','high','critical'];
  const fallbackSeverity = severities.includes(String(input.severityHint || '')) ? String(input.severityHint) : 'medium';

  const response = await client.responses.create({
    model: env.AI_REPLY_MODEL,
    reasoning: { effort: 'low' },
    instructions: `You are an issue-triage editorial assistant for ${env.SERVER_NAME}. Build a structured KNOWN ISSUE from staff-supplied evidence. Return ONLY compact JSON with keys: title, description, category, resource_name, severity, aliases, symptoms, log_patterns, workaround, staff_notes, authoring_note.

ACCURACY / SAFETY RULES:
- The supplied source text is the ONLY authority for factual claims about this issue.
- Do NOT invent a root cause, affected resource/script, fix, workaround, reproduction step, log error, affected location, or scope that is not supported by the source.
- resource_name must be empty unless a resource/script name is explicitly supplied or the resource hint names it.
- workaround must be empty unless STAFF explicitly identifies a workaround as verified/confirmed. A player saying something worked for them is community evidence, not a verified workaround.
- log_patterns may contain only actual error/log text or unmistakable patterns provided in the source. Never fabricate log lines.
- description should neutrally summarize what is known, including uncertainty where necessary.
- aliases MAY broadly expand realistic ways players might describe the SAME observed problem. Aliases are retrieval helpers and do not become factual claims.
- symptoms may normalize observed player-facing symptoms that are actually present in the source.
- severity may be inferred conservatively from the impact described. If impact is unclear, use the supplied hint or medium.
- Select exactly one category from the allowed category keys.
- authoring_note is a short staff-facing review note calling out uncertainties or missing information; empty string if none.
- staff_notes may preserve concise internal clues from the supplied source, but must not state speculation as fact.

ALLOWED CATEGORIES:
${input.categories.map(row => `${row.key}: ${row.label}${row.description ? ` — ${row.description}` : ''}`).join('\n')}

ALLOWED SEVERITIES:
low, medium, high, critical`,
    input: [
      input.categoryHint ? `CATEGORY HINT: ${input.categoryHint}` : '',
      input.resourceHint ? `RESOURCE HINT: ${input.resourceHint}` : '',
      input.severityHint ? `SEVERITY HINT: ${input.severityHint}` : '',
      `STAFF-SUPPLIED ISSUE EVIDENCE:\n${sourceText.slice(0,18000)}`
    ].filter(Boolean).join('\n\n'),
    max_output_tokens: 1600
  });

  const jsonText = response.output_text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let parsed: any;
  try { parsed = JSON.parse(jsonText); } catch { throw new Error('AI issue authoring returned an invalid structured response. Try again.'); }

  const category = categoryKeys.includes(String(parsed.category || '')) ? String(parsed.category) : fallbackCategory;
  const severity = severities.includes(String(parsed.severity || '')) ? String(parsed.severity) : fallbackSeverity;
  const sourceNormalized = normalize(sourceText);
  const generatedResource = String(parsed.resource_name || '').replace(/\s+/g,' ').trim().slice(0,160);
  const hintedResource = String(input.resourceHint || '').replace(/\s+/g,' ').trim().slice(0,160);
  const resourceName = hintedResource || (generatedResource && sourceNormalized.includes(normalize(generatedResource)) ? generatedResource : '');
  const verificationLanguage = /\b(staff|admin|developer|dev|confirmed|verified|official)\b[\s\S]{0,80}\b(workaround|temporary fix|fix)\b|\b(workaround|temporary fix)\b[\s\S]{0,80}\b(confirmed|verified|official|staff)\b/i.test(sourceText);
  const generatedLogs = issueDraftList(parsed.log_patterns,150,500).filter(pattern => {
    const normalizedPattern = normalize(pattern);
    return normalizedPattern.length >= 4 && sourceNormalized.includes(normalizedPattern);
  });
  return {
    title: String(parsed.title || 'Untitled known issue').replace(/\s+/g,' ').trim().slice(0,200),
    description: String(parsed.description || sourceText).trim().slice(0,12000),
    category,
    resource_name: resourceName,
    severity: severity as IssueDraftSuggestion['severity'],
    aliases: issueDraftList(parsed.aliases,100,200),
    symptoms: issueDraftList(parsed.symptoms,150,400),
    log_patterns: generatedLogs,
    workaround: verificationLanguage ? String(parsed.workaround || '').trim().slice(0,4000) : '',
    staff_notes: String(parsed.staff_notes || '').trim().slice(0,12000),
    authoring_note: String(parsed.authoring_note || '').trim().slice(0,2000)
  };
}
