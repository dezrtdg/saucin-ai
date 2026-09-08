'use server';

import { revalidatePath } from 'next/cache';
import { api } from '../../lib/api';
import { runDashboardAction } from '../../lib/actionFeedback';

type ModuleKey='tickets'|'issues'|'suggestions'|'knowledge'|'moderation'|'txadmin';
type Outcome='reviewed'|'helpful'|'incorrect'|'reopened';

export async function updateAutomationModuleAction(module:ModuleKey,formData:FormData){
  return runDashboardAction({fallbackPath:'/automation',successMessage:'Automation authority updated.'},async()=>{
    await api(`/api/automation/modules/${module}`,{method:'PUT',body:JSON.stringify({autonomy_level:String(formData.get('autonomy_level')||'observe')})});
    revalidatePath('/automation');revalidatePath('/txadmin');return null;
  });
}

export async function automationFeedbackAction(module:ModuleKey,resourceType:string,resourceId:string,outcome:Outcome,formData?:FormData){
  return runDashboardAction({fallbackPath:'/automation',successMessage:outcome==='reopened'?'Item returned to the inbox.':outcome==='incorrect'?'Correction saved.':'Item marked reviewed.'},async()=>{
    await api('/api/automation/feedback',{method:'POST',body:JSON.stringify({
      module,resource_type:resourceType,resource_id:resourceId,outcome,note:String(formData?.get('note')||'').trim()
    })});
    revalidatePath('/automation');return null;
  });
}
