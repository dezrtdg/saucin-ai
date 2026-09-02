'use server';

import { revalidatePath } from 'next/cache';
import { api } from '../../../lib/api';
import { runDashboardAction } from '../../../lib/actionFeedback';

function bool(formData: FormData, key: string) {
  return formData.get(key) === 'on' || formData.get(key) === 'true';
}

export async function updateBotSettingsAction(formData: FormData) {
  return runDashboardAction({fallbackPath:'/settings/bot',successMessage:'Bot settings saved.'},async()=>{
    const count = Number(formData.get('direct_mentions_context_messages') || 8);
    await api('/api/bot/settings', {
      method: 'PUT',
      body: JSON.stringify({
        direct_mentions_enabled: bool(formData, 'direct_mentions_enabled'),
        direct_mentions_bypass_channel_mode: bool(formData, 'direct_mentions_bypass_channel_mode'),
        direct_mentions_use_reply_context: bool(formData, 'direct_mentions_use_reply_context'),
        direct_mentions_use_recent_context: bool(formData, 'direct_mentions_use_recent_context'),
        direct_mentions_context_messages: Number.isInteger(count) ? Math.max(0, Math.min(25, count)) : 8
      })
    });
    revalidatePath('/settings/bot');
    return null;
  });
}
