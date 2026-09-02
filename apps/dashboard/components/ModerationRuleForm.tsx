'use client';

import { useState, type FormEvent, type ReactNode } from 'react';

type SaveState='idle'|'saving'|'saved'|'error';

type Props={
  articleId:string;
  children:ReactNode;
};

export default function ModerationRuleForm({articleId,children}:Props){
  const [state,setState]=useState<SaveState>('idle');
  const [message,setMessage]=useState('');

  async function onSubmit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(state==='saving') return;

    const form=event.currentTarget;
    const controller=new AbortController();
    const timeout=window.setTimeout(()=>controller.abort(),12000);
    setState('saving');
    setMessage('');

    try{
      const response=await fetch(`/api/moderation/rules/${encodeURIComponent(articleId)}`,{
        method:'PUT',
        body:new FormData(form),
        signal:controller.signal,
        credentials:'same-origin',
        cache:'no-store'
      });

      let payload:{error?:string}|null=null;
      try{ payload=await response.json() as {error?:string}; }catch{}
      if(!response.ok){
        throw new Error(payload?.error||`Save failed (${response.status}).`);
      }

      setState('saved');
      setMessage('Rule settings saved.');
    }catch(error){
      const aborted=controller.signal.aborted;
      setState('error');
      setMessage(aborted
        ? 'Save timed out after 12 seconds. The button has been reset so you can retry.'
        : error instanceof Error?error.message:'Unable to save rule settings.');
    }finally{
      window.clearTimeout(timeout);
    }
  }

  function markDirty(){
    if(state==='saved'||state==='error'){
      setState('idle');
      setMessage('');
    }
  }

  return <form
    onSubmit={onSubmit}
    className="knowledgeForm"
    data-dashboard-managed-state="true"
    onChange={markDirty}
  >
    {children}
    <div className="formActions">
      <div>
        <p>The verified rule text remains in the Knowledge Library; moderation settings do not rewrite policy or the standard ladder.</p>
        {state==='saved'?<small style={{display:'block',marginTop:6}}>✓ {message}</small>:null}
        {state==='error'?<small style={{display:'block',marginTop:6}} className="formError">{message}</small>:null}
      </div>
      <button className={`button primary${state==='saved'?' isSaved':''}`} type="submit" disabled={state==='saving'} aria-busy={state==='saving'}>
        {state==='saving'?<><span className="actionSpinner" aria-hidden="true"/><span>Saving rule settings…</span></>:<span>{state==='saved'?'Saved ✓':'Save rule settings'}</span>}
      </button>
    </div>
  </form>;
}
