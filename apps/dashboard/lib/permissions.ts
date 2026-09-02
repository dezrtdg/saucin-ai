import { api } from './api';

export type DashboardAccess = {
  authorized: boolean;
  permissions: string[];
  owner_bypass: boolean;
  configured: boolean;
  source?: string;
};

export async function getDashboardAccess() {
  return api<DashboardAccess>('/api/permissions/me');
}

export function can(access: DashboardAccess | null | undefined, permission: string) {
  return Boolean(access?.owner_bypass || access?.permissions?.includes(permission));
}

export function canAny(access: DashboardAccess | null | undefined, permissions: string[]) {
  return permissions.some(permission => can(access, permission));
}
