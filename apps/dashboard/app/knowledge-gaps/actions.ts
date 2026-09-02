'use server';

import { revalidatePath } from 'next/cache';
import { api } from '../../lib/api';

export async function updateKnowledgeGapAction(id: string, formData: FormData) {
  await api(`/api/knowledge/gaps/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ status: String(formData.get('status') || 'open'), notes: String(formData.get('notes') || '') })
  });
  revalidatePath('/knowledge-gaps');
}

export async function convertKnowledgeGapAction(id: string, formData: FormData) {
  await api(`/api/knowledge/gaps/${id}/convert`, {
    method: 'POST',
    body: JSON.stringify({
      category: String(formData.get('category') || 'general'),
      audiences: [String(formData.get('audience') || 'public')]
    })
  });
  revalidatePath('/knowledge-gaps');
  revalidatePath('/knowledge');
}

export async function reanalyzeKnowledgeGapAction(id: string) {
  await api(`/api/knowledge/gaps/${id}/reanalyze`, { method: 'POST', body: '{}' });
  revalidatePath('/knowledge-gaps');
}
