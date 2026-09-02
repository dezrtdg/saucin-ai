'use client';

import { useState } from 'react';

type Props={
  suggestion:{id:number;title:string;summary:string;category:string;status:string;staff_notes:string};
};

export default function SuggestionEditForm({suggestion}:Props){
  const [state,setState]=useState<'idle'|'saving'|'saved'|'error'>('idle');
  const [message,setMessage]=useState('');

  async function submit(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();
    const form=event.currentTarget;
    const fd=new FormData(form);
    setState('saving');setMessage('');
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),12000);
    try{
      const response=await fetch(`/api/suggestions/${suggestion.id}`,{
        method:'PUT',signal:controller.signal,headers:{'content-type':'application/json'},body:JSON.stringify({
          title:String(fd.get('title')||'').trim(),
          summary:String(fd.get('summary')||'').trim(),
          category:String(fd.get('category')||'general').trim()||'general',
          status:String(fd.get('status')||'candidate'),
          staff_notes:String(fd.get('staff_notes')||'').trim()
        })
      });
      const body=await response.json().catch(()=>({}));
      if(!response.ok) throw new Error(body?.error||`Save failed (${response.status})`);
      setState('saved');setMessage('Suggestion saved.');
      setTimeout(()=>{setState(current=>current==='saved'?'idle':current);},2500);
    }catch(error){
      const aborted=controller.signal.aborted;
      setState('error');
      setMessage(aborted?'The save timed out after 12 seconds.':error instanceof Error?error.message:'Unable to save suggestion.');
    }finally{clearTimeout(timer);}
  }

  return <form className="knowledgeForm" onSubmit={submit} onChange={()=>{if(state==='saved')setState('idle')}}>
    <div className="formGrid">
      <label className="field fieldWide"><span>Title</span><input className="input" name="title" defaultValue={suggestion.title} required maxLength={180}/></label>
      <label className="field"><span>Status</span><select className="input select" name="status" defaultValue={suggestion.status}>
        <option value="candidate">Candidate</option><option value="reviewing">Reviewing</option><option value="planned">Planned</option><option value="accepted">Accepted</option><option value="declined">Declined</option><option value="shipped">Shipped</option>
      </select></label>
      <label className="field"><span>Category</span><input className="input" name="category" defaultValue={suggestion.category||'general'} maxLength={100}/></label>
      <label className="field fieldFull"><span>Community suggestion summary</span><textarea className="textarea" name="summary" rows={7} defaultValue={suggestion.summary} required maxLength={6000}/><small>Keep this grounded in what community members actually suggested.</small></label>
      <label className="field fieldFull"><span>Staff notes</span><textarea className="textarea" name="staff_notes" rows={5} defaultValue={suggestion.staff_notes||''} maxLength={6000}/><small>Internal notes only. These are not sent to Discord.</small></label>
    </div>
    <div className="formActions"><div>{state==='saved'?<span className="formSuccess">✓ {message}</span>:state==='error'?<span className="formError">{message}</span>:<p>Status changes and edits stay on this page.</p>}</div><button className={`button primary${state==='saved'?' isSaved':''}`} type="submit" disabled={state==='saving'}>{state==='saving'?'Saving suggestion…':state==='saved'?'Saved ✓':'Save suggestion'}</button></div>
  </form>;
}
