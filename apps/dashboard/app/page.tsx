import Link from 'next/link';
import { redirect } from 'next/navigation';
import { api } from '../lib/api';
import { can,getDashboardAccess } from '../lib/permissions';
import LiveRefresh from '../components/LiveRefresh';

type Activity={id:number;intent:string;confidence:string;response_text:string|null;created_at:string;channel_name:string|null;author_name:string|null;content:string|null};
type PersonalKind='ticket_reply'|'ticket_mention'|'issue_reply'|'issue_mention'|'suggestion_reply'|'suggestion_mention';
type Notice={
  total:number;counts:{tickets:number;issues:number;suggestions:number;knowledgeGaps:number;moderation:number;personal:number};
  personal:Array<{key:string;kind:PersonalKind;title:string;detail:string;href:string;created_at:string}>;
  queues:Array<{key:string;label:string;count:number;href:string}>;
};

function relative(value:string){const ms=Date.now()-new Date(value).getTime();const m=Math.max(1,Math.round(ms/60000));if(m<60)return `${m}m`;const h=Math.round(m/60);if(h<48)return `${h}h`;return `${Math.round(h/24)}d`;}

export default async function Home(){
  const access=await getDashboardAccess();
  if(!can(access,'dashboard.view')){
    const destination=can(access,'tickets.view')?'/tickets':can(access,'issues.view')?'/issues':can(access,'knowledge.view')?'/knowledge':can(access,'knowledge.gaps.view')?'/knowledge-gaps':can(access,'channels.view')?'/channels':can(access,'settings.view')?'/settings':null;
    if(destination)redirect(destination);
    return <><header className="pageHeader"><div><p className="eyebrow">ACCESS</p><h1>Dashboard access enabled</h1><p>Your role can sign in, but it does not currently have access to any dashboard modules.</p></div></header><div className="viewOnlyNote">Ask a dashboard administrator to grant this role at least one view permission.</div></>;
  }

  let notices:Notice={total:0,counts:{tickets:0,issues:0,suggestions:0,knowledgeGaps:0,moderation:0,personal:0},personal:[],queues:[]};
  let activity:Activity[]=[];let offline=false;
  try{[notices,activity]=await Promise.all([api<Notice>('/api/notifications'),api<Activity[]>('/api/activity')]);}catch{offline=true;}

  const cards=[
    can(access,'tickets.view')?{label:'Tickets',value:notices.counts.tickets,note:'unclaimed or waiting for you',href:'/tickets',tone:'tickets'}:null,
    can(access,'issues.view')?{label:'Issue reports',value:notices.counts.issues,note:'need triage',href:'/issues',tone:'issues'}:null,
    can(access,'suggestions.view')?{label:'Suggestions',value:notices.counts.suggestions,note:'need review',href:'/suggestions',tone:'suggestions'}:null,
    can(access,'knowledge.gaps.view')?{label:'Knowledge gaps',value:notices.counts.knowledgeGaps,note:'need an answer',href:'/knowledge-gaps',tone:'gaps'}:null,
    can(access,'moderation.view')?{label:'Moderation',value:notices.counts.moderation,note:'cases pending review',href:'/moderation',tone:'tone-bad'}:null
  ].filter(Boolean) as Array<{label:string;value:number;note:string;href:string;tone:string}>;
  const shortcuts=[
    can(access,'tickets.view')?{label:'Open tickets',href:'/tickets'}:null,
    can(access,'issues.create')?{label:'Create issue',href:'/issues/create'}:null,
    can(access,'suggestions.manage')?{label:'Create suggestion',href:'/suggestions/create'}:null,
    can(access,'knowledge.view')?{label:'Search knowledge',href:'/knowledge/all'}:null,
    can(access,'settings.view')?{label:'Settings',href:'/settings'}:null
  ].filter(Boolean) as Array<{label:string;href:string}>;

  return <>
    <LiveRefresh interval={30000}/>
    <header className="pageHeader dashboardHomeHeader"><div><p className="eyebrow">STAFF OVERVIEW</p><h1>What needs attention</h1><p>A focused view of current work. Counts update automatically while this page is open.</p></div><div className={offline?'status offline':'status'}><span/>{offline?'Connection issue':'Live'}</div></header>

    <section className="attentionCards" aria-label="Work queues">
      {cards.map(card=><Link href={card.href} className={`attentionCard ${card.tone}`} key={card.label}><div><span>{card.label}</span><small>{card.note}</small></div><strong>{card.value}</strong><i aria-hidden="true">›</i></Link>)}
    </section>

    <div className="homeWorkspace">
      <section className="consolePanel homePriority">
        <div className="compactPanelTitle"><div><h2>Your priority</h2><span>replies, tags, and open queues</span></div></div>
        {notices.personal.length?<div className="priorityRows">{notices.personal.slice(0,6).map(item=><Link href={item.href} key={item.key}><i className={item.kind}/><div><strong>{item.title}</strong><span>{item.detail}</span></div><time>{relative(item.created_at)}</time></Link>)}</div>:notices.queues.length?<div className="priorityRows">{notices.queues.slice(0,6).map(item=><Link href={item.href} key={item.key}><i className={item.key}/><div><strong>{item.label}</strong><span>Open the queue when you’re ready to review it.</span></div><b>{item.count}</b></Link>)}</div>:<div className="calmEmpty"><span>✓</span><div><strong>You’re caught up</strong><p>No assigned replies, direct tags, or open work queues need your attention.</p></div></div>}
      </section>

      <aside className="homeSide">
        <section className="consolePanel quickPanel"><div className="compactPanelTitle"><div><h2>Quick access</h2></div></div><div className="quickLinks">{shortcuts.map(item=><Link href={item.href} key={item.href}>{item.label}<span>›</span></Link>)}</div></section>
        <details className="consolePanel recentDisclosure"><summary><div><strong>Recent bot activity</strong><span>{activity.length} recent decisions</span></div><b>View</b></summary><div className="compactActivity">{activity.slice(0,8).map(row=><div className="compactActivityRow" key={row.id}><span className={`activityDot ${row.intent}`}/><div><strong>{row.intent} · #{row.channel_name||'unknown'}</strong><p>{row.content||'No message content'}</p></div><time>{Math.round(Number(row.confidence)*100)}%</time></div>)}{!activity.length?<div className="empty">No AI activity yet.</div>:null}</div></details>
      </aside>
    </div>
  </>;
}
