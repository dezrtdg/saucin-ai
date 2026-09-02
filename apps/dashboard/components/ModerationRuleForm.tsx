'use client';

import { useActionState, useEffect, useState, type ReactNode } from 'react';

export type ModerationRuleSaveState={
  status:'idle'|'saved'|'error';
  revision:number;
  message?:string;
};

type Props={
  action:(previous:ModerationRuleSaveState,formData:FormData)=>Promise<ModerationRuleSaveState>;
  children:ReactNode;
};

const INITIAL_STATE:ModerationRuleSaveState={status:'idle',revision:0};

export default function ModerationRuleForm({action,children}:Props){
  const [state,formAction,pending]=useActionState(action,INITIAL_STATE);
  const [dirty,setDirty]=useState(false);

  useEffect(()=>{
    if(state.status==='saved') setDirty(false);
  },[state.revision,state.status]);

  const saved=state.status==='saved'&&!dirty&&!pending;
  const error=state.status==='error'&&!pending;

  return <form
    action={formAction}
    className="knowledgeForm"
    data-dashboard-managed-state="true"
    onChange={()=>setDirty(true)}
  >
    {children}
    <div className="formActions">
      <div>
        <p>The verified rule text remains in the Knowledge Library; moderation settings do not rewrite policy or the standard ladder.</p>
        {saved?<small style={{display:'block',marginTop:6}}>✓ {state.message||'Rule settings saved.'}</small>:null}
        {error?<small style={{display:'block',marginTop:6}} className="formError">{state.message||'Unable to save rule settings.'}</small>:null}
      </div>
      <button className={`button primary${saved?' isSaved':''}`} type="submit" disabled={pending} aria-busy={pending}>
        {pending?<><span className="actionSpinner" aria-hidden="true"/><span>Saving rule settings…</span></>:<span>{saved?'Saved ✓':'Save rule settings'}</span>}
      </button>
    </div>
  </form>;
}
