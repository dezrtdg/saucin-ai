import Link from 'next/link';
import { api } from '../../lib/api';
import { can,getDashboardAccess } from '../../lib/permissions';
import LiveRefresh from '../../components/LiveRefresh';
import ActionButton from '../../components/ActionButton';
import { acknowledgeTxEventAction,resolveTxEventAction } from './actions';

type Overview={
  connection:'online'|'stale'|'offline'|'not_configured';
  collector:null|{collector_id:string;server_name:string;hostname:string;txdata_path:string;collector_version:string;first_seen_at:string;last_heartbeat_at:string;metadata:Record<string,unknown>};
  stats:{open_errors:number;open_warnings:number;events_24h:number;matched_issues_24h:number;occurrences_24h:number};
};
type Event={
  id:string;event_type:string;severity:string;category:string;resource_name:string|null;message:string;payload:Record<string,unknown>;
  occurred_at:string;first_seen_at:string;last_seen_at:string;repeat_count:number;status:string;source_file:string|null;line_number:number|null;
  acknowledged_at:string|null;acknowledged_by_user_id:string|null;matched_issue_id:string|null;issue_public_id:string|null;issue_title:string|null;
};
type Params=Promise<{status?:string;severity?:string;category?:string;resource?:string;q?:string}>;

function date(value:string|null|undefined){if(!value)return 'Never';try{return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit'}).format(new Date(value));}catch{return String(value);}}
function ago(value:string|null|undefined){if(!value)return 'never';const seconds=Math.max(0,Math.floor((Date.now()-new Date(value).getTime())/1000));if(seconds<60)return `${seconds}s ago`;const minutes=Math.floor(seconds/60);if(minutes<60)return `${minutes}m ago`;const hours=Math.floor(minutes/60);return hours<48?`${hours}h ago`:`${Math.floor(hours/24)}d ago`;}
function pretty(value:string){return value.replace(/[._-]+/g,' ').replace(/\b\w/g,letter=>letter.toUpperCase());}

export default async function TxAdminPage({searchParams}:{searchParams:Params}){
  const params=await searchParams;
  const status=['all','open','acknowledged','resolved'].includes(String(params.status))?String(params.status):'open';
  const severity=['all','info','warning','error','critical'].includes(String(params.severity))?String(params.severity):'all';
  const category=String(params.category||'all');const resource=String(params.resource||'');const q=String(params.q||'');
  const query=new URLSearchParams({status,severity,category,resource,q,limit:'150'});
  let overview:Overview={connection:'not_configured',collector:null,stats:{open_errors:0,open_warnings:0,events_24h:0,matched_issues_24h:0,occurrences_24h:0}};
  let events:Event[]=[];let loadError='';let access=null;
  try{[overview,events,access]=await Promise.all([api<Overview>('/api/txadmin/overview'),api<Event[]>(`/api/txadmin/events?${query}`),getDashboardAccess()]);}
  catch(error){loadError=error instanceof Error?error.message:'Unable to load server intelligence.';}
  const canManage=can(access,'txadmin.manage');
  const connectionLabel=overview.connection==='online'?'Collector online':overview.connection==='stale'?'Collector delayed':overview.connection==='offline'?'Collector offline':'Setup required';
  const fxServerRunning=overview.collector?.metadata?.fxserver_running===true;

  return <>
    <LiveRefresh interval={20000}/>
    <header className="pageHeader compactPageHeader txHeader"><div><p className="eyebrow">SERVER INTELLIGENCE</p><h1>txAdmin</h1><p>Important FiveM and resource events, grouped into a quiet queue. Player identifiers, IP addresses, and secrets are redacted before storage.</p></div><div className={`status txConnection ${overview.connection}`}><span/>{connectionLabel}</div></header>
    {loadError?<div className="alert error">Could not load txAdmin intelligence: {loadError}</div>:null}

    <section className="txSummary">
      <div className="txCollectorCard"><div className={`txCollectorIcon ${overview.connection}`}>◎</div><div><small>COLLECTOR</small><strong>{overview.collector?.hostname||'Windows collector not connected'}</strong><span>{overview.collector?`Heartbeat ${ago(overview.collector.last_heartbeat_at)} · FXServer ${fxServerRunning?'running':'not detected'} · v${overview.collector.collector_version}`:'Install the collector after deploying this update.'}</span></div></div>
      <div className="txMetric critical"><small>OPEN ERRORS</small><strong>{Number(overview.stats.open_errors||0)}</strong><span>need attention</span></div>
      <div className="txMetric warning"><small>WARNINGS</small><strong>{Number(overview.stats.open_warnings||0)}</strong><span>currently open</span></div>
      <div className="txMetric"><small>OCCURRENCES</small><strong>{Number(overview.stats.occurrences_24h||0)}</strong><span>last 24 hours</span></div>
      <div className="txMetric matched"><small>KNOWN ISSUE MATCHES</small><strong>{Number(overview.stats.matched_issues_24h||0)}</strong><span>last 24 hours</span></div>
      <div className={`txMetric process ${overview.collector?(fxServerRunning?'running':'stopped'):''}`}><small>FXSERVER</small><strong>{overview.collector?(fxServerRunning?'Online':'Stopped'):'—'}</strong><span>exact process state</span></div>
    </section>

    {overview.collector?<details className="consolePanel txCollectorDetails"><summary><div><strong>Collector details</strong><span>{overview.collector.server_name} · {overview.collector.hostname}</span></div><b>View</b></summary><dl><div><dt>txData path</dt><dd>{overview.collector.txdata_path}</dd></div><div><dt>Collector ID</dt><dd>{overview.collector.collector_id}</dd></div><div><dt>First connected</dt><dd>{date(overview.collector.first_seen_at)}</dd></div><div><dt>Last heartbeat</dt><dd>{date(overview.collector.last_heartbeat_at)}</dd></div></dl></details>:null}

    <section className="issueViewPanel txEventPanel">
      <div className="issueSectionHeader"><div><span className="sectionLabel">EVENT QUEUE</span><h2>Server events</h2><p>Repeated matching lines are grouped. Open an event only when you need its source and technical details.</p></div><span className="countPill">{events.length}</span></div>
      <form className="txFilters" method="get" action="/txadmin">
        <input className="input" name="q" defaultValue={q} placeholder="Search messages…"/>
        <input className="input" name="resource" defaultValue={resource} placeholder="Resource name…"/>
        <select className="input select" name="status" defaultValue={status}><option value="open">Open</option><option value="acknowledged">Acknowledged</option><option value="resolved">Resolved</option><option value="all">All statuses</option></select>
        <select className="input select" name="severity" defaultValue={severity}><option value="all">All severity</option><option value="critical">Critical</option><option value="error">Error</option><option value="warning">Warning</option><option value="info">Info</option></select>
        <select className="input select" name="category" defaultValue={category}><option value="all">All categories</option><option value="crash">Crash</option><option value="resource">Resource</option><option value="database">Database</option><option value="performance">Performance</option><option value="network">Network</option><option value="server">Server</option><option value="general">General</option></select>
        <button className="button" type="submit">Filter</button>
        <Link className="button subtle" href="/txadmin">Reset</Link>
      </form>
      <div className="txEvents">{events.length?events.map(event=><details className={`txEvent severity-${event.severity}`} key={event.id}>
        <summary><span className={`txSeverity ${event.severity}`}>{event.severity}</span><div className="txEventMessage"><strong>{event.resource_name?`${event.resource_name} · `:''}{event.message}</strong><span>{pretty(event.category)} · {pretty(event.event_type)}{event.issue_public_id?` · matched ${event.issue_public_id}`:''}</span></div>{Number(event.repeat_count)>1?<b className="txRepeat">×{event.repeat_count}</b>:null}<time>{ago(event.last_seen_at)}</time><span className={`statusBadge status-${event.status}`}>{pretty(event.status)}</span></summary>
        <div className="txEventDetail"><div className="txEventFacts"><dl><div><dt>First seen</dt><dd>{date(event.first_seen_at)}</dd></div><div><dt>Last seen</dt><dd>{date(event.last_seen_at)}</dd></div><div><dt>Source</dt><dd>{event.source_file||'Unknown'}{event.line_number?`:${event.line_number}`:''}</dd></div><div><dt>Category</dt><dd>{pretty(event.category)}</dd></div></dl>{event.issue_public_id?<Link className="txIssueMatch" href={`/issues/${event.matched_issue_id}`}><small>MATCHED KNOWN ISSUE</small><strong>{event.issue_public_id} · {event.issue_title}</strong><span>Open issue ›</span></Link>:null}</div>
          <pre>{event.message}</pre>
          {event.status==='acknowledged'&&event.acknowledged_at?<p className="txAcknowledged">Acknowledged {date(event.acknowledged_at)} by Discord user {event.acknowledged_by_user_id}.</p>:null}
          {canManage&&event.status!=='resolved'?<div className="txEventActions">{event.status==='open'?<form action={acknowledgeTxEventAction.bind(null,event.id)}><ActionButton label="Acknowledge" pendingLabel="Acknowledging"/></form>:null}<form action={resolveTxEventAction.bind(null,event.id)}><ActionButton label="Mark resolved" pendingLabel="Resolving" variant="primary"/></form></div>:null}
        </div>
      </details>):<div className="emptyLibrary"><strong>No events found</strong><span>The collector is quiet, or no events match these filters.</span></div>}</div>
    </section>
  </>;
}
