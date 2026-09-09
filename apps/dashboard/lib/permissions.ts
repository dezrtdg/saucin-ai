import { api } from './api';
import { cache } from 'react';

export type DashboardAccess = {
  authorized: boolean;
  permissions: string[];
  owner_bypass: boolean;
  configured: boolean;
  source?: string;
};

// Layouts and pages frequently need the same permission snapshot. React's
// request cache prevents a second API round trip during one render.
export const getDashboardAccess = cache(async () => api<DashboardAccess>('/api/permissions/me'));

export function can(access: DashboardAccess | null | undefined, permission: string) {
  return Boolean(access?.owner_bypass || access?.permissions?.includes(permission));
}

export function canAny(access: DashboardAccess | null | undefined, permissions: string[]) {
  return permissions.some(permission => can(access, permission));
}
