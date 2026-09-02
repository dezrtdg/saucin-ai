import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { api } from '../../../lib/api';
import { can, getDashboardAccess } from '../../../lib/permissions';
import { reviewModerationCaseAction } from '../actions';
import styles from '../moderation.module.css';

type Event={id:number;event_type:string;actor_user_id:string|null;details:any;created_at:string};
type Case={id:number;public_id:string;guild_id:string;channel_id:string;channel_name:string|null;message_id:string;discord_user_id:string;author_name:string|null;message_content:string;rule_article_id:number|null;rule_title:string;confidence:number|string;ai_reason:string;evidence:string;recommended_action:string;delete_message_recommended:boolean;prior_confirmed_count:number;offense_number:number;repeat_window_days_used:number|null;action_ladder_snapshot:any;status:'pending'|'confirmed'|'dismissed';review_notes:string|null;reviewed_by_user_id:string|null;reviewed_at:string|null;created_at:string;events:Event[];user_confirmed_total:number;user_dismissed_total:number};
function pct(v:number|string){return `${Math.round(Number(v)*100)}%`}
function when(v:string|null){return v?new Date(v).toLocaleString():'—'}
function recommendation(c:Case){
  const parts=[c.recommended_action.replaceAll('_',' ')];
  if(c.delete_message_recommended) parts.push('delete message');
  if((c.offense_number||1)>=4 && c.recommended_action!=='staff_review') parts.push('staff review');
  return parts.join(' + ');
}

export default async function ModerationCasePage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{saved?:string}>}){
  const access=await getDashboardAccess(); if(!can(access,'moderation.view')) redirect('/');
  const [{id},query]=await Promise.all([params,searchParams]); if(!/^\d+$/.test(id)) notFound();
  let c:Case; try{c=await api<Case>(`/api/moderation/cases/${id}`);}catch{notFound();}
  const messageUrl=`https://discord.com/channels/${c.guild_id}/${c.channel_id}/${c.message_id}`;
  const staffReviewRequired=(c.offense_number||1)>=4;
  return <>
    <div className="detailBreadcrumb"><Link href="/moderation">← Moderation</Link></div>
    <header className="pageHeader compactPageHeader"><div><p className="eyebrow">{c.public_id}</p><h1>{c.rule_title}</h1><p>Observe-only detection involving {c.author_name||c.discord_user_id} · {pct(c.confidence)} confidence.</p></div><span className={`${styles.badge} ${styles[c.status]}`}>{c.status}</span></header>
    {query.saved?<div className="alert success">Moderation case updated.</div>:null}
    {staffReviewRequired?<div className={styles.info}><strong>Staff review required:</strong> this is a 4th+ confirmed-repeat escalation level under the standard moderation ladder.</div>:null}
    <div className={styles.detailGrid}><div>
      <section className={styles.section}><h2>Target message</h2><p className={styles.evidence}>{c.message_content}</p><a className={styles.discordLink} href={messageUrl} target="_blank" rel="noreferrer">Open original Discord message ↗</a></section>
      <section className={styles.section}><h2>AI assessment</h2><p>{c.ai_reason||'No additional rationale was saved.'}</p>{c.evidence?<><h2>Evidence</h2><p className={styles.evidence}>{c.evidence}</p></>:null}<div className={styles.info}>This assessment is not discipline. Observe Mode never automatically warns, deletes, or times out the member.</div><div className={styles.escalationBox}><strong>Repeat-offense simulation</strong><span>This was evaluated as offense #{c.offense_number||1} because Saucin AI found {c.prior_confirmed_count||0} prior staff-confirmed case{Number(c.prior_confirmed_count||0)===1?'':'s'} for this same rule within {c.repeat_window_days_used||'the configured'} day{Number(c.repeat_window_days_used||0)===1?'':'s'}. Pending or dismissed cases do not advance the ladder.</span></div></section>
      {can(access,'moderation.review')?<section className={`${styles.section} ${styles.reviewBox}`}><h2>{staffReviewRequired?'Required staff review':'Staff review'}</h2><form action={reviewModerationCaseAction.bind(null,id,'confirmed')}><textarea className="textarea" name="notes" defaultValue={c.review_notes||''} placeholder="Optional staff notes…"/><div className={styles.reviewActions}><button className={`button ${styles.confirm}`} type="submit">Confirm detection</button><button className={`button ${styles.dismiss}`} formAction={reviewModerationCaseAction.bind(null,id,'dismissed')} type="submit">Dismiss</button>{c.status!=='pending'?<button className="button" formAction={reviewModerationCaseAction.bind(null,id,'pending')} type="submit">Reopen</button>:null}</div></form></section>:null}
      <section className={styles.section}><h2>Case timeline</h2><div className={styles.historyList}>{(c.events||[]).map(e=><div className={styles.historyRow} key={e.id}><span>{when(e.created_at)}</span><strong>{e.event_type.replaceAll('_',' ')}</strong><span>{e.actor_user_id||'Saucin AI'}</span></div>)}</div></section>
    </div><aside>
      <section className={styles.section}><h2>Case details</h2><div className={styles.meta}><div><span>Confidence</span><strong>{pct(c.confidence)}</strong></div><div><span>Would recommend</span><strong>{recommendation(c)}</strong></div><div><span>Detected</span><strong>{when(c.created_at)}</strong></div><div><span>Channel</span><strong>{c.channel_name?`#${c.channel_name}`:c.channel_id}</strong></div><div><span>Offense level</span><strong>#{c.offense_number||1}</strong></div><div><span>Prior confirmed</span><strong>{c.prior_confirmed_count}</strong></div><div><span>Repeat window</span><strong>{c.repeat_window_days_used?`${c.repeat_window_days_used} days`:'—'}</strong></div><div><span>Staff review</span><strong>{staffReviewRequired?'Required':'Standard case review'}</strong></div><div><span>Mode</span><strong>Observe only</strong></div></div></section>
      <section className={styles.section}><h2>Member history</h2><div className={styles.meta}><div><span>Confirmed total</span><strong>{c.user_confirmed_total||0}</strong></div><div><span>Dismissed total</span><strong>{c.user_dismissed_total||0}</strong></div></div><Link className="button" href={`/moderation/users/${encodeURIComponent(c.discord_user_id)}`}>View full history</Link></section>
      {c.reviewed_at?<section className={styles.section}><h2>Last review</h2><p>{when(c.reviewed_at)}<br/>{c.reviewed_by_user_id||'Staff'}</p>{c.review_notes?<p>{c.review_notes}</p>:null}</section>:null}
    </aside></div>
  </>;
}
