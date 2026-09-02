'use server';
import { revalidatePath } from 'next/cache';
import { api } from '../../../lib/api';
import { runDashboardAction } from '../../../lib/actionFeedback';

function val(fd:FormData,key:string){return String(fd.get(key)||'').trim();}
function checked(fd:FormData,key:string){return fd.get(key)==='on';}

const standardActionLadder = {
  first: { action: 'reminder', delete_message: false },
  second: { action: 'warning', delete_message: false },
  third: { action: 'timeout_10m', delete_message: true },
  fourth_plus: { action: 'timeout_1h', delete_message: true }
} as const;

export async function saveModerationSettingsAction(formData:FormData){
  return runDashboardAction({fallbackPath:'/settings/moderation',successMessage:'Moderation settings saved.'},async()=>{
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
    return null;
  });
}

export async function saveModerationRuleAction(
  articleId:string,
  previous:{status:'idle'|'saved'|'error';revision:number;message?:string},
  formData:FormData
){
  const min=val(formData,'minimum_confidence');
  const days=val(formData,'repeat_window_days');
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),12000);

  try {
    await api(`/api/moderation/rules/${articleId}`,{
      method:'PUT',
      signal:controller.signal,
      body:JSON.stringify({
        enabled:checked(formData,'enabled'),
        minimum_confidence:min?Number(min):null,
        recommended_action:'reminder',
        action_ladder:standardActionLadder,
        repeat_window_days:days?Number(days):null,
        exempt_role_ids:[...new Set(formData.getAll('exempt_role_ids').map(String).filter(Boolean))],
        channel_ids:[...new Set(formData.getAll('channel_ids').map(String).filter(Boolean))]
      })
    });
    revalidatePath('/moderation');
    return {status:'saved' as const,revision:previous.revision+1,message:'Rule settings saved.'};
  } catch(error) {
    const aborted=controller.signal.aborted;
    return {
      status:'error' as const,
      revision:previous.revision+1,
      message:aborted
        ? 'The moderation API did not respond within 12 seconds. Nothing was left spinning; try again or check the API container log.'
        : error instanceof Error ? error.message : 'Unable to save moderation rule settings.'
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function clearModerationDiagnosticsAction(){
  return runDashboardAction({fallbackPath:'/settings/moderation/diagnostics',successMessage:'Moderation diagnostics cleared.'},async()=>{
    await api('/api/moderation/diagnostics',{method:'DELETE'});
    revalidatePath('/settings/moderation/diagnostics');
    return null;
  });
}
