'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { api } from '../../lib/api';

function value(formData:FormData,key:string){return String(formData.get(key)||'').trim();}

export async function reviewModerationCaseAction(caseId:string,status:'pending'|'confirmed'|'dismissed',formData:FormData){
  await api(`/api/moderation/cases/${caseId}/review`,{method:'PUT',body:JSON.stringify({status,notes:value(formData,'notes')||null})});
  revalidatePath('/moderation');
  revalidatePath(`/moderation/${caseId}`);
  redirect(`/moderation/${caseId}?saved=1`);
}
