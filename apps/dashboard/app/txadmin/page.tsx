import Link from 'next/link';
import { api } from '../../lib/api';
import { can,getDashboardAccess } from '../../lib/permissions';
import LiveRefresh from '../../components/LiveRefresh';
import ActionButton from '../../components/ActionButton';
import DirectSettingsForm from '../../components/DirectSettingsForm';
import { acknowledgeTxEventAction,resolveTxEventAction } from './actions';

type Overview={
  connection:'online'|'stale'|'offline'|'not_configured';
  collector:null|{collector_id:string;server_name:string;hostname:string;txdata_path:string;collector_version:string;first_seen_at:string;last_heartbeat_at:string;metadata:Record<string,unknown>};
  stats:{attention_open:number;updates_available:number;startup_blockers:number;runtime_failures:number;matched_issues_24h:number;actionable_occurrences_24h:number;drafts_24h:number;suppressed_24h:number;routine_24h:number};
};
type Event={
  id:string;event_type:string;severity:string;category:string;resource_name:string|null;message:string;payload:Record<string,unknown>;
  occurred_at:string;first_seen_at:string;last_seen_at:string;repeat_count:number;status:string;source_file:string|null;line_number:number|null;
  acknowledged_at:string|null;acknowledged_by_user_id:string|null;matched_issue_id:string|null;issue_public_id:string|null;issue_title:string|null;
  issue_candidate_id:string|null;suppressed:boolean;suppression_reason:string|null;
  attention_kind:string;actionable:boolean;actionability_reason:string|null;
};
type TxSettings={group_window_minutes:number;auto_draft_enabled:boolean;draft_min_occurrences:number;alert_channel_id:string|null;alert_role_ids:string[];notify_critical:boolean;notify_recurring_errors:boolean;hide_alert_mentions:boolean;noise_patterns:string[];auto_link_issue_reports:boolean;correlation_min_confidence:number};
type SettingsData={settings:TxSettings;channels:Array<{id:string;name:string;category_name:string|null}>;roles:Array<{id:string;name:string;color:string}>};
type Params=Promise<{status?:string;severity?:string;category?:string;resource?:string;q?:string;noise?:string;view?:string}>;

function date(value:string|null|undefined){if(!value)return 'Never';try{return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit'}).format(new Date(value));}catch{return String(value);}}
function ago(value:string|null|undefined){if(!value)return 'never';const seconds=Math.max(0,Math.floor((Date.now()-new Date(value).getTime())/1000));if(seconds<60)return `${seconds}s ago`;const minutes=Math.floor(seconds/60);if(minutes<60)return `${minutes}m ago`;const hours=Math.floor(minutes/60);return hours<48?`${hours}h ago`:`${Math.floor(hours/24)}d ago`;}
function pretty(value:string){return value.replace(/[._-]+/g,' ').replace(/\b\w/g,letter=>letter.toUpperCase());}

export default async function TxAdminPage({searchParams}:{searchParams:Params}){
  const params=await searchParams;
  const status=['all','open','acknowledged','resolved'].includes(String(params.status))?String(params.status):'open';
  const severity=['all','info','warning','error','critical'].includes(String(params.severity))?String(params.severity):'all';
  const category=String(params.category||'all');const resource=String(params.resource||'');const q=String(params.q||'');
  const noise=['hide','only','all'].includes(String(params.noise))?String(params.noise):'hide';
  const view=['attention','updates','failures','history'].includes(String(params.view))?String(params.view):'attention';
  const query=new URLSearchParams({status,severity,category,resource,q,noise,view,limit:'150'});
  let overview:Overview={connection:'not_configured',collector:null,stats:{attention_open:0,updates_available:0,startup_blockers:0,runtime_failures:0,matched_issues_24h:0,actionable_occurrences_24h:0,drafts_24h:0,suppressed_24h:0,routine_24h:0}};
  let events:Event[]=[];let settingsData:SettingsData|null=null;let loadError='';let access=null;
  try{access=await getDashboardAccess();[overview,events]=await Promise.all([api<Overview>('/api/txadmin/overview'),api<Event[]>(`/api/txadmin/events?${query}`)]);if(can(access,'txadmin.manage'))settingsData=await api<SettingsData>('/api/txadmin/settings');}
  catch(error){loadError=error instanceof Error?error.message:'Unable to load server intelligence.';}
  const canManage=can(access,'txadmin.manage');
  const connectionLabel=overview.connection==='online'?'Collector online':overview.connection==='stale'?'Collector delayed':overview.connection==='offline'?'Collector offline':'Setup required';
  const fxServerRunning=overview.collector?.metadata?.fxserver_running===true;

  return <>
    <LiveRefresh interval={20000}/>
    <header className="pageHeader compactPageHeader txHeader"><div><p className="eyebrow">SERVER HEALTH</p><h1>txAdmin</h1><p>Only script updates and errors that may stop FXServer or a resource from starting or running appear here by default.</p></div><div className={`status txConnection ${overview.connection}`}><span/>{connectionLabel}</div></header>
    {loadError?<div className="alert error">Could not load txAdmin intelligence: {loadError}</div>:null}

    <section className="txSummary">
      <div className="txCollectorCard"><div className={`txCollectorIcon ${overview.connection}`}>◎</div><div><small>COLLECTOR</small><strong>{overview.collector?.hostname||'Windows collector not connected'}</strong><span>{overview.collector?`Heartbeat ${ago(overview.collector.last_heartbeat_at)} · FXServer ${fxServerRunning?'running':'not detected'} · v${overview.collector.collector_version}`:'Install the collector after deploying this update.'}</span></div></div>
      <div className="txMetric warning"><small>SCRIPT UPDATES</small><strong>{Number(overview.stats.updates_available||0)}</strong><span>available</span></div>
      <div className="txMetric critical"><small>STARTUP BLOCKERS</small><strong>{Number(overview.stats.startup_blockers||0)}</strong><span>resources unable to start</span></div>
      <div className="txMetric critical"><small>RUNTIME FAILURES</small><strong>{Number(overview.stats.runtime_failures||0)}</strong><span>may prevent normal operation</span></div>
      <div className="txMetric matched"><small>ISSUE LINKS</small><strong>{Number(overview.stats.matched_issues_24h||0)}</strong><span>matched in the last 24 hours</span></div>
      <div className={`txMetric process ${overview.collector?(fxServerRunning?'running':'stopped'):''}`}><small>FXSERVER</small><strong>{overview.collector?(fxServerRunning?'Online':'Stopped'):'—'}</strong><span>exact process state</span></div>
    </section>

    {overview.collector?<details className="consolePanel txCollectorDetails"><summary><div><strong>Collector details</strong><span>{overview.collector.server_name} · {overview.collector.hostname}</span></div><b>View</b></summary><dl><div><dt>txData path</dt><dd>{overview.collector.txdata_path}</dd></div><div><dt>Collector ID</dt><dd>{overview.collector.collector_id}</dd></div><div><dt>First connected</dt><dd>{date(overview.collector.first_seen_at)}</dd></div><div><dt>Last heartbeat</dt><dd>{date(overview.collector.last_heartbeat_at)}</dd></div></dl></details>:null}

    {canManage&&settingsData?<details className="consolePanel txCollectorDetails"><summary><div><strong>Automation and developer alerts</strong><span>Issue matching, grouping, notifications, and advanced history controls</span></div><b>Configure</b></summary>
      <DirectSettingsForm operation="txadmin.settings.update" className="knowledgeForm" idleLabel="Save txAdmin settings" pendingLabel="Saving txAdmin settings…" successMessage="txAdmin automation saved." refreshOnSuccess>
        <div className="formGrid">
          <label className="field"><span>Minimum issue-match confidence</span><input className="input" name="correlation_min_confidence" type="number" min="0.4" max="0.95" step="0.01" defaultValue={settingsData.settings.correlation_min_confidence}/><small>Higher values reduce automatic links. 0.55 works well for clear terms such as a garage name or resource.</small></label>
          <label className="settingToggleCard"><input name="auto_link_issue_reports" type="checkbox" defaultChecked={settingsData.settings.auto_link_issue_reports}/><span><strong>Link reports to server errors</strong><small>Attach likely txAdmin evidence to the private dashboard issue when a player confirms or adds details.</small></span></label>
          <label className="field"><span>Grouping window</span><input className="input" name="group_window_minutes" type="number" min="5" max="1440" defaultValue={settingsData.settings.group_window_minutes}/><small>Matching errors within this many minutes become one event with an occurrence count.</small></label>
          <label className="field"><span>Draft threshold</span><input className="input" name="draft_min_occurrences" type="number" min="2" max="1000" defaultValue={settingsData.settings.draft_min_occurrences}/><small>Create an incoming issue draft after this many matching occurrences.</small></label>
          <label className="settingToggleCard"><input name="auto_draft_enabled" type="checkbox" defaultChecked={settingsData.settings.auto_draft_enabled}/><span><strong>Create recurring failure drafts</strong><small>Only actionable startup/runtime failures can create a private issue draft.</small></span></label>
          <label className="field fieldWide"><span>Discord alert channel</span><select className="input select" name="alert_channel_id" defaultValue={settingsData.settings.alert_channel_id||''}><option value="">Dashboard only</option>{settingsData.channels.map(channel=><option key={channel.id} value={channel.id}>{channel.category_name?`${channel.category_name} → `:''}#{channel.name}</option>)}</select><small>Critical and recurring alerts are posted once per grouped event.</small></label>
          <div className="field fieldFull"><span>Developer roles to notify</span><div className="roleCheckGrid">{settingsData.roles.map(role=><label className="roleCheck" key={role.id}><input type="checkbox" name="alert_role_ids" value={role.id} defaultChecked={settingsData.settings.alert_role_ids.includes(role.id)}/><i style={{background:role.color}}/><span>{role.name}</span></label>)}</div><small>Leave blank to post the alert without pinging a role.</small></div>
          <label className="settingToggleCard"><input name="notify_critical" type="checkbox" defaultChecked={settingsData.settings.notify_critical}/><span><strong>Notify critical events</strong><small>Send one immediate Discord alert for a crash or FXServer stop.</small></span></label>
          <label className="settingToggleCard"><input name="notify_recurring_errors" type="checkbox" defaultChecked={settingsData.settings.notify_recurring_errors}/><span><strong>Notify recurring failures</strong><small>Alert only when an actionable, unmatched failure reaches the issue-draft threshold.</small></span></label>
          <label className="settingToggleCard"><input name="hide_alert_mentions" type="checkbox" defaultChecked={settingsData.settings.hide_alert_mentions}/><span><strong>Hide role mentions</strong><small>Place developer-role pings behind Discord spoiler formatting.</small></span></label>
          <label className="field fieldFull"><span>Noise patterns</span><textarea className="textarea compactTextarea" name="noise_patterns" rows={4} defaultValue={settingsData.settings.noise_patterns.join('\n')} placeholder="One harmless message fragment per line"/><small>Matching events are retained but hidden from the attention queue. Avoid broad words such as “error” or “failed.”</small></label>
        </div>
      </DirectSettingsForm>
    </details>:null}

    <section className="issueViewPanel txEventPanel">
      <div className="issueSectionHeader"><div><span className="sectionLabel">ATTENTION QUEUE</span><h2>{view==='updates'?'Script updates':view==='failures'?'Startup and runtime failures':view==='history'?'Complete event history':'What needs attention'}</h2><p>Repeated lines are grouped. {Number(overview.stats.routine_24h||0)} non-actionable events were quietly retained as history in the last 24 hours.</p></div><span className="countPill">{events.length}</span></div>
      <form className="txFilters" method="get" action="/txadmin">
        <select className="input select" name="view" defaultValue={view}><option value="attention">Attention required</option><option value="updates">Script updates</option><option value="failures">Startup/runtime failures</option><option value="history">Complete history</option></select>
        <input className="input" name="q" defaultValue={q} placeholder="Search messages…"/>
        <input className="input" name="resource" defaultValue={resource} placeholder="Resource name…"/>
        <select className="input select" name="status" defaultValue={status}><option value="open">Open</option><option value="acknowledged">Acknowledged</option><option value="resolved">Resolved</option><option value="all">All statuses</option></select>
        <select className="input select" name="severity" defaultValue={severity}><option value="all">All severity</option><option value="critical">Critical</option><option value="error">Error</option><option value="warning">Warning</option><option value="info">Info</option></select>
        <select className="input select" name="category" defaultValue={category}><option value="all">All categories</option><option value="crash">Crash</option><option value="resource">Resource</option><option value="database">Database</option><option value="performance">Performance</option><option value="network">Network</option><option value="server">Server</option><option value="general">General</option></select>
        <select className="input select" name="noise" defaultValue={noise}><option value="hide">Hide routine noise</option><option value="only">Routine noise only</option><option value="all">Include routine noise</option></select>
        <button className="button" type="submit">Filter</button>
        <Link className="button subtle" href="/txadmin">Reset</Link>
      </form>
      <div className="txEvents">{events.length?events.map(event=><details className={`txEvent severity-${event.severity}`} key={event.id}>
        <summary><span className={`txSeverity ${event.severity}`}>{event.attention_kind==='update_available'?'update':event.severity}</span><div className="txEventMessage"><strong>{event.resource_name?`${event.resource_name} · `:''}{event.message}</strong><span>{pretty(event.attention_kind)}{event.issue_public_id?` · linked to ${event.issue_public_id}`:event.issue_candidate_id?` · issue draft #${event.issue_candidate_id}`:!event.actionable?' · history only':''}</span></div>{Number(event.repeat_count)>1?<b className="txRepeat">×{event.repeat_count}</b>:null}<time>{ago(event.last_seen_at)}</time><span className={`statusBadge status-${event.status}`}>{pretty(event.status)}</span></summary>
        <div className="txEventDetail"><div className="txEventFacts"><dl><div><dt>First seen</dt><dd>{date(event.first_seen_at)}</dd></div><div><dt>Last seen</dt><dd>{date(event.last_seen_at)}</dd></div><div><dt>Source</dt><dd>{event.source_file||'Unknown'}{event.line_number?`:${event.line_number}`:''}</dd></div><div><dt>Category</dt><dd>{pretty(event.category)}</dd></div></dl>{event.issue_public_id?<Link className="txIssueMatch" href={`/issues/${event.matched_issue_id}`}><small>MATCHED KNOWN ISSUE</small><strong>{event.issue_public_id} · {event.issue_title}</strong><span>Open issue ›</span></Link>:null}</div>
          <pre>{event.message}</pre>
          {event.actionability_reason?<p className="txAcknowledged"><strong>Why this is shown:</strong> {event.actionability_reason}</p>:null}
          {event.suppressed&&event.suppression_reason?<p className="txAcknowledged">Hidden from the attention queue: {event.suppression_reason}.</p>:null}
          {event.issue_candidate_id&&!event.issue_public_id?<p className="txAcknowledged">Recurring activity created incoming issue draft #{event.issue_candidate_id}. Review it under Issues before promoting or linking it.</p>:null}
          {event.status==='acknowledged'&&event.acknowledged_at?<p className="txAcknowledged">Acknowledged {date(event.acknowledged_at)} by Discord user {event.acknowledged_by_user_id}.</p>:null}
          {canManage&&event.status!=='resolved'?<div className="txEventActions">{event.status==='open'?<form action={acknowledgeTxEventAction.bind(null,event.id)}><ActionButton label="Acknowledge" pendingLabel="Acknowledging"/></form>:null}<form action={resolveTxEventAction.bind(null,event.id)}><ActionButton label="Mark resolved" pendingLabel="Resolving" variant="primary"/></form></div>:null}
        </div>
      </details>):<div className="emptyLibrary"><strong>No action needed</strong><span>The collector is online and nothing matches this attention view.</span></div>}</div>
    </section>
  </>;
}
