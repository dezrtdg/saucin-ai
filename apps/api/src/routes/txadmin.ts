import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance,FastifyReply,FastifyRequest } from 'fastify';
import { z } from 'zod';
import { env } from '../env.js';
import { ingestTxAdminBatch } from '../services/txadmin.js';

const eventBody=z.object({
  occurred_at:z.string().datetime({offset:true}),
  severity:z.enum(['info','warning','error','critical']),
  event_type:z.string().trim().min(1).max(80).regex(/^[a-z0-9][a-z0-9_.-]*$/),
  category:z.string().trim().min(1).max(80).regex(/^[a-z0-9][a-z0-9_.-]*$/),
  resource_name:z.string().trim().max(160).nullable().optional(),
  message:z.string().trim().min(1).max(12000),
  fingerprint:z.string().trim().max(128).nullable().optional(),
  source_file:z.string().trim().max(1000).nullable().optional(),
  line_number:z.coerce.number().int().positive().nullable().optional(),
  metadata:z.record(z.string(),z.unknown()).optional().default({})
});

const ingestBody=z.object({
  collector_id:z.string().trim().min(3).max(120).regex(/^[a-zA-Z0-9_.-]+$/),
  server_name:z.string().trim().min(1).max(160),
  hostname:z.string().trim().min(1).max(160),
  txdata_path:z.string().trim().min(1).max(1000),
  collector_version:z.string().trim().min(1).max(40),
  heartbeat_at:z.string().datetime({offset:true}),
  metadata:z.record(z.string(),z.unknown()).optional().default({}),
  events:z.array(eventBody).max(100).default([])
});

function sameSecret(provided:string,expected:string){
  const left=Buffer.from(provided);const right=Buffer.from(expected);
  return left.length===right.length&&timingSafeEqual(left,right);
}

async function requireCollectorToken(request:FastifyRequest,reply:FastifyReply){
  if(!env.TXADMIN_COLLECTOR_TOKEN)return reply.code(503).send({error:'txAdmin collector is not configured'});
  const header=String(request.headers.authorization||'');
  const provided=header.startsWith('Bearer ')?header.slice(7).trim():'';
  if(!provided||!sameSecret(provided,env.TXADMIN_COLLECTOR_TOKEN))return reply.code(401).send({error:'unauthorized collector'});
}

export async function txAdminRoutes(app:FastifyInstance){
  app.register(async ingest=>{
    ingest.addHook('onRequest',requireCollectorToken);
    ingest.post('/api/txadmin/ingest',async(request,reply)=>{
      const parsed=ingestBody.safeParse(request.body);
      if(!parsed.success){
        request.log.warn({issues:parsed.error.issues},'txAdmin collector payload rejected');
        return reply.code(400).send({error:'invalid collector payload',issues:parsed.error.issues.slice(0,5)});
      }
      return ingestTxAdminBatch(parsed.data);
    });
  });
}
