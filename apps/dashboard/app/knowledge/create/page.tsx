import Link from 'next/link';
import { redirect } from 'next/navigation';
import { api } from '../../../lib/api';
import { can, getDashboardAccess } from '../../../lib/permissions';
import { createKnowledgeAction, createKnowledgeWithAiAction } from '../actions';
import ActionButton from '../../../components/ActionButton';

type ContentType={key:string;label:string;description:string;enabled:boolean};
type Category={key:string;label:string;description:string;enabled:boolean};
type Audience={key:string;label:string;description:string;public_access:boolean;enabled:boolean};
type Settings={content_types:ContentType[];categories:Category[];audiences:Audience[];discord_roles:unknown[]};

type Params=Promise<{mode?:string;scope?:string;error?:string}>;

function scopeMeta(scope:string) {
  if (scope==='server_rule') return { key:'server_rule', type:'server_rule', label:'Server Rule', back:'/knowledge/server-rules', title:'Server Rule', allowAllTypes:false };
  if (scope==='discord_rule') return { key:'discord_rule', type:'discord_rule', label:'Discord Rule', back:'/knowledge/discord-rules', title:'Discord Rule', allowAllTypes:false };
  if (scope==='all') return { key:'all', type:'', label:'All Knowledge', back:'/knowledge/all', title:'Knowledge Article', allowAllTypes:true };
  return { key:'general', type:'', label:'Guides & Knowledge', back:'/knowledge', title:'Knowledge Article', allowAllTypes:false };
}

export default async function CreateKnowledgePage({searchParams}:{searchParams:Params}) {
  const params=await searchParams;
  let mode=params.mode==='manual'?'manual':'ai';
  const scope=scopeMeta(String(params.scope||'general'));
  const access=await getDashboardAccess();
  if(!can(access,'knowledge.create')) redirect(scope.back);
  if(mode==='ai'&&!can(access,'knowledge.ai')) mode='manual';
  const settings=await api<Settings>('/api/knowledge/settings');
  const types=settings.content_types.filter(row=>row.enabled && (scope.type ? row.key===scope.type : scope.allowAllTypes ? true : !['server_rule','discord_rule'].includes(row.key)));
  const categories=settings.categories.filter(row=>row.enabled);
  const audiences=settings.audiences.filter(row=>row.enabled);
  const defaultType=scope.type || types.find(row=>row.key==='guide')?.key || types[0]?.key || 'other';

  return <>
    <header className="pageHeader compactPageHeader">
      <div><p className="eyebrow">CREATE</p><h1>{mode==='ai'?'Create with AI':'Create manually'}</h1><p>{scope.label} · {mode==='ai'?'Paste verified information and let Saucin AI organize the draft.':'Enter the article exactly the way you want it stored.'}</p></div>
      <div className="headerActions"><Link className="button" href={scope.back}>Cancel</Link></div>
    </header>

    {params.error ? <div className="knowledgeCreateError" role="alert"><strong>AI draft could not be created</strong><span>{params.error}</span></div> : null}

    <div className="creationModeSwitch">
      {can(access,'knowledge.ai')?<Link className={mode==='ai'?'active':''} href={`/knowledge/create?mode=ai&scope=${scope.key}`}>✨ Create with AI</Link>:null}
      <Link className={mode==='manual'?'active':''} href={`/knowledge/create?mode=manual&scope=${scope.key}`}>Create manually</Link>
    </div>

    {mode==='ai' ? <section className="editorPanel narrowEditorPanel">
      <div className="editorIntro"><span className="editorIcon">✨</span><div><h2>Build a draft from verified information</h2><p>AI can organize and broaden retrieval wording, but it cannot invent a rule, punishment, exception, command, or procedure you did not provide.</p></div></div>
      <form action={createKnowledgeWithAiAction} className="editorForm">
        <input type="hidden" name="return_scope" value={scope.key}/>
        {scope.type ? <input type="hidden" name="content_type_hint" value={scope.type}/> : null}
        <label className="field fieldFull"><span>Verified information / source notes</span><textarea className="textarea aiSourceTextarea" name="source_text" required minLength={8} rows={13} placeholder="Paste the rule, guide, procedure, or verified facts here. Write naturally — Saucin AI will structure it for the knowledge base."/></label>
        <div className="formGrid">
          {!scope.type ? <label className="field"><span>Content type hint <small>optional</small></span><select className="select input" name="content_type_hint" defaultValue=""><option value="">Let AI choose</option>{types.map(row=><option key={row.key} value={row.key}>{row.label}</option>)}</select></label> : <div className="lockedField"><span>Content type</span><strong>{scope.label}</strong><small>Locked because you started from the {scope.label} page.</small></div>}
          <label className="field"><span>Category hint <small>optional</small></span><select className="select input" name="category_hint" defaultValue=""><option value="">Let AI choose</option>{categories.map(row=><option key={row.key} value={row.key}>{row.label}</option>)}</select></label>
        </div>
        <fieldset className="field audienceFieldset"><legend>Audience hints <small>optional</small></legend><div className="audienceChoices">{audiences.map(a=><label className="checkCard" key={a.key}><input type="checkbox" name="audiences" value={a.key} defaultChecked={a.key==='public'}/><span><strong>{a.label}</strong><small>{a.public_access?'Everyone':a.description}</small></span></label>)}</div></fieldset>
        <div className="editorFooter"><div><strong>Result: Draft</strong><span>Nothing becomes live until you review and publish it.</span></div><ActionButton label="✨ Analyze & build draft" pendingLabel="Building draft…" variant="primary" className="largeButton"/></div>
      </form>
    </section> : <section className="editorPanel">
      <form action={createKnowledgeAction} className="editorForm">
        <input type="hidden" name="return_scope" value={scope.key}/>
        {scope.type ? <input type="hidden" name="content_type" value={scope.type}/> : null}
        <div className="formGrid">
          <label className="field fieldWide"><span>Title</span><input className="input" name="title" required minLength={2}/></label>
          {!scope.type ? <label className="field"><span>Content type</span><select className="select input" name="content_type" defaultValue={defaultType}>{types.map(row=><option key={row.key} value={row.key}>{row.label}</option>)}</select></label> : <div className="lockedField"><span>Content type</span><strong>{scope.label}</strong><small>Locked from the page you started on.</small></div>}
          <label className="field"><span>Category</span><select className="select input" name="category" defaultValue={categories[0]?.key||'general'}>{categories.map(row=><option key={row.key} value={row.key}>{row.label}</option>)}</select></label>
          <label className="field"><span>Status</span><select className="select input" name="status" defaultValue="draft"><option value="draft">Draft</option>{can(access,'knowledge.publish')?<option value="published">Published</option>:null}{can(access,'knowledge.archive')?<option value="archived">Archived</option>:null}</select></label>
          <fieldset className="field fieldFull audienceFieldset"><legend>Audience</legend><div className="audienceChoices">{audiences.map(a=><label className="checkCard" key={a.key}><input type="checkbox" name="audiences" value={a.key} defaultChecked={a.key==='public'}/><span><strong>{a.label}</strong><small>{a.public_access?'Everyone':a.description}</small></span></label>)}</div></fieldset>
          <label className="field fieldWide"><span>Aliases / keywords</span><textarea className="textarea compactTextarea" name="aliases" rows={5} placeholder="One per line or comma-separated"/></label>
          <label className="field fieldWide"><span>Related topics</span><textarea className="textarea compactTextarea" name="related_topics" rows={5} placeholder="death, respawn, inventory..."/></label>
          <label className="field fieldFull"><span>Example player questions</span><textarea className="textarea compactTextarea" name="example_questions" rows={6} placeholder="One realistic player question per line"/></label>
          <label className="field fieldWide"><span>Source URL <small>optional</small></span><input className="input" type="url" name="source_url"/></label>
          <label className="field fieldFull"><span>Verified information</span><textarea className="textarea" name="body" required minLength={5} rows={14}/></label>
        </div>
        <div className="editorFooter"><div><strong>Manual article</strong><span>You control every field.</span></div><ActionButton label="Create article" pendingLabel="Creating article…" variant="primary" className="largeButton"/></div>
      </form>
    </section>}
  </>;
}
