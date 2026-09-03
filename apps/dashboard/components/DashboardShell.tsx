'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback,useEffect,useMemo,useState } from 'react';
import SidebarNav from './SidebarNav';

type Counts={tickets:number;issues:number;suggestions:number;knowledgeGaps:number;moderation:number;personal:number};
type PersonalItem={key:string;kind:'ticket_reply'|'ticket_mention';title:string;detail:string;href:string;created_at:string};
type QueueItem={key:string;label:string;count:number;href:string};
type NoticeData={generated_at:string;total:number;counts:Counts;personal:PersonalItem[];queues:QueueItem[]};
type User={displayName:string;avatar:string|null;initials:string}|null;

const emptyCounts:Counts={tickets:0,issues:0,suggestions:0,knowledgeGaps:0,moderation:0,personal:0};
function ago(value:string){
  const minutes=Math.max(1,Math.floor((Date.now()-new Date(value).getTime())/60000));
  if(minutes<60)return `${minutes}m ago`;
  const hours=Math.floor(minutes/60);return hours<24?`${hours}h ago`:`${Math.floor(hours/24)}d ago`;
}

export default function DashboardShell({children,serverName,user,permissions,ownerBypass,knowledgeSearch}:{
  children:React.ReactNode;serverName:string;user:User;permissions:string[];ownerBypass:boolean;knowledgeSearch:boolean;
}){
  const pathname=usePathname();
  const [mobileOpen,setMobileOpen]=useState(false);
  const [noticeOpen,setNoticeOpen]=useState(false);
  const [data,setData]=useState<NoticeData|null>(null);
  const [liveState,setLiveState]=useState<'connecting'|'live'|'offline'>('connecting');

  const refresh=useCallback(async()=>{
    try{
      const response=await fetch('/api/dashboard/notifications',{cache:'no-store'});
      if(!response.ok)throw new Error('notification request failed');
      setData(await response.json());setLiveState('live');
    }catch{setLiveState('offline');}
  },[]);

  useEffect(()=>{
    void refresh();
    const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void refresh();},20_000);
    const visible=()=>{if(document.visibilityState==='visible')void refresh();};
    document.addEventListener('visibilitychange',visible);
    return()=>{window.clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
  },[refresh]);

  useEffect(()=>{setMobileOpen(false);setNoticeOpen(false);},[pathname]);

  const markRead=useCallback(async(keys:string[])=>{
    if(!keys.length)return;
    setData(current=>current?{
      ...current,
      total:Math.max(0,current.total-keys.length),
      counts:{...current.counts,tickets:Math.max(0,current.counts.tickets-keys.length),personal:Math.max(0,current.counts.personal-keys.length)},
      personal:current.personal.filter(item=>!keys.includes(item.key))
    }:current);
    await fetch('/api/dashboard/notifications',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({keys}),keepalive:true}).catch(()=>undefined);
  },[]);

  const badges=useMemo(()=>data?.counts||emptyCounts,[data]);
  return <div className={`consoleShell dashboardV2 ${mobileOpen?'mobileNavOpen':''}`}>
    <button className="mobileNavScrim" aria-label="Close navigation" onClick={()=>setMobileOpen(false)}/>
    <aside className="consoleSidebar">
      <div className="consoleBrand"><img className="brandLogo" src="/saucin-rp-logo.png" alt="Saucin RP"/><div><strong>Saucin AI</strong><small>{serverName}</small></div><button className="mobileNavClose" onClick={()=>setMobileOpen(false)} aria-label="Close navigation">×</button></div>
      <SidebarNav permissions={permissions} ownerBypass={ownerBypass} badges={badges}/>
      <div className={`sidebarStatus ${liveState}`}><span className="onlineDot"/><div><strong>{liveState==='live'?'Live':liveState==='offline'?'Connection issue':'Connecting'}</strong><small>{liveState==='live'?'updates every 20 seconds':liveState==='offline'?'trying again automatically':'checking activity'}</small></div></div>
    </aside>
    <main className="consoleMain">
      <header className="consoleTopbar">
        <button className="mobileNavButton" onClick={()=>setMobileOpen(true)} aria-label="Open navigation"><span/><span/><span/></button>
        <div className="topbarIdentity"><strong>{serverName}</strong><small>staff operations</small></div>
        {knowledgeSearch?<form className="topbarSearch" action="/knowledge/all" method="get"><span aria-hidden="true">⌕</span><input name="q" aria-label="Search knowledge" placeholder="Search knowledge"/></form>:<div className="topbarSpacer"/>}
        <div className="notificationWrap">
          <button className={`notificationButton ${noticeOpen?'active':''}`} onClick={()=>setNoticeOpen(value=>!value)} aria-label={`${data?.total||0} items need attention`} aria-expanded={noticeOpen}>
            <span aria-hidden="true">◇</span>{data?.total?<b>{data.total>99?'99+':data.total}</b>:null}
          </button>
          {noticeOpen?<div className="notificationPanel">
            <div className="notificationHeader"><div><strong>Needs attention</strong><span>Live staff queue</span></div>{data?.personal.length?<button onClick={()=>void markRead(data.personal.map(item=>item.key))}>Mark personal read</button>:null}</div>
            {data?.personal.length?<section className="notificationSection"><small>FOR YOU</small>{data.personal.slice(0,6).map(item=><Link href={item.href} key={item.key} onClick={()=>void markRead([item.key])}><i className={item.kind}/><div><strong>{item.title}</strong><span>{item.detail}</span></div><time>{ago(item.created_at)}</time></Link>)}</section>:null}
            <section className="notificationSection"><small>WORK QUEUES</small>{data?.queues.length?data.queues.map(item=><Link href={item.href} key={item.key}><i className={item.key}/><div><strong>{item.label}</strong><span>Open the queue to review</span></div><b>{item.count}</b></Link>):<div className="notificationEmpty">You’re all caught up.</div>}</section>
            <div className="notificationFooter"><span className={`livePulse ${liveState}`}/>{liveState==='live'?'Live updates on':'Reconnecting…'}</div>
          </div>:null}
        </div>
        {user?<div className="topbarUser">{user.avatar?<img src={user.avatar} alt=""/>:<div className="topbarAvatar">{user.initials}</div>}<div><strong>{user.displayName}</strong><a href="/api/auth/logout">Sign out</a></div></div>:null}
      </header>
      <div className="consoleContent">{children}</div>
    </main>
  </div>;
}
