'use client';

import { useState } from 'react';

type Draft={title:string;summary:string;category:string;related_terms:string[];expansion_note?:string};
function lines(value:string){return [...new Set(value.split(/[\n,]+/).map(item=>item.trim()).filter(Boolean))];}

export default function SuggestionCreateForm({mode}:{mode:'ai'|'manual'}){
  const [state,setState]=useState<'idle'|'drafting'|'saving'|'error'>('idle');
  const [message,setMessage]=useState('');
  const [sourceText,setSourceText]=useState('');
  const [title,setTitle]=useState('');
  const [summary,setSummary]=useState('');
  const [category,setCategory]=useState('general');
  const [relatedTerms,setRelatedTerms]=useState('');
  const [staffNotes,setStaffNotes]=useState('');

  async function createDraft(){
    if(sourceText.trim().length<8){setState('error');setMessage('Add a little more detail before asking AI to develop the idea.');return;}
    setState('drafting');setMessage('');
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),45000);
    try{
      const response=await fetch('/api/suggestions/ai-build',{
        method:'POST',signal:controller.signal,headers:{'content-type':'application/json'},
        body:JSON.stringify({source_text:sourceText.trim()})
      });
      const body=await response.json().catch(()=>({})) as Partial<Draft>&{error?:string};
      if(!response.ok) throw new Error(body.error||`AI draft failed (${response.status})`);
      setTitle(String(body.title||''));
      setSummary(String(body.summary||''));
      setCategory(String(body.category||'general'));
      setRelatedTerms((body.related_terms||[]).join('\n'));
      if(body.expansion_note) setStaffNotes(`AI review note: ${body.expansion_note}`);
      setState('idle');setMessage('AI draft ready. Review and edit it before creating the suggestion.');
    }catch(error){
      setState('error');
      setMessage(controller.signal.aborted?'AI drafting timed out after 45 seconds.':error instanceof Error?error.message:'Unable to create an AI draft.');
    }finally{clearTimeout(timer);}
  }

  async function submit(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();
    setState('saving');setMessage('');
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),20000);
    try{
      const response=await fetch('/api/suggestions',{
        method:'POST',signal:controller.signal,headers:{'content-type':'application/json'},body:JSON.stringify({
          title:title.trim(),summary:summary.trim(),category:category.trim()||'general',
          related_terms:lines(relatedTerms),staff_notes:staffNotes.trim(),
          source_text:mode==='ai'?sourceText.trim():undefined
        })
      });
      const body=await response.json().catch(()=>({}));
      if(!response.ok) throw new Error(body?.error||`Create failed (${response.status})`);
      if(!body?.id) throw new Error('Suggestion was created but no ID was returned.');
      window.location.href=`/suggestions/${body.id}`;
    }catch(error){
      setState('error');
      setMessage(controller.signal.aborted?'The create request timed out after 20 seconds.':error instanceof Error?error.message:'Unable to create suggestion.');
    }finally{clearTimeout(timer);}
  }

  return <form className="knowledgeForm" onSubmit={submit}>
    <div className="formGrid">
      {mode==='ai'?<label className="field fieldFull"><span>Original idea or notes</span><textarea className="textarea aiSourceTextarea" value={sourceText} onChange={event=>setSourceText(event.target.value)} rows={10} minLength={8} maxLength={18000} required placeholder="Paste the original suggestion, rough idea, links, examples, or staff notes. AI will organize and expand only what is supported here."/><small>The original text is preserved in Community History even after the AI draft is edited.</small></label>:null}
      {mode==='ai'?<div className="field fieldFull"><div className="headerActions"><button className="button" type="button" onClick={createDraft} disabled={state==='drafting'||state==='saving'}>{state==='drafting'?'Developing idea…':'✨ Develop idea with AI'}</button></div></div>:null}
      <label className="field fieldWide"><span>Title</span><input className="input" name="title" value={title} onChange={event=>setTitle(event.target.value)} required maxLength={180} placeholder="Example: Add a city hall permit system"/></label>
      <label className="field"><span>Category</span><input className="input" name="category" value={category} onChange={event=>setCategory(event.target.value)} maxLength={100}/></label>
      <label className="field fieldFull"><span>Suggestion</span><textarea className="textarea" name="summary" value={summary} onChange={event=>setSummary(event.target.value)} rows={8} required maxLength={6000} placeholder="Describe the requested feature or improvement."/></label>
      <label className="field fieldWide"><span>Related phrases <small>one per line</small></span><textarea className="textarea compactTextarea" value={relatedTerms} onChange={event=>setRelatedTerms(event.target.value)} rows={5} maxLength={4000} placeholder={'permit system\ncity hall permits\nbusiness licensing'}/><small>These help cluster differently worded versions of the same idea.</small></label>
      <label className="field fieldWide"><span>Staff notes <small>optional</small></span><textarea className="textarea compactTextarea" name="staff_notes" value={staffNotes} onChange={event=>setStaffNotes(event.target.value)} rows={5} maxLength={6000}/></label>
    </div>
    <div className="formActions"><div>{state==='error'?<span className="formError">{message}</span>:message?<span className="formSuccess">✓ {message}</span>:<p>{mode==='ai'?'AI creates an editable draft; it does not replace the original submission.':'Manual suggestions use the same queue and forum workflow as Discord-detected ideas.'}</p>}</div><button className="button primary" type="submit" disabled={state==='saving'||state==='drafting'}>{state==='saving'?'Creating suggestion…':'Create suggestion'}</button></div>
  </form>;
}
