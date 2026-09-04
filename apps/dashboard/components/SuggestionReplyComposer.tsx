'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Props={suggestionId:number;threadLinked:boolean;canUseAi:boolean};
type State='idle'|'drafting'|'posting'|'saved'|'error';

export default function SuggestionReplyComposer({suggestionId,threadLinked,canUseAi}:Props){
  const router=useRouter();
  const [reply,setReply]=useState('');
  const [state,setState]=useState<State>('idle');
  const [message,setMessage]=useState('');

  async function helpWrite(){
    if(reply.trim().length<3){setState('error');setMessage('Write a few rough notes first so AI has something accurate to work from.');return;}
    setState('drafting');setMessage('');
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),45000);
    try{
      const response=await fetch(`/api/suggestions/${suggestionId}/reply/ai-draft`,{
        method:'POST',signal:controller.signal,headers:{'content-type':'application/json'},body:JSON.stringify({draft:reply.trim()})
      });
      const body=await response.json().catch(()=>({})) as {reply?:string;error?:string};
      if(!response.ok) throw new Error(body.error||`AI drafting failed (${response.status})`);
      setReply(String(body.reply||reply));
      setState('idle');setMessage('AI-polished draft loaded. Review it before posting.');
    }catch(error){
      setState('error');
      setMessage(controller.signal.aborted?'AI drafting timed out after 45 seconds.':error instanceof Error?error.message:'Unable to draft this update.');
    }finally{clearTimeout(timer);}
  }

  async function post(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(!reply.trim()) return;
    setState('posting');setMessage('');
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),15000);
    try{
      const response=await fetch(`/api/suggestions/${suggestionId}/reply`,{
        method:'POST',signal:controller.signal,headers:{'content-type':'application/json'},body:JSON.stringify({content:reply.trim()})
      });
      const body=await response.json().catch(()=>({})) as {error?:string};
      if(!response.ok) throw new Error(body.error||`Discord update failed (${response.status})`);
      setReply('');setState('saved');setMessage('Update posted to the Discord discussion.');
      router.refresh();
      setTimeout(()=>setState(current=>current==='saved'?'idle':current),3500);
    }catch(error){
      setState('error');
      setMessage(controller.signal.aborted?'Discord did not accept the update within 15 seconds.':error instanceof Error?error.message:'Unable to post this update.');
    }finally{clearTimeout(timer);}
  }

  const busy=state==='drafting'||state==='posting';
  return <form className="suggestionReplyComposer" onSubmit={post} data-dashboard-managed-state="true">
    <label className="field"><span>Reply to the suggestion discussion</span><textarea className="textarea" rows={6} value={reply} onChange={event=>{setReply(event.target.value);if(state==='saved'||state==='error')setState('idle');}} maxLength={1700} disabled={!threadLinked||busy} placeholder="Share progress, ask for more details, explain a decision, or post another community update…"/><small>This posts as a new staff update. It does not replace the suggestion or expose staff-only notes.</small></label>
    <div className="formActions suggestionReplyActions"><div>{!threadLinked?<span className="formError">Create the Discord discussion before posting an update.</span>:state==='error'?<span className="formError">{message}</span>:message?<span className="formSuccess">✓ {message}</span>:<p>Write the final reply yourself, or give AI rough notes to polish.</p>}</div><div className="headerActions">{canUseAi?<button className="button" type="button" onClick={helpWrite} disabled={!threadLinked||busy||reply.trim().length<3}>{state==='drafting'?'Helping write…':'✨ Help write with AI'}</button>:null}<button className="button primary" type="submit" disabled={!threadLinked||busy||!reply.trim()}>{state==='posting'?'Posting update…':state==='saved'?'Posted ✓':'Post update to Discord'}</button></div></div>
  </form>;
}
