import OpenAI from 'openai';
import { db } from '../db.js';
import { env } from '../env.js';

export type SuggestionQueryPlan = {
  original: string;
  normalizedQuestion?: string;
  topic?: string;
  searchTerms?: string[];
  relatedTopics?: string[];
};

const client = env.OPENAI_API_KEY ? new OpenAI({ apiKey: env.OPENAI_API_KEY }) : null;

export type SuggestionAutomationSettings = {
  forum_channel_id: string | null;
  forum_tag_id: string | null;
  auto_create_forum_posts: boolean;
  collect_thread_details: boolean;
  ai_summarize_thread: boolean;
  edit_original_status_message: boolean;
  post_status_updates_to_thread: boolean;
  include_suggestion_id: boolean;
  include_support_count: boolean;
};

export type SuggestionAiDraft = {
  title: string;
  summary: string;
  category: string;
  related_terms: string[];
  expansion_note: string;
};

function unique(values:string[],max=30){
  return [...new Set(values.map(value=>String(value).trim()).filter(Boolean))].slice(0,max);
}

function normalize(value:string){
  return value.toLowerCase().replace(/[^a-z0-9\s/_-]/g,' ').replace(/\s+/g,' ').trim().slice(0,1000);
}

function suggestionText(row:any){
  return [row.title,row.summary,row.community_context,row.category,...(row.related_terms||[])].filter(Boolean).join('\n');
}

function cleanDraftList(values:unknown,max=30,itemMax=160){
  if(!Array.isArray(values)) return [];
  return unique(values.map(value=>String(value).replace(/\s+/g,' ').trim().slice(0,itemMax)).filter(Boolean),max);
}

export async function buildSuggestionDraft(input:{
  sourceText:string;
  existingTitle?:string;
  existingSummary?:string;
  existingCategory?:string;
  existingRelatedTerms?:string[];
}):Promise<SuggestionAiDraft>{
  const sourceText=String(input.sourceText||'').trim();
  if(sourceText.length<8) throw new Error('Provide more information before asking AI to develop this suggestion.');
  if(!client||!env.AI_ENABLED) throw new Error('AI suggestion authoring is unavailable because AI is disabled or no OpenAI API key is configured.');

  const response=await client.responses.create({
    model:env.AI_REPLY_MODEL,
    reasoning:{effort:'low'},
    instructions:`You are a community-idea editor for ${env.SERVER_NAME}. Turn the supplied player or staff idea into a clear, practical suggestion draft. Return ONLY compact JSON with keys: title, summary, category, related_terms, expansion_note.

GROUNDING RULES:
- The supplied text and existing draft are the only authority.
- Preserve the original intent. Do not add promised features, technical claims, costs, dates, staff decisions, or requirements that were not supplied.
- You may organize implications and useful discussion questions, but label uncertainty naturally instead of inventing facts.
- summary should explain the idea, why the submitter appears to want it, useful examples already provided, and open details staff/community may want to discuss.
- title must be concise and specific.
- category must be a short lowercase dashboard label such as gameplay, economy, leo-ems, vehicles, criminal, qol, map, community, or general.
- related_terms are broad retrieval phrases for recognizing differently worded versions of the same idea; they do not become factual claims.
- expansion_note is a short staff-facing note describing what AI clarified and any important information still missing.`,
    input:[
      input.existingTitle?`EXISTING TITLE: ${input.existingTitle}`:'',
      input.existingSummary?`EXISTING SUMMARY:\n${input.existingSummary}`:'',
      input.existingCategory?`EXISTING CATEGORY: ${input.existingCategory}`:'',
      input.existingRelatedTerms?.length?`EXISTING RELATED TERMS: ${input.existingRelatedTerms.join(', ')}`:'',
      `SOURCE MATERIAL:\n${sourceText.slice(0,18000)}`
    ].filter(Boolean).join('\n\n'),
    max_output_tokens:1400
  });

  const jsonText=response.output_text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  let parsed:any;
  try{parsed=JSON.parse(jsonText);}catch{throw new Error('AI suggestion authoring returned an invalid structured response. Try again.');}
  const fallbackTitle=String(input.existingTitle||sourceText).replace(/\s+/g,' ').trim().slice(0,180);
  return {
    title:String(parsed.title||fallbackTitle||'Community suggestion').replace(/\s+/g,' ').trim().slice(0,180),
    summary:String(parsed.summary||input.existingSummary||sourceText).trim().slice(0,6000),
    category:String(parsed.category||input.existingCategory||'general').toLowerCase().replace(/[^a-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,100)||'general',
    related_terms:cleanDraftList(parsed.related_terms,40,160),
    expansion_note:String(parsed.expansion_note||'').trim().slice(0,2000)
  };
}

async function createEmbedding(input:string):Promise<number[]|null>{
  if(!client || !env.AI_ENABLED || !input.trim()) return null;
  try{
    const response=await client.embeddings.create({
      model:env.AI_EMBEDDING_MODEL,
      input:input.slice(0,16000),
      encoding_format:'float'
    });
    return response.data[0]?.embedding??null;
  }catch(error){
    console.error('[suggestions] embedding request failed',error);
    return null;
  }
}

export async function refreshSuggestionEmbedding(suggestionId:number){
  const result=await db.query('SELECT id,title,summary,category,related_terms FROM suggestions WHERE id=$1',[suggestionId]);
  if(!result.rowCount) return false;
  const embedding=await createEmbedding(suggestionText(result.rows[0]));
  if(!embedding) return false;
  await db.query('UPDATE suggestions SET embedding=$1::vector,embedding_updated_at=NOW(),updated_at=NOW() WHERE id=$2',[JSON.stringify(embedding),suggestionId]);
  return true;
}

export async function backfillSuggestionEmbeddings(limit=100){
  if(!client || !env.AI_ENABLED) return 0;
  const result=await db.query('SELECT id FROM suggestions WHERE embedding IS NULL ORDER BY updated_at DESC NULLS LAST,created_at DESC LIMIT $1',[limit]);
  let indexed=0;
  for(const row of result.rows){
    if(await refreshSuggestionEmbedding(Number(row.id))) indexed+=1;
  }
  if(indexed) console.log(`[suggestions] indexed ${indexed} suggestion embedding(s)`);
  return indexed;
}

export async function getSuggestionAutomationSettings():Promise<SuggestionAutomationSettings>{
  const result=await db.query('SELECT * FROM suggestion_automation_settings WHERE id=1');
  const row=result.rows[0]||{};
  return {
    forum_channel_id:row.forum_channel_id?String(row.forum_channel_id):null,
    forum_tag_id:row.forum_tag_id?String(row.forum_tag_id):null,
    auto_create_forum_posts:row.auto_create_forum_posts!==false,
    collect_thread_details:row.collect_thread_details!==false,
    ai_summarize_thread:row.ai_summarize_thread!==false,
    edit_original_status_message:row.edit_original_status_message!==false,
    post_status_updates_to_thread:row.post_status_updates_to_thread!==false,
    include_suggestion_id:row.include_suggestion_id!==false,
    include_support_count:row.include_support_count!==false
  };
}

export async function getSuggestionPublicMessage(suggestionOrId:any):Promise<string>{
  const suggestion=typeof suggestionOrId==='number'?await getSuggestion(suggestionOrId):suggestionOrId;
  if(!suggestion) return '';
  const settings=await getSuggestionAutomationSettings();
  const id=suggestion.public_id||`SUG-${String(suggestion.id).padStart(4,'0')}`;
  const heading=settings.include_suggestion_id?`**${id} · ${suggestion.title}**`:`**${suggestion.title}**`;
  const supporters=Number(suggestion.unique_supporters||suggestion.mention_count||0);
  return [
    heading,
    `**Status:** ${String(suggestion.status||'candidate').replaceAll('_',' ')}`,
    `**Category:** ${String(suggestion.category||'general').replaceAll('_',' ')}`,
    settings.include_support_count?`**Supporters:** ${supporters}`:'',
    '',
    String(suggestion.summary||'').slice(0,1250),
    suggestion.community_context?`\n**Community additions:**\n${String(suggestion.community_context).slice(0,450)}`:'',
    '',
    'Add details, examples, links, screenshots, or questions in this post. Use **I support this idea** to add your support without creating a duplicate.'
  ].filter(line=>line!==null&&line!==undefined).join('\n').slice(0,1950);
}

async function summarizeSuggestionThread(suggestion:any,newContent:string){
  if(!client||!env.AI_ENABLED) return '';
  try{
    const response=await client.responses.create({
      model:env.AI_REPLY_MODEL,
      reasoning:{effort:'low'},
      instructions:`You maintain a concise community-context summary for a FiveM server suggestion. Return plain text only, maximum 650 characters. Use only details actually stated in the existing summary or new message. Preserve useful examples, links, requested behavior, concerns, and open questions. Do not invent implementation details, promises, staff decisions, or facts. Do not repeat the main suggestion unless needed for clarity.`,
      input:`SUGGESTION: ${suggestion.title}\nMAIN SUMMARY: ${suggestion.summary}\nEXISTING COMMUNITY CONTEXT: ${suggestion.community_context||'(none)'}\nNEW FORUM MESSAGE: ${newContent.slice(0,5000)}`,
      max_output_tokens:300
    });
    return response.output_text.trim().slice(0,1000);
  }catch(error){
    console.error('[suggestions] forum summary failed',error);
    return '';
  }
}

export async function processSuggestionThreadMessage(input:{
  suggestionId:number;
  discordMessageDbId:number;
  discordUserId:string;
  authorName:string;
  content:string;
}){
  const settings=await getSuggestionAutomationSettings();
  if(!settings.collect_thread_details) return {processed:false};
  const inserted=await db.query(`
    INSERT INTO suggestion_thread_entries
      (suggestion_id,discord_message_id,discord_user_id,author_name,content)
    VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (discord_message_id) WHERE discord_message_id IS NOT NULL DO NOTHING
    RETURNING id`,[input.suggestionId,input.discordMessageDbId,input.discordUserId,input.authorName,input.content]);
  if(!inserted.rowCount) return {processed:false,duplicate:true};
  await addSuggestionSupport(input.suggestionId,input.discordUserId,{source:'suggestion_forum'}).catch(()=>false);
  await saveEvent(input.suggestionId,{
    discordMessageId:input.discordMessageDbId,
    discordUserId:input.discordUserId,
    text:input.content,
    source:'suggestion_forum'
  });
  const suggestion=await getSuggestion(input.suggestionId);
  const communityContext=settings.ai_summarize_thread&&suggestion
    ? await summarizeSuggestionThread(suggestion,input.content)
    : '';
  await db.query(`
    UPDATE suggestions
       SET community_context=CASE WHEN $1<>'' THEN $1 ELSE community_context END,
           thread_last_activity_at=NOW(),
           thread_summary_updated_at=CASE WHEN $1<>'' THEN NOW() ELSE thread_summary_updated_at END,
           last_seen=NOW(),updated_at=NOW()
     WHERE id=$2`,[communityContext,input.suggestionId]);
  return {processed:true,community_context:communityContext};
}

function planText(plan:SuggestionQueryPlan){
  return unique([
    plan.original,
    plan.normalizedQuestion||'',
    plan.topic||'',
    ...(plan.searchTerms||[]),
    ...(plan.relatedTopics||[])
  ]).join(' ');
}

export async function findMatchingSuggestion(plan:SuggestionQueryPlan){
  const expanded=planText(plan);
  const original=normalize(plan.normalizedQuestion||plan.original)||normalize(plan.original);
  const embedding=await createEmbedding(expanded);
  const params:unknown[]=[expanded,original];
  let semantic='NULL::float AS semantic_score';
  if(embedding){
    params.push(JSON.stringify(embedding));
    semantic=`CASE WHEN embedding IS NULL THEN NULL ELSE GREATEST(-1.0,LEAST(1.0,1-(embedding <=> $3::vector))) END::float AS semantic_score`;
  }
  const result=await db.query(`
    SELECT id,public_id,title,summary,category,status,mention_count,related_terms,last_seen,
           ts_rank_cd(
             setweight(to_tsvector('english',coalesce(title,'')),'A') ||
             setweight(to_tsvector('english',coalesce(summary,'')),'B') ||
             setweight(to_tsvector('english',coalesce(array_to_string(related_terms,' '),'')),'A'),
             websearch_to_tsquery('english',$1)
           )::float AS lexical_rank,
           GREATEST(
             similarity(lower(coalesce(normalized_text,'')),lower($2)),
             similarity(lower(coalesce(title,'')),lower($2)),
             similarity(lower(coalesce(summary,'')),lower($2))
           )::float AS fuzzy_rank,
           ${semantic}
      FROM suggestions
     WHERE status <> 'declined'
     ORDER BY last_seen DESC
     LIMIT 400`,params);

  const terms=unique([...(plan.searchTerms||[]),...(plan.relatedTopics||[])]).map(term=>term.toLowerCase());
  const scored=result.rows.map(row=>{
    const semanticScore=row.semantic_score==null?0:Math.max(0,Math.min(1,Number(row.semantic_score)));
    const lexical=Math.min(1,Number(row.lexical_rank||0)*3.5);
    const fuzzy=Math.max(0,Number(row.fuzzy_rank||0));
    const haystack=suggestionText(row).toLowerCase();
    const hits=terms.filter(term=>term.length>2&&haystack.includes(term)).length;
    const coverage=terms.length?Math.min(1,hits/Math.min(8,terms.length)):0;
    const statusWeight=row.status==='shipped'?0.9:1;
    const score=(embedding
      ? semanticScore*0.58+lexical*0.20+fuzzy*0.14+coverage*0.08
      : lexical*0.52+fuzzy*0.30+coverage*0.18)*statusWeight;
    const matchTypes:string[]=[];
    if(semanticScore>=0.60) matchTypes.push('semantic');
    if(lexical>0) matchTypes.push('keyword');
    if(fuzzy>=0.22) matchTypes.push('fuzzy');
    if(coverage>0) matchTypes.push('concept');
    return {row,score,matchTypes};
  }).sort((a,b)=>b.score-a.score);

  const best=scored[0];
  if(!best) return null;
  const strongSemantic=embedding && best.score>=0.34 && best.matchTypes.includes('semantic');
  const strongLexical=best.score>=0.18 && (best.matchTypes.includes('keyword')||best.matchTypes.includes('fuzzy'));
  if(!strongSemantic&&!strongLexical) return null;
  return {...best.row,id:Number(best.row.id),score:best.score,match_types:best.matchTypes};
}

async function saveEvent(suggestionId:number,input:{discordMessageId?:number|null;discordUserId?:string|null;text:string;source?:string}){
  await db.query(`
    INSERT INTO suggestion_events (suggestion_id,discord_message_id,discord_user_id,suggestion_text,source)
    VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (suggestion_id,discord_message_id) WHERE discord_message_id IS NOT NULL DO NOTHING`,[
      suggestionId,input.discordMessageId??null,input.discordUserId||null,input.text,input.source||'discord'
    ]);
}

export async function addSuggestionSupport(suggestionId:number,discordUserId:string,options?:{discordMessageId?:number|null;text?:string;source?:string}){
  const clientDb=await db.connect();
  try{
    await clientDb.query('BEGIN');
    const inserted=await clientDb.query(`
      INSERT INTO suggestion_supporters (suggestion_id,discord_user_id,source)
      VALUES ($1,$2,$3)
      ON CONFLICT (suggestion_id,discord_user_id) DO NOTHING
      RETURNING suggestion_id`,[suggestionId,discordUserId,options?.source||'discord']);
    if(inserted.rowCount){
      await clientDb.query('UPDATE suggestions SET mention_count=mention_count+1,last_seen=NOW(),updated_at=NOW() WHERE id=$1',[suggestionId]);
    }else{
      await clientDb.query('UPDATE suggestions SET last_seen=NOW(),updated_at=NOW() WHERE id=$1',[suggestionId]);
    }
    await clientDb.query('COMMIT');
    if(options?.text){
      await saveEvent(suggestionId,{discordMessageId:options.discordMessageId,discordUserId,text:options.text,source:options.source}).catch(error=>console.error('[suggestions] failed to save support event',error));
    }
    return Boolean(inserted.rowCount);
  }catch(error){
    await clientDb.query('ROLLBACK');
    throw error;
  }finally{
    clientDb.release();
  }
}

export async function recordSuggestion(input:{
  text:string;
  normalizedText?:string;
  title?:string;
  topic?:string;
  relatedTerms?:string[];
  discordUserId?:string|null;
  channelId?:string|null;
  discordMessageId?:number|null;
  source?:string;
}){
  const plan:SuggestionQueryPlan={
    original:input.text,
    normalizedQuestion:input.normalizedText,
    topic:input.topic,
    searchTerms:input.relatedTerms,
    relatedTopics:input.relatedTerms
  };
  const match=await findMatchingSuggestion(plan);
  if(match){
    const supporterAdded=input.discordUserId
      ? await addSuggestionSupport(match.id,input.discordUserId,{discordMessageId:input.discordMessageId,text:input.text,source:input.source||'discord'})
      : false;
    if(!input.discordUserId){
      await saveEvent(match.id,{discordMessageId:input.discordMessageId,text:input.text,source:input.source||'discord'}).catch(()=>undefined);
      await db.query('UPDATE suggestions SET last_seen=NOW(),updated_at=NOW() WHERE id=$1',[match.id]);
    }
    const current=await getSuggestion(match.id);
    return {suggestion:current,created:false,supporterAdded,match:{score:match.score,types:match.match_types}};
  }

  const normalized=normalize(input.normalizedText||input.text)||normalize(input.text);
  const title=(input.title||input.normalizedText||input.topic||input.text).replace(/\s+/g,' ').trim().slice(0,180)||'Community suggestion';
  const summary=input.text.trim().slice(0,3000);
  const result=await db.query(`
    INSERT INTO suggestions
      (title,summary,category,status,mention_count,normalized_text,fingerprint,related_terms,discord_user_id,channel_id,discord_message_id,updated_at)
    VALUES ($1,$2,'general','candidate',0,$3,md5($3),$4,$5,$6,$7,NOW())
    RETURNING *`,[title,summary,normalized,unique(input.relatedTerms||[]),input.discordUserId||null,input.channelId||null,input.discordMessageId??null]);
  const id=Number(result.rows[0].id);
  await db.query('UPDATE suggestions SET public_id=$1 WHERE id=$2',[`SUG-${String(id).padStart(4,'0')}`,id]);
  if(input.discordUserId){
    await addSuggestionSupport(id,input.discordUserId,{discordMessageId:input.discordMessageId,text:input.text,source:input.source||'discord'});
  }else{
    await saveEvent(id,{discordMessageId:input.discordMessageId,text:input.text,source:input.source||'discord'}).catch(()=>undefined);
  }
  await refreshSuggestionEmbedding(id).catch(error=>console.error('[suggestions] failed to refresh embedding',error));
  return {suggestion:await getSuggestion(id),created:true,supporterAdded:Boolean(input.discordUserId),match:null};
}

export async function getSuggestion(id:number){
  const result=await db.query(`
    SELECT s.*,
      COALESCE((SELECT count(*)::int FROM suggestion_supporters sp WHERE sp.suggestion_id=s.id),0) AS unique_supporters,
      COALESCE((
        SELECT jsonb_agg(e ORDER BY e.created_at DESC)
        FROM (
          SELECT se.id,se.discord_user_id,se.suggestion_text,se.source,se.created_at,
                 dm.author_name,dm.channel_name,dm.channel_id,dm.message_id,dm.guild_id
            FROM suggestion_events se
            LEFT JOIN discord_messages dm ON dm.id=se.discord_message_id
           WHERE se.suggestion_id=s.id
           ORDER BY se.created_at DESC
           LIMIT 100
        ) e
      ),'[]'::jsonb) AS events
    FROM suggestions s WHERE s.id=$1`,[id]);
  return result.rows[0]??null;
}

export async function listSuggestions(input?:{status?:string;limit?:number}){
  const params:unknown[]=[];
  const where:string[]=[];
  if(input?.status){params.push(input.status);where.push(`s.status=$${params.length}`);}
  params.push(Math.max(1,Math.min(500,input?.limit||200)));
  const result=await db.query(`
    SELECT s.*,
      COALESCE((SELECT count(*)::int FROM suggestion_supporters sp WHERE sp.suggestion_id=s.id),0) AS unique_supporters,
      COALESCE((SELECT count(*)::int FROM suggestion_events se WHERE se.suggestion_id=s.id),0) AS event_count
    FROM suggestions s
    ${where.length?`WHERE ${where.join(' AND ')}`:''}
    ORDER BY
      CASE s.status WHEN 'candidate' THEN 1 WHEN 'reviewing' THEN 2 WHEN 'planned' THEN 3 WHEN 'accepted' THEN 4 WHEN 'shipped' THEN 5 ELSE 6 END,
      s.mention_count DESC,s.last_seen DESC
    LIMIT $${params.length}`,params);
  return result.rows;
}

export async function updateSuggestion(id:number,input:{
  title:string;summary:string;category:string;status:string;staff_notes:string;related_terms?:string[];changed_by?:string|null;
}){
  const before=await getSuggestion(id);
  if(!before) return null;
  const relatedTerms=input.related_terms===undefined
    ? before.related_terms||[]
    : unique(input.related_terms.map(value=>String(value).trim()).filter(Boolean),40);
  const result=await db.query(`
    UPDATE suggestions
       SET title=$1,summary=$2,category=$3,status=$4,staff_notes=$5,related_terms=$6,
           normalized_text=$7,fingerprint=md5($7),embedding=NULL,embedding_updated_at=NULL,updated_at=NOW()
     WHERE id=$8 RETURNING *`,[
      input.title.trim(),input.summary.trim(),input.category.trim()||'general',input.status,input.staff_notes.trim(),
      relatedTerms,normalize(`${input.title} ${input.summary} ${relatedTerms.join(' ')}`),id
    ]);
  if(!result.rowCount) return null;
  if(String(before.status)!==String(input.status)){
    await db.query(`
      INSERT INTO suggestion_updates (suggestion_id,update_type,from_value,to_value,created_by)
      VALUES ($1,'status',$2,$3,$4)`,[id,String(before.status),String(input.status),input.changed_by||null]);
  }
  await refreshSuggestionEmbedding(id).catch(error=>console.error('[suggestions] failed to refresh updated embedding',error));
  return getSuggestion(id);
}

export async function createManualSuggestion(input:{
  title:string;summary:string;category?:string;staff_notes?:string;related_terms?:string[];source_text?:string;
}){
  const relatedTerms=unique((input.related_terms||[]).map(value=>String(value).trim()).filter(Boolean),40);
  const normalized=normalize(`${input.title} ${input.summary} ${relatedTerms.join(' ')}`);
  const result=await db.query(`
    INSERT INTO suggestions
      (title,summary,category,status,mention_count,normalized_text,fingerprint,related_terms,staff_notes,updated_at)
    VALUES ($1,$2,$3,'candidate',0,$4,md5($4),$5,$6,NOW()) RETURNING id`,[
      input.title.trim(),input.summary.trim(),input.category?.trim()||'general',normalized,relatedTerms,input.staff_notes?.trim()||''
    ]);
  const id=Number(result.rows[0].id);
  await db.query('UPDATE suggestions SET public_id=$1 WHERE id=$2',[`SUG-${String(id).padStart(4,'0')}`,id]);
  await saveEvent(id,{
    text:String(input.source_text||input.summary).trim(),
    source:input.source_text?'dashboard_ai_source':'dashboard'
  }).catch(()=>undefined);
  await refreshSuggestionEmbedding(id).catch(()=>undefined);
  return getSuggestion(id);
}
