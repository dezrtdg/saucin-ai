'use server';
import { revalidatePath } from 'next/cache';
import { api } from '../../../lib/api';

function val(fd:FormData,key:string){return String(fd.get(key)||'').trim();}
function checked(fd:FormData,key:string){return fd.get(key)==='on';}

const standardActionLadder = {
  first: { action: 'reminder', delete_message: false },
  second: { action: 'warning', delete_message: false },
  third: { action: 'timeout_10m', delete_message: true },
  fourth_plus: { action: 'timeout_1h', delete_message: true }
} as const;

export async function saveModerationSettingsAction(formData:FormData){
  const desiredMode=val(formData,'mode')||'off';
  const baseMode=desiredMode==='off'?'off':'observe';

  await api('/api/moderation/settings',{method:'PUT',body:JSON.stringify({
    mode:baseMode,
    minimum_confidence:Number(val(formData,'minimum_confidence')||.9),
    repeat_window_days:Number(val(formData,'repeat_window_days')||7),
    audit_channel_id:val(formData,'audit_channel_id')||null,
    post_observations_to_audit:desiredMode==='live'?false:checked(formData,'post_observations_to_audit'),
    exempt_role_ids:[...new Set(formData.getAll('exempt_role_ids').map(String).filter(Boolean))],
    diagnostics_enabled:checked(formData,'diagnostics_enabled')
  })});

  await api('/api/moderation/live',{method:'PUT',body:JSON.stringify({mode:desiredMode})});
  revalidatePath('/settings/moderation');
  revalidatePath('/moderation');
}

export async function saveModerationRuleAction(articleId:string,formData:FormData){
  const min=val(formData,'minimum_confidence');
  const days=val(formData,'repeat_window_days');
  await api(`/api/moderation/rules/${articleId}`,{method:'PUT',body:JSON.stringify({
    enabled:checked(formData,'enabled'),
    minimum_confidence:min?Number(min):null,
    recommended_action:'reminder',
    action_ladder:standardActionLadder,
    repeat_window_days:days?Number(days):null,
    exempt_role_ids:[...new Set(formData.getAll('exempt_role_ids').map(String).filter(Boolean))],
    channel_ids:[...new Set(formData.getAll('channel_ids').map(String).filter(Boolean))]
  })});
  revalidatePath('/settings/moderation');
  revalidatePath('/moderation');
}

export async function clearModerationDiagnosticsAction(){
  await api('/api/moderation/diagnostics',{method:'DELETE'});
  revalidatePath('/settings/moderation/diagnostics');
}
