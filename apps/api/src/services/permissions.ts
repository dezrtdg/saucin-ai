import { db } from '../db.js';
import { env } from '../env.js';

export type PermissionDefinition = {
  key: string;
  label: string;
  description: string;
};
export type PermissionGroup = { key: string; label: string; permissions: PermissionDefinition[] };

export const permissionCatalog: PermissionGroup[] = [
  { key: 'dashboard', label: 'Dashboard', permissions: [
    { key: 'dashboard.access', label: 'Dashboard access', description: 'Sign in and access the staff dashboard.' },
    { key: 'dashboard.view', label: 'View overview', description: 'View dashboard statistics, activity, and attention queues.' }
  ]},
  { key: 'issues', label: 'Issues', permissions: [
    { key: 'issues.view', label: 'View issues', description: 'View incoming reports, known issues, evidence, and status.' },
    { key: 'issues.create', label: 'Create known issues', description: 'Create and promote known issues.' },
    { key: 'issues.ai', label: 'Create with AI', description: 'Use AI to structure a known issue from reports, notes, or logs.' },
    { key: 'issues.edit', label: 'Edit issues', description: 'Edit known issue details, severity, responses, and notes.' },
    { key: 'issues.status', label: 'Change issue status', description: 'Move issues through investigating, testing, monitoring, resolved, and other statuses.' },
    { key: 'issues.triage', label: 'Triage incoming reports', description: 'Link, promote, or dismiss incoming possible issues.' },
    { key: 'issues.verify', label: 'Verify community evidence', description: 'Verify or reject community observations and workarounds.' },
    { key: 'issues.ticket', label: 'Manage Discord tickets', description: 'Create and synchronize Discord issue tickets.' },
    { key: 'issues.delete', label: 'Delete issues', description: 'Permanently delete known issues.' }
  ]},
  { key: 'knowledge', label: 'Knowledge', permissions: [
    { key: 'knowledge.view', label: 'View knowledge', description: 'View Server Rules, Discord Rules, guides, and knowledge articles.' },
    { key: 'knowledge.create', label: 'Create articles', description: 'Create new knowledge articles manually.' },
    { key: 'knowledge.ai', label: 'Use knowledge AI', description: 'Create or improve knowledge articles with AI.' },
    { key: 'knowledge.edit', label: 'Edit articles', description: 'Edit verified content and retrieval helpers.' },
    { key: 'knowledge.publish', label: 'Publish articles', description: 'Publish draft knowledge so the bot can use it.' },
    { key: 'knowledge.archive', label: 'Archive articles', description: 'Archive or restore knowledge articles.' },
    { key: 'knowledge.delete', label: 'Delete articles', description: 'Permanently delete knowledge articles.' },
    { key: 'knowledge.gaps.view', label: 'View knowledge gaps', description: 'View questions the bot could not fully answer.' },
    { key: 'knowledge.gaps.manage', label: 'Manage knowledge gaps', description: 'Re-analyze, resolve, and convert gaps into knowledge.' }
  ]},
  { key: 'channels', label: 'Channels', permissions: [
    { key: 'channels.view', label: 'View channel policies', description: 'View Discord channel modes and bot behavior.' },
    { key: 'channels.manage', label: 'Manage channel policies', description: 'Change channel modes and refresh Discord channels.' }
  ]},
  { key: 'settings', label: 'Settings', permissions: [
    { key: 'settings.view', label: 'View settings', description: 'Open the Settings area.' },
    { key: 'settings.bot.manage', label: 'Manage Bot & AI', description: 'Change direct mention and bot behavior settings.' },
    { key: 'settings.knowledge.manage', label: 'Manage knowledge settings', description: 'Manage content types, categories, audiences, and role mappings.' },
    { key: 'settings.issues.manage', label: 'Manage issue settings', description: 'Manage issue categories, ticket automation, and public response templates.' },
    { key: 'settings.permissions.manage', label: 'Manage permissions', description: 'Change which Discord roles can access dashboard modules and actions.' }
  ]},
  { key: 'future', label: 'Future modules', permissions: [
    { key: 'suggestions.view', label: 'View suggestions', description: 'View collected community suggestions when the module is enabled.' },
    { key: 'suggestions.manage', label: 'Manage suggestions', description: 'Triage and manage suggestions when the module is enabled.' },
    { key: 'moderation.view', label: 'View moderation', description: 'View moderation detections, cases, and history.' },
    { key: 'moderation.review', label: 'Review moderation cases', description: 'Approve, dismiss, and annotate moderation cases.' },
    { key: 'moderation.actions', label: 'Take moderation actions', description: 'Warn, remove messages, or timeout members when moderation enforcement is enabled.' },
    { key: 'moderation.configure', label: 'Configure moderation', description: 'Change moderation rules, thresholds, exemptions, and enforcement ladders.' },
    { key: 'announcements.view', label: 'View announcements', description: 'View announcement drafts and history.' },
    { key: 'announcements.manage', label: 'Manage announcements', description: 'Create, schedule, edit, and send announcements.' },
    { key: 'txadmin.view', label: 'View txAdmin intelligence', description: 'View server/log intelligence when txAdmin integration is enabled.' },
    { key: 'txadmin.manage', label: 'Manage txAdmin integration', description: 'Change txAdmin integration and server intelligence settings.' }
  ]}
];

export const allPermissionKeys = permissionCatalog.flatMap(group => group.permissions.map(permission => permission.key));
const validPermissionKeys = new Set(allPermissionKeys);

const implications: Record<string, string[]> = {
  'dashboard.view': ['dashboard.access'],
  'issues.create': ['issues.view'], 'issues.ai': ['issues.view'], 'issues.edit': ['issues.view'], 'issues.status': ['issues.view'],
  'issues.triage': ['issues.view'], 'issues.verify': ['issues.view'], 'issues.ticket': ['issues.view'], 'issues.delete': ['issues.view'],
  'knowledge.create': ['knowledge.view'], 'knowledge.ai': ['knowledge.view'], 'knowledge.edit': ['knowledge.view'],
  'knowledge.publish': ['knowledge.view'], 'knowledge.archive': ['knowledge.view'], 'knowledge.delete': ['knowledge.view'],
  'knowledge.gaps.manage': ['knowledge.gaps.view'],
  'channels.manage': ['channels.view'],
  'settings.bot.manage': ['settings.view'], 'settings.knowledge.manage': ['settings.view','knowledge.view'], 'settings.issues.manage': ['settings.view','issues.view'],
  'settings.permissions.manage': ['settings.view'],
  'suggestions.manage': ['suggestions.view'],
  'moderation.review': ['moderation.view'], 'moderation.actions': ['moderation.view'], 'moderation.configure': ['moderation.view','settings.view'],
  'announcements.manage': ['announcements.view'], 'txadmin.manage': ['txadmin.view','settings.view']
};

function splitIds(value?: string) {
  return new Set((value || '').split(',').map(item => item.trim()).filter(Boolean));
}

export function legacyAllowedRoleIds() { return splitIds(env.DASHBOARD_ALLOWED_ROLE_IDS); }
export function directOwnerUserIds() { return splitIds(env.DASHBOARD_ALLOWED_USER_IDS); }

function expandPermissions(input: Iterable<string>) {
  const result = new Set<string>();
  for (const key of input) if (validPermissionKeys.has(key)) result.add(key);
  let changed = true;
  while (changed) {
    changed = false;
    for (const key of [...result]) {
      for (const implied of implications[key] || []) {
        if (!result.has(implied)) { result.add(implied); changed = true; }
      }
    }
  }
  return result;
}

export async function permissionSystemConfigured() {
  const result = await db.query(`
    SELECT c.configured, EXISTS(SELECT 1 FROM dashboard_permission_audit) AS has_changes
    FROM dashboard_permission_config c
    WHERE c.id=1
  `);
  return Boolean(result.rows[0]?.configured && result.rows[0]?.has_changes);
}

export async function effectivePermissions(userId: string | null | undefined, roleIds: string[]) {
  if (!env.DASHBOARD_AUTH_REQUIRED && !userId) return { permissions: new Set(allPermissionKeys), ownerBypass: true, configured: await permissionSystemConfigured(), source: 'auth-disabled' as const };

  const configured = await permissionSystemConfigured();
  if (userId && directOwnerUserIds().has(userId)) {
    return { permissions: new Set(allPermissionKeys), ownerBypass: true, configured, source: 'direct-owner' as const };
  }

  if (!configured) {
    const legacy = legacyAllowedRoleIds();
    if (roleIds.some(roleId => legacy.has(roleId))) {
      return { permissions: new Set(allPermissionKeys), ownerBypass: false, configured, source: 'legacy-role' as const };
    }
    return { permissions: new Set<string>(), ownerBypass: false, configured, source: 'none' as const };
  }

  if (!roleIds.length) return { permissions: new Set<string>(), ownerBypass: false, configured, source: 'managed-role' as const };
  const result = await db.query('SELECT permission_key FROM dashboard_role_permissions WHERE role_id = ANY($1::text[])', [roleIds]);
  return { permissions: expandPermissions(result.rows.map(row => String(row.permission_key))), ownerBypass: false, configured, source: 'managed-role' as const };
}

export async function permissionSnapshot(userId: string | null | undefined, roleIds: string[]) {
  const effective = await effectivePermissions(userId, roleIds);
  return {
    authorized: effective.permissions.has('dashboard.access'),
    permissions: [...effective.permissions].sort(),
    owner_bypass: effective.ownerBypass,
    configured: effective.configured,
    source: effective.source
  };
}

async function initializeManagedPermissions(client: any) {
  const current = await client.query('SELECT configured FROM dashboard_permission_config WHERE id=1 FOR UPDATE');
  const audit = await client.query('SELECT EXISTS(SELECT 1 FROM dashboard_permission_audit) AS has_changes');
  if (current.rows[0]?.configured && audit.rows[0]?.has_changes) return;
  const legacyRoles = [...legacyAllowedRoleIds()];
  for (const roleId of legacyRoles) {
    for (const permissionKey of allPermissionKeys) {
      await client.query(
        'INSERT INTO dashboard_role_permissions (role_id,permission_key) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [roleId, permissionKey]
      );
    }
  }
  await client.query('UPDATE dashboard_permission_config SET configured=TRUE,updated_at=NOW() WHERE id=1');
}

export async function saveRolePermissions(roleId: string, permissionKeys: string[], actor: { userId?: string | null; roleIds?: string[]; ownerBypass?: boolean }) {
  const requested = [...new Set(permissionKeys)].filter(key => validPermissionKeys.has(key));
  const unique = [...expandPermissions(requested)].sort();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await initializeManagedPermissions(client);

    if (!actor.ownerBypass && actor.userId && (actor.roleIds || []).includes(roleId)) {
      const otherRoles = (actor.roleIds || []).filter(id => id !== roleId);
      const other = otherRoles.length
        ? await client.query('SELECT permission_key FROM dashboard_role_permissions WHERE role_id = ANY($1::text[])', [otherRoles])
        : { rows: [] as Array<{permission_key:string}> };
      const after = expandPermissions([...other.rows.map(row => String(row.permission_key)), ...unique]);
      if (!after.has('dashboard.access') || !after.has('settings.permissions.manage')) {
        throw new Error('This change would remove your own dashboard or permission-management access. Give another one of your roles permission management first, or use the direct owner account.');
      }
    }

    await client.query('DELETE FROM dashboard_role_permissions WHERE role_id=$1', [roleId]);
    for (const permissionKey of unique) {
      await client.query('INSERT INTO dashboard_role_permissions (role_id,permission_key) VALUES ($1,$2)', [roleId, permissionKey]);
    }
    await client.query(
      'INSERT INTO dashboard_permission_audit (role_id,permissions,changed_by_user_id) VALUES ($1,$2::jsonb,$3)',
      [roleId, JSON.stringify(unique), actor.userId || null]
    );
    await client.query('COMMIT');
    return unique;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export function parseDashboardIdentity(headers: Record<string, unknown>) {
  const userId = typeof headers['x-dashboard-user-id'] === 'string' ? headers['x-dashboard-user-id'].trim() : '';
  const rolesRaw = typeof headers['x-dashboard-role-ids'] === 'string' ? headers['x-dashboard-role-ids'] : '';
  const roleIds = [...new Set(rolesRaw.split(',').map(value => value.trim()).filter(Boolean))];
  return { userId: userId || null, roleIds };
}

export async function rolePermissionMapForDisplay() {
  const configured = await permissionSystemConfigured();
  const rows = await db.query('SELECT role_id,permission_key FROM dashboard_role_permissions ORDER BY role_id,permission_key');
  const map = new Map<string,string[]>();
  for (const row of rows.rows) {
    const id = String(row.role_id);
    if (!map.has(id)) map.set(id, []);
    map.get(id)!.push(String(row.permission_key));
  }
  if (!configured) {
    for (const roleId of legacyAllowedRoleIds()) map.set(roleId, [...allPermissionKeys]);
  }
  return { configured, map };
}
