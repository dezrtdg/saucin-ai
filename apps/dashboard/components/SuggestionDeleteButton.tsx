'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function SuggestionDeleteButton({suggestionId,label}:{suggestionId:number;label:string}){
  const router=useRouter();
  const [state,setState]=useState<'idle'|'deleting'|'error'>('idle');
  const [error,setError]=useState('');

  async function remove(){
    const confirmed=window.confirm(`Permanently delete ${label} from the dashboard and delete its linked Discord forum post? This cannot be undone.`);
    if(!confirmed) return;
    setState('deleting');setError('');
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),20000);
    try{
      const response=await fetch(`/api/suggestions/${suggestionId}`,{method:'DELETE',signal:controller.signal});
      const body=await response.json().catch(()=>({})) as {error?:string};
      if(!response.ok) throw new Error(body.error||`Deletion failed (${response.status})`);
      router.push('/suggestions');
      router.refresh();
    }catch(reason){
      setState('error');
      setError(controller.signal.aborted?'Deletion timed out after 20 seconds.':reason instanceof Error?reason.message:'Unable to delete suggestion.');
    }finally{clearTimeout(timer);}
  }

  return <div><button className="button danger" type="button" onClick={remove} disabled={state==='deleting'}>{state==='deleting'?'Deleting suggestion…':'Delete suggestion and Discord post'}</button>{state==='error'?<small className="formError" style={{display:'block',marginTop:7}}>{error}</small>:null}</div>;
}
