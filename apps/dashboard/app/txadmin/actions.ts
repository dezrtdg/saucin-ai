'use server';

import { revalidatePath } from 'next/cache';
import { api } from '../../lib/api';
import { runDashboardAction } from '../../lib/actionFeedback';

export async function acknowledgeTxEventAction(id:string){
  return runDashboardAction({fallbackPath:'/txadmin',successMessage:'Server alert acknowledged.'},async()=>{
    await api(`/api/txadmin/events/${id}/acknowledge`,{method:'POST',body:'{}'});
    revalidatePath('/txadmin');return null;
  });
}

export async function resolveTxEventAction(id:string){
  return runDashboardAction({fallbackPath:'/txadmin',successMessage:'Server alert resolved.'},async()=>{
    await api(`/api/txadmin/events/${id}/resolve`,{method:'POST',body:'{}'});
    revalidatePath('/txadmin');return null;
  });
}
