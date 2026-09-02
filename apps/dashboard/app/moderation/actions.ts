'use server';
import { revalidatePath } from 'next/cache';
import { api } from '../../lib/api';
import { runDashboardAction } from '../../lib/actionFeedback';

function value(formData:FormData,key:string){return String(formData.get(key)||'').trim();}

export async function reviewModerationCaseAction(caseId:string,status:'pending'|'confirmed'|'dismissed',formData:FormData){
  const label=status==='confirmed'?'Moderation case confirmed.':status==='dismissed'?'Moderation case dismissed and removed from escalation.':'Moderation case reopened.';
  return runDashboardAction({
    fallbackPath:`/moderation/${caseId}`,
    successMessage:label,
    successPath:status==='dismissed'?'/moderation':undefined
  },async()=>{
    await api(`/api/moderation/cases/${caseId}/review`,{method:'PUT',body:JSON.stringify({status,notes:value(formData,'notes')||null})});
    revalidatePath('/moderation');
    revalidatePath(`/moderation/${caseId}`);
    return null;
  });
}
