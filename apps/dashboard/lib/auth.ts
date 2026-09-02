import { cookies } from 'next/headers';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const SESSION_COOKIE = 'saucin_dashboard_session';
const STATE_COOKIE = 'saucin_oauth_state';
const SESSION_TTL_SECONDS = 60 * 60 * 8;

type DiscordUser = {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
};

type DiscordMember = {
  roles?: string[];
  nick?: string | null;
};

export type DashboardSession = {
  userId: string;
  username: string;
  displayName: string;
  avatar: string | null;
  roles: string[];
  exp: number;
};

function authRequired() {
  return (process.env.DASHBOARD_AUTH_REQUIRED || 'true').toLowerCase() === 'true';
}

function sessionSecret() {
  const value = process.env.SESSION_SECRET || '';
  if (authRequired() && value.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters when dashboard auth is enabled.');
  }
  return value;
}

function b64url(value: string | Buffer) {
  return Buffer.from(value).toString('base64url');
}

function sign(payload: string) {
  return createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
}

function encodeSession(session: DashboardSession) {
  const payload = b64url(JSON.stringify(session));
  return `${payload}.${sign(payload)}`;
}

function decodeSession(raw?: string): DashboardSession | null {
  if (!raw) return null;
  const [payload, signature] = raw.split('.');
  if (!payload || !signature) return null;
  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as DashboardSession;
    if (!session.exp || session.exp <= Math.floor(Date.now() / 1000)) return null;
    return session;
  } catch {
    return null;
  }
}

export function isDashboardAuthRequired() {
  return authRequired();
}

export async function getDashboardSession() {
  if (!authRequired()) return null;
  const store = await cookies();
  return decodeSession(store.get(SESSION_COOKIE)?.value);
}

export async function assertDashboardAccess() {
  if (!authRequired()) return null;
  const session = await getDashboardSession();
  if (!session) throw new Error('Dashboard authentication required');
  return session;
}

export async function createOauthState() {
  const value = randomBytes(32).toString('base64url');
  const store = await cookies();
  store.set(STATE_COOKIE, value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: (process.env.DASHBOARD_PUBLIC_URL || '').startsWith('https://'),
    path: '/',
    maxAge: 600
  });
  return value;
}

export async function consumeOauthState(received: string) {
  const store = await cookies();
  const expected = store.get(STATE_COOKIE)?.value || '';
  store.delete(STATE_COOKIE);
  if (!expected || !received) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function discordOauthRedirectUri() {
  const base = (process.env.DASHBOARD_PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, '');
  return `${base}/api/auth/callback`;
}

export function discordAuthorizeUrl(state: string) {
  const clientId = process.env.DISCORD_CLIENT_ID || '';
  if (!clientId) throw new Error('DISCORD_CLIENT_ID is not configured.');
  const query = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: discordOauthRedirectUri(),
    scope: 'identify guilds.members.read',
    state
  });
  return `https://discord.com/oauth2/authorize?${query}`;
}

export async function exchangeDiscordCode(code: string) {
  const body = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID || '',
    client_secret: process.env.DISCORD_CLIENT_SECRET || '',
    grant_type: 'authorization_code',
    code,
    redirect_uri: discordOauthRedirectUri()
  });
  const response = await fetch('https://discord.com/api/v10/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'SaucinAI/0.3 (Discord OAuth)' },
    body,
    cache: 'no-store'
  });
  if (!response.ok) throw new Error(`Discord token exchange failed (${response.status})`);
  return response.json() as Promise<{ access_token: string; token_type: string; expires_in: number }>;
}

async function discordGet<T>(accessToken: string, path: string) {
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    headers: { authorization: `Bearer ${accessToken}`, 'user-agent': 'SaucinAI/0.3 (Discord OAuth)' },
    cache: 'no-store'
  });
  if (!response.ok) throw new Error(`Discord API request failed (${response.status}) for ${path}`);
  return response.json() as Promise<T>;
}

function splitIds(value?: string) {
  return new Set((value || '').split(',').map(v => v.trim()).filter(Boolean));
}

async function permissionAuthorization(userId: string, roles: string[]) {
  const base = (process.env.API_INTERNAL_URL || 'http://api:3100').replace(/\/$/, '');
  const response = await fetch(`${base}/api/permissions/check`, {
    method: 'POST',
    headers: {
      'x-api-key': process.env.DASHBOARD_API_KEY || '',
      'content-type': 'application/json'
    },
    body: JSON.stringify({ user_id: userId, role_ids: roles }),
    cache: 'no-store'
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Dashboard permission check failed (${response.status})`);
  return response.json() as Promise<{ authorized:boolean; permissions:string[]; owner_bypass:boolean; configured:boolean }>;
}

export async function createDashboardSessionFromDiscord(accessToken: string) {
  const guildId = process.env.DISCORD_GUILD_ID || '';
  if (!guildId) throw new Error('DISCORD_GUILD_ID is not configured.');

  const [user, member] = await Promise.all([
    discordGet<DiscordUser>(accessToken, '/users/@me'),
    discordGet<DiscordMember>(accessToken, `/users/@me/guilds/${guildId}/member`)
  ]);

  const allowedUsers = splitIds(process.env.DASHBOARD_ALLOWED_USER_IDS);
  const allowedRoles = splitIds(process.env.DASHBOARD_ALLOWED_ROLE_IDS);
  const roles = member.roles || [];
  const permissionCheck = await permissionAuthorization(user.id, roles);
  if (permissionCheck) {
    // A direct user allowlist is the emergency owner path. Keep it authoritative
    // at the dashboard edge even during a permission-system migration/recovery.
    if (!permissionCheck.authorized && !allowedUsers.has(user.id)) throw new Error('Your Discord account is not authorized for this dashboard.');
  } else {
    // Rolling-upgrade fallback for an older API that does not yet expose the permission service.
    const userAllowed = allowedUsers.has(user.id);
    const roleAllowed = roles.some(role => allowedRoles.has(role));
    if (!allowedUsers.size && !allowedRoles.size) throw new Error('No dashboard users or roles have been allowlisted yet.');
    if (!userAllowed && !roleAllowed) throw new Error('Your Discord account is not authorized for this dashboard.');
  }

  const session: DashboardSession = {
    userId: user.id,
    username: user.username,
    displayName: member.nick || user.global_name || user.username,
    avatar: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128` : null,
    roles,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
  };
  const store = await cookies();
  store.set(SESSION_COOKIE, encodeSession(session), {
    httpOnly: true,
    sameSite: 'lax',
    secure: (process.env.DASHBOARD_PUBLIC_URL || '').startsWith('https://'),
    path: '/',
    maxAge: SESSION_TTL_SECONDS
  });
  return session;
}

export async function clearDashboardSession() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
