import type { FastifyInstance,FastifyReply,FastifyRequest } from 'fastify';
import { z } from 'zod';
import { env } from '../env.js';
import { parseDashboardIdentity,permissionSnapshot } from '../services/permissions.js';
import { createManualSuggestion,getSuggestion,listSuggestions,updateSuggestion } from '../services/suggestions.js';

async function access(request:FastifyRequest){
  if(request.headers['x-dashboard-owner-allowlisted']==='1') return {authorized:true,permissions:['suggestions.view','suggestions.manage']};
  const identity=parseDashboardIdentity(request.headers as Record<string,unknown>);
  return permissionSnapshot(identity.userId,identity.roleIds);
}

async function requirePermission(request:FastifyRequest,reply:FastifyReply,permission:string){
  if(request.headers['x-api-key']!==env.DASHBOARD_API_KEY){reply.code(401).send({error:'unauthorized'});return false;}
  const current=await access(request);
  if(!current.authorized||!current.permissions.includes(permission)){
    reply.code(403).send({error:'permission denied',required:[permission]});
    return false;
  }
  return true;
}

const status=z.enum(['candidate','reviewing','planned','accepted','declined','shipped']);

export async function suggestionRoutes(app:FastifyInstance){
  app.get('/api/suggestions',async(request,reply)=>{
    if(!await requirePermission(request,reply,'suggestions.view')) return;
    const query=z.object({status:status.optional(),limit:z.coerce.number().int().min(1).max(500).optional()}).parse(request.query||{});
    return {suggestions:await listSuggestions({status:query.status,limit:query.limit})};
  });

  app.get('/api/suggestions/:id',async(request,reply)=>{
    if(!await requirePermission(request,reply,'suggestions.view')) return;
    const params=z.object({id:z.coerce.number().int().positive()}).parse(request.params);
    const suggestion=await getSuggestion(params.id);
    if(!suggestion) return reply.code(404).send({error:'suggestion not found'});
    return suggestion;
  });

  app.post('/api/suggestions',async(request,reply)=>{
    if(!await requirePermission(request,reply,'suggestions.manage')) return;
    const body=z.object({
      title:z.string().trim().min(3).max(180),
      summary:z.string().trim().min(3).max(6000),
      category:z.string().trim().max(100).optional(),
      staff_notes:z.string().trim().max(6000).optional()
    }).parse(request.body);
    const suggestion=await createManualSuggestion(body);
    return reply.code(201).send(suggestion);
  });

  app.put('/api/suggestions/:id',async(request,reply)=>{
    if(!await requirePermission(request,reply,'suggestions.manage')) return;
    const params=z.object({id:z.coerce.number().int().positive()}).parse(request.params);
    const body=z.object({
      title:z.string().trim().min(3).max(180),
      summary:z.string().trim().min(3).max(6000),
      category:z.string().trim().min(1).max(100).default('general'),
      status,
      staff_notes:z.string().trim().max(6000).default('')
    }).parse(request.body);
    const suggestion=await updateSuggestion(params.id,body);
    if(!suggestion) return reply.code(404).send({error:'suggestion not found'});
    return suggestion;
  });
}
