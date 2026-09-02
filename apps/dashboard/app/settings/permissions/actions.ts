'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { api } from '../../../lib/api';

export async function saveRolePermissionsAction(roleId:string, formData:FormData){
  const permissions=[...new Set(formData.getAll('permissions').map(value=>String(value).trim()).filter(Boolean))];
  try {
    await api(`/api/permissions/roles/${encodeURIComponent(roleId)}`,{
      method:'PUT',
      body:JSON.stringify({permissions})
    });
  } catch (error) {
    const message=error instanceof Error
      ? error.message
      : 'Unable to save role permissions.';
    redirect(`/settings/permissions?role=${encodeURIComponent(roleId)}&error=${encodeURIComponent(message)}`);
  }
  revalidatePath('/settings');
  revalidatePath('/settings/permissions');
  redirect(`/settings/permissions?role=${encodeURIComponent(roleId)}&saved=1`);
}
