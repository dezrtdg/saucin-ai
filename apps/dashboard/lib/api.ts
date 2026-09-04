import { assertDashboardAccess } from './auth';

const base = process.env.API_INTERNAL_URL || 'http://api:3100';
const key = process.env.DASHBOARD_API_KEY || '';

function splitIds(value?: string) {
  return new Set((value || '').split(',').map(item => item.trim()).filter(Boolean));
}


export class DashboardApiError extends Error {
  status: number;
  constructor(status:number, message:string){ super(message); this.name='DashboardApiError'; this.status=status; }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const session = await assertDashboardAccess();
  const ownerAllowlisted = Boolean(session && splitIds(process.env.DASHBOARD_ALLOWED_USER_IDS).has(session.userId));
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      'x-api-key': key,
      ...(session ? { 'x-dashboard-user-id': session.userId, 'x-dashboard-role-ids': session.roles.join(','), 'x-dashboard-display-name': session.displayName } : {}),
      ...(ownerAllowlisted ? { 'x-dashboard-owner-allowlisted': '1' } : {}),
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...(init?.headers || {})
    },
    cache: 'no-store'
  });
  if (!response.ok) {
    let detail = '';
    try { const body = await response.json() as {error?:string}; detail = body.error || ''; } catch {}
    throw new DashboardApiError(response.status, detail || `API ${response.status}`);
  }
  return response.json() as Promise<T>;
}
