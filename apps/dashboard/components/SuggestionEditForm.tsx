'use client';

import { useState } from 'react';

type Props={
  suggestion:{
    id:number;title:string;summary:string;category:string;status:string;staff_notes:string;
    related_terms?:string[];discord_thread_id?:string|null;
  };
};
type Draft={title:string;summary:string;category:string;related_terms:string[];expansion_note?:string};
function lines(value:string){return [...new Set(value.split(/[\n,]+/).map(item=>item.trim()).filter(Boolean))];}

export default function SuggestionEditForm({suggestion}:Props){
  const [state,setState]=useState<'idle'|'saving'|'saved'|'drafting'|'syncing'|'error'>('idle');
  const [message,setMessage]=useState('');
  const [title,setTitle]=useState(suggestion.title);
  const [summary,setSummary]=useState(suggestion.summary);
  const [category,setCategory]=useState(suggestion.category||'general');
  const [status,setStatus]=useState(suggestion.status);
  const [staffNotes,setStaffNotes]=useState(suggestion.staff_notes||'');
  const [relatedTerms,setRelatedTerms]=useState((suggestion.related_terms||[]).join('\n'));
  const [additionalContext,setAdditionalContext]=useState('');
  const [threadId,setThreadId]=useState(suggestion.discord_thread_id||null);

  async function expandWithAi(){
    setState('drafting');setMessage('');
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),45000);
    try{
      const response=await fetch(`/api/suggestions/${suggestion.id}/ai-expand`,{
        method:'POST',signal:controller.signal,headers:{'content-type':'application/json'},
        body:JSON.stringify({additional_context:additionalContext.trim()||undefined})
      });
      const body=await response.json().catch(()=>({})) as Partial<Draft>&{error?:string};
      if(!response.ok) throw new Error(body.error||`AI expansion failed (${response.status})`);
      setTitle(String(body.title||title));
      setSummary(String(body.summary||summary));
      setCategory(String(body.category||category));
      setRelatedTerms((body.related_terms||lines(relatedTerms)).join('\n'));
      if(body.expansion_note){
        setStaffNotes(current=>[current,`AI expansion review note: ${body.expansion_note}`].filter(Boolean).join('\n\n').slice(0,6000));
      }
      setState('idle');setMessage('AI-expanded draft loaded. Review it, then save when ready.');
    }catch(error){
      setState('error');
      setMessage(controller.signal.aborted?'AI expansion timed out after 45 seconds.':error instanceof Error?error.message:'Unable to expand this suggestion.');
    }finally{clearTimeout(timer);}
  }

  async function syncForum(){
    setState('syncing');setMessage('');
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),15000);
    try{
      const response=await fetch(`/api/suggestions/${suggestion.id}/discord-post`,{method:'POST',signal:controller.signal});
      const body=await response.json().catch(()=>({}));
      if(!response.ok) throw new Error(body?.error||`Discord sync failed (${response.status})`);
      if(body?.thread_id) setThreadId(String(body.thread_id));
      setState('idle');setMessage('Discord forum discussion created or synchronized.');
    }catch(error){
      setState('error');
      setMessage(controller.signal.aborted?'Discord sync timed out after 15 seconds.':error instanceof Error?error.message:'Unable to synchronize Discord.');
    }finally{clearTimeout(timer);}
  }

  async function submit(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();
    setState('saving');setMessage('');
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),20000);
    try{
      const response=await fetch(`/api/suggestions/${suggestion.id}`,{
        method:'PUT',signal:controller.signal,headers:{'content-type':'application/json'},body:JSON.stringify({
          title:title.trim(),summary:summary.trim(),category:category.trim()||'general',status,
          staff_notes:staffNotes.trim(),related_terms:lines(relatedTerms)
        })
      });
      const body=await response.json().catch(()=>({}));
      if(!response.ok) throw new Error(body?.error||`Save failed (${response.status})`);
      if(body?.discord_thread_id) setThreadId(String(body.discord_thread_id));
      setState('saved');setMessage('Suggestion saved and its Discord discussion synchronized.');
      setTimeout(()=>setState(current=>current==='saved'?'idle':current),3000);
    }catch(error){
      setState('error');
      setMessage(controller.signal.aborted?'The save timed out after 20 seconds.':error instanceof Error?error.message:'Unable to save suggestion.');
    }finally{clearTimeout(timer);}
  }

  return <form className="knowledgeForm" onSubmit={submit} onChange={()=>{if(state==='saved')setState('idle')}}>
    <div className="formGrid">
      <label className="field fieldWide"><span>Title</span><input className="input" name="title" value={title} onChange={event=>setTitle(event.target.value)} required maxLength={180}/></label>
      <label className="field"><span>Status</span><select className="input select" name="status" value={status} onChange={event=>setStatus(event.target.value)}>
        <option value="candidate">Candidate</option><option value="reviewing">Reviewing</option><option value="planned">Planned</option><option value="accepted">Accepted</option><option value="declined">Declined</option><option value="shipped">Shipped</option>
      </select></label>
      <label className="field"><span>Category</span><input className="input" name="category" value={category} onChange={event=>setCategory(event.target.value)} maxLength={100}/></label>
      <label className="field fieldFull"><span>Community suggestion summary</span><textarea className="textarea" name="summary" rows={8} value={summary} onChange={event=>setSummary(event.target.value)} required maxLength={6000}/><small>This clean draft can be edited without losing the original community messages below.</small></label>
      <label className="field fieldWide"><span>Related phrases <small>one per line</small></span><textarea className="textarea compactTextarea" rows={5} value={relatedTerms} onChange={event=>setRelatedTerms(event.target.value)} maxLength={4000}/><small>Used for semantic, keyword, and duplicate matching.</small></label>
      <label className="field fieldWide"><span>Staff notes</span><textarea className="textarea compactTextarea" name="staff_notes" rows={5} value={staffNotes} onChange={event=>setStaffNotes(event.target.value)} maxLength={6000}/><small>Internal only; never posted to Discord.</small></label>
      <label className="field fieldFull"><span>Additional context for AI <small>optional</small></span><textarea className="textarea compactTextarea" rows={4} value={additionalContext} onChange={event=>setAdditionalContext(event.target.value)} maxLength={12000} placeholder="Add a staff note, implementation constraint, or new community detail before expanding the idea."/><small>AI also reads the preserved submission and linked community discussion.</small></label>
      <div className="field fieldFull"><div className="headerActions">
        <button className="button" type="button" onClick={expandWithAi} disabled={state==='drafting'||state==='saving'||state==='syncing'}>{state==='drafting'?'Expanding idea…':'✨ Expand idea with AI'}</button>
        <button className="button" type="button" onClick={syncForum} disabled={state==='drafting'||state==='saving'||state==='syncing'}>{state==='syncing'?'Syncing Discord…':threadId?'Sync Discord discussion':'Create Discord discussion'}</button>
      </div></div>
    </div>
    <div className="formActions"><div>{state==='saved'?<span className="formSuccess">✓ {message}</span>:state==='error'?<span className="formError">{message}</span>:message?<span className="formSuccess">✓ {message}</span>:<p>Status changes are posted to this suggestion’s linked Discord discussion.</p>}</div><button className={`button primary${state==='saved'?' isSaved':''}`} type="submit" disabled={state==='saving'||state==='drafting'||state==='syncing'}>{state==='saving'?'Saving suggestion…':state==='saved'?'Saved ✓':'Save suggestion'}</button></div>
  </form>;
}
