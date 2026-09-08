import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ChannelType } from 'discord.js';
import { db } from '../db.js';
import { env } from '../env.js';
import { applyIssueDiscordLifecycle, applyTicketPunishment, discord, ensureIssueDiscordThread, getCachedDiscordChannelMetadata, postIssueStatusUpdate, publishTicketPanel, recoverDiscordConversationContext, reopenDiscordTicket, reverseTicketPunishment, syncDiscordChannels, syncIssueDiscordPost } from '../discord/client.js';
import { invalidateBotBehaviorSettingsCache } from '../services/botSettings.js';
import { backfillKnowledgeEmbeddings, buildKnowledgeDraft, deriveKnowledgeGapQuestion, improveKnowledgeRetrieval, refreshKnowledgeEmbedding } from '../services/knowledge.js';
import { buildIssueDraft, linkCandidateToIssue, refreshIssueEmbedding, setIssueObservationStatus } from '../services/issues.js';
import { allPermissionKeys, parseDashboardIdentity, permissionCatalog, permissionSnapshot, permissionSystemConfigured, rolePermissionMapForDisplay, saveRolePermissions } from '../services/permissions.js';
import { clearModerationDiagnostics, getModerationCase, getModerationRuleSettings, getModerationSettings, getModerationUserHistory, listModerationCases, listModerationDiagnostics, reviewModerationCase, updateModerationRuleSettings, updateModerationSettings } from '../services/moderation.js';
import { claimTicket, getPunishment, getTicket, getTicketSettings, listPunishments, listTickets, listTicketTypes, releaseTicket, setTicketStatus, updateTicketSettings, updateTicketType } from '../services/tickets.js';
import { getDashboardNotifications, markDashboardNotificationsRead } from '../services/dashboardNotifications.js';
import { acknowledgeTxAdminEvent, correlateIssueWithTxAdmin, getTxAdminOverview, getTxAdminSettings, listTxAdminEvents, resolveTxAdminEvent, updateTxAdminSettings } from '../services/txadmin.js';

async function requireApiKey(request: FastifyRequest, reply: FastifyReply) {
  if (request.headers['x-api-key'] !== env.DASHBOARD_API_KEY) {
    return reply.code(401).send({ error: 'unauthorized' });
  }
}


function routeRequirement(method: string, route: string): string[] | null {
  const key = `${method.toUpperCase()} ${route}`;
  const exact: Record<string,string[]> = {
    'GET /api/overview': ['dashboard.view'],
    'GET /api/activity': ['dashboard.view'],
    'GET /api/notifications': ['dashboard.access'],
    'POST /api/notifications/read': ['dashboard.access'],
    'GET /api/txadmin/overview': ['txadmin.view'],
    'GET /api/txadmin/events': ['txadmin.view'],
    'GET /api/txadmin/settings': ['txadmin.manage'],
    'PUT /api/txadmin/settings': ['txadmin.manage'],
    'POST /api/txadmin/events/:id/acknowledge': ['txadmin.manage'],
    'POST /api/txadmin/events/:id/resolve': ['txadmin.manage'],
    'GET /api/channels': ['channels.view'],
    'POST /api/channels/sync': ['channels.manage'],
    'PUT /api/channels': ['channels.manage'],
    'PUT /api/channels/:id': ['channels.manage'],
    'GET /api/bot/settings': ['settings.bot.manage'],
    'PUT /api/bot/settings': ['settings.bot.manage'],
    'GET /api/knowledge/settings': ['knowledge.view'],
    'POST /api/knowledge/content-types': ['settings.knowledge.manage'],
    'PUT /api/knowledge/content-types/:key': ['settings.knowledge.manage'],
    'DELETE /api/knowledge/content-types/:key': ['settings.knowledge.manage'],
    'POST /api/knowledge/categories': ['settings.knowledge.manage'],
    'PUT /api/knowledge/categories/:key': ['settings.knowledge.manage'],
    'DELETE /api/knowledge/categories/:key': ['settings.knowledge.manage'],
    'POST /api/knowledge/audiences': ['settings.knowledge.manage'],
    'PUT /api/knowledge/audiences/:key': ['settings.knowledge.manage'],
    'PUT /api/knowledge/audiences/:key/roles': ['settings.knowledge.manage'],
    'DELETE /api/knowledge/audiences/:key': ['settings.knowledge.manage'],
    'GET /api/issues/settings': ['issues.view'],
    'PUT /api/issues/automation': ['settings.issues.manage'],
    'PUT /api/issues/templates/:status': ['settings.issues.manage'],
    'POST /api/issues/categories': ['settings.issues.manage'],
    'PUT /api/issues/categories/:key': ['settings.issues.manage'],
    'DELETE /api/issues/categories/:key': ['settings.issues.manage'],
    'GET /api/knowledge': ['knowledge.view'],
    'GET /api/knowledge/gaps': ['knowledge.gaps.view'],
    'PUT /api/knowledge/gaps/:id': ['knowledge.gaps.manage'],
    'POST /api/knowledge/gaps/:id/reanalyze': ['knowledge.gaps.manage'],
    'POST /api/knowledge/gaps/:id/convert': ['knowledge.gaps.manage','knowledge.create'],
    'POST /api/knowledge/reindex': ['settings.knowledge.manage'],
    'POST /api/knowledge/ai-build': ['knowledge.ai','knowledge.create'],
    'POST /api/knowledge/:id/ai-improve': ['knowledge.ai','knowledge.edit'],
    'GET /api/knowledge/:id': ['knowledge.view'],
    'POST /api/knowledge': ['knowledge.create'],
    'PUT /api/knowledge/:id': ['knowledge.edit'],
    'DELETE /api/knowledge/:id': ['knowledge.delete'],
    'POST /api/issues/ai-build': ['issues.ai','issues.create'],
    'GET /api/issues': ['issues.view'],
    'GET /api/issues/candidates': ['issues.view'],
    'GET /api/issues/:id/reports': ['issues.view'],
    'POST /api/issues': ['issues.create'],
    'PUT /api/issues/:id': ['issues.edit'],
    'POST /api/issues/:id/discord-ticket': ['issues.ticket'],
    'PUT /api/issues/:id/observations/:observationId': ['issues.verify'],
    'DELETE /api/issues/:id': ['issues.delete'],
    'PUT /api/issues/candidates/:id': ['issues.triage'],
    'POST /api/issues/candidates/:id/link': ['issues.triage'],
    'POST /api/issues/candidates/:id/promote': ['issues.triage','issues.create'],
    'GET /api/tickets': ['tickets.view'],
    'GET /api/tickets/:id': ['tickets.view'],
    'PUT /api/tickets/:id/status': ['tickets.manage'],
    'POST /api/tickets/:id/reopen': ['tickets.manage'],
    'GET /api/tickets/settings': ['settings.tickets.manage'],
    'PUT /api/tickets/settings': ['settings.tickets.manage'],
    'PUT /api/tickets/types/:key': ['settings.tickets.manage'],
    'POST /api/tickets/panel': ['settings.tickets.manage'],
    'GET /api/punishments': ['moderation.view'],
    'GET /api/punishments/:id': ['moderation.view'],
    'POST /api/tickets/:id/punishments': ['moderation.punish'],
    'POST /api/punishments/:id/reverse': ['moderation.reverse'],
    'GET /api/permissions/roles': ['settings.permissions.manage'],
    'PUT /api/permissions/roles/:roleId': ['settings.permissions.manage'],
    'GET /api/moderation/cases': ['moderation.view'],
    'GET /api/moderation/cases/:id': ['moderation.view'],
    'PUT /api/moderation/cases/:id/review': ['moderation.review'],
    'GET /api/moderation/users/:userId': ['moderation.view'],
    'GET /api/moderation/settings': ['moderation.configure'],
    'PUT /api/moderation/settings': ['moderation.configure'],
    'GET /api/moderation/rules': ['moderation.configure'],
    'PUT /api/moderation/rules/:articleId': ['moderation.configure'],
    'GET /api/moderation/diagnostics': ['moderation.configure'],
    'DELETE /api/moderation/diagnostics': ['moderation.configure']
  };
  return exact[key] ?? null;
}

async function requestPermissionSnapshot(request: FastifyRequest) {
  // The dashboard server may mark a session as a direct allowlisted owner.
  // This header is only honored inside this API-key protected admin plugin.
  if (request.headers['x-dashboard-owner-allowlisted'] === '1') {
    return {
      authorized: true,
      permissions: [...allPermissionKeys].sort(),
      owner_bypass: true,
      configured: await permissionSystemConfigured(),
      source: 'dashboard-owner' as const
    };
  }
  const identity = parseDashboardIdentity(request.headers as Record<string,unknown>);
  return permissionSnapshot(identity.userId, identity.roleIds);
}

async function requireRoutePermission(request: FastifyRequest, reply: FastifyReply) {
  const route = request.routeOptions.url;
  if (!route) {
    request.log.error({ method: request.method, url: request.url }, 'Unable to resolve dashboard route for permission check');
    return reply.code(403).send({ error: 'permission route unavailable' });
  }
  if (route === '/api/permissions/check' || route === '/api/permissions/me') return;
  const required = routeRequirement(request.method, route);
  if (!required) {
    request.log.error({ method: request.method, route }, 'No dashboard permission mapping exists for admin route');
    return reply.code(403).send({ error: 'permission mapping missing' });
  }
  const snapshot = await requestPermissionSnapshot(request);
  if (!snapshot.authorized) return reply.code(403).send({ error: 'dashboard access denied', required: ['dashboard.access'] });
  const granted = new Set(snapshot.permissions);
  const missing = required.filter(permission => !granted.has(permission));
  if (missing.length) return reply.code(403).send({ error: 'permission denied', required: missing });
}

async function requireAdditionalPermission(request: FastifyRequest, reply: FastifyReply, permission: string) {
  const snapshot = await requestPermissionSnapshot(request);
  if (!snapshot.authorized || !snapshot.permissions.includes(permission)) {
    reply.code(403).send({ error: 'permission denied', required: [permission] });
    return false;
  }
  return true;
}

const slug = z.string().trim().min(1).max(64).regex(/^[a-z0-9][a-z0-9_-]*$/);
const articleStatus = z.enum(['draft','published','archived']);

const knowledgeBody = z.object({
  title: z.string().trim().min(2).max(200),
  body: z.string().trim().min(5),
  content_type: slug.default('other'),
  category: slug.default('general'),
  audiences: z.array(slug).min(1).max(20).default(['public']),
  status: articleStatus.default('published'),
  source_url: z.string().url().nullable().optional(),
  aliases: z.array(z.string().trim().min(1).max(160)).max(100).default([]),
  related_topics: z.array(z.string().trim().min(1).max(160)).max(100).default([]),
  example_questions: z.array(z.string().trim().min(1).max(400)).max(150).default([]),
  created_by: z.string().trim().max(120).optional()
});

const categoryBody = z.object({
  key: slug,
  label: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).default(''),
  sort_order: z.coerce.number().int().min(-10000).max(10000).default(100),
  enabled: z.boolean().default(true)
});


const contentTypeBody = z.object({
  key: slug,
  label: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).default(''),
  moderation_eligible: z.boolean().default(false),
  sort_order: z.coerce.number().int().min(-10000).max(10000).default(100),
  enabled: z.boolean().default(true)
});

const audienceBody = z.object({
  key: slug,
  label: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).default(''),
  public_access: z.boolean().default(false),
  sort_order: z.coerce.number().int().min(-10000).max(10000).default(100),
  enabled: z.boolean().default(true)
});


const issueStatus = z.enum(['new','acknowledged','investigating','fix_in_progress','testing','monitoring','resolved','wont_fix']);
const issueSeverity = z.enum(['low','medium','high','critical']);
const issueCategoryBody = z.object({
  key: slug,
  label: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).default(''),
  sort_order: z.coerce.number().int().min(-10000).max(10000).default(100),
  enabled: z.boolean().default(true)
});
const issueAutomationBody = z.object({
  intake_channel_id: z.string().trim().max(32).nullable().optional(),
  auto_create_threads: z.boolean(),
  allow_player_details: z.boolean(),
  auto_summarize_thread: z.boolean(),
  auto_update_symptoms: z.boolean(),
  auto_collect_workarounds: z.boolean(),
  auto_collect_reproduction: z.boolean(),
  auto_collect_locations: z.boolean(),
  edit_original_status_message: z.boolean(),
  post_status_updates_to_thread: z.boolean(),
  auto_public_response: z.boolean(),
  include_bug_id: z.boolean(),
  include_workaround: z.boolean(),
  include_affected_count: z.boolean()
});
const issueTemplateBody = z.object({ template: z.string().trim().min(1).max(4000), enabled: z.boolean() });
const txAdminSettingsBody=z.object({
  group_window_minutes:z.coerce.number().int().min(5).max(1440),
  auto_draft_enabled:z.boolean(),draft_min_occurrences:z.coerce.number().int().min(2).max(1000),
  alert_channel_id:z.string().trim().max(32).nullable().optional(),
  alert_role_ids:z.array(z.string().trim().min(1).max(32)).max(100),
  notify_critical:z.boolean(),notify_recurring_errors:z.boolean(),hide_alert_mentions:z.boolean(),
  noise_patterns:z.array(z.string().trim().min(3).max(300)).max(100),
  auto_link_issue_reports:z.boolean(),
  correlation_min_confidence:z.coerce.number().min(.4).max(.95)
});
const issueBody = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(12000).default(''),
  category: z.string().trim().min(1).max(100).default('general'),
  resource_name: z.string().trim().max(160).optional(),
  severity: issueSeverity.default('medium'),
  status: issueStatus.default('new'),
  public_response: z.string().trim().max(4000).optional(),
  workaround: z.string().trim().max(4000).optional(),
  staff_notes: z.string().trim().max(12000).optional(),
  aliases: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
  symptoms: z.array(z.string().trim().min(1).max(400)).max(150).default([]),
  log_patterns: z.array(z.string().trim().min(1).max(500)).max(150).default([])
});


const botSettingsBody = z.object({
  direct_mentions_enabled: z.boolean(),
  direct_mentions_bypass_channel_mode: z.boolean(),
  direct_mentions_use_reply_context: z.boolean(),
  direct_mentions_use_recent_context: z.boolean(),
  direct_mentions_context_messages: z.coerce.number().int().min(0).max(25)
});

async function assertContentTypeExists(key: string, reply: FastifyReply) {
  const result = await db.query('SELECT 1 FROM knowledge_content_types WHERE key=$1', [key]);
  if (!result.rowCount) {
    reply.code(400).send({ error: `unknown knowledge content type: ${key}` });
    return false;
  }
  return true;
}

async function assertCategoryExists(key: string, reply: FastifyReply) {
  const result = await db.query('SELECT 1 FROM knowledge_categories WHERE key=$1', [key]);
  if (!result.rowCount) {
    reply.code(400).send({ error: `unknown knowledge category: ${key}` });
    return false;
  }
  return true;
}

async function assertIssueCategoryExists(key: string, reply: FastifyReply) {
  const result = await db.query('SELECT 1 FROM issue_categories WHERE key=$1', [key]);
  if (!result.rowCount) {
    reply.code(400).send({ error: `unknown issue category: ${key}` });
    return false;
  }
  return true;
}

async function assertAudiencesExist(keys: string[], reply: FastifyReply) {
  const unique = [...new Set(keys)];
  const result = await db.query('SELECT key FROM knowledge_audiences WHERE key = ANY($1::text[])', [unique]);
  if (result.rowCount !== unique.length) {
    const found = new Set(result.rows.map(row => String(row.key)));
    const missing = unique.filter(key => !found.has(key));
    reply.code(400).send({ error: `unknown knowledge audience(s): ${missing.join(', ')}` });
    return false;
  }
  return true;
}

async function discordRoles() {
  if (!env.DISCORD_GUILD_ID || !discord.isReady()) return [];
  const guild = discord.guilds.cache.get(env.DISCORD_GUILD_ID);
  if (!guild) return [];
  const roles = await guild.roles.fetch();
  return [...roles.values()]
    .filter(role => role.id !== guild.id && !role.managed)
    .sort((a, b) => b.position - a.position)
    .map(role => ({ id: role.id, name: role.name, position: role.position, color: role.hexColor }));
}

async function discordTicketDestinations() {
  if (!env.DISCORD_GUILD_ID || !discord.isReady()) return { text_channels: [], categories: [] };
  const guild = discord.guilds.cache.get(env.DISCORD_GUILD_ID);
  if (!guild) return { text_channels: [], categories: [] };
  const channels = await guild.channels.fetch();
  const categories=[...channels.values()].filter(channel=>channel?.type===ChannelType.GuildCategory).map(channel=>({
    id:String(channel!.id),name:String((channel as any).name||channel!.id),position:Number((channel as any).position||0)
  })).sort((a,b)=>a.position-b.position||a.name.localeCompare(b.name));
  const categoryNames=new Map(categories.map(item=>[item.id,item.name]));
  const text_channels=[...channels.values()].filter(channel=>channel?.type===ChannelType.GuildText||channel?.type===ChannelType.GuildAnnouncement).map(channel=>({
    id:String(channel!.id),name:String((channel as any).name||channel!.id),category_id:(channel as any).parentId?String((channel as any).parentId):null,
    category_name:(channel as any).parentId?categoryNames.get(String((channel as any).parentId))||null:null,
    position:Number((channel as any).position||0)
  })).sort((a,b)=>(a.category_name||'').localeCompare(b.category_name||'')||a.position-b.position||a.name.localeCompare(b.name));
  return { text_channels, categories };
}

async function discordIssueDestinations(){
  if(env.DISCORD_GUILD_ID&&discord.isReady()){
    const guild=discord.guilds.cache.get(env.DISCORD_GUILD_ID);
    if(guild){
      const fetched=await guild.channels.fetch().catch(()=>null);
      if(fetched){
        const allowed=new Set<number>([ChannelType.GuildText,ChannelType.GuildAnnouncement,ChannelType.GuildForum,ChannelType.GuildMedia]);
        const categories=new Map([...fetched.values()]
          .filter(channel=>channel?.type===ChannelType.GuildCategory)
          .map(channel=>[String(channel!.id),String((channel as any).name||channel!.id)]));
        return [...fetched.values()]
          .filter(channel=>channel&&allowed.has(channel.type))
          .map(channel=>({
            id:String(channel!.id),name:String((channel as any).name||channel!.id),
            type:channel!.type===ChannelType.GuildForum?'Forum':channel!.type===ChannelType.GuildMedia?'Media':channel!.type===ChannelType.GuildAnnouncement?'Announcement':'Text',
            category_name:(channel as any).parentId?categories.get(String((channel as any).parentId))||null:null,
            is_thread:false,position:Number((channel as any).position||0)
          }))
          .sort((a,b)=>(a.category_name||'').localeCompare(b.category_name||'')||a.position-b.position||a.name.localeCompare(b.name));
      }
    }
  }
  const rows=await db.query('SELECT discord_channel_id,channel_name FROM channel_policies ORDER BY lower(coalesce(channel_name,discord_channel_id))');
  return rows.rows.map(row=>{
    const metadata=getCachedDiscordChannelMetadata(String(row.discord_channel_id));
    return {id:String(row.discord_channel_id),name:metadata?.name||row.channel_name||String(row.discord_channel_id),type:metadata?.type||'Text-based',category_name:metadata?.category_name||null,is_thread:metadata?.is_thread||false,position:0};
  }).filter(row=>!row.is_thread&&['Text','Announcement','Forum','Media','Text-based'].includes(row.type));
}

export async function adminRoutes(app: FastifyInstance) {
  app.register(async (admin) => {
    admin.addHook('onRequest', requireApiKey);
    admin.addHook('preHandler', requireRoutePermission);

    admin.post('/api/permissions/check', async (request) => {
      const body = z.object({ user_id: z.string().trim().min(1).max(64), role_ids: z.array(z.string().trim().min(1).max(64)).max(100).default([]) }).parse(request.body);
      return permissionSnapshot(body.user_id, [...new Set(body.role_ids)]);
    });

    admin.get('/api/permissions/me', async (request) => requestPermissionSnapshot(request));

    admin.get('/api/notifications', async (request) => {
      const access=await requestPermissionSnapshot(request);
      const identity=parseDashboardIdentity(request.headers as Record<string,unknown>);
      return getDashboardNotifications({
        userId:identity.userId||'dashboard',permissions:access.permissions,ownerBypass:access.owner_bypass
      });
    });

    admin.post('/api/notifications/read', async (request) => {
      const body=z.object({keys:z.array(z.string().trim().min(1).max(100)).max(100)}).parse(request.body);
      const identity=parseDashboardIdentity(request.headers as Record<string,unknown>);
      return {ok:true,marked:await markDashboardNotificationsRead(identity.userId||'dashboard',body.keys)};
    });

    admin.get('/api/txadmin/overview', async () => getTxAdminOverview());

    admin.get('/api/txadmin/settings', async () => {
      const [settings,destinations,roles]=await Promise.all([getTxAdminSettings(),discordTicketDestinations(),discordRoles()]);
      return {settings,channels:destinations.text_channels,roles};
    });

    admin.put('/api/txadmin/settings', async request => {
      const body=txAdminSettingsBody.parse(request.body);
      return updateTxAdminSettings({
        ...body,alert_channel_id:body.alert_channel_id||null,
        alert_role_ids:[...new Set(body.alert_role_ids)],noise_patterns:[...new Set(body.noise_patterns)]
      });
    });

    admin.get('/api/txadmin/events', async (request) => {
      const query=z.object({
        status:z.enum(['all','open','acknowledged','resolved']).default('open'),
        severity:z.enum(['all','info','warning','error','critical']).default('all'),
        category:z.string().trim().max(80).default('all'),
        resource:z.string().trim().max(160).default(''),
        q:z.string().trim().max(300).default(''),
        noise:z.enum(['hide','only','all']).default('hide'),
        view:z.enum(['attention','updates','failures','history']).default('attention'),
        limit:z.coerce.number().int().min(1).max(300).default(100)
      }).parse(request.query);
      return listTxAdminEvents({...query,query:query.q});
    });

    admin.post('/api/txadmin/events/:id/acknowledge', async (request,reply) => {
      const params=z.object({id:z.coerce.number().int().positive()}).parse(request.params);
      const identity=parseDashboardIdentity(request.headers as Record<string,unknown>);
      const event=await acknowledgeTxAdminEvent(params.id,identity.userId||'dashboard');
      if(!event)return reply.code(404).send({error:'txAdmin event not found'});
      return event;
    });

    admin.post('/api/txadmin/events/:id/resolve', async (request,reply) => {
      const params=z.object({id:z.coerce.number().int().positive()}).parse(request.params);
      const identity=parseDashboardIdentity(request.headers as Record<string,unknown>);
      const event=await resolveTxAdminEvent(params.id,identity.userId||'dashboard');
      if(!event)return reply.code(404).send({error:'txAdmin event not found'});
      return event;
    });

    admin.get('/api/permissions/roles', async (request) => {
      const [{ configured, map }, roles, current] = await Promise.all([rolePermissionMapForDisplay(), discordRoles(), requestPermissionSnapshot(request)]);
      const roleById = new Map(roles.map(role => [role.id, role]));
      for (const roleId of map.keys()) if (!roleById.has(roleId)) roleById.set(roleId, { id: roleId, name: `Unknown / removed role (${roleId})`, position: -1, color: '#000000' });
      const identity = parseDashboardIdentity(request.headers as Record<string,unknown>);
      return {
        configured,
        bootstrap_mode: !configured,
        catalog: permissionCatalog,
        permissions: allPermissionKeys,
        current,
        current_role_ids: identity.roleIds,
        roles: [...roleById.values()].sort((a,b) => b.position-a.position || a.name.localeCompare(b.name)).map(role => ({ ...role, permissions: map.get(role.id) ?? [] }))
      };
    });

    admin.put('/api/permissions/roles/:roleId', async (request, reply) => {
      const params = z.object({ roleId: z.string().trim().min(1).max(64) }).parse(request.params);
      const body = z.object({ permissions: z.array(z.string().trim().min(1).max(120)).max(200) }).parse(request.body);
      const identity = parseDashboardIdentity(request.headers as Record<string,unknown>);
      const current = await permissionSnapshot(identity.userId, identity.roleIds);
      try {
        const permissions = await saveRolePermissions(params.roleId, body.permissions, { userId: identity.userId, roleIds: identity.roleIds, ownerBypass: current.owner_bypass });
        return { ok: true, role_id: params.roleId, permissions };
      } catch (error) {
        return reply.code(400).send({ error: error instanceof Error ? error.message : 'unable to save role permissions' });
      }
    });

    admin.get('/api/tickets', async (request) => {
      const query=z.object({
        status:z.enum(['creating','open','claimed','awaiting_user','closed','failed']).optional(),
        type:z.string().trim().max(64).optional(),limit:z.coerce.number().int().min(1).max(500).optional()
      }).parse(request.query);
      const [tickets,types]=await Promise.all([listTickets({status:query.status,typeKey:query.type,limit:query.limit}),listTicketTypes(true)]);
      return {tickets,types};
    });

    admin.get('/api/tickets/:id', async (request,reply) => {
      const params=z.object({id:z.coerce.number().int().positive()}).parse(request.params);
      const ticket=await getTicket(params.id);
      if(!ticket) return reply.code(404).send({error:'ticket not found'});
      const access=await requestPermissionSnapshot(request);
      if(!access.owner_bypass&&!access.permissions.includes('tickets.transcripts')){
        ticket.messages=[];
        ticket.transcript_text=null;
      }
      return ticket;
    });

    admin.put('/api/tickets/:id/status', async (request,reply) => {
      const params=z.object({id:z.coerce.number().int().positive()}).parse(request.params);
      const body=z.object({status:z.enum(['open','claimed','awaiting_user']),note:z.string().trim().max(1000).optional()}).parse(request.body);
      const identity=parseDashboardIdentity(request.headers as Record<string,unknown>);
      const actor={userId:identity.userId||'dashboard',name:'Dashboard staff'};
      const updated=body.status==='claimed'
        ?await claimTicket(params.id,actor)
        :body.status==='open'
          ?await releaseTicket(params.id,actor,body.note)
          :await setTicketStatus(params.id,body.status,actor,body.note);
      if(!updated) return reply.code(404).send({error:'ticket not found or already closed'});
      return updated;
    });

    admin.post('/api/tickets/:id/reopen', async (request,reply) => {
      const params=z.object({id:z.coerce.number().int().positive()}).parse(request.params);
      const identity=parseDashboardIdentity(request.headers as Record<string,unknown>);
      try{return await reopenDiscordTicket(params.id,{userId:identity.userId||'dashboard',name:'Dashboard staff'});}
      catch(error){return reply.code(400).send({error:error instanceof Error?error.message:'unable to reopen ticket'});}
    });

    admin.get('/api/tickets/settings', async () => {
      const [settings,types,roles,destinations]=await Promise.all([
        getTicketSettings(),listTicketTypes(true),discordRoles(),discordTicketDestinations()
      ]);
      return {settings,types,roles,...destinations};
    });

    admin.put('/api/tickets/settings', async (request) => {
      const body=z.object({
        enabled:z.boolean(),panel_channel_id:z.string().trim().max(64).nullable().optional(),
        open_category_id:z.string().trim().max(64).nullable().optional(),closed_category_id:z.string().trim().max(64).nullable().optional(),
        transcript_channel_id:z.string().trim().max(64).nullable().optional(),max_open_per_user:z.coerce.number().int().min(1).max(10),
        allow_user_close:z.boolean(),hide_staff_mentions:z.boolean(),delete_closed_channels:z.boolean(),warning_role_ids:z.array(z.string().trim().min(1).max(64)).max(100).default([]),
        timeout_role_ids:z.array(z.string().trim().min(1).max(64)).max(100).default([]),
        kick_role_ids:z.array(z.string().trim().min(1).max(64)).max(100).default([]),
        ban_role_ids:z.array(z.string().trim().min(1).max(64)).max(100).default([]),
        reversal_role_ids:z.array(z.string().trim().min(1).max(64)).max(100).default([])
      }).parse(request.body);
      return updateTicketSettings({
        enabled:body.enabled,panel_channel_id:body.panel_channel_id||null,open_category_id:body.open_category_id||null,
        closed_category_id:body.closed_category_id||null,transcript_channel_id:body.transcript_channel_id||null,
        max_open_per_user:body.max_open_per_user,allow_user_close:body.allow_user_close,hide_staff_mentions:body.hide_staff_mentions,
        delete_closed_channels:body.delete_closed_channels,
        warning_role_ids:body.warning_role_ids,timeout_role_ids:body.timeout_role_ids,kick_role_ids:body.kick_role_ids,
        ban_role_ids:body.ban_role_ids,reversal_role_ids:body.reversal_role_ids
      });
    });

    admin.put('/api/tickets/types/:key', async (request,reply) => {
      const params=z.object({key:slug}).parse(request.params);
      const body=z.object({
        label:z.string().trim().min(1).max(100),description:z.string().trim().max(300),emoji:z.string().trim().max(40).nullable().optional(),
        intake_prompt:z.string().trim().min(1).max(1000),support_role_ids:z.array(z.string().trim().min(1).max(64)).max(100),
        category_override_id:z.string().trim().max(64).nullable().optional(),allow_punishments:z.boolean(),enabled:z.boolean(),
        sort_order:z.coerce.number().int().min(-10000).max(10000)
      }).parse(request.body);
      const updated=await updateTicketType(params.key,body);
      if(!updated) return reply.code(404).send({error:'ticket type not found'});
      return updated;
    });

    admin.post('/api/tickets/panel', async (_request,reply) => {
      try{return {ok:true,...await publishTicketPanel()};}
      catch(error){return reply.code(400).send({error:error instanceof Error?error.message:'unable to publish ticket panel'});}
    });

    admin.get('/api/punishments', async (request) => {
      const query=z.object({
        ticket_id:z.coerce.number().int().positive().optional(),target_user_id:z.string().trim().max(64).optional(),
        status:z.enum(['pending','active','completed','expired','reversed','failed','superseded']).optional(),
        limit:z.coerce.number().int().min(1).max(500).optional()
      }).parse(request.query);
      return {punishments:await listPunishments({ticketId:query.ticket_id,targetUserId:query.target_user_id,status:query.status,limit:query.limit})};
    });

    admin.get('/api/punishments/:id', async (request,reply) => {
      const params=z.object({id:z.coerce.number().int().positive()}).parse(request.params);
      const punishment=await getPunishment(params.id);
      if(!punishment) return reply.code(404).send({error:'punishment not found'});
      return punishment;
    });

    admin.post('/api/tickets/:id/punishments', async (request,reply) => {
      const params=z.object({id:z.coerce.number().int().positive()}).parse(request.params);
      const ticket=await getTicket(params.id);
      if(!ticket) return reply.code(404).send({error:'ticket not found'});
      if(!ticket.allow_punishments) return reply.code(400).send({error:'punishments are not enabled for this ticket type'});
      const body=z.object({
        target_user_id:z.string().trim().regex(/^\d{15,22}$/),action:z.enum(['warning','timeout','kick','temporary_ban','permanent_ban']),
        duration_seconds:z.coerce.number().int().positive().max(2592000).nullable().optional(),reason:z.string().trim().min(3).max(1000),
        internal_notes:z.string().trim().max(3000).optional(),source_moderation_case_id:z.coerce.number().int().positive().nullable().optional()
      }).parse(request.body);
      const identity=parseDashboardIdentity(request.headers as Record<string,unknown>);
      try{return await applyTicketPunishment({
        ticketId:params.id,guildId:String(ticket.guild_id),targetUserId:body.target_user_id,action:body.action,
        durationSeconds:body.duration_seconds||null,reason:body.reason,internalNotes:body.internal_notes||'',
        actor:{userId:identity.userId||'dashboard',name:'Dashboard staff'},sourceModerationCaseId:body.source_moderation_case_id||null
      });}catch(error){return reply.code(400).send({error:error instanceof Error?error.message:'unable to apply punishment'});}
    });

    admin.post('/api/punishments/:id/reverse', async (request,reply) => {
      const params=z.object({id:z.coerce.number().int().positive()}).parse(request.params);
      const body=z.object({reason:z.string().trim().min(3).max(1000)}).parse(request.body);
      const identity=parseDashboardIdentity(request.headers as Record<string,unknown>);
      try{return await reverseTicketPunishment(params.id,{userId:identity.userId||'dashboard',name:'Dashboard staff'},body.reason);}
      catch(error){return reply.code(400).send({error:error instanceof Error?error.message:'unable to reverse punishment'});}
    });

    admin.get('/api/moderation/cases', async (request) => {
      const query = z.object({ status: z.enum(['pending','confirmed','dismissed']).optional(), user_id: z.string().trim().max(64).optional(), limit: z.coerce.number().int().min(1).max(500).optional() }).parse(request.query);
      const settings = await getModerationSettings();
      const data = await listModerationCases({ status: query.status, userId: query.user_id, limit: query.limit });
      return { ...data, mode: settings.mode, minimum_confidence: settings.minimum_confidence };
    });

    admin.get('/api/moderation/cases/:id', async (request, reply) => {
      const params = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
      const found = await getModerationCase(params.id);
      if (!found) return reply.code(404).send({ error: 'moderation case not found' });
      return found;
    });

    admin.put('/api/moderation/cases/:id/review', async (request, reply) => {
      const params = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
      const body = z.object({ status: z.enum(['pending','confirmed','dismissed']), notes: z.string().trim().max(3000).nullable().optional() }).parse(request.body);
      const identity = parseDashboardIdentity(request.headers as Record<string,unknown>);
      const updated = await reviewModerationCase(params.id, { status: body.status, notes: body.notes, actorUserId: identity.userId });
      if (!updated) return reply.code(404).send({ error: 'moderation case not found' });
      return updated;
    });

    admin.get('/api/moderation/users/:userId', async (request) => {
      const params = z.object({ userId: z.string().trim().min(1).max(64) }).parse(request.params);
      return getModerationUserHistory(params.userId);
    });

    admin.get('/api/moderation/settings', async () => {
      const [settings, roles, ruleSettings, channelRows] = await Promise.all([
        getModerationSettings(), discordRoles(), getModerationRuleSettings(),
        db.query(`SELECT discord_channel_id AS id,channel_name AS name,mode,monitor_messages FROM channel_policies ORDER BY channel_name NULLS LAST,discord_channel_id`)
      ]);
      return { settings, roles, rules: ruleSettings, channels: channelRows.rows };
    });

    admin.put('/api/moderation/settings', async (request) => {
      const body = z.object({
        mode: z.enum(['off','observe']), minimum_confidence: z.coerce.number().min(0.5).max(0.99),
        repeat_window_days: z.coerce.number().int().min(1).max(90), audit_channel_id: z.string().trim().max(64).nullable().optional(),
        post_observations_to_audit: z.boolean().default(false), exempt_role_ids: z.array(z.string().trim().min(1).max(64)).max(100).default([]),
        diagnostics_enabled: z.boolean().default(false)
      }).parse(request.body);
      return updateModerationSettings(body);
    });

    admin.get('/api/moderation/rules', async () => getModerationRuleSettings());

    admin.put('/api/moderation/rules/:articleId', async (request, reply) => {
      const params = z.object({ articleId: z.coerce.number().int().positive() }).parse(request.params);
      const legacyAction=z.enum(['staff_review','reminder','warning','delete_message','timeout_10m','timeout_1h']);
      const primaryAction=z.enum(['staff_review','reminder','warning','timeout_10m','timeout_1h']);
      const step=z.object({action:primaryAction,delete_message:z.boolean().default(false)});
      const body = z.object({
        enabled: z.boolean(), minimum_confidence: z.coerce.number().min(0.5).max(0.99).nullable().optional(),
        recommended_action: legacyAction.optional(),
        action_ladder: z.object({first:step,second:step,third:step,fourth_plus:step}).optional(),
        repeat_window_days: z.coerce.number().int().min(1).max(90).nullable().optional(),
        exempt_role_ids: z.array(z.string().trim().min(1).max(64)).max(100).default([]),
        channel_ids: z.array(z.string().trim().min(1).max(64)).max(500).default([])
      }).parse(request.body);
      const fallback=body.recommended_action||'staff_review';
      const fallbackStep={action:(fallback==='delete_message'?'staff_review':fallback) as 'staff_review'|'reminder'|'warning'|'timeout_10m'|'timeout_1h',delete_message:fallback==='delete_message'};
      const ladder=body.action_ladder||{first:fallbackStep,second:fallbackStep,third:fallbackStep,fourth_plus:fallbackStep};
      try { return await updateModerationRuleSettings(params.articleId, {
        ...body,recommended_action:ladder.first.action,action_ladder:ladder,
        minimum_confidence: body.minimum_confidence ?? null, repeat_window_days: body.repeat_window_days ?? null
      }); }
      catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : 'unable to save moderation rule settings' }); }
    });

    admin.get('/api/moderation/diagnostics', async (request) => {
      const query=z.object({limit:z.coerce.number().int().min(1).max(300).optional()}).parse(request.query);
      const settings=await getModerationSettings();
      const rows=await listModerationDiagnostics(query.limit||100);
      return { enabled:settings.diagnostics_enabled, mode:settings.mode, rows };
    });

    admin.delete('/api/moderation/diagnostics', async () => clearModerationDiagnostics());

    admin.get('/api/overview', async () => {
      const [messages, activity, issues, suggestions, channels, knowledge, gaps, candidates] = await Promise.all([
        db.query(`SELECT count(*)::int AS count FROM discord_messages WHERE created_at > NOW() - INTERVAL '24 hours'`),
        db.query(`SELECT count(*)::int AS count FROM ai_activity WHERE created_at > NOW() - INTERVAL '24 hours'`),
        db.query(`SELECT count(*)::int AS count FROM issues WHERE status NOT IN ('resolved','wont_fix')`),
        db.query(`SELECT count(*)::int AS count FROM suggestions WHERE status IN ('candidate','reviewing')`),
        db.query(`SELECT count(*)::int AS count FROM channel_policies WHERE mode <> 'ignored'`),
        db.query(`SELECT count(*)::int AS count FROM knowledge_articles WHERE status = 'published'`),
        db.query(`SELECT count(*)::int AS count FROM knowledge_gaps WHERE status='open'`),
        db.query(`SELECT count(*)::int AS count FROM issue_candidates WHERE status IN ('detected','reported')`)
      ]);
      return {
        messages24h: messages.rows[0].count,
        aiEvents24h: activity.rows[0].count,
        openIssues: issues.rows[0].count,
        pendingSuggestions: suggestions.rows[0].count,
        monitoredChannels: channels.rows[0].count,
        publishedKnowledge: knowledge.rows[0].count,
        openKnowledgeGaps: gaps.rows[0].count,
        incomingIssues: candidates.rows[0].count
      };
    });

    admin.get('/api/activity', async () => {
      const result = await db.query(`
        SELECT a.id, a.intent, a.confidence, a.should_respond, a.response_text, a.created_at,
               m.channel_name, m.author_name, m.content
        FROM ai_activity a
        LEFT JOIN discord_messages m ON m.id = a.discord_message_id
        ORDER BY a.created_at DESC LIMIT 50`);
      return result.rows;
    });

    admin.get('/api/channels', async () => {
      const result = await db.query('SELECT * FROM channel_policies ORDER BY channel_name NULLS LAST, discord_channel_id');
      return result.rows
        .map(row => {
          const metadata = getCachedDiscordChannelMetadata(String(row.discord_channel_id));
          return {
            ...row,
            channel_name: metadata?.name ?? row.channel_name,
            channel_type: metadata?.type ?? null,
            parent_name: metadata?.parent_name ?? null,
            category_name: metadata?.category_name ?? null,
            is_thread: metadata?.is_thread ?? false,
            discord_resolved: Boolean(metadata)
          };
        })
        .sort((a, b) => {
          const categoryA = String(a.category_name ?? '').toLowerCase();
          const categoryB = String(b.category_name ?? '').toLowerCase();
          if (categoryA !== categoryB) return categoryA.localeCompare(categoryB);
          return String(a.channel_name ?? a.discord_channel_id).localeCompare(String(b.channel_name ?? b.discord_channel_id));
        });
    });

    admin.post('/api/channels/sync', async (_request, reply) => {
      const result = await syncDiscordChannels();
      if (!result.ok) return reply.code(503).send(result);
      return result;
    });

    // Save all channel policies in one operation. This powers the dashboard's
    // single Save All button and keeps the UI/DB state in sync after refresh.
    admin.put('/api/channels', async (request) => {
      const channelMode = z.enum(['monitor','questions','issues','suggestions','full','ignored']);
      const body = z.object({
        channels: z.array(z.object({
          id: z.string().trim().min(1).max(32),
          mode: channelMode
        })).max(1000)
      }).parse(request.body);

      const deduped = [...new Map(body.channels.map(channel => [channel.id, channel])).values()];
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        for (const channel of deduped) {
          const autoReply = ['questions','issues','full'].includes(channel.mode);
          const monitor = channel.mode !== 'ignored';
          await client.query(
            `INSERT INTO channel_policies (discord_channel_id, mode, auto_reply, monitor_messages)
             VALUES ($1,$2,$3,$4)
             ON CONFLICT (discord_channel_id) DO UPDATE SET
               mode = EXCLUDED.mode,
               auto_reply = EXCLUDED.auto_reply,
               monitor_messages = EXCLUDED.monitor_messages,
               updated_at = NOW()`,
            [channel.id, channel.mode, autoReply, monitor]
          );
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }

      return { ok: true, updated: deduped.length };
    });

    admin.put('/api/channels/:id', async (request) => {
      const params = z.object({ id: z.string() }).parse(request.params);
      const body = z.object({
        mode: z.enum(['monitor','questions','issues','suggestions','full','ignored']),
        auto_reply: z.boolean().optional(),
        monitor_messages: z.boolean().optional()
      }).parse(request.body);
      const autoReply = body.auto_reply ?? ['questions','issues','full'].includes(body.mode);
      const monitor = body.monitor_messages ?? body.mode !== 'ignored';
      const result = await db.query(
        `INSERT INTO channel_policies (discord_channel_id, mode, auto_reply, monitor_messages)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (discord_channel_id) DO UPDATE SET
           mode = EXCLUDED.mode, auto_reply = EXCLUDED.auto_reply,
           monitor_messages = EXCLUDED.monitor_messages, updated_at = NOW()
         RETURNING *`,
        [params.id, body.mode, autoReply, monitor]
      );
      return result.rows[0];
    });

    // Bot behavior settings
    admin.get('/api/bot/settings', async () => {
      const result = await db.query(`
        SELECT direct_mentions_enabled, direct_mentions_bypass_channel_mode,
               direct_mentions_use_reply_context, direct_mentions_use_recent_context,
               direct_mentions_context_messages, updated_at
          FROM bot_settings WHERE id=1`);
      return result.rows[0];
    });

    admin.put('/api/bot/settings', async (request) => {
      const body = botSettingsBody.parse(request.body);
      const result = await db.query(
        `UPDATE bot_settings SET
           direct_mentions_enabled=$1,
           direct_mentions_bypass_channel_mode=$2,
           direct_mentions_use_reply_context=$3,
           direct_mentions_use_recent_context=$4,
           direct_mentions_context_messages=$5,
           updated_at=NOW()
         WHERE id=1 RETURNING *`,
        [body.direct_mentions_enabled, body.direct_mentions_bypass_channel_mode,
         body.direct_mentions_use_reply_context, body.direct_mentions_use_recent_context,
         body.direct_mentions_context_messages]
      );
      invalidateBotBehaviorSettingsCache();
      return result.rows[0];
    });

    // Knowledge settings
    admin.get('/api/knowledge/settings', async () => {
      const [contentTypes, categories, audiences, mappings, roles] = await Promise.all([
        db.query('SELECT * FROM knowledge_content_types ORDER BY sort_order, label'),
        db.query('SELECT * FROM knowledge_categories ORDER BY sort_order, label'),
        db.query('SELECT * FROM knowledge_audiences ORDER BY sort_order, label'),
        db.query('SELECT audience_key, discord_role_id FROM knowledge_audience_roles ORDER BY audience_key, discord_role_id'),
        discordRoles().catch(() => [])
      ]);
      const roleMap = new Map<string, string[]>();
      for (const row of mappings.rows) {
        const key = String(row.audience_key);
        const list = roleMap.get(key) ?? [];
        list.push(String(row.discord_role_id));
        roleMap.set(key, list);
      }
      return {
        content_types: contentTypes.rows,
        categories: categories.rows,
        audiences: audiences.rows.map(row => ({ ...row, role_ids: roleMap.get(String(row.key)) ?? [] })),
        discord_roles: roles
      };
    });

    admin.post('/api/knowledge/content-types', async (request, reply) => {
      const body = contentTypeBody.parse(request.body);
      const result = await db.query(
        `INSERT INTO knowledge_content_types (key,label,description,moderation_eligible,sort_order,enabled)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [body.key,body.label,body.description,body.moderation_eligible,body.sort_order,body.enabled]
      ).catch(error => {
        if ((error as { code?: string }).code === '23505') return null;
        throw error;
      });
      if (!result) return reply.code(409).send({ error: 'content type key already exists' });
      return reply.code(201).send(result.rows[0]);
    });

    admin.put('/api/knowledge/content-types/:key', async (request, reply) => {
      const params = z.object({ key: slug }).parse(request.params);
      const body = contentTypeBody.omit({ key: true }).parse(request.body);
      const result = await db.query(
        `UPDATE knowledge_content_types SET label=$1,description=$2,moderation_eligible=$3,sort_order=$4,enabled=$5,updated_at=NOW()
         WHERE key=$6 RETURNING *`,
        [body.label,body.description,body.moderation_eligible,body.sort_order,body.enabled,params.key]
      );
      if (!result.rowCount) return reply.code(404).send({ error: 'content type not found' });
      return result.rows[0];
    });

    admin.delete('/api/knowledge/content-types/:key', async (request, reply) => {
      const params = z.object({ key: slug }).parse(request.params);
      const used = await db.query('SELECT count(*)::int AS count FROM knowledge_articles WHERE content_type=$1', [params.key]);
      if (used.rows[0].count > 0) return reply.code(409).send({ error: 'content type is still used by knowledge articles; disable it instead' });
      const result = await db.query('DELETE FROM knowledge_content_types WHERE key=$1 RETURNING key,label', [params.key]);
      if (!result.rowCount) return reply.code(404).send({ error: 'content type not found' });
      return { ok: true, deleted: result.rows[0] };
    });

    admin.post('/api/knowledge/categories', async (request, reply) => {
      const body = categoryBody.parse(request.body);
      const result = await db.query(
        `INSERT INTO knowledge_categories (key,label,description,sort_order,enabled)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [body.key, body.label, body.description, body.sort_order, body.enabled]
      ).catch(error => {
        if ((error as { code?: string }).code === '23505') return null;
        throw error;
      });
      if (!result) return reply.code(409).send({ error: 'category key already exists' });
      return reply.code(201).send(result.rows[0]);
    });

    admin.put('/api/knowledge/categories/:key', async (request, reply) => {
      const params = z.object({ key: slug }).parse(request.params);
      const body = categoryBody.omit({ key: true }).parse(request.body);
      const result = await db.query(
        `UPDATE knowledge_categories SET label=$1,description=$2,sort_order=$3,enabled=$4,updated_at=NOW()
         WHERE key=$5 RETURNING *`,
        [body.label, body.description, body.sort_order, body.enabled, params.key]
      );
      if (!result.rowCount) return reply.code(404).send({ error: 'category not found' });
      return result.rows[0];
    });

    admin.delete('/api/knowledge/categories/:key', async (request, reply) => {
      const params = z.object({ key: slug }).parse(request.params);
      const used = await db.query('SELECT count(*)::int AS count FROM knowledge_articles WHERE category=$1', [params.key]);
      if (used.rows[0].count > 0) return reply.code(409).send({ error: 'category is still used by knowledge articles; disable it instead' });
      const result = await db.query('DELETE FROM knowledge_categories WHERE key=$1 RETURNING key,label', [params.key]);
      if (!result.rowCount) return reply.code(404).send({ error: 'category not found' });
      return { ok: true, deleted: result.rows[0] };
    });

    admin.post('/api/knowledge/audiences', async (request, reply) => {
      const body = audienceBody.parse(request.body);
      const result = await db.query(
        `INSERT INTO knowledge_audiences (key,label,description,public_access,sort_order,enabled)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [body.key, body.label, body.description, body.public_access, body.sort_order, body.enabled]
      ).catch(error => {
        if ((error as { code?: string }).code === '23505') return null;
        throw error;
      });
      if (!result) return reply.code(409).send({ error: 'audience key already exists' });
      return reply.code(201).send({ ...result.rows[0], role_ids: [] });
    });

    admin.put('/api/knowledge/audiences/:key', async (request, reply) => {
      const params = z.object({ key: slug }).parse(request.params);
      const body = audienceBody.omit({ key: true }).parse(request.body);
      const result = await db.query(
        `UPDATE knowledge_audiences
            SET label=$1,description=$2,public_access=$3,sort_order=$4,enabled=$5,updated_at=NOW()
          WHERE key=$6 RETURNING *`,
        [body.label, body.description, body.public_access, body.sort_order, body.enabled, params.key]
      );
      if (!result.rowCount) return reply.code(404).send({ error: 'audience not found' });
      return result.rows[0];
    });

    admin.put('/api/knowledge/audiences/:key/roles', async (request, reply) => {
      const params = z.object({ key: slug }).parse(request.params);
      const body = z.object({ role_ids: z.array(z.string().trim().min(1).max(32)).max(100) }).parse(request.body);
      const exists = await db.query('SELECT 1 FROM knowledge_audiences WHERE key=$1', [params.key]);
      if (!exists.rowCount) return reply.code(404).send({ error: 'audience not found' });
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM knowledge_audience_roles WHERE audience_key=$1', [params.key]);
        for (const roleId of [...new Set(body.role_ids)]) {
          await client.query('INSERT INTO knowledge_audience_roles (audience_key,discord_role_id) VALUES ($1,$2)', [params.key, roleId]);
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      return { ok: true, audience_key: params.key, role_ids: [...new Set(body.role_ids)] };
    });

    admin.delete('/api/knowledge/audiences/:key', async (request, reply) => {
      const params = z.object({ key: slug }).parse(request.params);
      const used = await db.query('SELECT count(*)::int AS count FROM knowledge_articles WHERE $1 = ANY(audiences)', [params.key]);
      if (used.rows[0].count > 0) return reply.code(409).send({ error: 'audience is still used by knowledge articles; disable it instead' });
      const result = await db.query('DELETE FROM knowledge_audiences WHERE key=$1 RETURNING key,label', [params.key]);
      if (!result.rowCount) return reply.code(404).send({ error: 'audience not found' });
      return { ok: true, deleted: result.rows[0] };
    });

    // Issue settings
    admin.get('/api/issues/settings', async () => {
      const [categories, automation, templates, channels] = await Promise.all([
        db.query('SELECT * FROM issue_categories ORDER BY sort_order, label'),
        db.query('SELECT * FROM issue_automation_settings WHERE id=1'),
        db.query(`SELECT * FROM issue_status_templates ORDER BY CASE status WHEN 'new' THEN 1 WHEN 'acknowledged' THEN 2 WHEN 'investigating' THEN 3 WHEN 'fix_in_progress' THEN 4 WHEN 'testing' THEN 5 WHEN 'monitoring' THEN 6 WHEN 'resolved' THEN 7 ELSE 8 END`),
        discordIssueDestinations()
      ]);
      return { categories: categories.rows, automation: automation.rows[0] || null, templates: templates.rows, channels };
    });

    admin.put('/api/issues/automation', async (request) => {
      const body = issueAutomationBody.parse(request.body);
      const result = await db.query(
        `UPDATE issue_automation_settings SET intake_channel_id=$1,auto_create_threads=$2,allow_player_details=$3,
          auto_summarize_thread=$4,auto_update_symptoms=$5,auto_collect_workarounds=$6,auto_collect_reproduction=$7,
          auto_collect_locations=$8,edit_original_status_message=$9,post_status_updates_to_thread=$10,auto_public_response=$11,
          include_bug_id=$12,include_workaround=$13,include_affected_count=$14,updated_at=NOW() WHERE id=1 RETURNING *`,
        [body.intake_channel_id || null,body.auto_create_threads,body.allow_player_details,body.auto_summarize_thread,
         body.auto_update_symptoms,body.auto_collect_workarounds,body.auto_collect_reproduction,body.auto_collect_locations,
         body.edit_original_status_message,body.post_status_updates_to_thread,body.auto_public_response,body.include_bug_id,
         body.include_workaround,body.include_affected_count]
      );
      return result.rows[0];
    });

    admin.put('/api/issues/templates/:status', async (request, reply) => {
      const params = z.object({ status: issueStatus }).parse(request.params);
      const body = issueTemplateBody.parse(request.body);
      const result = await db.query(
        `INSERT INTO issue_status_templates (status,template,enabled) VALUES ($1,$2,$3)
         ON CONFLICT (status) DO UPDATE SET template=EXCLUDED.template,enabled=EXCLUDED.enabled,updated_at=NOW() RETURNING *`,
        [params.status,body.template,body.enabled]
      );
      return result.rows[0];
    });

    admin.post('/api/issues/categories', async (request, reply) => {
      const body = issueCategoryBody.parse(request.body);
      const result = await db.query(
        `INSERT INTO issue_categories (key,label,description,sort_order,enabled)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [body.key, body.label, body.description, body.sort_order, body.enabled]
      ).catch(error => {
        if ((error as { code?: string }).code === '23505') return null;
        throw error;
      });
      if (!result) return reply.code(409).send({ error: 'issue category key already exists' });
      return reply.code(201).send(result.rows[0]);
    });

    admin.put('/api/issues/categories/:key', async (request, reply) => {
      const params = z.object({ key: slug }).parse(request.params);
      const body = issueCategoryBody.omit({ key: true }).parse(request.body);
      const result = await db.query(
        `UPDATE issue_categories SET label=$1,description=$2,sort_order=$3,enabled=$4,updated_at=NOW()
         WHERE key=$5 RETURNING *`,
        [body.label, body.description, body.sort_order, body.enabled, params.key]
      );
      if (!result.rowCount) return reply.code(404).send({ error: 'issue category not found' });
      return result.rows[0];
    });

    admin.delete('/api/issues/categories/:key', async (request, reply) => {
      const params = z.object({ key: slug }).parse(request.params);
      const used = await db.query('SELECT count(*)::int AS count FROM issues WHERE category=$1', [params.key]);
      if (used.rows[0].count > 0) return reply.code(409).send({ error: 'issue category is still used by known issues; disable it instead' });
      const result = await db.query('DELETE FROM issue_categories WHERE key=$1 RETURNING key,label', [params.key]);
      if (!result.rowCount) return reply.code(404).send({ error: 'issue category not found' });
      return { ok: true, deleted: result.rows[0] };
    });

    // Knowledge Base CRUD
    admin.get('/api/knowledge', async () => {
      const result = await db.query(`
        SELECT id,title,body,content_type,category,audiences,status,source_url,aliases,related_topics,example_questions,
               created_by,created_at,updated_at,embedding_updated_at
        FROM knowledge_articles
        ORDER BY updated_at DESC, id DESC`);
      return result.rows;
    });

    admin.get('/api/knowledge/gaps', async () => {
      const result = await db.query(`
        SELECT id,normalized_question,display_question,sample_question,example_questions,topic,occurrences,status,matched_sources,first_seen,last_seen,notes,converted_article_id,
               conversation_context,partial_answer,discord_message_id
        FROM knowledge_gaps
        ORDER BY CASE status WHEN 'open' THEN 1 WHEN 'reviewed' THEN 2 ELSE 3 END, occurrences DESC, last_seen DESC
        LIMIT 200`);
      return result.rows;
    });


    admin.put('/api/knowledge/gaps/:id', async (request, reply) => {
      const params = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
      const body = z.object({
        status: z.enum(['open','reviewed','resolved','ignored']),
        notes: z.string().trim().max(8000).default('')
      }).parse(request.body);
      const result = await db.query(
        `UPDATE knowledge_gaps SET status=$1,notes=$2,last_seen=last_seen WHERE id=$3 RETURNING *`,
        [body.status, body.notes, params.id]
      );
      if (!result.rowCount) return reply.code(404).send({ error: 'knowledge gap not found' });
      return result.rows[0];
    });

    admin.post('/api/knowledge/gaps/:id/reanalyze', async (request, reply) => {
      const params = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
      const result = await db.query('SELECT * FROM knowledge_gaps WHERE id=$1', [params.id]);
      if (!result.rowCount) return reply.code(404).send({ error: 'knowledge gap not found' });
      const row = result.rows[0];

      // v0.8.2: never use normalized_question as conversation context. It is only a grouping key.
      // Prefer the immutable context snapshot captured when the gap was created.
      let conversationContext = String(row.conversation_context || '').trim();
      let sourceMessageDbId = row.discord_message_id ? Number(row.discord_message_id) : null;

      // Legacy v0.8/v0.8.1 gaps did not save context. Try to locate the original Discord message
      // and recover the surrounding conversation live from Discord before re-analyzing it.
      if (!conversationContext && row.channel_id) {
        let sourceMessage: { id: number; message_id: string; raw: any } | null = null;
        if (sourceMessageDbId) {
          const found = await db.query(
            'SELECT id,message_id,raw FROM discord_messages WHERE id=$1 LIMIT 1',
            [sourceMessageDbId]
          );
          sourceMessage = found.rows[0] ?? null;
        }
        if (!sourceMessage) {
          const found = await db.query(
            `SELECT id,message_id,raw FROM discord_messages
              WHERE channel_id=$1
                AND ($2::text IS NULL OR author_id=$2)
                AND content=$3
              ORDER BY ABS(EXTRACT(EPOCH FROM (discord_created_at - $4::timestamptz))) ASC
              LIMIT 1`,
            [String(row.channel_id), row.discord_user_id ? String(row.discord_user_id) : null, String(row.sample_question || ''), row.first_seen]
          );
          sourceMessage = found.rows[0] ?? null;
        }

        if (sourceMessage) {
          sourceMessageDbId = Number(sourceMessage.id);
          conversationContext = await recoverDiscordConversationContext(String(row.channel_id), String(sourceMessage.message_id)) || '';

          // If live Discord recovery is unavailable, rebuild what we can from messages already stored locally.
          if (!conversationContext) {
            const raw = sourceMessage.raw && typeof sourceMessage.raw === 'object' ? sourceMessage.raw : {};
            const ids = [raw.replied_to_message_id, ...(Array.isArray(raw.context_message_ids) ? raw.context_message_ids : [])]
              .map((value: unknown) => String(value || '').trim())
              .filter(Boolean);
            if (ids.length) {
              const stored = await db.query(
                `SELECT message_id,author_name,content,discord_created_at
                   FROM discord_messages
                  WHERE message_id = ANY($1::text[])
                  ORDER BY discord_created_at ASC`,
                [ids]
              );
              if (stored.rowCount) {
                conversationContext = [
                  `CURRENT REQUEST:
${String(row.sample_question || '')}`,
                  `RECOVERED CONTEXT (oldest to newest):
${stored.rows.map((message: any) => `${message.author_name || 'User'}: ${message.content}`).join('\n')}`
                ].join('\n\n').slice(0, 12000);
              }
            }
          }
        }
      }

      const cleanedTrigger = String(row.sample_question || '').replace(/<@!?\d+>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
      const vagueTrigger = /^(clarify|clarify that|verify|verify this|verify that|is this right|are they right|what about this|what about that|this|that)[?.!]*$/.test(cleanedTrigger);

      // Never make a gap worse. A vague direct mention without recoverable context cannot be safely cleaned.
      if (!conversationContext && vagueTrigger) {
        return reply.code(409).send({
          error: 'The original conversation context was not stored for this legacy gap and could not be recovered from Discord. The existing gap was left unchanged.'
        });
      }

      const displayQuestion = await deriveKnowledgeGapQuestion({
        currentRequest: String(row.sample_question || ''),
        conversationContext: conversationContext || undefined,
        partialAnswer: row.partial_answer ? String(row.partial_answer) : null,
        topic: String(row.topic || ''),
        matchedSources: row.matched_sources || [],
        fallback: String(row.display_question || row.sample_question || row.normalized_question || 'Clarification needed')
      });
      const normalized = displayQuestion.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);
      const updated = await db.query(
        `UPDATE knowledge_gaps
            SET display_question=$1,
                normalized_question=$2,
                conversation_context=COALESCE(NULLIF($3,''),conversation_context),
                discord_message_id=COALESCE($4,discord_message_id)
          WHERE id=$5 RETURNING *`,
        [displayQuestion, normalized, conversationContext, sourceMessageDbId, params.id]
      );
      return updated.rows[0];
    });

    admin.post('/api/knowledge/gaps/:id/convert', async (request, reply) => {
      const params = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
      const body = z.object({
        category: slug.default('general'),
        audiences: z.array(slug).min(1).default(['public'])
      }).parse(request.body ?? {});
      if (!(await assertCategoryExists(body.category, reply))) return;
      if (!(await assertAudiencesExist(body.audiences, reply))) return;
      const gap = await db.query('SELECT * FROM knowledge_gaps WHERE id=$1', [params.id]);
      if (!gap.rowCount) return reply.code(404).send({ error: 'knowledge gap not found' });
      const row = gap.rows[0];
      if (row.converted_article_id) return reply.code(409).send({ error: 'knowledge gap already has a draft article', article_id: row.converted_article_id });
      const titleBase = String(row.display_question || row.topic || row.sample_question || 'Knowledge gap').trim();
      const title = `Clarify: ${titleBase}`.slice(0, 200);
      const audiences = [...new Set(body.audiences)];
      const article = await db.query(
        `INSERT INTO knowledge_articles
          (title,body,content_type,category,audience,audiences,status,aliases,related_topics,example_questions,created_by)
         VALUES ($1,$2,'other',$3,$4,$5,'draft',$6,$7,$8,$9) RETURNING *`,
        [title,
         'TODO: Add the verified server rule or answer for this knowledge gap. Replace this placeholder before publishing.',
         body.category, audiences[0], audiences,
         [String(row.display_question || row.normalized_question || row.sample_question)].filter(Boolean),
         [String(row.topic || '')].filter(Boolean),
         [String(row.display_question || row.sample_question)].filter(Boolean),
         `Knowledge gap #${params.id}`]
      );
      await db.query(
        `UPDATE knowledge_gaps SET status='reviewed',converted_article_id=$3,notes=CASE WHEN notes='' THEN $1 ELSE notes || E'\n' || $1 END WHERE id=$2`,
        [`Draft knowledge article #${article.rows[0].id} created.`, params.id, article.rows[0].id]
      );
      await refreshKnowledgeEmbedding(Number(article.rows[0].id)).catch(error => request.log.warn({ error }, 'knowledge embedding refresh failed'));
      return reply.code(201).send(article.rows[0]);
    });

    admin.post('/api/knowledge/reindex', async () => {
      const count = await backfillKnowledgeEmbeddings(500);
      return { ok: true, indexed: count };
    });

    admin.post('/api/knowledge/ai-build', async (request, reply) => {
      try {
        // These values are authoring hints, not trusted database keys. Normalize them
        // here and let buildKnowledgeDraft() select only values that actually exist in
        // the enabled knowledge settings. A stale/renamed hint must never crash creation.
        const parsed = z.object({
          source_text: z.string().trim().min(8).max(18000),
          content_type_hint: z.string().trim().max(128).optional().nullable(),
          category_hint: z.string().trim().max(128).optional().nullable(),
          audience_hints: z.array(z.string().trim().max(128)).max(50).optional().default([])
        }).safeParse(request.body);

        if (!parsed.success) {
          request.log.warn({ issues: parsed.error.issues }, 'Invalid AI knowledge authoring request');
          return reply.code(400).send({
            error: 'The AI draft request contained invalid or incomplete form data. Please reload the create page and try again.'
          });
        }

        const body = parsed.data;
        const [contentTypes,categories,audiences] = await Promise.all([
          db.query('SELECT key,label,description FROM knowledge_content_types WHERE enabled=TRUE ORDER BY sort_order,label'),
          db.query('SELECT key,label,description FROM knowledge_categories WHERE enabled=TRUE ORDER BY sort_order,label'),
          db.query('SELECT key,label,description,public_access FROM knowledge_audiences WHERE enabled=TRUE ORDER BY sort_order,label')
        ]);

        if (!contentTypes.rowCount || !categories.rowCount || !audiences.rowCount) {
          request.log.error({
            contentTypes: contentTypes.rowCount,
            categories: categories.rowCount,
            audiences: audiences.rowCount
          }, 'AI knowledge authoring settings are incomplete');
          return reply.code(503).send({
            error: 'Knowledge settings are incomplete. At least one enabled content type, category, and audience are required.'
          });
        }

        const contentTypeKeys = new Set(contentTypes.rows.map(row => String(row.key)));
        const categoryKeys = new Set(categories.rows.map(row => String(row.key)));
        const audienceKeys = new Set(audiences.rows.map(row => String(row.key)));

        const draft = await buildKnowledgeDraft({
          sourceText: body.source_text,
          contentTypeHint: body.content_type_hint && contentTypeKeys.has(body.content_type_hint)
            ? body.content_type_hint
            : undefined,
          categoryHint: body.category_hint && categoryKeys.has(body.category_hint)
            ? body.category_hint
            : undefined,
          audienceHints: body.audience_hints.filter(key => audienceKeys.has(key)),
          options: { contentTypes: contentTypes.rows, categories: categories.rows, audiences: audiences.rows }
        });
        return draft;
      } catch (error) {
        request.log.error({ error }, 'AI knowledge authoring route failed');
        return reply.code(503).send({
          error: error instanceof Error && error.message
            ? error.message
            : 'AI knowledge authoring failed. Check the API log for details.'
        });
      }
    });

    admin.post('/api/knowledge/:id/ai-improve', async (request, reply) => {
      const params = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
      const existing = await db.query(
        `SELECT id,title,body,content_type,category,audiences,status,source_url,aliases,related_topics,example_questions
           FROM knowledge_articles WHERE id=$1`,
        [params.id]
      );
      if (!existing.rowCount) return reply.code(404).send({ error: 'knowledge article not found' });
      const [contentTypes,categories,audiences] = await Promise.all([
        db.query('SELECT key,label,description FROM knowledge_content_types WHERE enabled=TRUE ORDER BY sort_order,label'),
        db.query('SELECT key,label,description FROM knowledge_categories WHERE enabled=TRUE ORDER BY sort_order,label'),
        db.query('SELECT key,label,description,public_access FROM knowledge_audiences WHERE enabled=TRUE ORDER BY sort_order,label')
      ]);
      try {
        const row = existing.rows[0];
        const improved = await improveKnowledgeRetrieval({
          article: {
            title: String(row.title), body: String(row.body), content_type: String(row.content_type || 'other'),
            category: String(row.category), audiences: row.audiences || ['public'], aliases: row.aliases || [],
            related_topics: row.related_topics || [], example_questions: row.example_questions || []
          },
          options: { contentTypes: contentTypes.rows, categories: categories.rows, audiences: audiences.rows }
        });
        const result = await db.query(
          `UPDATE knowledge_articles SET title=$1,aliases=$2,related_topics=$3,example_questions=$4,
                  embedding=NULL,embedding_updated_at=NULL,updated_at=NOW() WHERE id=$5 RETURNING *`,
          [improved.title,improved.aliases,improved.related_topics,improved.example_questions,params.id]
        );
        await refreshKnowledgeEmbedding(params.id).catch(error => request.log.warn({ error }, 'knowledge embedding refresh failed'));
        return { ...result.rows[0], authoring_note: improved.authoring_note };
      } catch (error) {
        request.log.warn({ error }, 'AI knowledge improvement failed');
        return reply.code(503).send({ error: error instanceof Error ? error.message : 'AI knowledge improvement failed' });
      }
    });

    admin.get('/api/knowledge/:id', async (request, reply) => {
      const params = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
      const result = await db.query(
        `SELECT id,title,body,content_type,category,audiences,status,source_url,aliases,related_topics,example_questions,
                created_by,created_at,updated_at,embedding_updated_at
         FROM knowledge_articles WHERE id=$1`,
        [params.id]
      );
      if (!result.rowCount) return reply.code(404).send({ error: 'knowledge article not found' });
      return result.rows[0];
    });

    admin.post('/api/knowledge', async (request, reply) => {
      const parsed = knowledgeBody.safeParse(request.body);
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        const field = first?.path?.length ? first.path.join('.') : 'article';
        request.log.warn({ issues: parsed.error.issues }, 'Knowledge article validation failed');
        return reply.code(400).send({
          error: first ? `Invalid ${field}: ${first.message}` : 'Knowledge article validation failed.'
        });
      }
      const body = parsed.data;
      if (body.status === 'published' && !(await requireAdditionalPermission(request, reply, 'knowledge.publish'))) return;
      if (body.status === 'archived' && !(await requireAdditionalPermission(request, reply, 'knowledge.archive'))) return;
      if (!(await assertContentTypeExists(body.content_type, reply))) return;
      if (!(await assertCategoryExists(body.category, reply))) return;
      if (!(await assertAudiencesExist(body.audiences, reply))) return;
      const audiences = [...new Set(body.audiences)];
      const result = await db.query(
        `INSERT INTO knowledge_articles
          (title,body,content_type,category,audience,audiences,status,source_url,aliases,related_topics,example_questions,created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [body.title, body.body, body.content_type, body.category, audiences[0], audiences, body.status, body.source_url ?? null,
         [...new Set(body.aliases)], [...new Set(body.related_topics)], [...new Set(body.example_questions)], body.created_by ?? null]
      );
      await refreshKnowledgeEmbedding(Number(result.rows[0].id)).catch(error => request.log.warn({ error }, 'knowledge embedding refresh failed'));
      return reply.code(201).send(result.rows[0]);
    });

    admin.put('/api/knowledge/:id', async (request, reply) => {
      const params = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
      const parsed = knowledgeBody.omit({ created_by: true }).safeParse(request.body);
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        const field = first?.path?.length ? first.path.join('.') : 'article';
        request.log.warn({ issues: parsed.error.issues }, 'Knowledge article update validation failed');
        return reply.code(400).send({
          error: first ? `Invalid ${field}: ${first.message}` : 'Knowledge article validation failed.'
        });
      }
      const body = parsed.data;
      const previousStatus = await db.query('SELECT status FROM knowledge_articles WHERE id=$1', [params.id]);
      if (!previousStatus.rowCount) return reply.code(404).send({ error: 'knowledge article not found' });
      if (previousStatus.rows[0].status !== body.status) {
        if (body.status === 'published' && !(await requireAdditionalPermission(request, reply, 'knowledge.publish'))) return;
        if ((body.status === 'archived' || previousStatus.rows[0].status === 'archived') && !(await requireAdditionalPermission(request, reply, 'knowledge.archive'))) return;
      }
      if (!(await assertContentTypeExists(body.content_type, reply))) return;
      if (!(await assertCategoryExists(body.category, reply))) return;
      if (!(await assertAudiencesExist(body.audiences, reply))) return;
      const audiences = [...new Set(body.audiences)];
      const result = await db.query(
        `UPDATE knowledge_articles
            SET title=$1, body=$2, content_type=$3, category=$4, audience=$5, audiences=$6, status=$7, source_url=$8,
                aliases=$9, related_topics=$10, example_questions=$11, embedding=NULL, embedding_updated_at=NULL, updated_at=NOW()
          WHERE id=$12
          RETURNING *`,
        [body.title, body.body, body.content_type, body.category, audiences[0], audiences, body.status, body.source_url ?? null,
         [...new Set(body.aliases)], [...new Set(body.related_topics)], [...new Set(body.example_questions)], params.id]
      );
      if (!result.rowCount) return reply.code(404).send({ error: 'knowledge article not found' });
      await refreshKnowledgeEmbedding(params.id).catch(error => request.log.warn({ error }, 'knowledge embedding refresh failed'));
      return result.rows[0];
    });

    admin.delete('/api/knowledge/:id', async (request, reply) => {
      const params = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
      const result = await db.query('DELETE FROM knowledge_articles WHERE id=$1 RETURNING id,title', [params.id]);
      if (!result.rowCount) return reply.code(404).send({ error: 'knowledge article not found' });
      return { ok: true, deleted: result.rows[0] };
    });

    admin.post('/api/issues/ai-build', async (request, reply) => {
      const body = z.object({
        source_text: z.string().trim().min(8).max(18000),
        category_hint: slug.optional(),
        resource_hint: z.string().trim().max(160).optional(),
        severity_hint: issueSeverity.optional()
      }).parse(request.body);
      const categories = await db.query('SELECT key,label,description FROM issue_categories WHERE enabled=TRUE ORDER BY sort_order,label');
      try {
        return await buildIssueDraft({
          sourceText: body.source_text,
          categories: categories.rows,
          categoryHint: body.category_hint,
          resourceHint: body.resource_hint,
          severityHint: body.severity_hint
        });
      } catch (error) {
        request.log.warn({ error }, 'AI issue authoring failed');
        return reply.code(503).send({ error: error instanceof Error ? error.message : 'AI issue authoring failed' });
      }
    });

    admin.get('/api/issues', async () => {
      const result = await db.query(`
        SELECT i.id,i.public_id,i.title,i.description,i.category,i.resource_name,i.severity,i.status,i.public_response,i.workaround,i.staff_notes,
               i.aliases,i.symptoms,i.log_patterns,i.report_count,i.first_seen,i.last_seen,i.created_at,i.updated_at,i.embedding_updated_at,
               i.discord_thread_id,i.discord_status_channel_id,i.discord_status_message_id,i.community_summary,i.reproduction_steps,i.reported_locations,
               i.thread_last_activity_at,i.thread_summary_updated_at,
               COALESCE((
                 SELECT jsonb_agg(rj ORDER BY rj.created_at DESC)
                   FROM (
                     SELECT r.id,r.discord_user_id,r.report_text,r.source,r.created_at,
                            m.author_name,m.channel_name,m.channel_id,m.message_id,m.guild_id
                       FROM issue_reports r
                       LEFT JOIN discord_messages m ON m.id=r.discord_message_id
                      WHERE r.issue_id=i.id
                      ORDER BY r.created_at DESC
                      LIMIT 5
                   ) rj
               ), '[]'::jsonb) AS recent_reports,
               COALESCE((
                 SELECT jsonb_agg(oj ORDER BY CASE oj.status WHEN 'verified' THEN 1 WHEN 'community' THEN 2 ELSE 3 END, oj.confirmations DESC, oj.last_seen DESC)
                   FROM (
                     SELECT o.id,o.kind,o.value,o.status,o.confirmations,o.first_seen,o.last_seen
                       FROM issue_observations o
                      WHERE o.issue_id=i.id
                      ORDER BY CASE o.status WHEN 'verified' THEN 1 WHEN 'community' THEN 2 ELSE 3 END,o.confirmations DESC,o.last_seen DESC
                      LIMIT 80
                   ) oj
               ), '[]'::jsonb) AS observations,
               COALESCE((
                 SELECT jsonb_agg(uj ORDER BY uj.created_at DESC)
                   FROM (
                     SELECT u.id,u.update_type,u.from_value,u.to_value,u.note,u.created_by,u.created_at
                       FROM issue_updates u WHERE u.issue_id=i.id ORDER BY u.created_at DESC LIMIT 20
                   ) uj
               ), '[]'::jsonb) AS recent_updates,
               COALESCE((
                 SELECT jsonb_agg(tj ORDER BY tj.confidence DESC,tj.last_seen_at DESC)
                   FROM (
                     SELECT l.service_event_id,l.confidence,l.match_types,l.reason,l.linked_by,l.first_linked_at,
                            e.attention_kind,e.severity,e.resource_name,e.message,e.repeat_count,e.status,e.first_seen_at,e.last_seen_at
                       FROM issue_txadmin_links l
                       JOIN service_events e ON e.id=l.service_event_id
                      WHERE l.issue_id=i.id
                      ORDER BY l.confidence DESC,e.last_seen_at DESC
                      LIMIT 12
                   ) tj
               ), '[]'::jsonb) AS txadmin_matches
          FROM issues i
         ORDER BY CASE i.status WHEN 'investigating' THEN 1 WHEN 'fix_in_progress' THEN 2 WHEN 'testing' THEN 3 WHEN 'monitoring' THEN 4 WHEN 'new' THEN 5 WHEN 'acknowledged' THEN 6 WHEN 'resolved' THEN 7 ELSE 8 END,
                  CASE i.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,i.last_seen DESC
         LIMIT 300`);
      return result.rows.map(row => ({ ...row, discord_thread_url: row.discord_thread_id && env.DISCORD_GUILD_ID ? `https://discord.com/channels/${env.DISCORD_GUILD_ID}/${row.discord_thread_id}` : null }));
    });

    admin.get('/api/issues/candidates', async () => {
      const result = await db.query(`
        SELECT c.id,c.sample_text,c.normalized_text,c.topic,c.related_terms,c.discord_user_id,c.channel_id,c.occurrence_count,c.confirmed_count,c.source,
               c.status,c.matched_issue_id,c.first_seen,c.last_seen,c.created_at,c.updated_at,
               COALESCE((
                 SELECT jsonb_agg(ej ORDER BY ej.created_at DESC)
                   FROM (
                     SELECT e.id,e.discord_user_id,e.report_text,e.created_at,
                            m.author_name,m.channel_name,m.channel_id,m.message_id,m.guild_id
                       FROM issue_candidate_events e
                       LEFT JOIN discord_messages m ON m.id=e.discord_message_id
                      WHERE e.candidate_id=c.id
                      ORDER BY e.created_at DESC
                      LIMIT 6
                   ) ej
               ), '[]'::jsonb) AS recent_samples
          FROM issue_candidates c
         ORDER BY CASE c.status WHEN 'reported' THEN 1 WHEN 'detected' THEN 2 WHEN 'promoted' THEN 3 ELSE 4 END,
                  c.confirmed_count DESC,c.occurrence_count DESC,c.last_seen DESC
         LIMIT 300`);
      return result.rows;
    });

    admin.get('/api/issues/:id/reports', async (request) => {
      const params = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
      const result = await db.query(
        `SELECT r.id,r.discord_user_id,r.report_text,r.source,r.created_at,
                m.author_name,m.channel_name,m.channel_id,m.message_id,m.guild_id
           FROM issue_reports r
           LEFT JOIN discord_messages m ON m.id=r.discord_message_id
          WHERE r.issue_id=$1 ORDER BY r.created_at DESC LIMIT 200`,
        [params.id]
      );
      return result.rows;
    });

    admin.post('/api/issues', async (request, reply) => {
      const body = issueBody.parse(request.body);
      if (body.status !== 'new' && !(await requireAdditionalPermission(request, reply, 'issues.status'))) return;
      if (!(await assertIssueCategoryExists(body.category, reply))) return;
      const result = await db.query(
        `INSERT INTO issues
          (title,description,category,resource_name,severity,status,public_response,workaround,staff_notes,aliases,symptoms,log_patterns)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [body.title,body.description,body.category,body.resource_name || null,body.severity,body.status,
         body.public_response || null,body.workaround || null,body.staff_notes || null,
         [...new Set(body.aliases)],[...new Set(body.symptoms)],[...new Set(body.log_patterns)]]
      );
      const row = result.rows[0];
      const publicId = `BUG-${String(row.id).padStart(4, '0')}`;
      const updated = await db.query('UPDATE issues SET public_id=$1 WHERE id=$2 RETURNING *', [publicId,row.id]);
      await refreshIssueEmbedding(Number(row.id)).catch(error => request.log.warn({ error }, 'issue embedding refresh failed'));
      await correlateIssueWithTxAdmin(Number(row.id)).catch(error=>request.log.warn({error},'issue txAdmin correlation failed'));
      await ensureIssueDiscordThread(Number(row.id)).catch(error => request.log.warn({ error }, 'issue Discord ticket creation failed'));
      return reply.code(201).send((await db.query('SELECT * FROM issues WHERE id=$1',[row.id])).rows[0]);
    });

    admin.put('/api/issues/:id', async (request, reply) => {
      const params = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
      const body = issueBody.parse(request.body);
      if (!(await assertIssueCategoryExists(body.category, reply))) return;
      const before = await db.query('SELECT status,severity,public_response,workaround FROM issues WHERE id=$1', [params.id]);
      if (!before.rowCount) return reply.code(404).send({ error: 'issue not found' });
      if (before.rows[0].status !== body.status && !(await requireAdditionalPermission(request, reply, 'issues.status'))) return;
      const result = await db.query(
        `UPDATE issues SET title=$1,description=$2,category=$3,resource_name=$4,severity=$5,status=$6,
             public_response=$7,workaround=$8,staff_notes=$9,aliases=$10,symptoms=$11,log_patterns=$12,
             embedding=NULL,embedding_updated_at=NULL,updated_at=NOW()
          WHERE id=$13 RETURNING *`,
        [body.title,body.description,body.category,body.resource_name || null,body.severity,body.status,
         body.public_response || null,body.workaround || null,body.staff_notes || null,
         [...new Set(body.aliases)],[...new Set(body.symptoms)],[...new Set(body.log_patterns)],params.id]
      );
      if (!result.rowCount) return reply.code(404).send({ error: 'issue not found' });
      const previous = before.rows[0];
      const updates: Array<[string,string | null,string | null,string | null]> = [];
      if (previous.status !== body.status) updates.push(['status', previous.status, body.status, null]);
      if (previous.severity !== body.severity) updates.push(['severity', previous.severity, body.severity, null]);
      if ((previous.public_response || '') !== (body.public_response || '')) updates.push(['public_response', previous.public_response || null, body.public_response || null, 'Player-facing response updated.']);
      if ((previous.workaround || '') !== (body.workaround || '')) updates.push(['workaround', previous.workaround || null, body.workaround || null, 'Player workaround updated.']);
      for (const [type,fromValue,toValue,note] of updates) {
        await db.query('INSERT INTO issue_updates (issue_id,update_type,from_value,to_value,note,created_by) VALUES ($1,$2,$3,$4,$5,$6)',
          [params.id,type,fromValue,toValue,note,'dashboard']);
      }
      await refreshIssueEmbedding(params.id).catch(error => request.log.warn({ error }, 'issue embedding refresh failed'));
      await correlateIssueWithTxAdmin(params.id).catch(error=>request.log.warn({error},'issue txAdmin correlation failed'));
      if(previous.status==='resolved'&&body.status!=='resolved'){
        await applyIssueDiscordLifecycle(params.id,body.status).catch(error=>request.log.warn({error},'issue Discord discussion reopen failed'));
      }
      await ensureIssueDiscordThread(params.id).catch(error => request.log.warn({ error }, 'issue Discord ticket creation failed'));
      await syncIssueDiscordPost(params.id).catch(error => request.log.warn({ error }, 'issue Discord status sync failed'));
      if (previous.status !== body.status) {
        await postIssueStatusUpdate(params.id, String(previous.status), body.status).catch(error => request.log.warn({ error }, 'issue Discord status update post failed'));
        if(body.status==='resolved') await applyIssueDiscordLifecycle(params.id,body.status).catch(error=>request.log.warn({error},'resolved issue Discord lifecycle failed'));
      }
      return (await db.query('SELECT * FROM issues WHERE id=$1',[params.id])).rows[0];
    });

    admin.post('/api/issues/:id/discord-ticket', async (request, reply) => {
      const params = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
      const issue = await db.query('SELECT id FROM issues WHERE id=$1',[params.id]);
      if (!issue.rowCount) return reply.code(404).send({ error: 'issue not found' });
      try {
        const threadId = await ensureIssueDiscordThread(params.id);
        await syncIssueDiscordPost(params.id).catch(() => null);
        return { ok: true, thread_id: threadId };
      } catch (error) {
        return reply.code(400).send({ error: error instanceof Error ? error.message : 'unable to create Discord issue ticket' });
      }
    });

    admin.put('/api/issues/:id/observations/:observationId', async (request, reply) => {
      const params = z.object({ id: z.coerce.number().int().positive(), observationId: z.coerce.number().int().positive() }).parse(request.params);
      const body = z.object({ status: z.enum(['community','verified','rejected']) }).parse(request.body);
      const observation = await setIssueObservationStatus(params.id, params.observationId, body.status);
      if (!observation) return reply.code(404).send({ error: 'issue observation not found' });
      await syncIssueDiscordPost(params.id).catch(() => null);
      return observation;
    });

    admin.delete('/api/issues/:id', async (request, reply) => {
      const params = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
      const result = await db.query('DELETE FROM issues WHERE id=$1 RETURNING id,public_id,title', [params.id]);
      if (!result.rowCount) return reply.code(404).send({ error: 'issue not found' });
      return { ok: true, deleted: result.rows[0] };
    });

    admin.put('/api/issues/candidates/:id', async (request, reply) => {
      const params = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
      const body = z.object({ status: z.enum(['detected','reported','promoted','dismissed']) }).parse(request.body);
      const result = await db.query('UPDATE issue_candidates SET status=$1,updated_at=NOW() WHERE id=$2 RETURNING *', [body.status,params.id]);
      if (!result.rowCount) return reply.code(404).send({ error: 'issue candidate not found' });
      return result.rows[0];
    });

    admin.post('/api/issues/candidates/:id/link', async (request, reply) => {
      const params = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
      const body = z.object({ issue_id: z.coerce.number().int().positive() }).parse(request.body);
      try {
        const linked = await linkCandidateToIssue(params.id, body.issue_id);
        await ensureIssueDiscordThread(body.issue_id).catch(error => request.log.warn({ error }, 'issue Discord ticket creation failed'));
        await syncIssueDiscordPost(body.issue_id).catch(() => null);
        return linked;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unable to link issue candidate';
        if (message.includes('not found')) return reply.code(404).send({ error: message });
        if (message.includes('already linked')) return reply.code(409).send({ error: message });
        throw error;
      }
    });

    admin.post('/api/issues/candidates/:id/promote', async (request, reply) => {
      const params = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
      const body = z.object({
        title: z.string().trim().min(3).max(200).optional(),
        severity: issueSeverity.default('medium'),
        status: issueStatus.default('new'),
        resource_name: z.string().trim().max(160).optional(),
        category: slug.default('general')
      }).parse(request.body ?? {});
      if (body.status !== 'new' && !(await requireAdditionalPermission(request, reply, 'issues.status'))) return;
      if (!(await assertIssueCategoryExists(body.category, reply))) return;
      const candidate = await db.query('SELECT * FROM issue_candidates WHERE id=$1', [params.id]);
      if (!candidate.rowCount) return reply.code(404).send({ error: 'issue candidate not found' });
      const row = candidate.rows[0];
      if (row.matched_issue_id) return reply.code(409).send({ error: 'candidate was already promoted' });
      const title = (body.title || row.topic || row.sample_text).slice(0,200);
      const created = await db.query(
        `INSERT INTO issues (title,description,category,resource_name,severity,status,aliases,symptoms,report_count,first_seen,last_seen)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,$9,$10) RETURNING *`,
        [title,String(row.sample_text),body.category,body.resource_name || null,body.severity,body.status,row.related_terms || [],[String(row.sample_text)],
         row.first_seen,row.last_seen]
      );
      const issueId = Number(created.rows[0].id);
      const publicId = `BUG-${String(issueId).padStart(4,'0')}`;
      await db.query('UPDATE issues SET public_id=$1 WHERE id=$2',[publicId,issueId]);
      const linked = await linkCandidateToIssue(params.id, issueId);
      await ensureIssueDiscordThread(issueId).catch(error => request.log.warn({ error }, 'issue Discord ticket creation failed'));
      await syncIssueDiscordPost(issueId).catch(() => null);
      return reply.code(201).send(await db.query('SELECT * FROM issues WHERE id=$1',[issueId]).then(result => result.rows[0]));
    });
  });
}
