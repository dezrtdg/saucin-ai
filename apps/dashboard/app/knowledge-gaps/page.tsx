import Link from 'next/link';
import { api } from '../../lib/api';
import { can, getDashboardAccess } from '../../lib/permissions';
import { convertKnowledgeGapAction, reanalyzeKnowledgeGapAction, updateKnowledgeGapAction } from './actions';

type Gap = { id:string; normalized_question:string; display_question:string|null; sample_question:string; example_questions:string[]; topic:string|null; occurrences:number; status:string; matched_sources:any[]; first_seen:string; last_seen:string; notes:string; converted_article_id:string|null; conversation_context:string|null; partial_answer:string|null; discord_message_id:string|null };
type Category = { key:string; label:string; enabled:boolean };
type Audience = { key:string; label:string; enabled:boolean; public_access:boolean };
type Settings = { categories:Category[]; audiences:Audience[] };
type Params = Promise<{q?:string;status?:string;sort?:string}>;

function date(value:string){try{return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(value));}catch{return value;}}
function sourceTitles(sources:any[]){return (sources||[]).map(source=>source?.title).filter(Boolean).slice(0,5);}

export default async function KnowledgeGapsPage({searchParams}:{searchParams:Params}){
  const params=await searchParams;
  let gaps:Gap[]=[]; let settings:Settings={categories:[],audiences:[]}; let loadError=''; let access=null;
  try{
    access=await getDashboardAccess();
    gaps=await api<Gap[]>('/api/knowledge/gaps');
    if(can(access,'knowledge.create')) settings=await api<Settings>('/api/knowledge/settings');
  }catch(error){loadError=error instanceof Error?error.message:'Unable to load knowledge gaps.';}
  const q=String(params.q||'').trim().toLowerCase(); const status=String(params.status||'open'); const sort=String(params.sort||'occurrences');
  const rows=gaps.filter(g=>{if(status!=='all'&&g.status!==status)return false;if(q&&!`${g.sample_question} ${(g.example_questions||[]).join(' ')} ${g.normalized_question} ${g.topic||''} ${g.notes||''}`.toLowerCase().includes(q))return false;return true;});
  rows.sort((a,b)=>sort==='recent'?new Date(b.last_seen).getTime()-new Date(a.last_seen).getTime():sort==='oldest'?new Date(a.first_seen).getTime()-new Date(b.first_seen).getTime():b.occurrences-a.occurrences);
  const open=gaps.filter(g=>g.status==='open').length; const totalOccurrences=gaps.reduce((sum,g)=>sum+Number(g.occurrences||0),0);
  const cats=settings.categories.filter(c=>c.enabled); const audiences=settings.audiences.filter(a=>a.enabled);
  return <>
    <header className="pageHeader"><div><p className="eyebrow">KNOWLEDGE IMPROVEMENT</p><h1>Knowledge Gaps</h1><p>Questions Saucin AI could not fully answer from verified information. Use these to systematically fill missing rules and edge cases.</p></div><div className="knowledgeStats"><span><strong>{open}</strong> open</span><span><strong>{gaps.length}</strong> tracked</span><span><strong>{totalOccurrences}</strong> total asks</span></div></header>
    {loadError?<div className="alert error">Could not load knowledge gaps: {loadError}</div>:null}
    <div className="knowledgeSettingsNotice"><div><strong>Nothing here becomes a rule automatically.</strong><p>Saucin AI records the question and related sources, but staff must add verified information before a draft is published.</p></div>{can(access,'knowledge.view')?<Link className="button" href="/knowledge">Knowledge Library</Link>:null}</div>
    <section className="panel gapLibrary">
      <div className="panelTitle"><div><h2>Unanswered & partially answered questions</h2><p>Repeated wording is grouped so the most common missing information rises to the top.</p></div></div>
      <form className="knowledgeFilters gapFilters" method="get" action="/knowledge-gaps">
        <label className="filterSearch"><span>Search</span><input className="input" type="search" name="q" defaultValue={params.q||''} placeholder="Search question, topic, notes..."/></label>
        <label><span>Status</span><select className="input select" name="status" defaultValue={status}><option value="open">Open</option><option value="all">All</option><option value="reviewed">Reviewed</option><option value="resolved">Resolved</option><option value="ignored">Ignored</option></select></label>
        <label><span>Sort</span><select className="input select" name="sort" defaultValue={sort}><option value="occurrences">Most asked</option><option value="recent">Most recent</option><option value="oldest">Oldest first</option></select></label>
        <div className="filterActions"><button className="button primary" type="submit">Filter</button><Link className="button" href="/knowledge-gaps">Reset</Link></div>
      </form>
      <div className="gapList">
        {rows.length===0?<div className="empty">No knowledge gaps match the current filters.</div>:rows.map(gap=>{const sources=sourceTitles(gap.matched_sources);return <details className="gapCard" key={gap.id}>
          <summary><div className="gapTitle"><strong>{gap.display_question||gap.normalized_question||gap.sample_question}</strong><span>{gap.topic||'Unclassified topic'}</span></div><div className="gapMetrics"><span><strong>{gap.occurrences}</strong> asks</span><span className={`badge gap-${gap.status}`}>{gap.status}</span><small>{date(gap.last_seen)}</small></div></summary>
          <div className="gapBody">
            <div className="gapContext"><div><small>Original trigger</small><p>{gap.sample_question}</p></div><div><small>Normalized for grouping</small><p>{gap.normalized_question}</p></div><div><small>Example player questions</small>{(gap.example_questions||[]).length?(gap.example_questions||[]).map((question,index)=><p key={`${index}-${question}`}>• {question}</p>):<p>{gap.sample_question}</p>}</div><div><small>Related knowledge retrieved</small>{sources.length?<div className="tagList">{sources.map(source=><span key={source}>{source}</span>)}</div>:<p>None</p>}</div><div><small>Seen</small><p>First {date(gap.first_seen)} · Last {date(gap.last_seen)}</p></div></div>
            {gap.conversation_context||gap.partial_answer?<details className="gapEvidence"><summary>Saved evidence used for this gap</summary>{gap.partial_answer?<div><small>Partial verified answer</small><p>{gap.partial_answer}</p></div>:null}{gap.conversation_context?<div><small>Conversation context snapshot</small><pre>{gap.conversation_context}</pre></div>:null}</details>:null}
            {can(access,'knowledge.gaps.manage')?<div className="gapActionsGrid">
              <form action={updateKnowledgeGapAction.bind(null,gap.id)} className="gapReviewForm">
                <label className="field"><span>Status</span><select className="input select" name="status" defaultValue={gap.status}><option value="open">open</option><option value="reviewed">reviewed</option><option value="resolved">resolved</option><option value="ignored">ignored</option></select></label>
                <label className="field fieldWide"><span>Staff notes</span><textarea className="textarea compactTextarea" name="notes" rows={4} defaultValue={gap.notes||''} placeholder="Clarification needed, decision made, link to discussion..."/></label>
                <div className="gapReviewButtons"><button className="button" type="submit">Save gap</button><button className="button" formAction={reanalyzeKnowledgeGapAction.bind(null,gap.id)} type="submit">Clean / re-analyze</button></div>
              </form>
              {gap.converted_article_id ? <div className="gapConvertForm gapConverted"><div><strong>Draft article created</strong><p>Knowledge article #{gap.converted_article_id} was created from this gap. Open the Knowledge Library to replace the placeholder with verified information before publishing.</p></div>{can(access,'knowledge.view')?<Link className="button primary" href="/knowledge">Open Knowledge</Link>:null}</div> : can(access,'knowledge.create')?<form action={convertKnowledgeGapAction.bind(null,gap.id)} className="gapConvertForm">
                <div><strong>Create draft knowledge article</strong><p>Copies this question into a draft so you can add the verified answer in the Knowledge Library.</p></div>
                <label className="field"><span>Category</span><select className="input select" name="category" defaultValue="general">{cats.map(c=><option key={c.key} value={c.key}>{c.label}</option>)}</select></label>
                <label className="field"><span>Audience</span><select className="input select" name="audience" defaultValue="public">{audiences.map(a=><option key={a.key} value={a.key}>{a.label}</option>)}</select></label>
                <button className="button primary" type="submit">Create draft</button>
              </form>:null}
            </div>:<div className="viewOnlyNote">View only — your role can review this gap but cannot change its status, notes, or create drafts.</div>}
          </div>
        </details>})}
      </div>
    </section>
  </>;
}
