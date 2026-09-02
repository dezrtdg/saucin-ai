'use server';

import { revalidatePath } from 'next/cache';
import { api } from '../../../lib/api';
import { runDashboardAction } from '../../../lib/actionFeedback';

export async function saveRolePermissionsAction(roleId:string, formData:FormData){
  return runDashboardAction({fallbackPath:`/settings/permissions?role=${encodeURIComponent(roleId)}`,successMessage:'Role permissions saved.'},async()=>{
    const permissions=[...new Set(formData.getAll('permissions').map(value=>String(value).trim()).filter(Boolean))];
    await api(`/api/permissions/roles/${encodeURIComponent(roleId)}`,{
      method:'PUT',
      body:JSON.stringify({permissions})
    });
    revalidatePath('/settings');
    revalidatePath('/settings/permissions');
    return null;
  });
}
