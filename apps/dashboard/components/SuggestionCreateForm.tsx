'use client';

import { useState } from 'react';

export default function SuggestionCreateForm(){
  const [state,setState]=useState<'idle'|'saving'|'error'>('idle');
  const [message,setMessage]=useState('');

  async function submit(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();
    const fd=new FormData(event.currentTarget);
    setState('saving');setMessage('');
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),12000);
    try{
      const response=await fetch('/api/suggestions',{
        method:'POST',signal:controller.signal,headers:{'content-type':'application/json'},body:JSON.stringify({
          title:String(fd.get('title')||'').trim(),
          summary:String(fd.get('summary')||'').trim(),
          category:String(fd.get('category')||'general').trim()||'general',
          staff_notes:String(fd.get('staff_notes')||'').trim()
        })
      });
      const body=await response.json().catch(()=>({}));
      if(!response.ok) throw new Error(body?.error||`Create failed (${response.status})`);
      if(!body?.id) throw new Error('Suggestion was created but no ID was returned.');
      window.location.href=`/suggestions/${body.id}`;
    }catch(error){
      setState('error');
      setMessage(controller.signal.aborted?'The create request timed out after 12 seconds.':error instanceof Error?error.message:'Unable to create suggestion.');
    }finally{clearTimeout(timer);}
  }

  return <form className="knowledgeForm" onSubmit={submit}>
    <div className="formGrid">
      <label className="field fieldWide"><span>Title</span><input className="input" name="title" required maxLength={180} placeholder="Example: Add a city hall permit system"/></label>
      <label className="field"><span>Category</span><input className="input" name="category" defaultValue="general" maxLength={100}/></label>
      <label className="field fieldFull"><span>Suggestion</span><textarea className="textarea" name="summary" rows={8} required maxLength={6000} placeholder="Describe the requested feature or improvement."/></label>
      <label className="field fieldFull"><span>Staff notes <small>optional</small></span><textarea className="textarea" name="staff_notes" rows={4} maxLength={6000}/></label>
    </div>
    <div className="formActions"><div>{state==='error'?<span className="formError">{message}</span>:<p>Manual suggestions use the same queue as Discord-detected ideas.</p>}</div><button className="button primary" type="submit" disabled={state==='saving'}>{state==='saving'?'Creating suggestion…':'Create suggestion'}</button></div>
  </form>;
}
