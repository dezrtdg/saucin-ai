import Link from 'next/link';
import { notFound } from 'next/navigation';
import { api } from '../../../lib/api';
import { can, getDashboardAccess } from '../../../lib/permissions';
import { improveKnowledgeAction, setKnowledgeStatusAction } from '../actions';

type Article={id:string;title:string;body:string;content_type:string;category:string;audiences:string[];status:string;source_url:string|null;aliases:string[];related_topics:string[];example_questions:string[];created_by:string|null;created_at:string;updated_at:string;embedding_updated_at?:string|null};
type Settings={content_types:{key:string;label:string}[];categories:{key:string;label:string}[];audiences:{key:string;label:string}[];discord_roles:unknown[]};
function label(key:string,rows:{key:string;label:string}[]){return rows.find(row=>row.key===key)?.label||key.replaceAll('_',' ')}
function backPath(type:string){return type==='server_rule'?'/knowledge/server-rules':type==='discord_rule'?'/knowledge/discord-rules':'/knowledge'}
function normalizeScope(value:string|undefined,type:string){
  if(value==='server_rule'||value==='discord_rule'||value==='general'||value==='all') return value;
  if(type==='server_rule') return 'server_rule';
  if(type==='discord_rule') return 'discord_rule';
  return 'general';
}
function scopePath(scope:string,type:string){
  if(scope==='server_rule') return '/knowledge/server-rules';
  if(scope==='discord_rule') return '/knowledge/discord-rules';
  if(scope==='all') return '/knowledge/all';
  if(scope==='general') return '/knowledge';
  return backPath(type);
}
function scopeLabel(scope:string,contentType:string){
  if(scope==='server_rule') return 'Server Rules';
  if(scope==='discord_rule') return 'Discord Rules';
  if(scope==='all') return 'All Knowledge';
  if(scope==='general') return 'Guides & Knowledge';
  return contentType==='Server Rule'?'Server Rules':contentType==='Discord Rule'?'Discord Rules':'Guides & Knowledge';
}
function prettyDate(value:string){return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(value))}

export default async function KnowledgeDetailPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{from?:string}>}){
  const [{id},query]=await Promise.all([params,searchParams]);
  let article:Article;
  let settings:Settings;let access=null;
  try{[article,settings,access]=await Promise.all([api<Article>(`/api/knowledge/${id}`),api<Settings>('/api/knowledge/settings'),getDashboardAccess()]);}catch{return notFound();}
  const contentType=label(article.content_type,settings.content_types);
  const category=label(article.category,settings.categories);
  const returnScope=normalizeScope(query.from,article.content_type);
  const returnPath=scopePath(returnScope,article.content_type);
  const returnLabel=scopeLabel(returnScope,contentType);
  return <>
    <div className="detailBreadcrumb"><Link href={returnPath}>← {returnLabel}</Link></div>
    <header className="articleViewHeader">
      <div className="articleViewHeading"><div className="articleMetaLine"><span className="typePill">{contentType}</span><span>{category}</span><span>•</span><span>{article.audiences.map(a=>label(a,settings.audiences)).join(', ')}</span><span className={`statusBadge status-${article.status}`}>{article.status}</span></div><h1>{article.title}</h1><p>Updated {prettyDate(article.updated_at)}</p></div>
      {(can(access,'knowledge.ai')||can(access,'knowledge.edit'))?<div className="headerActions">{can(access,'knowledge.ai')&&can(access,'knowledge.edit')?<form action={improveKnowledgeAction}><input type="hidden" name="id" value={article.id}/><button className="button" type="submit">✨ Improve with AI</button></form>:null}{can(access,'knowledge.edit')?<Link className="button primary" href={`/knowledge/${article.id}/edit?from=${encodeURIComponent(returnScope)}`}>Edit</Link>:null}</div>:null}
    </header>

    <div className="articleViewGrid">
      <article className="articleBodyCard"><div className="sectionLabel">VERIFIED INFORMATION</div><div className="articleBodyText">{article.body}</div>{article.source_url?<div className="articleSource"><span>Source</span><a href={article.source_url} target="_blank" rel="noreferrer">{article.source_url}</a></div>:null}</article>
      <aside className="articleSidebar">
        <section className="articleSideCard"><div className="sectionLabel">ALIASES / KEYWORDS</div><div className="tagCloud">{article.aliases.length?article.aliases.map(v=><span key={v}>{v}</span>):<em>None added</em>}</div></section>
        <section className="articleSideCard"><div className="sectionLabel">RELATED TOPICS</div><div className="tagCloud">{article.related_topics.length?article.related_topics.map(v=><span key={v}>{v}</span>):<em>None added</em>}</div></section>
      </aside>
    </div>

    <section className="articleQuestionsCard"><div className="sectionLabel">EXAMPLE PLAYER QUESTIONS</div>{article.example_questions.length?<ul>{article.example_questions.map(q=><li key={q}>{q}</li>)}</ul>:<p>No example questions added yet.</p>}</section>

    <div className="articleAuditBar"><div><span>Created</span><strong>{prettyDate(article.created_at)}</strong></div><div><span>Created by</span><strong>{article.created_by||'Unknown'}</strong></div><div><span>Embedding</span><strong>{article.embedding_updated_at?'Indexed':'Pending'}</strong></div>{(can(access,'knowledge.publish')||can(access,'knowledge.archive'))?<div className="articleStatusActions">{article.status!=='published'&&can(access,'knowledge.publish')?<form action={setKnowledgeStatusAction}><input type="hidden" name="id" value={article.id}/><input type="hidden" name="return_scope" value={returnScope}/><input type="hidden" name="status" value="published"/><button className="button primary" type="submit">Publish</button></form>:null}{article.status!=='archived'&&can(access,'knowledge.archive')?<form action={setKnowledgeStatusAction}><input type="hidden" name="id" value={article.id}/><input type="hidden" name="return_scope" value={returnScope}/><input type="hidden" name="status" value="archived"/><button className="button" type="submit">Archive</button></form>:article.status==='archived'&&can(access,'knowledge.archive')?<form action={setKnowledgeStatusAction}><input type="hidden" name="id" value={article.id}/><input type="hidden" name="return_scope" value={returnScope}/><input type="hidden" name="status" value="draft"/><button className="button" type="submit">Restore to draft</button></form>:null}</div>:null}</div>
  </>;
}
