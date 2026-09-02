import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

export type DashboardFeedbackKind = 'success'|'error';

type DashboardActionOptions<T> = {
  fallbackPath:string;
  successMessage:string;
  successPath?:string|((result:T)=>string);
  errorMessage?:string;
};

function cleanMessage(value:string){
  return value.replace(/\s+/g,' ').trim().slice(0,280) || 'Action completed.';
}

function safeInternalPath(value:string|undefined|null,fallback:string){
  const candidate=String(value||'').trim();
  if(!candidate.startsWith('/') || candidate.startsWith('//') || candidate.startsWith('/api/')) return fallback;
  if(/[\r\n]/.test(candidate)) return fallback;
  return candidate.slice(0,2400);
}

function withFeedback(path:string,kind:DashboardFeedbackKind,message:string){
  const hashIndex=path.indexOf('#');
  const base=hashIndex>=0?path.slice(0,hashIndex):path;
  const hash=hashIndex>=0?path.slice(hashIndex):'';
  const url=new URL(base,'http://saucin-dashboard.local');
  url.searchParams.delete('_ux');
  url.searchParams.delete('_uxm');
  url.searchParams.set('_ux',kind);
  url.searchParams.set('_uxm',cleanMessage(message));
  return `${url.pathname}${url.search}${hash}`;
}

async function dashboardReturnPath(fallbackPath:string){
  const fallback=safeInternalPath(fallbackPath,'/');
  try{
    const requestHeaders=await headers();
    const referer=requestHeaders.get('referer');
    if(!referer) return fallback;
    const url=new URL(referer);
    return safeInternalPath(`${url.pathname}${url.search}`,fallback);
  }catch{
    return fallback;
  }
}

function errorText(error:unknown,fallback?:string){
  if(fallback) return fallback;
  if(error instanceof Error && error.message.trim()) return error.message;
  return 'Unable to complete this action.';
}

export async function runDashboardAction<T>(
  options:DashboardActionOptions<T>,
  action:()=>Promise<T>
):Promise<never>{
  const returnPath=await dashboardReturnPath(options.fallbackPath);
  let result!:T;
  try{
    result=await action();
  }catch(error){
    redirect(withFeedback(returnPath,'error',errorText(error,options.errorMessage)));
  }

  const configuredTarget=typeof options.successPath==='function'
    ? options.successPath(result)
    : options.successPath;
  const target=safeInternalPath(configuredTarget,returnPath);
  redirect(withFeedback(target,'success',options.successMessage));
}
