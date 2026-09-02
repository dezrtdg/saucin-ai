'use server';

import { revalidatePath } from 'next/cache';
import { api } from '../../../lib/api';

function text(formData: FormData, key: string) {
  return String(formData.get(key) || '').trim();
}

function bool(formData: FormData, key: string) {
  return formData.get(key) === 'on' || formData.get(key) === 'true';
}

function integer(formData: FormData, key: string, fallback = 100) {
  const value = Number(text(formData, key));
  return Number.isInteger(value) ? value : fallback;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export async function createCategoryAction(formData: FormData) {
  const label = text(formData, 'label');
  const key = slugify(text(formData, 'key') || label);
  if (!label || !key) throw new Error('Category name is required.');
  await api('/api/knowledge/categories', {
    method: 'POST',
    body: JSON.stringify({ key, label, description: text(formData, 'description'), sort_order: integer(formData, 'sort_order'), enabled: true })
  });
  revalidatePath('/settings/knowledge');
  revalidatePath('/knowledge');
}

export async function updateCategoryAction(formData: FormData) {
  const key = text(formData, 'key');
  await api(`/api/knowledge/categories/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({
      label: text(formData, 'label'),
      description: text(formData, 'description'),
      sort_order: integer(formData, 'sort_order'),
      enabled: bool(formData, 'enabled')
    })
  });
  revalidatePath('/settings/knowledge');
  revalidatePath('/knowledge');
}

export async function deleteCategoryAction(formData: FormData) {
  const key = text(formData, 'key');
  await api(`/api/knowledge/categories/${encodeURIComponent(key)}`, { method: 'DELETE' });
  revalidatePath('/settings/knowledge');
  revalidatePath('/knowledge');
}

export async function createAudienceAction(formData: FormData) {
  const label = text(formData, 'label');
  const key = slugify(text(formData, 'key') || label);
  if (!label || !key) throw new Error('Audience name is required.');
  await api('/api/knowledge/audiences', {
    method: 'POST',
    body: JSON.stringify({
      key,
      label,
      description: text(formData, 'description'),
      public_access: bool(formData, 'public_access'),
      sort_order: integer(formData, 'sort_order'),
      enabled: true
    })
  });
  revalidatePath('/settings/knowledge');
  revalidatePath('/knowledge');
}

export async function updateAudienceAction(formData: FormData) {
  const key = text(formData, 'key');
  const roleIds = [...new Set(formData.getAll('role_ids').map(value => String(value).trim()).filter(Boolean))];
  await api(`/api/knowledge/audiences/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({
      label: text(formData, 'label'),
      description: text(formData, 'description'),
      public_access: bool(formData, 'public_access'),
      sort_order: integer(formData, 'sort_order'),
      enabled: bool(formData, 'enabled')
    })
  });
  await api(`/api/knowledge/audiences/${encodeURIComponent(key)}/roles`, {
    method: 'PUT',
    body: JSON.stringify({ role_ids: roleIds })
  });
  revalidatePath('/settings/knowledge');
  revalidatePath('/knowledge');
}

export async function deleteAudienceAction(formData: FormData) {
  const key = text(formData, 'key');
  await api(`/api/knowledge/audiences/${encodeURIComponent(key)}`, { method: 'DELETE' });
  revalidatePath('/settings/knowledge');
  revalidatePath('/knowledge');
}

export async function createContentTypeAction(formData: FormData) {
  const label = text(formData, 'label');
  const key = slugify(text(formData, 'key') || label);
  if (!label || !key) throw new Error('Content type name is required.');
  await api('/api/knowledge/content-types', {
    method: 'POST',
    body: JSON.stringify({
      key,
      label,
      description: text(formData, 'description'),
      moderation_eligible: bool(formData, 'moderation_eligible'),
      sort_order: integer(formData, 'sort_order'),
      enabled: true
    })
  });
  revalidatePath('/settings/knowledge');
  revalidatePath('/knowledge');
}

export async function updateContentTypeAction(formData: FormData) {
  const key = text(formData, 'key');
  await api(`/api/knowledge/content-types/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({
      label: text(formData, 'label'),
      description: text(formData, 'description'),
      moderation_eligible: bool(formData, 'moderation_eligible'),
      sort_order: integer(formData, 'sort_order'),
      enabled: bool(formData, 'enabled')
    })
  });
  revalidatePath('/settings/knowledge');
  revalidatePath('/knowledge');
}

export async function deleteContentTypeAction(formData: FormData) {
  const key = text(formData, 'key');
  await api(`/api/knowledge/content-types/${encodeURIComponent(key)}`, { method: 'DELETE' });
  revalidatePath('/settings/knowledge');
  revalidatePath('/knowledge');
}
