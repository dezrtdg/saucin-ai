import Link from 'next/link';
import { redirect } from 'next/navigation';
import { api } from '../lib/api';
import { can, getDashboardAccess } from '../lib/permissions';

type Overview={messages24h:number;aiEvents24h:number;openIssues:number;pendingSuggestions:number;monitoredChannels:number;publishedKnowledge:number;openKnowledgeGaps:number;incomingIssues:number};
type Activity={id:number;intent:string;confidence:string;should_respond:boolean;response_text:string|null;created_at:string;channel_name:string|null;author_name:string|null;content:string|null};
type Issue={id:number;public_id:string|null;title:string;status:string;severity:string;report_count:number;last_seen:string};
type Gap={id:number;display_question:string|null;sample_question:string;occurrences:number;status:string;last_seen:string};

function relative(value:string){const ms=Date.now()-new Date(value).getTime();const m=Math.max(1,Math.round(ms/60000));if(m<60)return `${m}m`;const h=Math.round(m/60);if(h<48)return `${h}h`;return `${Math.round(h/24)}d`;}

export default async function Home(){
  const access=await getDashboardAccess();
  if(!can(access,'dashboard.view')){
    const destination = can(access,'issues.view') ? '/issues'
      : can(access,'knowledge.view') ? '/knowledge'
      : can(access,'knowledge.gaps.view') ? '/knowledge-gaps'
      : can(access,'channels.view') ? '/channels'
      : can(access,'settings.view') ? '/settings'
      : null;
    if(destination) redirect(destination);
    return <>
      <header className="pageHeader consolePageHeader"><div><p className="eyebrow">ACCESS</p><h1>Dashboard access enabled</h1><p>Your role can sign in, but it does not currently have access to any dashboard modules.</p></div></header>
      <div className="viewOnlyNote"><strong>No modules are assigned.</strong> Ask a dashboard administrator to grant this role at least one view permission.</div>
    </>;
  }

  const canViewIssues=can(access,'issues.view');
  const canViewGaps=can(access,'knowledge.gaps.view');
  let overview:Overview|null=null,activity:Activity[]=[],issues:Issue[]=[],gaps:Gap[]=[];let offline=false;
  try{
    const requests:[Promise<Overview>,Promise<Activity[]>,Promise<Issue[]>,Promise<Gap[]>]=[
      api<Overview>('/api/overview'),
      api<Activity[]>('/api/activity'),
      canViewIssues?api<Issue[]>('/api/issues'):Promise.resolve([]),
      canViewGaps?api<Gap[]>('/api/knowledge/gaps'):Promise.resolve([])
    ];
    [overview,activity,issues,gaps]=await Promise.all(requests);
  }catch{offline=true;}
  const attention=[
    ...issues.filter(i=>!['resolved','wont_fix'].includes(i.status)).slice(0,4).map(i=>({kind:'issue',title:`${i.public_id||'BUG'} · ${i.title}`,meta:`${i.status.replaceAll('_',' ')} · ${i.report_count||0} affected`,age:relative(i.last_seen),href:'/issues'})),
    ...gaps.filter(g=>g.status==='open').slice(0,4).map(g=>({kind:'gap',title:g.display_question||g.sample_question,meta:`knowledge gap · ${g.occurrences} ask${g.occurrences===1?'':'s'}`,age:relative(g.last_seen),href:'/knowledge-gaps'}))
  ].slice(0,7);
  return <>
    <header className="pageHeader consolePageHeader"><div><p className="eyebrow">OVERVIEW</p><h1>Operations</h1><p>What needs attention across support, knowledge, and Discord intelligence.</p></div><div className={offline?'status offline':'status'}><span/>{offline?'API Offline':'System Online'}</div></header>
    <section className="overviewStats">
      <Stat label="OPEN ISSUES" value={overview?.openIssues??'—'} note={`${overview?.incomingIssues??0} incoming reports`}/>
      <Stat label="KNOWLEDGE GAPS" value={overview?.openKnowledgeGaps??'—'} note="unanswered or partial"/>
      <Stat label="AI ACTIVITY · 24H" value={overview?.aiEvents24h??'—'} note={`${overview?.messages24h??0} messages observed`}/>
      <Stat label="KB ARTICLES" value={overview?.publishedKnowledge??'—'} note={`${overview?.monitoredChannels??0} active channels`}/>
    </section>
    <div className="overviewGrid">
      <section className="consolePanel">
        <div className="compactPanelTitle"><div><h2>Needs your attention</h2><span>highest-value work first</span></div>{canViewIssues?<Link href="/issues">Open issues</Link>:canViewGaps?<Link href="/knowledge-gaps">Open gaps</Link>:null}</div>
        {attention.length?<div className="attentionList">{attention.map((row,index)=><Link href={row.href} className="attentionRow" key={`${row.kind}-${index}`}><i className={row.kind}/><div><strong>{row.title}</strong><small>{row.meta}</small></div><time>{row.age}</time></Link>)}</div>:<div className="empty">Nothing available for your current access.</div>}
      </section>
      <section className="consolePanel">
        <div className="compactPanelTitle"><div><h2>Recent AI activity</h2><span>latest bot decisions</span></div></div>
        <div className="compactActivity">{activity.slice(0,8).map(row=><div className="compactActivityRow" key={row.id}><span className={`activityDot ${row.intent}`}/><div><strong>{row.intent} · #{row.channel_name||'unknown'}</strong><p>{row.content||'No message content'}</p></div><time>{Math.round(Number(row.confidence)*100)}%</time></div>)}{!activity.length?<div className="empty">No AI activity yet.</div>:null}</div>
      </section>
    </div>
  </>;
}
function Stat({label,value,note}:{label:string;value:string|number;note:string}){return <div className="overviewStat"><span>{label}</span><strong>{value}</strong><small>{note}</small></div>}
