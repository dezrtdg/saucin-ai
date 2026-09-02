import Link from 'next/link';
import { redirect } from 'next/navigation';
import { api } from '../../lib/api';
import { can, getDashboardAccess } from '../../lib/permissions';
import styles from './moderation.module.css';

type Case={id:number;public_id:string;author_name:string|null;discord_user_id:string;rule_title:string;confidence:number|string;status:string;message_content:string;recommended_action:string;delete_message_recommended:boolean;prior_confirmed_count:number;offense_number:number;created_at:string;channel_name:string|null};
type Data={mode:'off'|'observe';minimum_confidence:number;stats:{pending:number;confirmed_30d:number;dismissed_30d:number;detected_24h:number};cases:Case[]};
function pct(v:number|string){return `${Math.round(Number(v)*100)}%`}
function when(v:string){return new Date(v).toLocaleString()}

export default async function ModerationPage({searchParams}:{searchParams:Promise<{status?:string}>}){
  const access=await getDashboardAccess(); if(!can(access,'moderation.view')) redirect('/');
  const q=await searchParams; const status=['pending','confirmed','dismissed'].includes(String(q.status||''))?String(q.status):'';
  const data=await api<Data>(`/api/moderation/cases${status?`?status=${status}`:''}`);
  return <>
    <header className="pageHeader compactPageHeader"><div><p className="eyebrow">OBSERVE MODE</p><h1>Moderation</h1><p>Review possible Discord-rule violations detected by Saucin AI. No automatic member actions are enabled in v1.3.</p></div>{can(access,'moderation.configure')?<Link className="button" href="/settings/moderation">Moderation Settings</Link>:null}</header>
    <div className={`${styles.modeBanner} ${data.mode==='off'?styles.modeOff:''}`}><div><strong>{data.mode==='observe'?'Observe Mode is active':'Moderation detection is off'}</strong><p>{data.mode==='observe'?'Saucin AI can create cases, but it cannot warn, delete, timeout, or punish members.':'Enable Observe Mode in Settings when you are ready to collect detections.'}</p></div><span className={styles.observePill}>{data.mode.toUpperCase()}</span></div>
    <div className={styles.stats}><div className={styles.stat}><span>Pending review</span><strong>{data.stats.pending||0}</strong></div><div className={styles.stat}><span>Detected 24h</span><strong>{data.stats.detected_24h||0}</strong></div><div className={styles.stat}><span>Confirmed 30d</span><strong>{data.stats.confirmed_30d||0}</strong></div><div className={styles.stat}><span>Dismissed 30d</span><strong>{data.stats.dismissed_30d||0}</strong></div></div>
    <div className={styles.filters}><Link className={`${styles.filter} ${!status?styles.active:''}`} href="/moderation">All</Link>{['pending','confirmed','dismissed'].map(s=><Link key={s} className={`${styles.filter} ${status===s?styles.active:''}`} href={`/moderation?status=${s}`}>{s[0].toUpperCase()+s.slice(1)}</Link>)}</div>
    <section className="panel"><div className="panelTitle"><div><h2>Moderation cases</h2><p>AI detections are evidence for staff review, not final discipline decisions.</p></div><span className="badge">{data.cases.length} shown</span></div>
      {data.cases.length?<div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Case</th><th>Member / message</th><th>Rule</th><th>Confidence</th><th>Status</th><th>Detected</th></tr></thead><tbody>{data.cases.map(c=><tr key={c.id}><td><Link className={styles.caseLink} href={`/moderation/${c.id}`}><strong>{c.public_id}</strong><small>{c.channel_name?`#${c.channel_name}`:'Discord'}</small></Link></td><td><Link className={styles.caseLink} href={`/moderation/${c.id}`}><strong>{c.author_name||c.discord_user_id}</strong><small>{c.message_content}</small></Link></td><td><strong>{c.rule_title}</strong><small className={styles.ruleEscalation}>Offense #{c.offense_number||1} · {c.recommended_action.replaceAll('_',' ')}{c.delete_message_recommended?' + delete message':''}</small></td><td className={styles.confidence}>{pct(c.confidence)}</td><td><span className={`${styles.badge} ${styles[c.status as 'pending']||''}`}>{c.status}</span></td><td>{when(c.created_at)}</td></tr>)}</tbody></table></div>:<div className={styles.empty}>No moderation cases match this view yet.</div>}
    </section>
  </>;
}
