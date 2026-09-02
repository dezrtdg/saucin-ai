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

function unique(values:string[],max=30){
  return [...new Set(values.map(value=>String(value).trim()).filter(Boolean))].slice(0,max);
}

function normalize(value:string){
  return value.toLowerCase().replace(/[^a-z0-9\s/_-]/g,' ').replace(/\s+/g,' ').trim().slice(0,1000);
}

function suggestionText(row:any){
  return [row.title,row.summary,row.category,...(row.related_terms||[])].filter(Boolean).join('\n');
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

export async function updateSuggestion(id:number,input:{title:string;summary:string;category:string;status:string;staff_notes:string}){
  const result=await db.query(`
    UPDATE suggestions SET title=$1,summary=$2,category=$3,status=$4,staff_notes=$5,embedding=NULL,embedding_updated_at=NULL,updated_at=NOW()
     WHERE id=$6 RETURNING *`,[input.title.trim(),input.summary.trim(),input.category.trim()||'general',input.status,input.staff_notes.trim(),id]);
  if(!result.rowCount) return null;
  await refreshSuggestionEmbedding(id).catch(error=>console.error('[suggestions] failed to refresh updated embedding',error));
  return getSuggestion(id);
}

export async function createManualSuggestion(input:{title:string;summary:string;category?:string;staff_notes?:string}){
  const normalized=normalize(`${input.title} ${input.summary}`);
  const result=await db.query(`
    INSERT INTO suggestions (title,summary,category,status,mention_count,normalized_text,fingerprint,staff_notes,updated_at)
    VALUES ($1,$2,$3,'candidate',0,$4,md5($4),$5,NOW()) RETURNING id`,[
      input.title.trim(),input.summary.trim(),input.category?.trim()||'general',normalized,input.staff_notes?.trim()||''
    ]);
  const id=Number(result.rows[0].id);
  await db.query('UPDATE suggestions SET public_id=$1 WHERE id=$2',[`SUG-${String(id).padStart(4,'0')}`,id]);
  await saveEvent(id,{text:input.summary,source:'dashboard'}).catch(()=>undefined);
  await refreshSuggestionEmbedding(id).catch(()=>undefined);
  return getSuggestion(id);
}
