import type { FastifyInstance,FastifyReply,FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db } from '../db.js';
import { env } from '../env.js';
import { allPermissionKeys,parseDashboardIdentity,permissionSnapshot } from '../services/permissions.js';
import { getIssueResolutionData,issueResolutionAutoEnabled,runIssueResolutionLoop,setIssueResolutionGapReview } from '../services/resolutionLoop.js';

async function access(request:FastifyRequest){
  if(request.headers['x-dashboard-owner-allowlisted']==='1')return {authorized:true,permissions:[...allPermissionKeys]};
  const identity=parseDashboardIdentity(request.headers as Record<string,unknown>);
  return permissionSnapshot(identity.userId,identity.roleIds);
}

async function requirePermissions(request:FastifyRequest,reply:FastifyReply,permissions:string[]){
  if(request.headers['x-api-key']!==env.DASHBOARD_API_KEY){reply.code(401).send({error:'unauthorized'});return false;}
  const current=await access(request);
  const missing=permissions.filter(permission=>!current.permissions.includes(permission));
  if(!current.authorized||missing.length){reply.code(403).send({error:'permission denied',required:missing.length?missing:permissions});return false;}
  return true;
}

function actorId(request:FastifyRequest){
  return parseDashboardIdentity(request.headers as Record<string,unknown>).userId||null;
}

export async function resolutionRoutes(app:FastifyInstance){
  app.get('/api/issues/:id/resolution-loop',async(request,reply)=>{
    if(!await requirePermissions(request,reply,['issues.view']))return;
    const params=z.object({id:z.coerce.number().int().positive()}).parse(request.params);
    const data=await getIssueResolutionData(params.id);
    if(!data)return reply.code(404).send({error:'issue not found'});
    return data;
  });

  app.put('/api/issues/:id/resolution',async(request,reply)=>{
    if(!await requirePermissions(request,reply,['issues.edit']))return;
    const params=z.object({id:z.coerce.number().int().positive()}).parse(request.params);
    const body=z.object({resolution_summary:z.string().trim().max(8000).default('')}).parse(request.body||{});
    const before=await db.query('SELECT status,resolution_summary,workaround,public_response FROM issues WHERE id=$1',[params.id]);
    if(!before.rowCount)return reply.code(404).send({error:'issue not found'});
    await db.query(`UPDATE issues SET resolution_summary=NULLIF($1,''),resolved_at=CASE WHEN status='resolved' THEN COALESCE(resolved_at,NOW()) ELSE resolved_at END,
      updated_at=CASE WHEN COALESCE(resolution_summary,'') IS DISTINCT FROM $1 THEN NOW() ELSE updated_at END WHERE id=$2`,[body.resolution_summary,params.id]);
    if(String(before.rows[0].resolution_summary||'')!==body.resolution_summary){
      await db.query(`INSERT INTO issue_updates(issue_id,update_type,from_value,to_value,note,created_by)
        VALUES ($1,'resolution',$2,$3,'Confirmed resolution updated.','dashboard')`,[params.id,before.rows[0].resolution_summary||null,body.resolution_summary||null]);
    }
    const hasResolution=Boolean(body.resolution_summary||before.rows[0].workaround||before.rows[0].public_response);
    if(before.rows[0].status==='resolved'&&hasResolution&&await issueResolutionAutoEnabled()){
      await runIssueResolutionLoop(params.id,actorId(request)).catch(error=>request.log.warn({error},'automatic issue resolution loop failed'));
    }
    return getIssueResolutionData(params.id);
  });

  app.post('/api/issues/:id/resolution-loop',async(request,reply)=>{
    if(!await requirePermissions(request,reply,['issues.edit','knowledge.create']))return;
    const params=z.object({id:z.coerce.number().int().positive()}).parse(request.params);
    try{return await runIssueResolutionLoop(params.id,actorId(request));}
    catch(error){return reply.code(400).send({error:error instanceof Error?error.message:'Unable to build resolution knowledge.'});}
  });

  app.put('/api/issues/:id/resolution-gaps/:gapId',async(request,reply)=>{
    if(!await requirePermissions(request,reply,['issues.edit','knowledge.gaps.manage']))return;
    const params=z.object({id:z.coerce.number().int().positive(),gapId:z.coerce.number().int().positive()}).parse(request.params);
    const body=z.object({status:z.enum(['linked','dismissed'])}).parse(request.body);
    try{return await setIssueResolutionGapReview({issueId:params.id,gapId:params.gapId,status:body.status,actorUserId:actorId(request)});}
    catch(error){return reply.code(400).send({error:error instanceof Error?error.message:'Unable to review the knowledge-gap match.'});}
  });
}
