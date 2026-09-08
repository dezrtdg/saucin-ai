import Link from 'next/link';
import { api } from '../../lib/api';
import { can,getDashboardAccess } from '../../lib/permissions';
import ActionButton from '../../components/ActionButton';
import LiveRefresh from '../../components/LiveRefresh';
import { automationFeedbackAction,updateAutomationModuleAction } from './actions';
import styles from './automation.module.css';

type Level='off'|'observe'|'assist'|'auto_safe';
type ModuleKey='tickets'|'issues'|'suggestions'|'knowledge'|'moderation'|'txadmin';
type Module={key:ModuleKey;label:string;maxLevel:Level;summary:string;safeActions:string;humanBoundary:string;settingsHref:string;autonomy_level:Level;updated_at:string|null};
type Item={key:string;module:ModuleKey;resource_type:string;resource_id:string;title:string;detail:string;reason:string;href:string;priority:'urgent'|'high'|'normal'|'low';priority_score:number;created_at:string;status:string;review_outcome?:string|null;reviewed_at?:string|null};
type Data={generated_at:string;modules:Module[];items:Item[];counts:Record<ModuleKey,number>;total:number};

const levels:Level[]=['off','observe','assist','auto_safe'];
const rank:Record<Level,number>={off:0,observe:1,assist:2,auto_safe:3};
const levelCopy:Record<Level,string>={off:'Off',observe:'Observe',assist:'Assist',auto_safe:'Auto-safe'};
const moduleCopy:Record<ModuleKey,string>={tickets:'Tickets',issues:'Issues',suggestions:'Suggestions',knowledge:'Knowledge',moderation:'Moderation',txadmin:'txAdmin'};
function date(value:string){try{return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(value));}catch{return value;}}

export default async function AutomationPage({searchParams}:{searchParams:Promise<{module?:string;reviewed?:string}>}){
  const params=await searchParams;const includeReviewed=params.reviewed==='1';
  const moduleFilter=Object.keys(moduleCopy).includes(String(params.module))?String(params.module) as ModuleKey:null;
  const [data,access]=await Promise.all([api<Data>(`/api/automation?include_reviewed=${includeReviewed?'true':'false'}`),getDashboardAccess()]);
  const items=moduleFilter?data.items.filter(item=>item.module===moduleFilter):data.items;
  const urgent=data.items.filter(item=>item.priority==='urgent').length;const high=data.items.filter(item=>item.priority==='high').length;
  return <>
    <LiveRefresh interval={20000}/>
    <header className="pageHeader compactPageHeader"><div><p className="eyebrow">AUTOMATION CONTROL</p><h1>Automation Center</h1><p>One prioritized inbox for work Saucin AI detected, organized, or needs staff to verify.</p></div><div className="headerActions"><Link className="button" href={includeReviewed?'/automation':'/automation?reviewed=1'}>{includeReviewed?'Hide reviewed':'Review history'}</Link></div></header>
    <section className={styles.summary}><div><small>NEEDS REVIEW</small><strong>{data.total}</strong><span>across your permitted modules</span></div><div className={styles.urgent}><small>URGENT</small><strong>{urgent}</strong><span>server or member impact</span></div><div><small>HIGH PRIORITY</small><strong>{high}</strong><span>review next</span></div><div><small>SAFETY BOUNDARY</small><strong>Human</strong><span>punishments and verified facts</span></div></section>

    <section className={styles.moduleSection}><div className="issueSectionHeader"><div><span className="sectionLabel">AUTHORITY CEILINGS</span><h2>What Saucin AI may do</h2><p>These controls limit Automation Center behavior. Each module’s settings still decide where detection and Discord workflows are enabled.</p></div></div><div className={styles.moduleGrid}>{data.modules.map(module=><article className={styles.moduleCard} key={module.key}><div className={styles.moduleTop}><div><strong>{module.label}</strong><span>{data.counts[module.key]||0} in review inbox</span></div><b className={styles[module.autonomy_level]}>{levelCopy[module.autonomy_level]}</b></div><p>{module.summary}</p><dl><div><dt>Allowed</dt><dd>{module.safeActions}</dd></div><div><dt>Human boundary</dt><dd>{module.humanBoundary}</dd></div></dl>{can(access,'automation.manage')?<form action={updateAutomationModuleAction.bind(null,module.key)} className={styles.moduleForm}><select className="input select" name="autonomy_level" defaultValue={module.autonomy_level}>{levels.filter(level=>rank[level]<=rank[module.maxLevel]).map(level=><option value={level} key={level}>{levelCopy[level]}</option>)}</select><ActionButton label="Save" pendingLabel="Saving" variant="subtle"/></form>:<Link className="button subtle" href={module.settingsHref}>Open settings</Link>}</article>)}</div></section>

    <section className={`issueViewPanel ${styles.queue}`}><div className="issueSectionHeader"><div><span className="sectionLabel">UNIFIED REVIEW INBOX</span><h2>{moduleFilter?moduleCopy[moduleFilter]:'All work requiring attention'}</h2><p>Priority is based on impact, confirmations, recurrence, and whether a human decision is required.</p></div><span className="countPill">{items.length}</span></div><nav className={styles.filters}><Link className={!moduleFilter?styles.active:''} href={includeReviewed?'/automation?reviewed=1':'/automation'}>All</Link>{data.modules.map(module=><Link className={moduleFilter===module.key?styles.active:''} key={module.key} href={`/automation?module=${module.key}${includeReviewed?'&reviewed=1':''}`}>{module.label}<b>{data.counts[module.key]||0}</b></Link>)}</nav>
      <div className={styles.items}>{items.length?items.map(item=><article className={styles.item} key={item.key}><div className={styles.itemMain}><div className={styles.itemMeta}><span className={`${styles.priority} ${styles[item.priority]}`}>{item.priority}</span><span>{moduleCopy[item.module]}</span><span>{item.status.replaceAll('_',' ')}</span><time>{date(item.created_at)}</time></div><h3><Link href={item.href}>{item.title}</Link></h3>{item.detail?<p>{item.detail}</p>:null}<small>{item.reason}</small>{item.review_outcome?<em>Reviewed as {item.review_outcome}{item.reviewed_at?` · ${date(item.reviewed_at)}`:''}</em>:null}</div><div className={styles.itemActions}><Link className="button primary" href={item.href}>Open</Link>{can(access,'automation.review')?(item.review_outcome?<form action={automationFeedbackAction.bind(null,item.module,item.resource_type,item.resource_id,'reopened')}><ActionButton label="Return to inbox" pendingLabel="Returning" variant="subtle"/></form>:<><form action={automationFeedbackAction.bind(null,item.module,item.resource_type,item.resource_id,'reviewed')}><ActionButton label="Mark reviewed" pendingLabel="Saving" variant="subtle"/></form><details className={styles.correction}><summary>Wrong priority or routing?</summary><form action={automationFeedbackAction.bind(null,item.module,item.resource_type,item.resource_id,'incorrect')}><input className="input" name="note" required placeholder="What should Saucin AI learn?"/><ActionButton label="Save correction" pendingLabel="Saving" variant="subtle"/></form></details></>):null}</div></article>):<div className="emptyLibrary"><strong>You’re all caught up</strong><span>No items currently need review in this view.</span></div>}</div>
    </section>
  </>;
}
