'use server';

import { revalidatePath } from 'next/cache';
import { api } from '../../../lib/api';

function bool(formData: FormData, key: string) { return formData.get(key) === 'on'; }

export async function createIssueCategoryAction(formData: FormData) {
  await api('/api/issues/categories', { method: 'POST', body: JSON.stringify({
    key: String(formData.get('key') || '').trim(),
    label: String(formData.get('label') || '').trim(),
    description: String(formData.get('description') || '').trim(),
    sort_order: Number(formData.get('sort_order') || 100),
    enabled: bool(formData,'enabled')
  }) });
  revalidatePath('/settings/issues'); revalidatePath('/issues');
}

export async function updateIssueCategoryAction(key: string, formData: FormData) {
  await api(`/api/issues/categories/${key}`, { method: 'PUT', body: JSON.stringify({
    label: String(formData.get('label') || '').trim(),
    description: String(formData.get('description') || '').trim(),
    sort_order: Number(formData.get('sort_order') || 100),
    enabled: bool(formData,'enabled')
  }) });
  revalidatePath('/settings/issues'); revalidatePath('/issues');
}

export async function deleteIssueCategoryAction(key: string) {
  await api(`/api/issues/categories/${key}`, { method: 'DELETE' });
  revalidatePath('/settings/issues'); revalidatePath('/issues');
}

export async function updateIssueAutomationAction(formData: FormData) {
  await api('/api/issues/automation', { method: 'PUT', body: JSON.stringify({
    intake_channel_id: String(formData.get('intake_channel_id') || '').trim() || null,
    auto_create_threads: bool(formData,'auto_create_threads'),
    allow_player_details: bool(formData,'allow_player_details'),
    auto_summarize_thread: bool(formData,'auto_summarize_thread'),
    auto_update_symptoms: bool(formData,'auto_update_symptoms'),
    auto_collect_workarounds: bool(formData,'auto_collect_workarounds'),
    auto_collect_reproduction: bool(formData,'auto_collect_reproduction'),
    auto_collect_locations: bool(formData,'auto_collect_locations'),
    edit_original_status_message: bool(formData,'edit_original_status_message'),
    post_status_updates_to_thread: bool(formData,'post_status_updates_to_thread'),
    auto_public_response: bool(formData,'auto_public_response'),
    include_bug_id: bool(formData,'include_bug_id'),
    include_workaround: bool(formData,'include_workaround'),
    include_affected_count: bool(formData,'include_affected_count')
  }) });
  revalidatePath('/settings/issues'); revalidatePath('/issues');
}

export async function updateIssueTemplateAction(status: string, formData: FormData) {
  await api(`/api/issues/templates/${status}`, { method: 'PUT', body: JSON.stringify({
    template: String(formData.get('template') || '').trim(),
    enabled: bool(formData,'enabled')
  }) });
  revalidatePath('/settings/issues'); revalidatePath('/issues');
}
