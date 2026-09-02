import Link from 'next/link';
import { redirect } from 'next/navigation';
import { api } from '../../../../lib/api';
import { can, getDashboardAccess } from '../../../../lib/permissions';
import { clearModerationDiagnosticsAction } from '../actions';
import styles from '../../../moderation/moderation.module.css';

type Diagnostic={
  id:number;result_code:string;result_label:string;channel_id:string|null;channel_name:string|null;
  discord_user_id:string|null;author_name:string|null;message_content:string;matched_rule_title:string|null;
  confidence:number|string|null;threshold:number|string|null;details:Record<string,unknown>|null;created_at:string;
};
type Data={enabled:boolean;mode:'off'|'observe';rows:Diagnostic[]};

const good=new Set(['case_created']);
const warn=new Set(['below_confidence','ai_no_match']);
const bad=new Set(['ai_error']);

function pct(value:number|string|null){if(value==null)return '—';return `${Math.round(Number(value)*100)}%`;}
function detailSummary(row:Diagnostic){
  const d=row.details||{};
  if(row.result_code==='skipped_global_exempt'){
    const roles=Array.isArray(d.matched_exempt_role_ids)?d.matched_exempt_role_ids:[];
    return roles.length?`Matched exempt role ID: ${roles.join(', ')}`:'Member matched a global exempt role.';
  }
  if(row.result_code==='skipped_channel_ignored') return 'The Channels page has this channel set to Ignored.';
  if(row.result_code==='skipped_channel_not_monitored') return 'The channel is not configured to monitor messages.';
  if(row.result_code==='skipped_no_candidate_rules') return 'No published moderation-eligible rules were available.';
  if(row.result_code==='skipped_no_eligible_rules') return 'Rules exist, but role/channel scope removed all of them.';
  if(row.result_code==='ai_no_match') return String(d.ai_reason||'AI did not consider the target message a supported violation.');
  if(row.result_code==='below_confidence') return String(d.ai_reason||'AI matched a rule but did not reach the configured threshold.');
  if(row.result_code==='ai_error') return String(d.error||'AI classification failed.');
  if(row.result_code==='case_created'){
    const offense=Number(d.offense_number||1);
    const action=String(d.recommended_action||'staff_review').replaceAll('_',' ');
    const reason=String(d.ai_reason||'Detection passed all gates and created a moderation case.');
    return `Offense #${offense} → ${action}. ${reason}`;
  }
  if(row.result_code==='skipped_mode_off') return 'Moderation mode was Off when this message was received.';
  if(row.result_code==='skipped_ai_unavailable') return 'AI classification was unavailable or disabled.';
  if(row.result_code==='skipped_issue_thread') return 'Issue-ticket threads bypass normal moderation processing.';
  return '';
}

export default async function ModerationDiagnosticsPage(){
  const access=await getDashboardAccess();
  if(!can(access,'moderation.configure')) redirect('/settings');

  const data=await api<Data>('/api/moderation/diagnostics?limit=150');

  return <>
    <header className="pageHeader">
      <div><p className="eyebrow">MODERATION</p><h1>Diagnostics</h1><p>See exactly why live Discord messages were detected, skipped, or rejected during Observe Mode.</p></div>
      <div className={styles.headerActions}><Link className="button" href="/settings/moderation">Moderation Settings</Link><Link className="button" href="/settings/moderation/diagnostics">Refresh</Link></div>
    </header>

    <div className={`${styles.info} ${data.enabled?styles.diagOn:styles.diagOff}`}>
      <strong>Diagnostics: {data.enabled?'ON':'OFF'}</strong>
      <span>{data.enabled?'Send a test message in Discord, then refresh this page. Saucin AI keeps only the newest 1,000 diagnostic events.':'Enable moderation diagnostics in Moderation Settings before sending a test message.'}</span>
    </div>

    <section className="panel">
      <div className="panelTitle">
        <div><h2>Recent live decisions</h2><p>Newest first. This records moderation decision gates only; it never performs a moderation action.</p></div>
        <form action={clearModerationDiagnosticsAction}><button className="button" type="submit">Clear diagnostics</button></form>
      </div>

      {data.rows.length?<div className={styles.tableWrap}><table className={styles.table}>
        <thead><tr><th>Result</th><th>Message</th><th>Channel / Member</th><th>Rule</th><th>Confidence</th><th>Time</th></tr></thead>
        <tbody>{data.rows.map(row=><tr key={row.id}>
          <td><span className={`${styles.diagBadge} ${good.has(row.result_code)?styles.diagGood:warn.has(row.result_code)?styles.diagWarn:bad.has(row.result_code)?styles.diagBad:styles.diagNeutral}`}>{row.result_label}</span><small className={styles.diagReason}>{detailSummary(row)}</small></td>
          <td><div className={styles.diagMessage}>{row.message_content||'—'}</div></td>
          <td><strong>#{row.channel_name||row.channel_id||'unknown'}</strong><small className={styles.diagMeta}>{row.author_name||row.discord_user_id||'unknown member'}</small></td>
          <td>{row.matched_rule_title||'—'}</td>
          <td><span className={styles.confidence}>{pct(row.confidence)}</span>{row.threshold!=null?<small className={styles.diagMeta}>threshold {pct(row.threshold)}</small>:null}</td>
          <td>{new Date(row.created_at).toLocaleString()}</td>
        </tr>)}</tbody>
      </table></div>:<div className={styles.empty}>No diagnostic events yet. Enable diagnostics, send a Discord test message, then refresh.</div>}
    </section>

    <div className={styles.info}>When we find the problem, turn diagnostics back off. Normal moderation cases remain available in the Moderation Queue.</div>
  </>;
}
