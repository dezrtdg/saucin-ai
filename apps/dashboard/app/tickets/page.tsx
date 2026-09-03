import Link from 'next/link';
import { redirect } from 'next/navigation';
import { api } from '../../lib/api';
import { can,getDashboardAccess } from '../../lib/permissions';
import LiveRefresh from '../../components/LiveRefresh';
import styles from './tickets.module.css';

type Ticket={id:number;public_id:string;type_key:string;type_label:string;type_emoji:string|null;subject:string;description:string;status:string;priority:string;opener_name:string|null;opener_user_id:string;claimed_by_name:string|null;message_count:number;punishment_count:number;created_at:string;last_message_at:string|null};
type Data={tickets:Ticket[];types:Array<{key:string;label:string}>};
const statuses=['open','claimed','awaiting_user','closed','failed'];
function pretty(value:string){return value.replaceAll('_',' ')}

export default async function TicketsPage({searchParams}:{searchParams:Promise<{status?:string;type?:string}>}){
  const access=await getDashboardAccess();if(!can(access,'tickets.view'))redirect('/');
  const q=await searchParams;
  const params=new URLSearchParams();
  if(statuses.includes(String(q.status||'')))params.set('status',String(q.status));
  if(q.type)params.set('type',String(q.type));
  const [data,all]=await Promise.all([
    api<Data>(`/api/tickets${params.size?`?${params}`:''}`),
    params.size?api<Data>('/api/tickets'):Promise.resolve(null)
  ]);
  const complete=all||data;
  const counts=new Map<string,number>();for(const ticket of complete.tickets)counts.set(ticket.status,(counts.get(ticket.status)||0)+1);
  const active=complete.tickets.filter(ticket=>['open','claimed','awaiting_user'].includes(ticket.status));
  return <>
    <LiveRefresh interval={30000}/>
    <header className="pageHeader"><div><p className="eyebrow">PRIVATE SUPPORT</p><h1>Tickets</h1><p>Private support requests, staff routing, evidence, transcripts, and ticket-linked moderation actions.</p></div>{can(access,'settings.tickets.manage')?<Link className="button" href="/settings/tickets">Ticket Settings</Link>:null}</header>
    <div className={styles.stats}><div className={styles.stat}><span>Needs staff</span><strong>{counts.get('open')||0}</strong></div><div className={styles.stat}><span>Claimed</span><strong>{counts.get('claimed')||0}</strong></div><div className={styles.stat}><span>Waiting on user</span><strong>{counts.get('awaiting_user')||0}</strong></div><div className={styles.stat}><span>Active total</span><strong>{active.length}</strong></div></div>
    <div className={styles.filters}><Link className={`${styles.filter} ${!q.status&&!q.type?styles.active:''}`} href="/tickets">All</Link>{statuses.map(status=><Link key={status} className={`${styles.filter} ${q.status===status?styles.active:''}`} href={`/tickets?status=${status}`}>{pretty(status)} · {counts.get(status)||0}</Link>)}</div>
    <section className="panel"><div className="panelTitle"><div><h2>Ticket queue</h2><p>Open requests appear first, followed by claimed, waiting, and archived cases.</p></div><span className="badge">{data.tickets.length} shown</span></div>
      {data.tickets.length?<div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Ticket</th><th>Type</th><th>Member</th><th>Status</th><th>Messages</th><th>Opened</th></tr></thead><tbody>{data.tickets.map(ticket=><tr key={ticket.id}><td><Link className={styles.ticketLink} href={`/tickets/${ticket.id}`}><strong>{ticket.public_id} · {ticket.subject}</strong><small>{ticket.description}</small></Link></td><td>{ticket.type_emoji} {ticket.type_label}</td><td>{ticket.opener_name||ticket.opener_user_id}</td><td><span className={`${styles.status} ${styles[ticket.status as keyof typeof styles]||''}`}>{pretty(ticket.status)}</span>{ticket.claimed_by_name?<small style={{display:'block',marginTop:4,color:'#70707b'}}>by {ticket.claimed_by_name}</small>:null}</td><td>{ticket.message_count}{ticket.punishment_count?` · ${ticket.punishment_count} action${Number(ticket.punishment_count)===1?'':'s'}`:''}</td><td>{new Date(ticket.created_at).toLocaleString()}</td></tr>)}</tbody></table></div>:<div className={styles.empty}>No tickets match this view.</div>}
    </section>
  </>;
}
