'use server';
import { revalidatePath } from 'next/cache';
import { api } from '../../../lib/api';
function val(fd:FormData,key:string){return String(fd.get(key)||'').trim();}
function checked(fd:FormData,key:string){return fd.get(key)==='on';}
export async function saveModerationSettingsAction(formData:FormData){
  await api('/api/moderation/settings',{method:'PUT',body:JSON.stringify({
    mode:val(formData,'mode')||'off',minimum_confidence:Number(val(formData,'minimum_confidence')||.9),repeat_window_days:Number(val(formData,'repeat_window_days')||7),
    audit_channel_id:val(formData,'audit_channel_id')||null,post_observations_to_audit:checked(formData,'post_observations_to_audit'),
    exempt_role_ids:[...new Set(formData.getAll('exempt_role_ids').map(String).filter(Boolean))],
    diagnostics_enabled:checked(formData,'diagnostics_enabled')
  })}); revalidatePath('/settings/moderation'); revalidatePath('/moderation');
}
export async function saveModerationRuleAction(articleId:string,formData:FormData){
  const min=val(formData,'minimum_confidence'); const days=val(formData,'repeat_window_days');
  const first=val(formData,'action_first')||'staff_review';
  const second=val(formData,'action_second')||first;
  const third=val(formData,'action_third')||second;
  const fourthPlus=val(formData,'action_fourth_plus')||third;
  await api(`/api/moderation/rules/${articleId}`,{method:'PUT',body:JSON.stringify({
    enabled:checked(formData,'enabled'),minimum_confidence:min?Number(min):null,recommended_action:first,
    action_ladder:{
      first:{action:first,delete_message:checked(formData,'delete_first')},
      second:{action:second,delete_message:checked(formData,'delete_second')},
      third:{action:third,delete_message:checked(formData,'delete_third')},
      fourth_plus:{action:fourthPlus,delete_message:checked(formData,'delete_fourth_plus')}
    },repeat_window_days:days?Number(days):null,
    exempt_role_ids:[...new Set(formData.getAll('exempt_role_ids').map(String).filter(Boolean))],channel_ids:[...new Set(formData.getAll('channel_ids').map(String).filter(Boolean))]
  })}); revalidatePath('/settings/moderation');
}


export async function clearModerationDiagnosticsAction(){
  await api('/api/moderation/diagnostics',{method:'DELETE'});
  revalidatePath('/settings/moderation/diagnostics');
}
