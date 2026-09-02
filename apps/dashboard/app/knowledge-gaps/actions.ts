'use server';

import { revalidatePath } from 'next/cache';
import { api } from '../../lib/api';
import { runDashboardAction } from '../../lib/actionFeedback';

export async function updateKnowledgeGapAction(id: string, formData: FormData) {
  return runDashboardAction({fallbackPath:'/knowledge-gaps',successMessage:'Knowledge gap updated.'},async()=>{
    await api(`/api/knowledge/gaps/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ status: String(formData.get('status') || 'open'), notes: String(formData.get('notes') || '') })
    });
    revalidatePath('/knowledge-gaps');
    return null;
  });
}

export async function convertKnowledgeGapAction(id: string, formData: FormData) {
  return runDashboardAction({fallbackPath:'/knowledge-gaps',successMessage:'Knowledge gap converted to a draft article.'},async()=>{
    await api(`/api/knowledge/gaps/${id}/convert`, {
      method: 'POST',
      body: JSON.stringify({
        category: String(formData.get('category') || 'general'),
        audiences: [String(formData.get('audience') || 'public')]
      })
    });
    revalidatePath('/knowledge-gaps');
    revalidatePath('/knowledge');
    return null;
  });
}

export async function reanalyzeKnowledgeGapAction(id: string) {
  return runDashboardAction({fallbackPath:'/knowledge-gaps',successMessage:'Knowledge gap re-analyzed.'},async()=>{
    await api(`/api/knowledge/gaps/${id}/reanalyze`, { method: 'POST', body: '{}' });
    revalidatePath('/knowledge-gaps');
    return null;
  });
}
