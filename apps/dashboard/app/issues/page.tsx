import Link from 'next/link';
import { api } from '../../lib/api';
import { can, getDashboardAccess } from '../../lib/permissions';
import { candidateStatusAction, linkCandidateAction } from './actions';

type ReportEvidence = {
  id?: string; discord_user_id?: string | null; report_text: string; source?: string; created_at: string;
  author_name?: string | null; channel_name?: string | null; channel_id?: string | null; message_id?: string | null; guild_id?: string | null;
};

type Issue = {
  id: string; public_id: string | null; title: string; description: string; category: string; resource_name: string | null;
  severity: string; status: string; report_count: number; first_seen: string; last_seen: string; updated_at: string;
  aliases: string[]; symptoms: string[]; reproduction_steps?: string[]; reported_locations?: string[]; community_summary?: string | null;
};

type Candidate = {
  id: string; sample_text: string; normalized_text: string; topic: string | null; related_terms: string[];
  occurrence_count: number; confirmed_count: number; status: string; matched_issue_id: string | null;
  first_seen: string; last_seen: string; recent_samples?: ReportEvidence[];
};

type IssueCategory = { key: string; label: string; description: string; sort_order: number; enabled: boolean };
type IssueSettings = { categories: IssueCategory[] };
type Params = Promise<{ q?: string; status?: string; severity?: string; sort?: string; incoming?: string; category?: string }>;

const severities = ['low','medium','high','critical'];
function pretty(value: string) { return value.replaceAll('_',' '); }
function date(value: string) { try { return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(value)); } catch { return value; } }
function searchable(issue: Issue) { return [issue.title,issue.description,issue.category,issue.resource_name,issue.community_summary,...(issue.aliases||[]),...(issue.symptoms||[]),...(issue.reproduction_steps||[]),...(issue.reported_locations||[])].filter(Boolean).join(' ').toLowerCase(); }
function discordJump(item: ReportEvidence) { if (!item.guild_id || !item.channel_id || !item.message_id) return null; return `https://discord.com/channels/${item.guild_id}/${item.channel_id}/${item.message_id}`; }

export default async function IssuesPage({ searchParams }: { searchParams: Params }) {
  const params = await searchParams;
  let issues: Issue[] = [];
  let candidates: Candidate[] = [];
  let settings: IssueSettings = { categories: [] };
  let loadError = '';
  let access=null;
  try {
    [issues,candidates,settings,access] = await Promise.all([api<Issue[]>('/api/issues'),api<Candidate[]>('/api/issues/candidates'),api<IssueSettings>('/api/issues/settings'),getDashboardAccess()]);
  } catch (error) { loadError = error instanceof Error ? error.message : 'Unable to load issue intelligence.'; }

  const categories = settings.categories.filter(row => row.enabled || issues.some(issue => issue.category === row.key));
  const categoryName = new Map(categories.map(row => [row.key,row.label]));
  const q = String(params.q || '').trim().toLowerCase();
  const status = String(params.status || 'active');
  const severity = String(params.severity || 'all');
  const category = String(params.category || 'all');
  const sort = String(params.sort || 'activity');
  const incoming = String(params.incoming || 'open');

  const visibleIssues = issues.filter(issue => {
    if (status === 'active' && ['resolved','wont_fix'].includes(issue.status)) return false;
    if (status !== 'active' && status !== 'all' && issue.status !== status) return false;
    if (severity !== 'all' && issue.severity !== severity) return false;
    if (category !== 'all' && issue.category !== category) return false;
    if (q && !searchable(issue).includes(q)) return false;
    return true;
  });
  visibleIssues.sort((a,b) => {
    if (sort === 'reports') return b.report_count-a.report_count;
    if (sort === 'title') return a.title.localeCompare(b.title);
    if (sort === 'severity') return severities.indexOf(b.severity)-severities.indexOf(a.severity);
    return new Date(b.last_seen).getTime()-new Date(a.last_seen).getTime();
  });

  const visibleCandidates = candidates.filter(candidate => incoming === 'all' || (incoming === 'open' ? ['detected','reported'].includes(candidate.status) : candidate.status === incoming));
  const linkableIssues = issues.filter(issue => !['resolved','wont_fix'].includes(issue.status));
  const openIssues = linkableIssues.length;
  const incomingCount = candidates.filter(row => ['detected','reported'].includes(row.status)).length;
  const affected = issues.reduce((sum,row)=>sum+Number(row.report_count||0),0);

  return <>
    <header className="pageHeader compactPageHeader">
      <div><p className="eyebrow">BUG INTELLIGENCE</p><h1>Issues</h1><p>Review incoming reports and monitor known issues. Creation and editing only appear when you explicitly request them.</p></div>
      {(can(access,'settings.issues.manage')||can(access,'issues.create'))?<div className="headerActions">{can(access,'settings.issues.manage')?<Link className="button" href="/settings/issues">Settings</Link>:null}{can(access,'issues.create')?<details className="createDropdown"><summary className="button primary">+ Create</summary><div className="createDropdownMenu">{can(access,'issues.ai')?<Link href="/issues/create?mode=ai"><strong>✨ Create with AI</strong><span>Paste reports, notes, or logs and let Saucin AI structure the known issue.</span></Link>:null}<Link href="/issues/create?mode=manual"><strong>Create manually</strong><span>Fill every known-issue field yourself.</span></Link></div></details>:null}</div>:null}
    </header>

    <div className="librarySummaryBar"><span><strong>{openIssues}</strong> active</span><span><strong>{incomingCount}</strong> incoming</span><span><strong>{affected}</strong> affected reports</span></div>
    {loadError ? <div className="alert error">Could not load issues: {loadError}</div> : null}

    <section className="issueViewPanel">
      <div className="issueSectionHeader"><div><span className="sectionLabel">INCOMING</span><h2>Incoming possible issues</h2><p>Unmatched player reports that need review, linking, promotion, or dismissal.</p></div><span className="countPill">{visibleCandidates.length}</span></div>
      <form className="issueIncomingToolbar" method="get" action="/issues">
        <input type="hidden" name="q" value={params.q || ''}/><input type="hidden" name="status" value={params.status || 'active'}/><input type="hidden" name="severity" value={params.severity || 'all'}/><input type="hidden" name="sort" value={params.sort || 'activity'}/><input type="hidden" name="category" value={params.category || 'all'}/>
        <select className="input select" name="incoming" defaultValue={incoming}><option value="open">Needs review</option><option value="all">All incoming</option><option value="detected">Detected</option><option value="reported">Confirmed reports</option><option value="promoted">Linked / promoted</option><option value="dismissed">Dismissed</option></select>
        <button className="button" type="submit">Apply</button>
      </form>
      <div className="incomingRows">
        {visibleCandidates.length===0 ? <div className="emptyLibrary"><strong>No incoming reports</strong><span>Nothing matches the current incoming filter.</span></div> : visibleCandidates.map(candidate => <details className="incomingRow" key={candidate.id}>
          <summary><div className="incomingPrimary"><strong>{candidate.topic || 'Possible server issue'}</strong><span>{candidate.sample_text}</span></div><div className="incomingMeta"><span>{candidate.occurrence_count} mentions</span><span>{candidate.confirmed_count} confirmed</span><span className={`statusBadge status-${candidate.status}`}>{pretty(candidate.status)}</span></div></summary>
          <div className="incomingDetail">
            {candidate.related_terms?.length ? <div className="tagCloud">{candidate.related_terms.map(term=><span key={term}>{term}</span>)}</div> : null}
            <div className="incomingSeen">First seen {date(candidate.first_seen)} · Last seen {date(candidate.last_seen)}</div>
            {candidate.recent_samples?.length ? <div className="issueEvidenceBlock"><div className="issueEvidenceHeading"><strong>Recent player examples</strong><span>{candidate.recent_samples.length} preserved</span></div>{candidate.recent_samples.map((sample,index)=>{const jump=discordJump(sample);return <div className="issueEvidenceRow" key={`${candidate.id}-${sample.id||index}`}><div><strong>{sample.author_name||sample.discord_user_id||'Discord user'}</strong><small>{sample.channel_name?`#${sample.channel_name} · `:''}{date(sample.created_at)}</small><p>{sample.report_text}</p></div>{jump?<a className="button subtle" href={jump} target="_blank" rel="noreferrer">Open in Discord</a>:null}</div>})}</div> : null}
            {['detected','reported'].includes(candidate.status)&&can(access,'issues.triage') ? <div className="incomingActions">
              <form action={linkCandidateAction.bind(null,candidate.id)} className="inlineIssueAction"><select className="input select" name="issue_id" required defaultValue=""><option value="" disabled>Link to existing issue…</option>{linkableIssues.map(issue=><option key={issue.id} value={issue.id}>{issue.public_id||`BUG-${issue.id}`} · {issue.title}</option>)}</select><button className="button" type="submit">Link</button></form>
              {can(access,'issues.create')?<Link className="button primary" href={`/issues/create?candidate=${candidate.id}`}>Promote to Known Issue</Link>:null}
              <form action={candidateStatusAction.bind(null,candidate.id)}><input type="hidden" name="status" value="dismissed"/><button className="button subtle" type="submit">Dismiss</button></form>
            </div> : <div className="incomingSeen">This incoming report is currently marked <strong>{pretty(candidate.status)}</strong>.</div>}
          </div>
        </details>)}
      </div>
    </section>

    <section className="issueViewPanel">
      <div className="issueSectionHeader"><div><span className="sectionLabel">KNOWN</span><h2>Known issues</h2><p>Tracked bugs and their current status. Open one to view details; editing is a separate action.</p></div><span className="countPill">{visibleIssues.length}</span></div>
      <form className="knownIssueToolbar" method="get" action="/issues">
        <input className="input" name="q" defaultValue={params.q || ''} placeholder="Search known issues…"/>
        <select className="input select" name="category" defaultValue={category}><option value="all">All categories</option>{categories.map(item=><option key={item.key} value={item.key}>{item.label}</option>)}</select>
        <select className="input select" name="status" defaultValue={status}><option value="active">Active</option><option value="all">All statuses</option><option value="new">New</option><option value="acknowledged">Acknowledged</option><option value="investigating">Investigating</option><option value="fix_in_progress">Fix in progress</option><option value="testing">Testing</option><option value="monitoring">Monitoring</option><option value="resolved">Resolved</option><option value="wont_fix">Won't fix</option></select>
        <select className="input select" name="severity" defaultValue={severity}><option value="all">All severity</option>{severities.map(v=><option key={v} value={v}>{pretty(v)}</option>)}</select>
        <select className="input select" name="sort" defaultValue={sort}><option value="activity">Recent activity</option><option value="reports">Most affected</option><option value="severity">Severity</option><option value="title">Title A–Z</option></select>
        <input type="hidden" name="incoming" value={incoming}/><button className="button" type="submit">Filter</button>
      </form>
      <div className="libraryTableWrap"><table className="libraryTable issueLibraryTable"><thead><tr><th>Issue</th><th>Category / Resource</th><th>Status</th><th>Severity</th><th>Affected</th><th>Updated</th></tr></thead><tbody>
        {visibleIssues.map(issue=><tr key={issue.id}><td><Link className="articleTitleLink" href={`/issues/${issue.id}`}><strong>{issue.public_id||`BUG-${issue.id}`} · {issue.title}</strong><small>{issue.description||issue.community_summary||'No description yet.'}</small></Link></td><td><span>{categoryName.get(issue.category)||pretty(issue.category)}</span><small className="tableSubtext">{issue.resource_name||'Resource not set'}</small></td><td><span className={`statusBadge status-${issue.status}`}>{pretty(issue.status)}</span></td><td><span className={`statusBadge severity-${issue.severity}`}>{pretty(issue.severity)}</span></td><td><strong>{issue.report_count}</strong></td><td>{date(issue.last_seen||issue.updated_at)}</td></tr>)}
        {visibleIssues.length===0?<tr><td colSpan={6}><div className="emptyLibrary"><strong>No known issues found</strong><span>Try changing the filters or create a new known issue.</span></div></td></tr>:null}
      </tbody></table></div>
    </section>
  </>;
}
