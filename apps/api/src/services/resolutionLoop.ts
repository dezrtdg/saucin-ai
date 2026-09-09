import { db } from '../db.js';
import { refreshKnowledgeEmbedding } from './knowledge.js';

type GapCandidate={
  id:number;
  display_question:string|null;
  normalized_question:string;
  sample_question:string;
  example_questions:string[];
  topic:string|null;
  conversation_context:string|null;
  occurrences:number;
  status:string;
};

const stopWords=new Set([
  'a','about','an','and','are','as','at','be','been','but','by','can','could','did','do','does','for','from','get','had','has','have','how','i','if','in','is','it','me','my','of','on','or','our','so','that','the','their','them','then','there','they','this','to','was','we','were','what','when','where','which','who','why','will','with','would','you','your'
]);

function unique(values:Array<string|null|undefined>,max=50){
  return [...new Set(values.map(value=>String(value||'').trim()).filter(Boolean))].slice(0,max);
}

function terms(value:string){
  return new Set(value.toLowerCase().replace(/[^a-z0-9_-]+/g,' ').split(/\s+/)
    .map(term=>term.replace(/^[-_]+|[-_]+$/g,''))
    .filter(term=>term.length>=3&&!stopWords.has(term)));
}

function scoreMatch(issueTerms:Set<string>,gap:GapCandidate){
  const gapText=[gap.display_question,gap.normalized_question,gap.sample_question,gap.topic,...(gap.example_questions||[]),gap.conversation_context]
    .filter(Boolean).join(' ');
  const gapTerms=terms(gapText);
  const shared=[...issueTerms].filter(term=>gapTerms.has(term));
  if(!shared.length)return null;
  const overlap=shared.length/Math.max(1,Math.min(issueTerms.size,gapTerms.size));
  const jaccard=shared.length/Math.max(1,new Set([...issueTerms,...gapTerms]).size);
  const confidence=Math.min(.94,.16+(overlap*.55)+(jaccard*.55)+Math.min(.12,shared.length*.025));
  if(confidence<.30)return null;
  return {confidence:Number(confidence.toFixed(4)),shared:shared.slice(0,10)};
}

function resolutionBody(issue:any,resolution:string){
  return [
    '## What players may notice',
    String(issue.description||'').trim()||`Players may encounter ${issue.title}.`,
    '',
    '## Confirmed resolution',
    resolution,
    issue.resource_name?'':null,
    issue.resource_name?'## Affected system':null,
    issue.resource_name?String(issue.resource_name):null,
    '',
    `Internal source: ${issue.public_id||`Issue #${issue.id}`} was marked resolved by staff. Review this draft before publishing.`
  ].filter(value=>value!==null).join('\n').trim();
}

function confirmedResolution(issue:any){
  return String(issue.resolution_summary||issue.workaround||issue.public_response||'').trim();
}

export async function issueResolutionAutoEnabled(){
  const result=await db.query(`SELECT autonomy_level FROM automation_module_settings WHERE module_key='issues'`);
  return result.rows[0]?.autonomy_level==='auto_safe';
}

export async function getIssueResolutionData(issueId:number){
  const result=await db.query(`SELECT i.id,i.status,i.public_response,i.workaround,i.resolution_summary,
    i.resolution_article_id,i.resolved_at,i.resolution_draft_updated_at,
    (SELECT jsonb_build_object('id',a.id,'title',a.title,'status',a.status,'updated_at',a.updated_at)
       FROM knowledge_articles a WHERE a.id=i.resolution_article_id) AS resolution_article,
    COALESCE((SELECT jsonb_agg(gj ORDER BY CASE gj.review_status WHEN 'linked' THEN 1 WHEN 'suggested' THEN 2 ELSE 3 END,gj.confidence DESC)
      FROM (SELECT m.gap_id,m.confidence,m.reason,m.review_status,m.reviewed_at,
          COALESCE(g.display_question,g.normalized_question,g.sample_question) AS question,g.topic,g.occurrences,g.status
        FROM issue_knowledge_gap_matches m JOIN knowledge_gaps g ON g.id=m.gap_id
        WHERE m.issue_id=i.id ORDER BY m.confidence DESC LIMIT 12) gj),'[]'::jsonb) AS resolution_gap_matches
    FROM issues i WHERE i.id=$1`,[issueId]);
  return result.rows[0]||null;
}

export async function runIssueResolutionLoop(issueId:number,actorUserId:string|null){
  const client=await db.connect();
  let articleId:number|null=null;
  try{
    await client.query('BEGIN');
    const issueResult=await client.query(`SELECT id,public_id,title,description,category,resource_name,status,resolution_summary,
      resolution_article_id,workaround,public_response,aliases,symptoms FROM issues WHERE id=$1 FOR UPDATE`,[issueId]);
    if(!issueResult.rowCount)throw new Error('Issue not found.');
    const issue=issueResult.rows[0];
    if(issue.status!=='resolved')throw new Error('Mark the issue resolved before building reusable knowledge.');
    const resolution=confirmedResolution(issue);
    if(!resolution)throw new Error('Add a confirmed resolution, workaround, or public response before building the knowledge draft.');

    const gapsResult=await client.query<GapCandidate>(`SELECT id,display_question,normalized_question,sample_question,
      COALESCE(example_questions,'{}'::text[]) AS example_questions,topic,conversation_context,occurrences,status
      FROM knowledge_gaps WHERE status IN ('open','reviewed') ORDER BY occurrences DESC,last_seen DESC LIMIT 400`);
    const issueTerms=terms([issue.title,issue.description,issue.category,issue.resource_name,resolution,...(issue.aliases||[]),...(issue.symptoms||[])].filter(Boolean).join(' '));
    const matches=gapsResult.rows.map(gap=>({gap,match:scoreMatch(issueTerms,gap)}))
      .filter((entry):entry is {gap:GapCandidate;match:{confidence:number;shared:string[]}}=>Boolean(entry.match))
      .sort((a,b)=>b.match.confidence-a.match.confidence||Number(b.gap.occurrences)-Number(a.gap.occurrences)).slice(0,8);

    for(const {gap,match} of matches){
      await client.query(`INSERT INTO issue_knowledge_gap_matches(issue_id,gap_id,confidence,reason)
        VALUES ($1,$2,$3,$4) ON CONFLICT(issue_id,gap_id) DO UPDATE SET confidence=EXCLUDED.confidence,
        reason=EXCLUDED.reason,updated_at=NOW()`,[issueId,gap.id,match.confidence,`Shared context: ${match.shared.join(', ')}`]);
    }

    const categoryResult=await client.query(`SELECT key FROM knowledge_categories WHERE enabled=TRUE AND key=ANY($1::text[])
      ORDER BY CASE key WHEN 'known-issues' THEN 1 WHEN $2 THEN 2 ELSE 3 END LIMIT 1`,[['known-issues',String(issue.category||''),'general'],String(issue.category||'')]);
    const category=String(categoryResult.rows[0]?.key||'general');
    const exampleQuestions=unique(matches.flatMap(entry=>[
      entry.gap.display_question||entry.gap.normalized_question||entry.gap.sample_question,
      ...(entry.gap.example_questions||[])
    ]),20);
    const aliases=unique([issue.title,issue.resource_name,...(issue.aliases||[]),...(issue.symptoms||[])],50);
    const relatedTopics=unique([issue.category,issue.resource_name,...(issue.symptoms||[])],30);
    const title=`Resolved: ${String(issue.title).trim()}`.slice(0,200);
    const body=resolutionBody(issue,resolution);

    if(issue.resolution_article_id){
      const existing=await client.query('SELECT id,status FROM knowledge_articles WHERE id=$1',[issue.resolution_article_id]);
      if(existing.rowCount){
        articleId=Number(existing.rows[0].id);
        if(existing.rows[0].status==='draft'){
          await client.query(`UPDATE knowledge_articles SET title=$1,body=$2,content_type='guide',category=$3,
            audience='public',audiences=ARRAY['public']::text[],aliases=$4,related_topics=$5,example_questions=$6,
            embedding=NULL,embedding_updated_at=NULL,updated_at=NOW() WHERE id=$7`,
          [title,body,category,aliases,relatedTopics,exampleQuestions,articleId]);
        }
      }
    }
    if(!articleId){
      const created=await client.query(`INSERT INTO knowledge_articles
        (title,body,content_type,category,audience,audiences,status,aliases,related_topics,example_questions,created_by)
        VALUES ($1,$2,'guide',$3,'public',ARRAY['public']::text[],'draft',$4,$5,$6,$7) RETURNING id`,
      [title,body,category,aliases,relatedTopics,exampleQuestions,`Resolution Loop · ${issue.public_id||`Issue #${issue.id}`}`]);
      articleId=Number(created.rows[0].id);
    }
    await client.query(`UPDATE issues SET resolution_summary=COALESCE(NULLIF(resolution_summary,''),$1),
      resolution_article_id=$2,resolution_draft_updated_at=NOW(),resolved_at=COALESCE(resolved_at,NOW()),updated_at=NOW() WHERE id=$3`,
    [resolution,articleId,issueId]);
    await client.query(`INSERT INTO issue_updates(issue_id,update_type,from_value,to_value,note,created_by)
      VALUES ($1,'resolution_knowledge',NULL,$2,$3,$4)`,[issueId,String(articleId),`Resolution knowledge draft #${articleId} prepared with ${matches.length} possible gap match(es).`,'automation']);
    await client.query('COMMIT');
    await refreshKnowledgeEmbedding(articleId).catch(()=>false);
    return {ok:true,article_id:articleId,matched_gaps:matches.length};
  }catch(error){
    await client.query('ROLLBACK');
    throw error;
  }finally{client.release();}
}

export async function setIssueResolutionGapReview(input:{issueId:number;gapId:number;status:'linked'|'dismissed';actorUserId:string|null}){
  const result=await db.query(`UPDATE issue_knowledge_gap_matches SET review_status=$1,reviewed_by_user_id=$2,
    reviewed_at=NOW(),updated_at=NOW() WHERE issue_id=$3 AND gap_id=$4 RETURNING *`,
  [input.status,input.actorUserId,input.issueId,input.gapId]);
  if(!result.rowCount)throw new Error('Knowledge-gap match not found.');
  if(input.status==='linked'){
    const published=await db.query(`SELECT i.resolution_article_id,a.status,i.public_id FROM issues i
      LEFT JOIN knowledge_articles a ON a.id=i.resolution_article_id WHERE i.id=$1`,[input.issueId]);
    if(published.rows[0]?.status==='published'){
      await resolveLinkedGap(input.gapId,Number(published.rows[0].resolution_article_id),String(published.rows[0].public_id||`Issue #${input.issueId}`));
    }
  }
  return result.rows[0];
}

async function resolveLinkedGap(gapId:number,articleId:number,issueLabel:string){
  const note=`Resolved from ${issueLabel} through published knowledge article #${articleId}.`;
  await db.query(`UPDATE knowledge_gaps SET status='resolved',converted_article_id=COALESCE(converted_article_id,$1),
    notes=CASE WHEN position($2 in notes)>0 THEN notes WHEN notes='' THEN $2 ELSE notes||E'\n'||$2 END
    WHERE id=$3 AND status IN ('open','reviewed')`,[articleId,note,gapId]);
}

export async function applyPublishedResolutionToLinkedGaps(articleId:number){
  const matches=await db.query(`SELECT m.gap_id,i.public_id,i.id FROM issue_knowledge_gap_matches m
    JOIN issues i ON i.id=m.issue_id WHERE i.resolution_article_id=$1 AND m.review_status='linked'`,[articleId]);
  for(const row of matches.rows){
    await resolveLinkedGap(Number(row.gap_id),articleId,String(row.public_id||`Issue #${row.id}`));
  }
  return matches.rowCount||0;
}
