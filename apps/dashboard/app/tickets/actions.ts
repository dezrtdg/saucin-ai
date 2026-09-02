'use server';
import { revalidatePath } from 'next/cache';
import { api } from '../../lib/api';
import { runDashboardAction } from '../../lib/actionFeedback';

function value(data:FormData,key:string){return String(data.get(key)||'').trim();}

export async function updateTicketStatusAction(ticketId:string,status:'open'|'claimed'|'awaiting_user',formData:FormData){
  return runDashboardAction({fallbackPath:`/tickets/${ticketId}`,successMessage:'Ticket status updated.'},async()=>{
    await api(`/api/tickets/${ticketId}/status`,{method:'PUT',body:JSON.stringify({status,note:value(formData,'note')||undefined})});
    revalidatePath('/tickets');revalidatePath(`/tickets/${ticketId}`);return null;
  });
}

export async function issuePunishmentAction(ticketId:string,formData:FormData){
  const action=value(formData,'action');
  const duration=Number(value(formData,'duration_seconds')||0)||null;
  return runDashboardAction({fallbackPath:`/tickets/${ticketId}`,successMessage:'Punishment applied and recorded.'},async()=>{
    await api(`/api/tickets/${ticketId}/punishments`,{method:'POST',body:JSON.stringify({
      target_user_id:value(formData,'target_user_id').replace(/[<@!>]/g,''),action,duration_seconds:duration,
      reason:value(formData,'reason'),internal_notes:value(formData,'internal_notes')
    })});
    revalidatePath('/tickets');revalidatePath(`/tickets/${ticketId}`);revalidatePath('/moderation');return null;
  });
}

export async function reversePunishmentAction(ticketId:string,punishmentId:string,formData:FormData){
  return runDashboardAction({fallbackPath:`/tickets/${ticketId}`,successMessage:'Punishment reversed; audit history preserved.'},async()=>{
    await api(`/api/punishments/${punishmentId}/reverse`,{method:'POST',body:JSON.stringify({reason:value(formData,'reversal_reason')})});
    revalidatePath(`/tickets/${ticketId}`);revalidatePath('/moderation');return null;
  });
}
