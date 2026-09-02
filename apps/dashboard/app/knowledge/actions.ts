'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { api } from '../../lib/api';
import { getDashboardSession } from '../../lib/auth';

const allowedStatuses = new Set(['draft','published','archived']);
const keyPattern = /^[a-z0-9][a-z0-9_-]*$/;

type ArticleRecord = {
  id:string; title:string; body:string; content_type:string; category:string; audiences:string[]; status:string;
  source_url:string|null; aliases:string[]; related_topics:string[]; example_questions:string[];
};

function text(formData: FormData, key: string) { return String(formData.get(key) || '').trim(); }
function list(formData: FormData, key: string, splitCommas = true) {
  const raw = text(formData, key);
  if (!raw) return [];
  const pieces = splitCommas ? raw.split(/\r?\n|,/g) : raw.split(/\r?\n/g);
  return [...new Set(pieces.map(value => value.trim()).filter(Boolean))];
}
function revalidateKnowledge() {
  ['/knowledge','/knowledge/all','/knowledge/server-rules','/knowledge/discord-rules','/'].forEach(path => revalidatePath(path));
}
function returnPathForType(type:string) {
  if (type === 'server_rule') return '/knowledge/server-rules';
  if (type === 'discord_rule') return '/knowledge/discord-rules';
  return '/knowledge';
}
function returnPathForScope(scope:string, fallbackType='') {
  if (scope === 'server_rule') return '/knowledge/server-rules';
  if (scope === 'discord_rule') return '/knowledge/discord-rules';
  if (scope === 'all') return '/knowledge/all';
  if (scope === 'general') return '/knowledge';
  return returnPathForType(fallbackType);
}
function safeScope(scope:string) {
  return ['server_rule','discord_rule','general','all'].includes(scope) ? scope : 'general';
}
function articlePayload(formData: FormData) {
  const title = text(formData, 'title');
  const body = text(formData, 'body');
  const contentType = text(formData, 'content_type') || 'other';
  const category = text(formData, 'category') || 'general';
  const audiences = [...new Set(formData.getAll('audiences').map(value => String(value).trim()).filter(Boolean))];
  const status = text(formData, 'status') || 'published';
  const sourceUrl = text(formData, 'source_url');
  const aliases = list(formData, 'aliases', true);
  const relatedTopics = list(formData, 'related_topics', true);
  const exampleQuestions = list(formData, 'example_questions', false);
  if (title.length < 2) throw new Error('Title must be at least 2 characters.');
  if (body.length < 5) throw new Error('Article content must be at least 5 characters.');
  if (!keyPattern.test(contentType)) throw new Error('Invalid content type.');
  if (!keyPattern.test(category)) throw new Error('Invalid category.');
  if (!audiences.length || audiences.some(value => !keyPattern.test(value))) throw new Error('Select at least one valid audience.');
  if (!allowedStatuses.has(status)) throw new Error('Invalid status.');
  return { title, body, content_type:contentType, category, audiences, status, aliases, related_topics:relatedTopics, example_questions:exampleQuestions, source_url:sourceUrl || null };
}

export async function createKnowledgeAction(formData: FormData) {
  const payload = articlePayload(formData);
  const returnScope = safeScope(text(formData, 'return_scope') || 'general');
  const session = await getDashboardSession();
  const created = await api<ArticleRecord>('/api/knowledge', { method:'POST', body:JSON.stringify({ ...payload, ...(session ? { created_by:`${session.displayName} (${session.userId})` } : {}) }) });
  revalidateKnowledge();
  redirect(`/knowledge/${created.id}?from=${encodeURIComponent(returnScope)}`);
}

export async function updateKnowledgeAction(formData: FormData) {
  const id = text(formData, 'id');
  const returnScope = safeScope(text(formData, 'return_scope') || 'general');
  if (!/^\d+$/.test(id)) throw new Error('Invalid article ID.');
  await api(`/api/knowledge/${id}`, { method:'PUT', body:JSON.stringify(articlePayload(formData)) });
  revalidateKnowledge();
  revalidatePath(`/knowledge/${id}`);
  redirect(`/knowledge/${id}?from=${encodeURIComponent(returnScope)}`);
}

export async function deleteKnowledgeAction(formData: FormData) {
  const id = text(formData, 'id');
  const confirmation = text(formData, 'confirm_delete');
  if (!/^\d+$/.test(id)) throw new Error('Invalid article ID.');
  if (confirmation !== 'DELETE') throw new Error('Delete confirmation was not supplied.');
  const existing = await api<ArticleRecord>(`/api/knowledge/${id}`);
  await api(`/api/knowledge/${id}`, { method:'DELETE' });
  revalidateKnowledge();
  redirect(returnPathForType(existing.content_type));
}

export async function createKnowledgeWithAiAction(formData: FormData) {
  const sourceText = text(formData, 'source_text');
  const returnScope = safeScope(text(formData, 'return_scope') || 'general');
  const returnUrl = `/knowledge/create?mode=ai&scope=${encodeURIComponent(returnScope)}`;
  if (sourceText.length < 8) {
    redirect(`${returnUrl}&error=${encodeURIComponent('Paste the verified information you want Saucin AI to organize.')}`);
  }

  const audienceHints = [...new Set(formData.getAll('audiences').map(value => String(value).trim()).filter(Boolean))];
  let created: ArticleRecord;
  try {
    const draft = await api<{ title:string; body:string; content_type:string; category:string; audiences:string[]; aliases:string[]; related_topics:string[]; example_questions:string[]; authoring_note?:string }>('/api/knowledge/ai-build', {
      method:'POST',
      body:JSON.stringify({ source_text:sourceText, content_type_hint:text(formData,'content_type_hint') || undefined, category_hint:text(formData,'category_hint') || undefined, audience_hints:audienceHints })
    });
    const session = await getDashboardSession();
    created = await api<ArticleRecord>('/api/knowledge', {
      method:'POST',
      body:JSON.stringify({
        title:draft.title, body:draft.body, content_type:draft.content_type, category:draft.category, audiences:draft.audiences,
        status:'draft', aliases:draft.aliases, related_topics:draft.related_topics, example_questions:draft.example_questions,
        // created_by is an audit identity field capped at 120 characters.
        // Do not append AI review notes here; a long note can make an otherwise valid
        // AI draft fail during the database/API validation step.
        created_by:session ? `AI draft for ${session.displayName} (${session.userId})`.slice(0,120) : 'AI-assisted draft'
      })
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to create the AI knowledge draft.';
    redirect(`${returnUrl}&error=${encodeURIComponent(message)}`);
  }

  revalidateKnowledge();
  redirect(`/knowledge/${created.id}?from=${encodeURIComponent(returnScope)}`);
}

export async function improveKnowledgeAction(formData: FormData) {
  const id = text(formData, 'id');
  if (!/^\d+$/.test(id)) throw new Error('Invalid article ID.');
  await api(`/api/knowledge/${id}/ai-improve`, { method:'POST', body:'{}' });
  revalidateKnowledge();
  revalidatePath(`/knowledge/${id}`);
}

export async function setKnowledgeStatusAction(formData:FormData) {
  const id=text(formData,'id');
  const status=text(formData,'status');
  const returnScope=safeScope(text(formData,'return_scope') || 'general');
  if (!/^\d+$/.test(id)) throw new Error('Invalid article ID.');
  if (!allowedStatuses.has(status)) throw new Error('Invalid status.');
  const existing=await api<ArticleRecord>(`/api/knowledge/${id}`);
  await api(`/api/knowledge/${id}`, { method:'PUT', body:JSON.stringify({ ...existing, status }) });
  revalidateKnowledge();
  revalidatePath(`/knowledge/${id}`);
  if (status === 'published') redirect(returnPathForScope(returnScope, existing.content_type));
}
