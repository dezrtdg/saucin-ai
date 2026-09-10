import Link from 'next/link';
import { redirect } from 'next/navigation';
import ModerationCalibrationTester from '../../../../components/ModerationCalibrationTester';
import { api } from '../../../../lib/api';
import { can,getDashboardAccess } from '../../../../lib/permissions';
import styles from '../../../moderation/moderation.module.css';

type Channel={id:string;name:string|null;mode:string;monitor_messages:boolean};
type RuleMetric={rule_article_id:number|null;rule_title:string;pending:number;confirmed:number;dismissed:number;member_reports:number;total:number;reviewed:number;dismissal_rate:number|null};
type Gate={result_code:string;count:number};
type Dismissal={id:number;public_id:string;rule_title:string;author_name:string|null;message_content:string;review_notes:string|null;reviewed_at:string};
type Data={
  settings:{mode:'off'|'observe';minimum_confidence:number};
  summary:{total_30d:number;pending_30d:number;confirmed_30d:number;dismissed_30d:number;reviewed_30d:number;member_reports_30d:number;contested_30d:number;dismissal_rate:number|null};
  readiness:{state:string;label:string;detail:string};
  rule_metrics:RuleMetric[];safety_gates:Gate[];recent_dismissals:Dismissal[];trusted_learning_examples:number;channels:Channel[];
};

function pct(value:number|null){return value==null?'Not enough data':`${Math.round(value*100)}%`;}
function when(value:string){return new Date(value).toLocaleString();}
function gateLabel(value:string){return ({context_safety_gate:'Context safety gate',skipped_benign_gaming_language:'Known gaming language',below_confidence:'Below confidence',ai_no_match:'No verified-rule match'} as Record<string,string>)[value]||value.replaceAll('_',' ');}

export default async function ModerationCalibrationPage(){
  const access=await getDashboardAccess();
  if(!can(access,'moderation.configure'))redirect('/settings');
  const data=await api<Data>('/api/moderation/calibration');
  const usefulGates=data.safety_gates.filter(g=>['context_safety_gate','skipped_benign_gaming_language','below_confidence','ai_no_match'].includes(g.result_code));

  return <>
    <header className="pageHeader">
      <div><p className="eyebrow">MODERATION QUALITY</p><h1>Calibration Center</h1><p>Test how Saucin AI interprets Discord messages, understand false positives, and tune safely before considering enforcement.</p></div>
      <div className={styles.headerActions}><Link className="button" href="/settings/moderation/diagnostics">Live Diagnostics</Link><Link className="button" href="/settings/moderation">Moderation Settings</Link></div>
    </header>

    <div className={`calibrationReadiness calibration-${data.readiness.state}`}><div><span className="sectionLabel">CURRENT RECOMMENDATION</span><strong>{data.readiness.label}</strong><p>{data.readiness.detail}</p></div><span className="badge">{data.settings.mode==='observe'?'OBSERVE ONLY':'MODERATION OFF'}</span></div>

    <section className="calibrationStats">
      <div><span>Reviewed · 30 days</span><strong>{data.summary.reviewed_30d}</strong><small>{data.summary.pending_30d} still pending</small></div>
      <div><span>Staff confirmed</span><strong>{data.summary.confirmed_30d}</strong><small>trusted violations</small></div>
      <div><span>Staff dismissed</span><strong>{data.summary.dismissed_30d}</strong><small>{pct(data.summary.dismissal_rate)} dismissal rate</small></div>
      <div><span>Learning examples</span><strong>{data.trusted_learning_examples}</strong><small>trusted staff outcomes</small></div>
    </section>

    <section className="panel">
      <div className="panelTitle"><div><h2>Safe message simulator</h2><p>Paste a target message and the conversation around it. The simulator uses the same conservative rule and context checks without saving a case.</p></div><span className="badge">NO DISCORD ACTIONS</span></div>
      <ModerationCalibrationTester channels={data.channels}/>
    </section>

    <div className="calibrationColumns">
      <section className="panel">
        <div className="panelTitle"><div><h2>Rule accuracy</h2><p>Staff-reviewed results from the last 30 days.</p></div><span className="badge">{data.rule_metrics.length} RULES</span></div>
        {data.rule_metrics.length?<div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Rule</th><th>Reviewed</th><th>Confirmed</th><th>Dismissed</th></tr></thead><tbody>{data.rule_metrics.map((rule,index)=><tr key={`${rule.rule_article_id||'report'}-${index}`}><td><strong>{rule.rule_title}</strong><small className={styles.diagMeta}>{rule.pending} pending · {rule.member_reports} member reports</small></td><td>{rule.reviewed}</td><td>{rule.confirmed}</td><td><span className={rule.dismissal_rate!=null&&rule.dismissal_rate>.15?'calibrationMetricWarn':''}>{rule.dismissed}{rule.reviewed?` · ${pct(rule.dismissal_rate)}`:''}</span></td></tr>)}</tbody></table></div>:<div className={styles.empty}>No moderation cases have been recorded in the last 30 days.</div>}
      </section>

      <section className="panel">
        <div className="panelTitle"><div><h2>Safety gates</h2><p>Messages prevented from becoming cases during diagnostic collection.</p></div><span className="badge">LAST 30 DAYS</span></div>
        {usefulGates.length?<div className="calibrationGateList">{usefulGates.map(g=><div key={g.result_code}><span>{gateLabel(g.result_code)}</span><strong>{g.count}</strong></div>)}</div>:<div className={styles.empty}>No safety-gate diagnostics are available. Enable diagnostics temporarily to collect them.</div>}
      </section>
    </div>

    <section className="panel">
      <div className="panelTitle"><div><h2>Recent false-positive corrections</h2><p>Staff dismissals become trusted examples that help prevent similar mistakes.</p></div><span className="badge">CALIBRATION DATA</span></div>
      {data.recent_dismissals.length?<div className="calibrationCorrectionList">{data.recent_dismissals.map(row=><Link href={`/moderation/${row.id}`} key={row.id}><div><strong>{row.public_id} · {row.rule_title}</strong><p>{row.message_content}</p><small>{row.author_name||'Discord member'} · {when(row.reviewed_at)}{row.review_notes?` · ${row.review_notes}`:''}</small></div><span>Review →</span></Link>)}</div>:<div className={styles.empty}>No staff-dismissed false positives have been recorded yet.</div>}
    </section>
  </>;
}
