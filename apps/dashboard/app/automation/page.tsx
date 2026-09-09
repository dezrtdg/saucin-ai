import Link from 'next/link';
import { Suspense } from 'react';
import { api } from '../../lib/api';
import { getDashboardAccess } from '../../lib/permissions';
import AutomationCenterLive,{type AutomationData,type ModuleKey} from './AutomationCenterLive';
import styles from './automation.module.css';

const modules=new Set<ModuleKey>(['tickets','issues','suggestions','knowledge','moderation','txadmin']);

function AutomationLoading(){
  return <div className={styles.loading} aria-live="polite">
    <div className={styles.loadingBar}><span/><small>Loading live automation data…</small></div>
    <div className={styles.loadingSummary}>{[1,2,3,4].map(item=><i key={item}/>)}</div>
    <div className={styles.loadingPanel}><i/><i/><i/></div>
  </div>;
}

async function AutomationDataView({moduleFilter,includeReviewed}:{moduleFilter:ModuleKey|null;includeReviewed:boolean}){
  const [data,access]=await Promise.all([
    api<AutomationData>(`/api/automation?include_reviewed=${includeReviewed?'true':'false'}`),
    getDashboardAccess()
  ]);
  return <AutomationCenterLive initialData={data} access={access} moduleFilter={moduleFilter} includeReviewed={includeReviewed}/>;
}

export default async function AutomationPage({searchParams}:{searchParams:Promise<{module?:string;reviewed?:string}>}){
  const params=await searchParams;const includeReviewed=params.reviewed==='1';
  const moduleFilter=modules.has(String(params.module) as ModuleKey)?String(params.module) as ModuleKey:null;
  return <>
    <header className="pageHeader compactPageHeader"><div><p className="eyebrow">AUTOMATION CONTROL</p><h1>Automation Center</h1><p>One prioritized inbox for work Saucin AI detected, organized, or needs staff to verify.</p></div><div className="headerActions"><Link className="button" href={includeReviewed?'/automation':'/automation?reviewed=1'}>{includeReviewed?'Hide reviewed':'Review history'}</Link></div></header>
    <Suspense fallback={<AutomationLoading/>}>
      <AutomationDataView moduleFilter={moduleFilter} includeReviewed={includeReviewed}/>
    </Suspense>
  </>;
}
