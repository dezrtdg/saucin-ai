import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { api } from '../../../../lib/api';
import { can, getDashboardAccess } from '../../../../lib/permissions';
import { deleteKnowledgeAction, updateKnowledgeAction } from '../../actions';
import ActionButton from '../../../../components/ActionButton';

type Article={id:string;title:string;body:string;content_type:string;category:string;audiences:string[];status:string;source_url:string|null;aliases:string[];related_topics:string[];example_questions:string[]};
type Settings={content_types:{key:string;label:string;enabled:boolean}[];categories:{key:string;label:string;enabled:boolean}[];audiences:{key:string;label:string;description:string;public_access:boolean;enabled:boolean}[];discord_roles:unknown[]};
const lines=(v:string[])=>(v||[]).join('\n');

export default async function EditKnowledgePage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{from?:string}>}){
  const [{id},query]=await Promise.all([params,searchParams]);
  const returnScope=['server_rule','discord_rule','general','all'].includes(String(query.from||'')) ? String(query.from) : '';
  const detailHref=returnScope ? `/knowledge/${id}?from=${encodeURIComponent(returnScope)}` : `/knowledge/${id}`;
  const access=await getDashboardAccess();
  if(!can(access,'knowledge.edit')) redirect(detailHref);
  let article:Article;let settings:Settings;
  try{[article,settings]=await Promise.all([api<Article>(`/api/knowledge/${id}`),api<Settings>('/api/knowledge/settings')]);}catch{return notFound();}
  return <>
    <header className="pageHeader compactPageHeader"><div><p className="eyebrow">EDIT KNOWLEDGE</p><h1>{article.title}</h1><p>Update verified content and retrieval helpers.</p></div><div className="headerActions"><Link className="button" href={detailHref}>Cancel</Link></div></header>
    <section className="editorPanel"><form action={updateKnowledgeAction} className="editorForm"><input type="hidden" name="id" value={article.id}/><input type="hidden" name="return_scope" value={returnScope}/><div className="formGrid">
      <label className="field fieldWide"><span>Title</span><input className="input" name="title" defaultValue={article.title} required/></label>
      <label className="field"><span>Content type</span><select className="select input" name="content_type" defaultValue={article.content_type}>{settings.content_types.filter(r=>r.enabled||r.key===article.content_type).map(r=><option key={r.key} value={r.key}>{r.label}</option>)}</select></label>
      <label className="field"><span>Category</span><select className="select input" name="category" defaultValue={article.category}>{settings.categories.filter(r=>r.enabled||r.key===article.category).map(r=><option key={r.key} value={r.key}>{r.label}</option>)}</select></label>
      <label className="field"><span>Status</span><select className="select input" name="status" defaultValue={article.status}><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></select></label>
      <fieldset className="field fieldFull audienceFieldset"><legend>Audience</legend><div className="audienceChoices">{settings.audiences.filter(r=>r.enabled||article.audiences.includes(r.key)).map(a=><label className="checkCard" key={a.key}><input type="checkbox" name="audiences" value={a.key} defaultChecked={article.audiences.includes(a.key)}/><span><strong>{a.label}</strong><small>{a.public_access?'Everyone':a.description}</small></span></label>)}</div></fieldset>
      <label className="field fieldWide"><span>Aliases / keywords</span><textarea className="textarea compactTextarea" name="aliases" rows={6} defaultValue={lines(article.aliases)}/></label>
      <label className="field fieldWide"><span>Related topics</span><textarea className="textarea compactTextarea" name="related_topics" rows={6} defaultValue={lines(article.related_topics)}/></label>
      <label className="field fieldFull"><span>Example player questions</span><textarea className="textarea compactTextarea" name="example_questions" rows={7} defaultValue={lines(article.example_questions)}/></label>
      <label className="field fieldWide"><span>Source URL <small>optional</small></span><input className="input" type="url" name="source_url" defaultValue={article.source_url||''}/></label>
      <label className="field fieldFull"><span>Verified information</span><textarea className="textarea" name="body" rows={16} defaultValue={article.body} required/></label>
    </div><div className="editorFooter"><div><strong>Save changes</strong><span>Updating retrieval helpers will refresh the semantic index.</span></div><ActionButton label="Save article" pendingLabel="Saving article…" variant="primary" className="largeButton"/></div></form></section>
    {can(access,'knowledge.delete')?<section className="dangerPanel"><div><strong>Delete article</strong><p>This permanently removes the article from the knowledge base.</p></div><form action={deleteKnowledgeAction}><input type="hidden" name="id" value={article.id}/><input type="hidden" name="confirm_delete" value="DELETE"/><ActionButton label="Delete permanently" pendingLabel="Deleting…" variant="danger" confirmMessage={`Permanently delete "${article.title}" from the knowledge base? This cannot be undone.`}/></form></section>:null}
  </>;
}
