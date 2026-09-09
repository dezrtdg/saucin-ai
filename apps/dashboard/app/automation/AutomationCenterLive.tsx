'use client';

import Link from 'next/link';
import { useCallback,useEffect,useRef,useState } from 'react';
import ActionButton from '../../components/ActionButton';
import { automationFeedbackAction,updateAutomationModuleAction } from './actions';
import styles from './automation.module.css';

export type Level='off'|'observe'|'assist'|'auto_safe';
export type ModuleKey='tickets'|'issues'|'suggestions'|'knowledge'|'moderation'|'txadmin';
export type Module={key:ModuleKey;label:string;maxLevel:Level;summary:string;safeActions:string;humanBoundary:string;settingsHref:string;autonomy_level:Level;updated_at:string|null};
export type Item={key:string;module:ModuleKey;resource_type:string;resource_id:string;title:string;detail:string;reason:string;href:string;priority:'urgent'|'high'|'normal'|'low';priority_score:number;created_at:string;status:string;review_outcome?:string|null;reviewed_at?:string|null};
export type AutomationData={generated_at:string;modules:Module[];items:Item[];counts:Record<ModuleKey,number>;total:number};
type DashboardAccess={authorized:boolean;permissions:string[];owner_bypass:boolean;configured:boolean;source?:string};

const levels:Level[]=['off','observe','assist','auto_safe'];
const rank:Record<Level,number>={off:0,observe:1,assist:2,auto_safe:3};
const levelCopy:Record<Level,string>={off:'Off',observe:'Observe',assist:'Assist',auto_safe:'Auto-safe'};
const moduleCopy:Record<ModuleKey,string>={tickets:'Tickets',issues:'Issues',suggestions:'Suggestions',knowledge:'Knowledge',moderation:'Moderation',txadmin:'txAdmin'};
function date(value:string){try{return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(value));}catch{return value;}}
function time(value:string){try{return new Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'2-digit',second:'2-digit'}).format(new Date(value));}catch{return '';}}
function dataSignature(data:AutomationData){return JSON.stringify({modules:data.modules.map(item=>[item.key,item.autonomy_level,item.updated_at]),items:data.items.map(item=>[item.key,item.status,item.priority_score,item.review_outcome,item.reviewed_at]),counts:data.counts,total:data.total});}
function can(access:DashboardAccess,permission:string){return Boolean(access.owner_bypass||access.permissions.includes(permission));}

export default function AutomationCenterLive({initialData,access,moduleFilter,includeReviewed}:{
  initialData:AutomationData;access:DashboardAccess;moduleFilter:ModuleKey|null;includeReviewed:boolean;
}){
  const [data,setData]=useState(initialData);
  const [liveState,setLiveState]=useState<'live'|'refreshing'|'offline'>('live');
  const [lastUpdated,setLastUpdated]=useState(initialData.generated_at);
  const rootRef=useRef<HTMLDivElement>(null);
  const running=useRef(false);
  const signature=useRef(dataSignature(initialData));

  useEffect(()=>{
    const nextSignature=dataSignature(initialData);
    signature.current=nextSignature;setData(initialData);setLastUpdated(initialData.generated_at);setLiveState('live');
  },[initialData,initialData.generated_at]);

  const refresh=useCallback(async(force=false)=>{
    if(running.current)return;
    const root=rootRef.current;
    if(!force&&root){
      if(root.querySelector('form[data-dashboard-pending="true"], details[open]'))return;
      const active=document.activeElement;
      if(active&&root.contains(active)&&(active instanceof HTMLInputElement||active instanceof HTMLTextAreaElement||active instanceof HTMLSelectElement))return;
    }
    running.current=true;setLiveState('refreshing');
    try{
      const response=await fetch(`/api/dashboard/automation?include_reviewed=${includeReviewed?'true':'false'}`,{cache:'no-store',signal:AbortSignal.timeout(12000)});
      if(!response.ok)throw new Error('Automation refresh failed');
      const next=await response.json() as AutomationData;
      const nextSignature=dataSignature(next);
      if(nextSignature!==signature.current){signature.current=nextSignature;setData(next);}
      setLastUpdated(next.generated_at);setLiveState('live');
    }catch{setLiveState('offline');}
    finally{running.current=false;}
  },[includeReviewed]);

  useEffect(()=>{
    const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void refresh();},20_000);
    const visible=()=>{if(document.visibilityState==='visible')void refresh();};
    document.addEventListener('visibilitychange',visible);
    return()=>{window.clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
  },[refresh]);

  const items=moduleFilter?data.items.filter(item=>item.module===moduleFilter):data.items;
  const urgent=data.items.filter(item=>item.priority==='urgent').length;
  const high=data.items.filter(item=>item.priority==='high').length;
  return <div ref={rootRef}>
    <div className={`${styles.liveBar} ${styles[liveState]}`} role="status">
      <span/><strong>{liveState==='refreshing'?'Checking for changes':liveState==='offline'?'Live refresh paused':'Live'}</strong>
      <small>{liveState==='offline'?'We’ll retry automatically.':`Updated ${time(lastUpdated)}`}</small>
      <button type="button" onClick={()=>void refresh(true)} disabled={liveState==='refreshing'}>{liveState==='refreshing'?'Refreshing…':'Refresh now'}</button>
    </div>
    <section className={styles.summary}><div><small>NEEDS REVIEW</small><strong>{data.total}</strong><span>across your permitted modules</span></div><div className={styles.urgent}><small>URGENT</small><strong>{urgent}</strong><span>server or member impact</span></div><div><small>HIGH PRIORITY</small><strong>{high}</strong><span>review next</span></div><div><small>SAFETY BOUNDARY</small><strong>Human</strong><span>punishments and verified facts</span></div></section>

    <section className={styles.moduleSection}><div className="issueSectionHeader"><div><span className="sectionLabel">AUTHORITY CEILINGS</span><h2>What Saucin AI may do</h2><p>These controls limit Automation Center behavior. Each module’s settings still decide where detection and Discord workflows are enabled.</p></div></div><div className={styles.moduleGrid}>{data.modules.map(module=><article className={styles.moduleCard} key={module.key}><div className={styles.moduleTop}><div><strong>{module.label}</strong><span>{data.counts[module.key]||0} in review inbox</span></div><b className={styles[module.autonomy_level]}>{levelCopy[module.autonomy_level]}</b></div><p>{module.summary}</p><dl><div><dt>Allowed</dt><dd>{module.safeActions}</dd></div><div><dt>Human boundary</dt><dd>{module.humanBoundary}</dd></div></dl>{can(access,'automation.manage')?<form action={updateAutomationModuleAction.bind(null,module.key)} className={styles.moduleForm}><select className="input select" name="autonomy_level" defaultValue={module.autonomy_level}>{levels.filter(level=>rank[level]<=rank[module.maxLevel]).map(level=><option value={level} key={level}>{levelCopy[level]}</option>)}</select><ActionButton label="Save" pendingLabel="Saving" variant="subtle"/></form>:<Link className="button subtle" href={module.settingsHref}>Open settings</Link>}</article>)}</div></section>

    <section className={`issueViewPanel ${styles.queue}`}><div className="issueSectionHeader"><div><span className="sectionLabel">UNIFIED REVIEW INBOX</span><h2>{moduleFilter?moduleCopy[moduleFilter]:'All work requiring attention'}</h2><p>Priority is based on impact, confirmations, recurrence, and whether a human decision is required.</p></div><span className="countPill">{items.length}</span></div><nav className={styles.filters}><Link className={!moduleFilter?styles.active:''} href={includeReviewed?'/automation?reviewed=1':'/automation'}>All</Link>{data.modules.map(module=><Link className={moduleFilter===module.key?styles.active:''} key={module.key} href={`/automation?module=${module.key}${includeReviewed?'&reviewed=1':''}`}>{module.label}<b>{data.counts[module.key]||0}</b></Link>)}</nav>
      <div className={styles.items}>{items.length?items.map(item=><article className={styles.item} key={item.key}><div className={styles.itemMain}><div className={styles.itemMeta}><span className={`${styles.priority} ${styles[item.priority]}`}>{item.priority}</span><span>{moduleCopy[item.module]}</span><span>{item.status.replaceAll('_',' ')}</span><time>{date(item.created_at)}</time></div><h3><Link href={item.href}>{item.title}</Link></h3>{item.detail?<p>{item.detail}</p>:null}<small>{item.reason}</small>{item.review_outcome?<em>Reviewed as {item.review_outcome}{item.reviewed_at?` · ${date(item.reviewed_at)}`:''}</em>:null}</div><div className={styles.itemActions}><Link className="button primary" href={item.href}>Open</Link>{can(access,'automation.review')?(item.review_outcome?<form action={automationFeedbackAction.bind(null,item.module,item.resource_type,item.resource_id,'reopened')}><ActionButton label="Return to inbox" pendingLabel="Returning" variant="subtle"/></form>:<><form action={automationFeedbackAction.bind(null,item.module,item.resource_type,item.resource_id,'reviewed')}><ActionButton label="Mark reviewed" pendingLabel="Saving" variant="subtle"/></form><details className={styles.correction}><summary>Wrong priority or routing?</summary><form action={automationFeedbackAction.bind(null,item.module,item.resource_type,item.resource_id,'incorrect')}><input className="input" name="note" required placeholder="What should Saucin AI learn?"/><ActionButton label="Save correction" pendingLabel="Saving" variant="subtle"/></form></details></>):null}</div></article>):<div className="emptyLibrary"><strong>You’re all caught up</strong><span>No items currently need review in this view.</span></div>}</div>
    </section>
  </div>;
}
