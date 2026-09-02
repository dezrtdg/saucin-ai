import Link from 'next/link';
import { redirect } from 'next/navigation';
import { api } from '../../lib/api';
import { can, getDashboardAccess } from '../../lib/permissions';
import styles from './moderation.module.css';

type Case={id:number;public_id:string;author_name:string|null;discord_user_id:string;rule_title:string;confidence:number|string;status:string;message_content:string;recommended_action:string;delete_message_recommended:boolean;prior_confirmed_count:number;offense_number:number;created_at:string;channel_name:string|null;staff_review_required?:boolean;live_action_status?:string;player_contested_at?:string|null};
type ContestedCase={id:number;public_id:string;author_name:string|null;discord_user_id:string;rule_title:string;message_content:string;confidence:number|string;status:string;offense_number:number;player_contested_at:string};
type Data={mode:'off'|'observe';minimum_confidence:number;stats:{pending:number;confirmed_30d:number;dismissed_30d:number;detected_24h:number};cases:Case[]};
type LiveState={effective_mode:'off'|'observe'|'live';live_enabled:boolean;pending_actions:number;failed_actions_24h:number};
type ContestedData={cases:ContestedCase[]};
function pct(v:number|string){return `${Math.round(Number(v)*100)}%`}
function when(v:string){return new Date(v).toLocaleString()}
function recommendation(c:Case){
  const parts=[c.recommended_action.replaceAll('_',' ')];
  if(c.delete_message_recommended) parts.push('delete message');
  if(c.staff_review_required||(c.offense_number||1)>=4) parts.push('staff follow-up');
  return [...new Set(parts)].join(' + ');
}
function liveStatus(c:Case){
  const status=String(c.live_action_status||'not_applicable');
  return status==='not_applicable'?'':` · live ${status.replaceAll('_',' ')}`;
}

export default async function ModerationPage({searchParams}:{searchParams:Promise<{status?:string}>}){
  const access=await getDashboardAccess(); if(!can(access,'moderation.view')) redirect('/');
  const q=await searchParams; const status=['pending','confirmed','dismissed'].includes(String(q.status||''))?String(q.status):'';
  const [data,live,contested]=await Promise.all([
    api<Data>(`/api/moderation/cases${status?`?status=${status}`:''}`),
    api<LiveState>('/api/moderation/live'),
    api<ContestedData>('/api/moderation/feedback/contested?limit=10').catch(()=>({cases:[]}))
  ]);
  const mode=live.effective_mode;
  const modeTitle=mode==='live'?'Live Enforcement is active':mode==='observe'?'Observe Mode is active':'Moderation detection is off';
  const modeText=mode==='live'
    ? 'Successful live reminders, warnings, and timeouts automatically confirm the case and advance future escalation. Staff can dismiss a case to correct the history.'
    : mode==='observe'
      ? 'Saucin AI creates cases for staff review but does not take player-facing moderation actions. Staff confirmation is required before an Observe case counts.'
      : 'Enable Observe Mode or Live Enforcement in Settings when you are ready.';
  return <>
    <header className="pageHeader compactPageHeader"><div><p className="eyebrow">{mode==='live'?'LIVE ENFORCEMENT':mode==='observe'?'OBSERVE MODE':'MODERATION'}</p><h1>Moderation</h1><p>Review Discord-rule detections, automated action results, player feedback, and repeat history.</p></div>{can(access,'moderation.configure')?<Link className="button" href="/settings/moderation">Moderation Settings</Link>:null}</header>
    <div className={`${styles.modeBanner} ${mode==='off'?styles.modeOff:''}`}><div><strong>{modeTitle}</strong><p>{modeText}</p></div><span className={styles.observePill}>{mode.toUpperCase()}</span></div>
    <div className={styles.stats}><div className={styles.stat}><span>Pending review</span><strong>{data.stats.pending||0}</strong></div><div className={styles.stat}><span>Player contested</span><strong>{contested.cases.length||0}</strong></div><div className={styles.stat}><span>Live actions pending</span><strong>{live.pending_actions||0}</strong></div><div className={styles.stat}><span>Live action issues 24h</span><strong>{live.failed_actions_24h||0}</strong></div></div>
    {contested.cases.length?<section className="panel"><div className="panelTitle"><div><h2>Player-contested cases</h2><p>These members clicked Incorrect and have not yet received a human staff outcome. Review the saved conversation context before confirming or dismissing.</p></div><span className="badge">{contested.cases.length} NEED REVIEW</span></div><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Case</th><th>Member / message</th><th>Rule</th><th>Confidence</th><th>Contested</th></tr></thead><tbody>{contested.cases.map(c=><tr key={c.id}><td><Link className={styles.caseLink} href={`/moderation/${c.id}`}><strong>{c.public_id}</strong><small>Offense #{c.offense_number||1}</small></Link></td><td><Link className={styles.caseLink} href={`/moderation/${c.id}`}><strong>{c.author_name||c.discord_user_id}</strong><small>{c.message_content}</small></Link></td><td><strong>{c.rule_title}</strong></td><td className={styles.confidence}>{pct(c.confidence)}</td><td>{when(c.player_contested_at)}</td></tr>)}</tbody></table></div></section>:null}
    <div className={styles.filters}><Link className={`${styles.filter} ${!status?styles.active:''}`} href="/moderation">All</Link>{['pending','confirmed','dismissed'].map(s=><Link key={s} className={`${styles.filter} ${status===s?styles.active:''}`} href={`/moderation?status=${s}`}>{s[0].toUpperCase()+s.slice(1)}</Link>)}</div>
    <section className="panel"><div className="panelTitle"><div><h2>Moderation cases</h2><p>Live cases auto-confirm after a successful primary action; staff can still dismiss/correct them. Failed primary actions stay pending.</p></div><span className="badge">{data.cases.length} shown</span></div>
      {data.cases.length?<div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Case</th><th>Member / message</th><th>Rule</th><th>Confidence</th><th>Status</th><th>Detected</th></tr></thead><tbody>{data.cases.map(c=><tr key={c.id}><td><Link className={styles.caseLink} href={`/moderation/${c.id}`}><strong>{c.public_id}</strong><small>{c.channel_name?`#${c.channel_name}`:'Discord'}{c.player_contested_at?' · PLAYER CONTESTED':''}</small></Link></td><td><Link className={styles.caseLink} href={`/moderation/${c.id}`}><strong>{c.author_name||c.discord_user_id}</strong><small>{c.message_content}</small></Link></td><td><strong>{c.rule_title}</strong><small className={styles.ruleEscalation}>Offense #{c.offense_number||1} · {recommendation(c)}{liveStatus(c)}</small></td><td className={styles.confidence}>{pct(c.confidence)}</td><td><span className={`${styles.badge} ${styles[c.status as 'pending']||''}`}>{c.status}</span></td><td>{when(c.created_at)}</td></tr>)}</tbody></table></div>:<div className={styles.empty}>No moderation cases match this view yet.</div>}
    </section>
  </>;
}
