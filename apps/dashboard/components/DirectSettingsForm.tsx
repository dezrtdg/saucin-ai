'use client';

import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

type SaveState = { kind:'idle'|'saving'|'saved'|'error'; message?:string };

type Props = {
  operation:string;
  resourceId?:string;
  className?:string;
  children?:ReactNode;
  idleLabel:string;
  pendingLabel?:string;
  successMessage?:string;
  buttonClassName?:string;
  layout?:'footer'|'inline'|'button';
  actionsClassName?:string;
  footer?:ReactNode;
  refreshOnSuccess?:boolean;
  resetOnSuccess?:boolean;
  confirmMessage?:string;
};

export default function DirectSettingsForm({
  operation,
  resourceId,
  className,
  children,
  idleLabel,
  pendingLabel='Saving…',
  successMessage='Saved.',
  buttonClassName='button primary',
  layout='footer',
  actionsClassName='formActions',
  footer,
  refreshOnSuccess=false,
  resetOnSuccess=false,
  confirmMessage
}:Props){
  const router=useRouter();
  const formRef=useRef<HTMLFormElement>(null);
  const [state,setState]=useState<SaveState>({kind:'idle'});

  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(state.kind==='saving') return;
    if(confirmMessage && !window.confirm(confirmMessage)) return;

    const form=event.currentTarget;
    const data=new FormData(form);
    data.set('_operation',operation);
    if(resourceId) data.set('_resource',resourceId);

    const controller=new AbortController();
    const timeout=window.setTimeout(()=>controller.abort(),12000);
    setState({kind:'saving'});

    try{
      const response=await fetch('/api/settings/action',{
        method:'POST',
        body:data,
        signal:controller.signal,
        cache:'no-store'
      });
      let payload:{ok?:boolean;error?:string}={};
      try{ payload=await response.json() as {ok?:boolean;error?:string}; }catch{}
      if(!response.ok) throw new Error(payload.error||`Request failed (${response.status}).`);

      if(resetOnSuccess) form.reset();
      setState({kind:'saved',message:successMessage});
      if(refreshOnSuccess) router.refresh();
    }catch(error){
      const aborted=controller.signal.aborted;
      setState({
        kind:'error',
        message:aborted
          ? 'The save did not finish within 12 seconds. Please try again.'
          : error instanceof Error ? error.message : 'Unable to complete this action.'
      });
    }finally{
      window.clearTimeout(timeout);
    }
  }

  function changed(){
    if(state.kind==='saved'||state.kind==='error') setState({kind:'idle'});
  }

  const pending=state.kind==='saving';
  const buttonLabel=pending?pendingLabel:state.kind==='saved'?'Saved ✓':idleLabel;
  const status=state.kind==='saved'
    ? <small style={{display:'block',marginTop:6}}>✓ {state.message||successMessage}</small>
    : state.kind==='error'
      ? <small className="formError" style={{display:'block',marginTop:6}}>{state.message}</small>
      : null;

  const button=<button className={`${buttonClassName}${state.kind==='saved'?' isSaved':''}`} type="submit" disabled={pending} aria-busy={pending}>
    {pending?<><span className="actionSpinner" aria-hidden="true"/><span>{buttonLabel}</span></>:<span>{buttonLabel}</span>}
  </button>;

  return <form ref={formRef} className={className} onSubmit={submit} onChange={changed} data-dashboard-managed-state="true">
    {children}
    {layout==='inline'?<>{button}{status}</>:layout==='button'?<>{button}{status}</>:<div className={actionsClassName}>
      <div>{footer}{status}</div>
      {button}
    </div>}
  </form>;
}
