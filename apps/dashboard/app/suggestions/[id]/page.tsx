import Link from 'next/link';
import { notFound,redirect } from 'next/navigation';
import { api,DashboardApiError } from '../../../lib/api';
import { can,getDashboardAccess } from '../../../lib/permissions';
import SuggestionEditForm from '../../../components/SuggestionEditForm';
import SuggestionReplyComposer from '../../../components/SuggestionReplyComposer';
import SuggestionDeleteButton from '../../../components/SuggestionDeleteButton';
import LiveRefresh from '../../../components/LiveRefresh';
import styles from '../suggestions.module.css';

type Event={
  id:number;discord_user_id:string|null;suggestion_text:string;source:string;created_at:string;
  author_name:string|null;channel_name:string|null;channel_id:string|null;message_id:string|null;guild_id:string|null;
};
type Update={
  id:number;update_type:string;from_value:string|null;to_value:string|null;note:string|null;created_by:string|null;created_at:string;
};
type Suggestion={
  id:number;public_id:string|null;title:string;summary:string;category:string;status:string;mention_count:number;unique_supporters:number;
  staff_notes:string;related_terms:string[];community_context:string;discord_thread_id:string|null;
  first_seen:string;last_seen:string;created_at:string;updated_at:string;events:Event[];updates:Update[];
};
type Params=Promise<{id:string}>;
function pretty(value:string){return value.replaceAll('_',' ')}

export default async function SuggestionDetailPage({params}:{params:Params}){
  const access=await getDashboardAccess();
  if(!can(access,'suggestions.view')) redirect('/');
  const {id}=await params;
  if(!/^\d+$/.test(id)) notFound();
  let suggestion:Suggestion;
  try{suggestion=await api<Suggestion>(`/api/suggestions/${id}`);}catch(error){if(error instanceof DashboardApiError&&error.status===404)notFound();throw error;}
  const supporters=Number(suggestion.unique_supporters||suggestion.mention_count||0);
  const discordUrl=suggestion.discord_thread_id&&process.env.DISCORD_GUILD_ID
    ? `https://discord.com/channels/${process.env.DISCORD_GUILD_ID}/${suggestion.discord_thread_id}`
    : null;

  return <>
    <LiveRefresh interval={20000}/>
    <header className="pageHeader"><div><p className="eyebrow">{suggestion.public_id||`SUG-${suggestion.id}`}</p><h1>{suggestion.title}</h1><p>Review the clustered community request, linked discussion, supporting messages, and staff decision.</p></div><div className="headerActions">{discordUrl?<a className="button primary" href={discordUrl} target="_blank" rel="noreferrer">Open Discord discussion ↗</a>:null}<Link className="button" href="/suggestions">Back to Suggestions</Link></div></header>

    <div className={styles.detailGrid}>
      <div className={styles.stat}><span>Status</span><strong style={{textTransform:'capitalize'}}>{pretty(suggestion.status)}</strong></div>
      <div className={styles.stat}><span>Unique supporters</span><strong>{supporters}</strong></div>
      <div className={styles.stat}><span>Community messages</span><strong>{suggestion.events?.length||0}</strong></div>
      <div className={styles.stat}><span>Last seen</span><strong style={{fontSize:13}}>{new Date(suggestion.last_seen).toLocaleString()}</strong></div>
    </div>

    {can(access,'suggestions.manage')?<section className="panel" style={{marginBottom:22}}><div className="panelTitle"><div><h2>Staff review</h2><p>Edit the clean staff-facing record without losing the original community messages below.</p></div><span className={`${styles.status} ${styles[suggestion.status as keyof typeof styles]||''}`}>{pretty(suggestion.status)}</span></div><SuggestionEditForm suggestion={suggestion}/></section>:<section className="panel" style={{marginBottom:22}}><div className="panelTitle"><div><h2>Suggestion</h2><p>Read-only view.</p></div></div><div className={styles.sectionBody}><p className={styles.summary}>{suggestion.summary}</p></div></section>}

    {can(access,'suggestions.forum')?<section className="panel" style={{marginBottom:22}}><div className="panelTitle"><div><h2>Post a community update</h2><p>Reply to the linked forum discussion manually or let AI polish your rough draft.</p></div>{suggestion.discord_thread_id?<span className="badge">Discord linked</span>:<span className="badge">Not linked</span>}</div><SuggestionReplyComposer suggestionId={suggestion.id} threadLinked={Boolean(suggestion.discord_thread_id)} canUseAi={can(access,'suggestions.ai')}/></section>:null}

    {suggestion.community_context?<section className="panel" style={{marginBottom:22}}><div className="panelTitle"><div><h2>Community additions</h2><p>AI-organized context from the linked forum discussion. Original messages remain preserved below.</p></div></div><div className={styles.sectionBody}><p className={styles.summary}>{suggestion.community_context}</p></div></section>:null}

    {suggestion.related_terms?.length?<section className="panel" style={{marginBottom:22}}><div className="panelTitle"><div><h2>Detected concepts</h2><p>Terms Saucin AI uses to recognize differently-worded versions of the same idea.</p></div></div><div className={styles.sectionBody} style={{display:'flex',gap:8,flexWrap:'wrap'}}>{suggestion.related_terms.map(term=><span className="badge" key={term}>{term}</span>)}</div></section>:null}

    {suggestion.updates?.length?<section className="panel" style={{marginBottom:22}}>
      <div className="panelTitle"><div><h2>Staff activity</h2><p>Status changes, AI refinements, and replies posted from the dashboard.</p></div><span className="badge">{suggestion.updates.length} updates</span></div>
      {suggestion.updates.map(update=><div className={styles.event} key={update.id}><div className={styles.eventTop}><strong>{update.update_type==='staff_reply'?'Discord staff update':update.update_type==='status'?`Status: ${pretty(update.from_value||'unknown')} → ${pretty(update.to_value||'unknown')}`:pretty(update.update_type)}</strong><span>{new Date(update.created_at).toLocaleString()}</span></div>{update.note?<p>{update.note}</p>:null}<div className={styles.eventMeta}><span>{update.created_by||'Saucin AI'}</span></div></div>)}
    </section>:null}

    <section className="panel">
      <div className="panelTitle"><div><h2>Community history</h2><p>Original Discord wording is preserved so staff can judge what players actually requested.</p></div><span className="badge">{suggestion.events?.length||0} messages</span></div>
      {suggestion.events?.length?suggestion.events.map(event=>{
        const discordUrl=event.guild_id&&event.channel_id&&event.message_id?`https://discord.com/channels/${event.guild_id}/${event.channel_id}/${event.message_id}`:null;
        return <div className={styles.event} key={event.id}><div className={styles.eventTop}><strong>{event.author_name||event.discord_user_id||'Staff / unknown source'}</strong><span>{new Date(event.created_at).toLocaleString()}</span></div><p>{event.suggestion_text}</p><div className={styles.eventMeta}><span>Source: {pretty(event.source)}</span>{event.channel_name?<span>#{event.channel_name}</span>:null}{discordUrl?<a href={discordUrl} target="_blank" rel="noreferrer">Open Discord message ↗</a>:null}</div></div>;
      }):<div className="empty">No source messages are attached to this suggestion.</div>}
    </section>

    {can(access,'suggestions.delete')?<section className="dangerPanel"><div><strong>Delete suggestion</strong><p>Permanently removes the dashboard record and its linked Discord forum post. Community history and support records will also be deleted.</p></div><SuggestionDeleteButton suggestionId={suggestion.id} label={suggestion.public_id||`SUG-${suggestion.id}`}/></section>:null}
  </>;
}
