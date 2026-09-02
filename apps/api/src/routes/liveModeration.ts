import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { env } from '../env.js';
import { parseDashboardIdentity, permissionSnapshot } from '../services/permissions.js';
import { getLiveModerationState, setLiveModerationMode, type EffectiveModerationMode } from '../services/liveModeration.js';

async function dashboardAccess(request: FastifyRequest) {
  if (request.headers['x-dashboard-owner-allowlisted'] === '1') {
    return { authorized:true,permissions:['moderation.view','moderation.configure','moderation.actions'] };
  }
  const identity = parseDashboardIdentity(request.headers as Record<string,unknown>);
  return permissionSnapshot(identity.userId,identity.roleIds);
}

async function requirePermission(request: FastifyRequest, reply: FastifyReply, permission: string) {
  if (request.headers['x-api-key'] !== env.DASHBOARD_API_KEY) {
    reply.code(401).send({error:'unauthorized'});
    return false;
  }
  const access = await dashboardAccess(request);
  if (!access.authorized || !access.permissions.includes(permission)) {
    reply.code(403).send({error:'permission denied',required:[permission]});
    return false;
  }
  return true;
}

export async function liveModerationRoutes(app: FastifyInstance) {
  app.get('/api/moderation/live',async (request,reply) => {
    if (!await requirePermission(request,reply,'moderation.view')) return;
    return getLiveModerationState();
  });

  app.put('/api/moderation/live',async (request,reply) => {
    if (!await requirePermission(request,reply,'moderation.configure')) return;
    const body = z.object({mode:z.enum(['off','observe','live'])}).parse(request.body);

    if (body.mode === 'live' && !await requirePermission(request,reply,'moderation.actions')) return;

    try {
      return await setLiveModerationMode(body.mode as EffectiveModerationMode);
    } catch (error) {
      return reply.code(400).send({error:error instanceof Error ? error.message : 'unable to change live moderation mode'});
    }
  });
}
