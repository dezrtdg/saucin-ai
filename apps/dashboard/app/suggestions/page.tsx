import Link from 'next/link';
import { redirect } from 'next/navigation';
import { api } from '../../lib/api';
import { can,getDashboardAccess } from '../../lib/permissions';
import styles from './suggestions.module.css';

type Suggestion={
  id:number;public_id:string|null;title:string;summary:string;category:string;status:string;mention_count:number;
  unique_supporters:number;event_count:number;last_seen:string;created_at:string;
};
type Params=Promise<{status?:string}>;

const statuses=['candidate','reviewing','planned','accepted','declined','shipped'] as const;
function pretty(value:string){return value.replaceAll('_',' ')}

export default async function SuggestionsPage({searchParams}:{searchParams:Params}){
  const params=await searchParams;
  const access=await getDashboardAccess();
  if(!can(access,'suggestions.view')) redirect('/');
  const selected=statuses.includes(params.status as any)?String(params.status):'';
  const data=await api<{suggestions:Suggestion[]}>(`/api/suggestions${selected?`?status=${encodeURIComponent(selected)}`:''}`);
  const all=selected?await api<{suggestions:Suggestion[]}>('/api/suggestions'):data;
  const rows=data.suggestions;
  const counts=new Map<string,number>();
  for(const item of all.suggestions) counts.set(item.status,(counts.get(item.status)||0)+1);
  const open=all.suggestions.filter(item=>['candidate','reviewing'].includes(item.status)).length;
  const supported=all.suggestions.reduce((sum,item)=>sum+Number(item.unique_supporters||item.mention_count||0),0);

  return <>
    <header className="pageHeader"><div><p className="eyebrow">COMMUNITY INTELLIGENCE</p><h1>Suggestions</h1><p>Community ideas detected from Discord are clustered so repeated requests build support instead of creating duplicate entries.</p></div>{can(access,'suggestions.manage')?<Link className="button primary" href="/suggestions/create">Create suggestion</Link>:null}</header>

    <div className="cards">
      <div className="card emphasis"><span>Needs review</span><strong>{open}</strong></div>
      <div className="card"><span>Total suggestions</span><strong>{all.suggestions.length}</strong></div>
      <div className="card"><span>Unique support signals</span><strong>{supported}</strong></div>
      <div className="card"><span>Shipped</span><strong>{counts.get('shipped')||0}</strong></div>
    </div>

    <div className={styles.filters}>
      <Link className={`${styles.filter} ${!selected?styles.active:''}`} href="/suggestions">All</Link>
      {statuses.map(status=><Link className={`${styles.filter} ${selected===status?styles.active:''}`} href={`/suggestions?status=${status}`} key={status}>{pretty(status)} · {counts.get(status)||0}</Link>)}
    </div>

    <section className="panel">
      <div className="panelTitle"><div><h2>{selected?`${pretty(selected)} suggestions`:'Suggestion queue'}</h2><p>Higher-support ideas are surfaced first within each workflow status.</p></div><span className="badge">{rows.length} shown</span></div>
      {rows.length?<div>
        <div className={`${styles.row} ${styles.head}`}><span>Suggestion</span><span>Status</span><span>Supporters</span><span>Mentions</span><span>Last seen</span></div>
        {rows.map(item=><Link className={styles.row} href={`/suggestions/${item.id}`} key={item.id}>
          <div className={styles.title}><strong>{item.public_id||`SUG-${item.id}`} · {item.title}</strong><small>{item.summary}</small></div>
          <span className={`${styles.status} ${styles[item.status as keyof typeof styles]||''}`}>{pretty(item.status)}</span>
          <span className={styles.support}>{Number(item.unique_supporters||item.mention_count||0)}</span>
          <span className={styles.muted}>{item.event_count}</span>
          <span className={styles.muted}>{new Date(item.last_seen).toLocaleString()}</span>
        </Link>)}
      </div>:<div className="empty">No suggestions match this view yet. Saucin AI will add ideas as they are detected in monitored Discord channels.</div>}
    </section>
  </>;
}
