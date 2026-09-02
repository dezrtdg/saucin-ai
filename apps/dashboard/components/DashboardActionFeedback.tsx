'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

type FeedbackState={kind:'loading'|'success'|'error';message:string}|null;
type ViewSnapshot={url:string;scrollY:number;openPanels:string[]};
type ActionStateDetail={pending:boolean;message?:string};

const VIEW_KEY='saucin-dashboard-action-view';
const ACTION_STATE_EVENT='saucin-dashboard-action-state';

function cleanUrl(url:URL){
  url.searchParams.delete('_ux');
  url.searchParams.delete('_uxm');
  return `${url.pathname}${url.search}`;
}

function panelKey(details:HTMLDetailsElement,index:number){
  if(details.id) return `id:${details.id}`;
  const explicit=details.dataset.panelKey;
  if(explicit) return `key:${explicit}`;
  const summary=details.querySelector('summary')?.textContent?.replace(/\s+/g,' ').trim();
  if(summary) return `summary:${index}:${summary.slice(0,160)}`;
  return `index:${index}`;
}

function saveView(){
  try{
    const current=new URL(window.location.href);
    const details=[...document.querySelectorAll<HTMLDetailsElement>('details')];
    const snapshot:ViewSnapshot={
      url:cleanUrl(current),
      scrollY:window.scrollY,
      openPanels:details.map((item,index)=>item.open?panelKey(item,index):'').filter(Boolean)
    };
    sessionStorage.setItem(VIEW_KEY,JSON.stringify(snapshot));
  }catch{}
}

function restoreView(){
  try{
    const raw=sessionStorage.getItem(VIEW_KEY);
    if(!raw) return;
    const snapshot=JSON.parse(raw) as ViewSnapshot;
    const current=new URL(window.location.href);
    if(cleanUrl(current)!==snapshot.url){
      sessionStorage.removeItem(VIEW_KEY);
      return;
    }
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      const open=new Set(snapshot.openPanels||[]);
      const details=[...document.querySelectorAll<HTMLDetailsElement>('details')];
      details.forEach((item,index)=>{ item.open=open.has(panelKey(item,index)); });
      window.scrollTo({top:Number(snapshot.scrollY)||0,left:0,behavior:'auto'});
      sessionStorage.removeItem(VIEW_KEY);
    }));
  }catch{
    sessionStorage.removeItem(VIEW_KEY);
  }
}

function successTitle(message:string){
  const value=message.toLowerCase();
  if(value.includes('deleted')) return 'Deleted';
  if(value.includes('created')) return 'Created';
  if(value.includes('refreshed')) return 'Refreshed';
  if(value.includes('published')) return 'Published';
  if(value.includes('archived')) return 'Archived';
  if(value.includes('saved')) return 'Saved';
  if(value.includes('updated')) return 'Updated';
  return 'Done';
}

export default function DashboardActionFeedback(){
  const pathname=usePathname();
  const searchParams=useSearchParams();
  const router=useRouter();
  const search=searchParams.toString();
  const [feedback,setFeedback]=useState<FeedbackState>(null);
  const [restorePending,setRestorePending]=useState(false);

  useEffect(()=>{
    const params=new URLSearchParams(search);
    const kind=params.get('_ux');
    const message=params.get('_uxm');
    if(kind!=='success'&&kind!=='error') return;

    setFeedback({kind,message:message|| (kind==='success'?'Saved.':'Action failed.')});
    setRestorePending(true);

    const url=new URL(window.location.href);
    url.searchParams.delete('_ux');
    url.searchParams.delete('_uxm');
    router.replace(`${url.pathname}${url.search}${url.hash}`,{scroll:false});
  },[pathname,search,router]);

  useEffect(()=>{
    if(!restorePending) return;
    const params=new URLSearchParams(search);
    if(params.has('_ux')) return;
    restoreView();
    setRestorePending(false);
  },[pathname,search,restorePending]);

  useEffect(()=>{
    if(!feedback || feedback.kind==='loading') return;
    const timer=window.setTimeout(()=>setFeedback(null),4200);
    return ()=>window.clearTimeout(timer);
  },[feedback]);

  useEffect(()=>{
    const rememberPosition=(event:Event)=>{
      const submitEvent=event as SubmitEvent;
      const form=submitEvent.target instanceof HTMLFormElement?submitEvent.target:null;
      if(!form) return;
      if((form.getAttribute('method')||'').toLowerCase()==='get') return;
      saveView();
    };
    document.addEventListener('submit',rememberPosition,true);
    return ()=>document.removeEventListener('submit',rememberPosition,true);
  },[]);

  useEffect(()=>{
    const onActionState=(event:Event)=>{
      const detail=(event as CustomEvent<ActionStateDetail>).detail;
      if(!detail) return;
      if(detail.pending){
        saveView();
        setFeedback({kind:'loading',message:detail.message||'Working…'});
      }else{
        setFeedback(current=>current?.kind==='loading'?null:current);
      }
    };

    window.addEventListener(ACTION_STATE_EVENT,onActionState as EventListener);
    return ()=>window.removeEventListener(ACTION_STATE_EVENT,onActionState as EventListener);
  },[]);

  if(!feedback) return null;
  const title=feedback.kind==='loading'?'Working':feedback.kind==='success'?successTitle(feedback.message):'Action failed';
  return <div className={`dashboardActionToast dashboardActionToast-${feedback.kind}`} role={feedback.kind==='error'?'alert':'status'} aria-live={feedback.kind==='error'?'assertive':'polite'}>
    <span className={`dashboardActionIndicator dashboardActionIndicator-${feedback.kind}`} aria-hidden="true"/>
    <div><strong>{title}</strong><span>{feedback.message}</span></div>
  </div>;
}
