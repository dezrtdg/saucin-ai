'use server';

import { revalidatePath } from 'next/cache';
import { api } from '../../lib/api';
import { runDashboardAction } from '../../lib/actionFeedback';

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
    resolution_summary: String(formData.get('resolution_summary') || '').trim() || undefined,
    staff_notes: String(formData.get('staff_notes') || '').trim() || undefined,
    aliases: lines(formData.get('aliases')),
    symptoms: lines(formData.get('symptoms')),
    log_patterns: String(formData.get('log_patterns') || '').split('\n').map(v => v.trim()).filter(Boolean)
  };
}

export async function createIssueAction(formData: FormData) {
  return runDashboardAction({
    fallbackPath:'/issues/create',successMessage:'Issue created.',successPath:(created:{id:string|number})=>`/issues/${created.id}`
  },async()=>{
    const created=await api<{id:string|number}>('/api/issues', { method: 'POST', body: JSON.stringify(issuePayload(formData)) });
    revalidatePath('/issues');
    return created;
  });
}

export async function updateIssueAction(id: string, formData: FormData) {
  return runDashboardAction({fallbackPath:`/issues/${id}`,successMessage:'Issue saved.'},async()=>{
    await api(`/api/issues/${id}`, { method: 'PUT', body: JSON.stringify(issuePayload(formData)) });
    await api(`/api/issues/${id}/resolution`,{method:'PUT',body:JSON.stringify({
      resolution_summary:String(formData.get('resolution_summary')||'').trim()
    })});
    revalidatePath('/issues');
    revalidatePath(`/issues/${id}`);
    return null;
  });
}

export async function deleteIssueAction(id: string) {
  return runDashboardAction({fallbackPath:'/issues',successMessage:'Issue deleted.',successPath:'/issues'},async()=>{
    await api(`/api/issues/${id}`, { method: 'DELETE' });
    revalidatePath('/issues');
    return null;
  });
}

export async function createIssueTicketAction(id: string) {
  return runDashboardAction({fallbackPath:`/issues/${id}`,successMessage:'Discord issue ticket created or synchronized.'},async()=>{
    await api(`/api/issues/${id}/discord-ticket`, { method: 'POST', body: '{}' });
    revalidatePath('/issues');
    revalidatePath(`/issues/${id}`);
    return null;
  });
}

export async function runIssueResolutionAction(id:string){
  return runDashboardAction({fallbackPath:`/issues/${id}`,successMessage:'Resolution knowledge draft prepared.'},async()=>{
    await api(`/api/issues/${id}/resolution-loop`,{method:'POST',body:'{}'});
    revalidatePath('/issues');revalidatePath(`/issues/${id}`);revalidatePath('/knowledge');revalidatePath('/knowledge-gaps');revalidatePath('/automation');
    return null;
  });
}

export async function resolutionGapReviewAction(issueId:string,gapId:string,status:'linked'|'dismissed'){
  return runDashboardAction({fallbackPath:`/issues/${issueId}`,successMessage:status==='linked'?'Knowledge gap linked to this resolution.':'Unrelated knowledge gap removed.'},async()=>{
    await api(`/api/issues/${issueId}/resolution-gaps/${gapId}`,{method:'PUT',body:JSON.stringify({status})});
    revalidatePath(`/issues/${issueId}`);revalidatePath('/knowledge-gaps');revalidatePath('/automation');
    return null;
  });
}

export async function observationStatusAction(issueId: string, observationId: string, status: 'community'|'verified'|'rejected') {
  return runDashboardAction({fallbackPath:`/issues/${issueId}`,successMessage:'Observation status updated.'},async()=>{
    await api(`/api/issues/${issueId}/observations/${observationId}`, { method: 'PUT', body: JSON.stringify({ status }) });
    revalidatePath('/issues');
    revalidatePath(`/issues/${issueId}`);
    return null;
  });
}

export async function txAdminMatchFeedbackAction(issueId:string,eventId:string,outcome:'helpful'|'incorrect'){
  return runDashboardAction({fallbackPath:`/issues/${issueId}`,successMessage:outcome==='helpful'?'Server evidence match confirmed.':'Incorrect server evidence match removed.'},async()=>{
    await api('/api/automation/feedback',{method:'POST',body:JSON.stringify({
      module:'txadmin',resource_type:'txadmin_match',resource_id:`${issueId}:${eventId}`,outcome
    })});
    revalidatePath('/automation');revalidatePath('/issues');revalidatePath(`/issues/${issueId}`);revalidatePath('/txadmin');
    return null;
  });
}

export async function candidateStatusAction(id: string, formData: FormData) {
  return runDashboardAction({fallbackPath:'/issues',successMessage:'Incoming report updated.'},async()=>{
    await api(`/api/issues/candidates/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ status: String(formData.get('status') || 'dismissed') })
    });
    revalidatePath('/issues');
    return null;
  });
}

export async function promoteCandidateAction(id: string, formData: FormData) {
  return runDashboardAction({fallbackPath:'/issues',successMessage:'Incoming report promoted to a known issue.'},async()=>{
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
    return null;
  });
}

export async function linkCandidateAction(id: string, formData: FormData) {
  return runDashboardAction({fallbackPath:'/issues',successMessage:'Incoming report linked to the known issue.'},async()=>{
    await api(`/api/issues/candidates/${id}/link`, {
      method: 'POST',
      body: JSON.stringify({ issue_id: String(formData.get('issue_id') || '') })
    });
    revalidatePath('/issues');
    return null;
  });
}

export async function createIssueWithAiAction(formData: FormData) {
  return runDashboardAction({
    fallbackPath:'/issues/create',successMessage:'AI issue draft created.',successPath:(created:{id:string|number})=>`/issues/${created.id}`
  },async()=>{
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
    return created;
  });
}
