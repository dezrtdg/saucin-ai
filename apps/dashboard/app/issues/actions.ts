'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { api } from '../../lib/api';

function lines(value: FormDataEntryValue | null) {
  return String(value || '')
    .split(/[\n,]+/)
    .map(item => item.trim())
    .filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index);
}

function issuePayload(formData: FormData) {
  return {
    title: String(formData.get('title') || '').trim(),
    description: String(formData.get('description') || '').trim(),
    category: String(formData.get('category') || 'general').trim() || 'general',
    resource_name: String(formData.get('resource_name') || '').trim() || undefined,
    severity: String(formData.get('severity') || 'medium'),
    status: String(formData.get('status') || 'new'),
    public_response: String(formData.get('public_response') || '').trim() || undefined,
    workaround: String(formData.get('workaround') || '').trim() || undefined,
    staff_notes: String(formData.get('staff_notes') || '').trim() || undefined,
    aliases: lines(formData.get('aliases')),
    symptoms: lines(formData.get('symptoms')),
    log_patterns: String(formData.get('log_patterns') || '').split('\n').map(v => v.trim()).filter(Boolean)
  };
}

export async function createIssueAction(formData: FormData) {
  const created = await api<{id:string|number}>('/api/issues', { method: 'POST', body: JSON.stringify(issuePayload(formData)) });
  revalidatePath('/issues');
  redirect(`/issues/${created.id}`);
}

export async function updateIssueAction(id: string, formData: FormData) {
  await api(`/api/issues/${id}`, { method: 'PUT', body: JSON.stringify(issuePayload(formData)) });
  revalidatePath('/issues');
}

export async function deleteIssueAction(id: string) {
  await api(`/api/issues/${id}`, { method: 'DELETE' });
  revalidatePath('/issues');
}

export async function createIssueTicketAction(id: string) {
  await api(`/api/issues/${id}/discord-ticket`, { method: 'POST', body: '{}' });
  revalidatePath('/issues');
}

export async function observationStatusAction(issueId: string, observationId: string, status: 'community'|'verified'|'rejected') {
  await api(`/api/issues/${issueId}/observations/${observationId}`, {
    method: 'PUT', body: JSON.stringify({ status })
  });
  revalidatePath('/issues');
}

export async function candidateStatusAction(id: string, formData: FormData) {
  await api(`/api/issues/candidates/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ status: String(formData.get('status') || 'dismissed') })
  });
  revalidatePath('/issues');
}

export async function promoteCandidateAction(id: string, formData: FormData) {
  await api(`/api/issues/candidates/${id}/promote`, {
    method: 'POST',
    body: JSON.stringify({
      title: String(formData.get('title') || '').trim() || undefined,
      severity: String(formData.get('severity') || 'medium'),
      status: String(formData.get('status') || 'new'),
      resource_name: String(formData.get('resource_name') || '').trim() || undefined,
      category: String(formData.get('category') || 'general')
    })
  });
  revalidatePath('/issues');
  redirect('/issues');
}

export async function linkCandidateAction(id: string, formData: FormData) {
  await api(`/api/issues/candidates/${id}/link`, {
    method: 'POST',
    body: JSON.stringify({ issue_id: String(formData.get('issue_id') || '') })
  });
  revalidatePath('/issues');
}


export async function createIssueWithAiAction(formData: FormData) {
  const sourceText = String(formData.get('source_text') || '').trim();
  if (sourceText.length < 8) throw new Error('Paste the issue evidence you want Saucin AI to organize.');
  const draft = await api<{
    title:string; description:string; category:string; resource_name:string; severity:'low'|'medium'|'high'|'critical';
    aliases:string[]; symptoms:string[]; log_patterns:string[]; workaround:string; staff_notes:string; authoring_note?:string;
  }>('/api/issues/ai-build', {
    method: 'POST',
    body: JSON.stringify({
      source_text: sourceText,
      category_hint: String(formData.get('category_hint') || '').trim() || undefined,
      resource_hint: String(formData.get('resource_hint') || '').trim() || undefined,
      severity_hint: String(formData.get('severity_hint') || '').trim() || undefined
    })
  });

  const reviewNote = draft.authoring_note ? `AI creation review note: ${draft.authoring_note}` : '';
  const staffNotes = [draft.staff_notes, reviewNote].filter(Boolean).join('\n\n').slice(0,12000);
  const created = await api<{id:string|number}>('/api/issues', {
    method: 'POST',
    body: JSON.stringify({
      title: draft.title,
      description: draft.description,
      category: draft.category,
      resource_name: draft.resource_name || undefined,
      severity: draft.severity,
      status: 'new',
      aliases: draft.aliases,
      symptoms: draft.symptoms,
      log_patterns: draft.log_patterns,
      workaround: draft.workaround || undefined,
      staff_notes: staffNotes || undefined
    })
  });
  revalidatePath('/issues');
  redirect(`/issues/${created.id}`);
}
