import Link from 'next/link';
import { redirect } from 'next/navigation';
import { api } from '../../../lib/api';
import { can, getDashboardAccess } from '../../../lib/permissions';
import { createIssueAction, createIssueWithAiAction, promoteCandidateAction } from '../actions';
import ActionButton from '../../../components/ActionButton';

type IssueCategory = { key:string; label:string; description?:string; enabled:boolean };
type IssueSettings = { categories:IssueCategory[] };
type Candidate = { id:string; sample_text:string; topic:string|null; related_terms:string[]; status:string };
type Params = Promise<{candidate?:string;mode?:string}>;
const statuses=['new','acknowledged','investigating','fix_in_progress','testing','monitoring'];
const severities=['low','medium','high','critical'];
function pretty(v:string){return v.replaceAll('_',' ')}

export default async function CreateIssuePage({searchParams}:{searchParams:Params}){
  const params=await searchParams;
  let mode=params.mode==='manual'?'manual':'ai';
  const access=await getDashboardAccess();
  if(!can(access,'issues.create')) redirect('/issues');
  if(mode==='ai'&&!can(access,'issues.ai')) mode='manual';
  const [settings,candidates]=await Promise.all([api<IssueSettings>('/api/issues/settings'),params.candidate?api<Candidate[]>('/api/issues/candidates'):Promise.resolve([])]);
  const categories=settings.categories.filter(row=>row.enabled);
  const candidate=candidates.find(row=>row.id===String(params.candidate||''));
  const action=candidate?promoteCandidateAction.bind(null,candidate.id):createIssueAction;

  if (candidate) return <>
    <div className="detailBreadcrumb"><Link href="/issues">← Issues</Link></div>
    <header className="pageHeader compactPageHeader"><div><p className="eyebrow">CREATE</p><h1>Promote Incoming Report</h1><p>Turn this incoming report into a tracked known issue.</p></div></header>
    <section className="editorPanel narrowEditorPanel">
      <div className="editorIntro"><div className="editorIcon">↗</div><div><h2>Incoming report</h2><p>{candidate.sample_text}</p></div></div>
      <form action={action} className="editorForm">
        <div className="formGrid">
          <label className="field fieldWide"><span>Title</span><input className="input" name="title" required minLength={3} defaultValue={candidate.topic||''}/></label>
          <label className="field"><span>Category</span><select className="input select" name="category" defaultValue="general">{categories.map(item=><option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
          <label className="field"><span>Affected resource</span><input className="input" name="resource_name" placeholder="jg-advancedgarages"/></label>
          <label className="field"><span>Severity</span><select className="input select" name="severity" defaultValue="medium">{severities.map(v=><option key={v} value={v}>{pretty(v)}</option>)}</select></label>
          {can(access,'issues.status')?<label className="field"><span>Status</span><select className="input select" name="status" defaultValue="new">{statuses.map(v=><option key={v} value={v}>{pretty(v)}</option>)}</select></label>:<input type="hidden" name="status" value="new"/>}
        </div>
        {candidate.related_terms?.length?<div className="tagCloud createCandidateTags">{candidate.related_terms.map(term=><span key={term}>{term}</span>)}</div>:null}
        <div className="editorFooter"><div><strong>The preserved player report becomes the initial description and symptom evidence.</strong></div><div className="headerActions"><Link className="button" href="/issues">Cancel</Link><ActionButton label="Create Known Issue" pendingLabel="Creating issue…" variant="primary" className="largeButton"/></div></div>
      </form>
    </section>
  </>;

  return <>
    <div className="detailBreadcrumb"><Link href="/issues">← Issues</Link></div>
    <header className="pageHeader compactPageHeader"><div><p className="eyebrow">CREATE</p><h1>{mode==='ai'?'Create Known Issue with AI':'Create Known Issue Manually'}</h1><p>{mode==='ai'?'Paste the information you already have and let Saucin AI organize it into a known issue.':'Enter the known issue exactly the way you want it stored.'}</p></div></header>
    <div className="creationModeSwitch">
      {can(access,'issues.ai')?<Link className={mode==='ai'?'active':''} href="/issues/create?mode=ai">✨ Create with AI</Link>:null}
      <Link className={mode==='manual'?'active':''} href="/issues/create?mode=manual">Create manually</Link>
    </div>

    {mode==='ai'?<section className="editorPanel narrowEditorPanel">
      <div className="editorIntro"><span className="editorIcon">✨</span><div><h2>Turn raw issue evidence into a structured known issue</h2><p>Paste player reports, staff observations, relevant log lines, or a plain-English description. AI organizes what you provide but does not invent a cause, fix, resource, log error, or verified workaround.</p></div></div>
      <form action={createIssueWithAiAction} className="editorForm">
        <label className="field fieldFull"><span>Issue evidence / notes</span><textarea className="textarea aiSourceTextarea" name="source_text" required minLength={8} rows={14} placeholder={'Example:\nSeveral players report that vehicles stored before restart show as unavailable and do not spawn. Legion and Alta have both been reported.\n\nRelevant log:\n[jg-advancedgarages] vehicle_properties returned nil\n\nStaff confirmed no workaround yet.'}/></label>
        <div className="formGrid">
          <label className="field"><span>Category hint <small>optional</small></span><select className="input select" name="category_hint" defaultValue=""><option value="">Let AI choose</option>{categories.map(item=><option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
          <label className="field"><span>Resource hint <small>optional</small></span><input className="input" name="resource_hint" placeholder="Only if you already know it, e.g. jg-advancedgarages"/></label>
          <label className="field"><span>Severity hint <small>optional</small></span><select className="input select" name="severity_hint" defaultValue=""><option value="">Let AI choose conservatively</option>{severities.map(v=><option key={v} value={v}>{pretty(v)}</option>)}</select></label>
        </div>
        <div className="aiSafetyNote"><strong>AI guardrail:</strong> Player-suggested fixes remain community evidence. The official workaround field is only filled if your source explicitly says staff verified it. The new issue starts at <strong>New</strong> status.</div>
        <div className="editorFooter"><div><strong>AI-assisted known issue</strong><span>Review the created issue afterward; automatic ticket creation follows your existing Issue Settings.</span></div><div className="headerActions"><Link className="button" href="/issues">Cancel</Link><ActionButton label="✨ Analyze & create issue" pendingLabel="Analyzing…" variant="primary" className="largeButton"/></div></div>
      </form>
    </section>:<section className="editorPanel">
      <form action={createIssueAction} className="editorForm">
        <div className="formGrid">
          <label className="field fieldWide"><span>Title</span><input className="input" name="title" required minLength={3} placeholder="Example: Garage vehicles fail to retrieve"/></label>
          <label className="field"><span>Category</span><select className="input select" name="category" defaultValue="general">{categories.map(item=><option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
          <label className="field"><span>Affected resource</span><input className="input" name="resource_name" placeholder="jg-advancedgarages"/></label>
          <label className="field"><span>Severity</span><select className="input select" name="severity" defaultValue="medium">{severities.map(v=><option key={v} value={v}>{pretty(v)}</option>)}</select></label>
          {can(access,'issues.status')?<label className="field"><span>Status</span><select className="input select" name="status" defaultValue="new">{statuses.map(v=><option key={v} value={v}>{pretty(v)}</option>)}</select></label>:<input type="hidden" name="status" value="new"/>}
          <label className="field fieldWide"><span>Aliases / common phrases</span><textarea className="textarea compactTextarea" name="aliases" rows={5} placeholder={'garage broken\ncar won\'t come out\nvehicle unavailable'}/></label>
          <label className="field fieldWide"><span>Symptoms</span><textarea className="textarea compactTextarea" name="symptoms" rows={5} placeholder="One symptom per line"/></label>
          <label className="field fieldFull"><span>Description</span><textarea className="textarea" name="description" required rows={7} placeholder="Describe the verified issue and what players experience."/></label>
          <label className="field fieldWide"><span>Public response override <small>optional</small></span><textarea className="textarea compactTextarea" name="public_response" rows={4} placeholder="Leave blank to use automatic status responses."/></label>
          <label className="field fieldWide"><span>Verified workaround</span><textarea className="textarea compactTextarea" name="workaround" rows={4}/></label>
          <label className="field fieldWide"><span>Known log patterns</span><textarea className="textarea compactTextarea codeArea" name="log_patterns" rows={5}/></label>
          <label className="field fieldWide"><span>Staff notes</span><textarea className="textarea compactTextarea" name="staff_notes" rows={5}/></label>
        </div>
        <div className="editorFooter"><div><strong>Manual known issue</strong><span>You control every field.</span></div><div className="headerActions"><Link className="button" href="/issues">Cancel</Link><ActionButton label="Create Issue" pendingLabel="Creating issue…" variant="primary" className="largeButton"/></div></div>
      </form>
    </section>}
  </>;
}
