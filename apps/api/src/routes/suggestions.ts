import type { FastifyInstance,FastifyReply,FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db } from '../db.js';
import { env } from '../env.js';
import {
  deleteSuggestionDiscordPost,
  ensureSuggestionDiscordThread,
  getCachedDiscordChannelMetadata,
  getCachedDiscordForumTags,
  postSuggestionStaffUpdate,
  postSuggestionStatusUpdate,
  syncSuggestionDiscordPost
} from '../discord/client.js';
import { allPermissionKeys,parseDashboardIdentity,permissionSnapshot } from '../services/permissions.js';
import {
  buildSuggestionDraft,
  buildSuggestionStaffReply,
  createManualSuggestion,
  getSuggestion,
  listSuggestions,
  updateSuggestion
} from '../services/suggestions.js';

async function access(request:FastifyRequest){
  if(request.headers['x-dashboard-owner-allowlisted']==='1'){
    return {authorized:true,permissions:[...allPermissionKeys]};
  }
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

function actorId(request:FastifyRequest){
  return parseDashboardIdentity(request.headers as Record<string,unknown>).userId||null;
}

function actorLabel(request:FastifyRequest){
  const id=actorId(request);
  const displayName=typeof request.headers['x-dashboard-display-name']==='string'
    ? request.headers['x-dashboard-display-name'].trim().slice(0,100)
    : '';
  return displayName?(id?`${displayName} (${id})`:displayName):id;
}

const status=z.enum(['candidate','reviewing','planned','accepted','testing','declined','shipped']);
const suggestionBody=z.object({
  title:z.string().trim().min(3).max(180),
  summary:z.string().trim().min(3).max(6000),
  category:z.string().trim().max(100).optional(),
  staff_notes:z.string().trim().max(6000).optional(),
  related_terms:z.array(z.string().trim().min(1).max(160)).max(40).optional(),
  source_text:z.string().trim().max(18000).optional()
});

export async function suggestionRoutes(app:FastifyInstance){
  app.get('/api/suggestions',async(request,reply)=>{
    if(!await requirePermission(request,reply,'suggestions.view')) return;
    const query=z.object({status:status.optional(),limit:z.coerce.number().int().min(1).max(500).optional()}).parse(request.query||{});
    return {suggestions:await listSuggestions({status:query.status,limit:query.limit})};
  });

  app.get('/api/suggestions/settings',async(request,reply)=>{
    if(!await requirePermission(request,reply,'settings.suggestions.manage')) return;
    const [automation,channelRows]=await Promise.all([
      db.query('SELECT * FROM suggestion_automation_settings WHERE id=1'),
      db.query('SELECT discord_channel_id,channel_name FROM channel_policies ORDER BY lower(coalesce(channel_name,discord_channel_id))')
    ]);
    const channels=channelRows.rows.map(row=>{
      const metadata=getCachedDiscordChannelMetadata(String(row.discord_channel_id));
      return {
        id:String(row.discord_channel_id),
        name:metadata?.name||row.channel_name||String(row.discord_channel_id),
        type:metadata?.type||'Unknown',
        category_name:metadata?.category_name||null,
        is_thread:metadata?.is_thread||false,
        tags:getCachedDiscordForumTags(String(row.discord_channel_id))
      };
    }).filter(row=>!row.is_thread&&['Forum','Media'].includes(row.type));
    return {automation:automation.rows[0]||null,channels};
  });

  app.put('/api/suggestions/settings',async(request,reply)=>{
    if(!await requirePermission(request,reply,'settings.suggestions.manage')) return;
    const body=z.object({
      forum_channel_id:z.string().trim().max(32).nullable().optional(),
      forum_tag_id:z.string().trim().max(32).nullable().optional(),
      auto_create_forum_posts:z.boolean(),
      collect_thread_details:z.boolean(),
      ai_summarize_thread:z.boolean(),
      edit_original_status_message:z.boolean(),
      post_status_updates_to_thread:z.boolean(),
      include_suggestion_id:z.boolean(),
      include_support_count:z.boolean()
    }).parse(request.body);
    const result=await db.query(`
      UPDATE suggestion_automation_settings
         SET forum_channel_id=$1,forum_tag_id=$2,auto_create_forum_posts=$3,collect_thread_details=$4,
             ai_summarize_thread=$5,edit_original_status_message=$6,
             post_status_updates_to_thread=$7,include_suggestion_id=$8,
             include_support_count=$9,updated_at=NOW()
       WHERE id=1 RETURNING *`,[
      body.forum_channel_id||null,body.forum_tag_id||null,
      body.auto_create_forum_posts,body.collect_thread_details,
      body.ai_summarize_thread,body.edit_original_status_message,
      body.post_status_updates_to_thread,body.include_suggestion_id,body.include_support_count
    ]);
    return result.rows[0];
  });

  app.post('/api/suggestions/ai-build',async(request,reply)=>{
    if(!await requirePermission(request,reply,'suggestions.ai')) return;
    const body=z.object({source_text:z.string().trim().min(8).max(18000)}).parse(request.body);
    try{return await buildSuggestionDraft({sourceText:body.source_text});}
    catch(error){
      request.log.warn({error},'AI suggestion authoring failed');
      return reply.code(503).send({error:error instanceof Error?error.message:'AI suggestion authoring failed'});
    }
  });

  app.post('/api/suggestions/:id/ai-expand',async(request,reply)=>{
    if(!await requirePermission(request,reply,'suggestions.ai')) return;
    const params=z.object({id:z.coerce.number().int().positive()}).parse(request.params);
    const body=z.object({additional_context:z.string().trim().max(12000).optional()}).parse(request.body||{});
    const suggestion=await getSuggestion(params.id);
    if(!suggestion) return reply.code(404).send({error:'suggestion not found'});
    const source=[
      ...(suggestion.events||[]).map((event:any)=>String(event.suggestion_text||'')),
      String(suggestion.community_context||''),
      String(body.additional_context||'')
    ].filter(Boolean).join('\n\n---\n\n').slice(0,18000);
    try{
      return await buildSuggestionDraft({
        sourceText:source||String(suggestion.summary),
        existingTitle:String(suggestion.title),
        existingSummary:String(suggestion.summary),
        existingCategory:String(suggestion.category),
        existingRelatedTerms:suggestion.related_terms||[]
      });
    }catch(error){
      request.log.warn({error},'AI suggestion expansion failed');
      return reply.code(503).send({error:error instanceof Error?error.message:'AI suggestion expansion failed'});
    }
  });

  app.post('/api/suggestions',async(request,reply)=>{
    if(!await requirePermission(request,reply,'suggestions.manage')) return;
    const body=suggestionBody.parse(request.body);
    const suggestion=await createManualSuggestion(body);
    await ensureSuggestionDiscordThread(Number(suggestion.id)).catch(error=>request.log.warn({error},'suggestion forum creation failed'));
    return reply.code(201).send(await getSuggestion(Number(suggestion.id)));
  });

  app.post('/api/suggestions/:id/discord-post',async(request,reply)=>{
    if(!await requirePermission(request,reply,'suggestions.forum')) return;
    const params=z.object({id:z.coerce.number().int().positive()}).parse(request.params);
    const suggestion=await getSuggestion(params.id);
    if(!suggestion) return reply.code(404).send({error:'suggestion not found'});
    try{
      const threadId=await ensureSuggestionDiscordThread(params.id);
      if(!threadId) return reply.code(409).send({error:'Configure and enable a Suggestions forum in Settings first.'});
      await syncSuggestionDiscordPost(params.id);
      return {ok:true,thread_id:threadId};
    }catch(error){
      return reply.code(400).send({error:error instanceof Error?error.message:'unable to create suggestion forum post'});
    }
  });

  app.get('/api/suggestions/:id',async(request,reply)=>{
    if(!await requirePermission(request,reply,'suggestions.view')) return;
    const params=z.object({id:z.coerce.number().int().positive()}).parse(request.params);
    const suggestion=await getSuggestion(params.id);
    if(!suggestion) return reply.code(404).send({error:'suggestion not found'});
    return suggestion;
  });

  app.post('/api/suggestions/:id/reply/ai-draft',async(request,reply)=>{
    if(!await requirePermission(request,reply,'suggestions.ai')) return;
    const params=z.object({id:z.coerce.number().int().positive()}).parse(request.params);
    const body=z.object({draft:z.string().trim().min(3).max(4000)}).parse(request.body);
    try{
      return {reply:await buildSuggestionStaffReply({suggestionId:params.id,staffDraft:body.draft})};
    }catch(error){
      request.log.warn({error},'suggestion staff reply drafting failed');
      const message=error instanceof Error?error.message:'Unable to draft the suggestion update.';
      return reply.code(message==='Suggestion not found.'?404:503).send({error:message});
    }
  });

  app.post('/api/suggestions/:id/reply',async(request,reply)=>{
    if(!await requirePermission(request,reply,'suggestions.forum')) return;
    const params=z.object({id:z.coerce.number().int().positive()}).parse(request.params);
    const body=z.object({content:z.string().trim().min(1).max(1700)}).parse(request.body);
    try{
      return await postSuggestionStaffUpdate(params.id,body.content,actorLabel(request));
    }catch(error){
      const message=error instanceof Error?error.message:'Unable to post the suggestion update.';
      return reply.code(message==='Suggestion not found.'?404:409).send({error:message});
    }
  });

  app.delete('/api/suggestions/:id',async(request,reply)=>{
    if(!await requirePermission(request,reply,'suggestions.delete')) return;
    const params=z.object({id:z.coerce.number().int().positive()}).parse(request.params);
    const suggestion=await getSuggestion(params.id);
    if(!suggestion) return reply.code(404).send({error:'suggestion not found'});
    try{
      await deleteSuggestionDiscordPost(params.id);
    }catch(error){
      return reply.code(409).send({error:error instanceof Error?error.message:'Unable to delete the linked Discord post.'});
    }
    const deleted=await db.query('DELETE FROM suggestions WHERE id=$1 RETURNING id,public_id,title',[params.id]);
    return {ok:true,deleted:deleted.rows[0]};
  });

  app.put('/api/suggestions/:id',async(request,reply)=>{
    if(!await requirePermission(request,reply,'suggestions.manage')) return;
    const params=z.object({id:z.coerce.number().int().positive()}).parse(request.params);
    const body=suggestionBody.extend({
      category:z.string().trim().min(1).max(100).default('general'),
      status
    }).omit({source_text:true}).parse(request.body);
    const before=await getSuggestion(params.id);
    if(!before) return reply.code(404).send({error:'suggestion not found'});
    const suggestion=await updateSuggestion(params.id,{...body,staff_notes:body.staff_notes||'',changed_by:actorLabel(request)});
    if(!suggestion) return reply.code(404).send({error:'suggestion not found'});
    await ensureSuggestionDiscordThread(params.id).catch(error=>request.log.warn({error},'suggestion forum creation failed'));
    await syncSuggestionDiscordPost(params.id).catch(error=>request.log.warn({error},'suggestion forum synchronization failed'));
    if(String(before.status)!==String(suggestion.status)){
      await postSuggestionStatusUpdate(params.id,String(before.status),String(suggestion.status))
        .catch(error=>request.log.warn({error},'suggestion status post failed'));
    }
    return getSuggestion(params.id);
  });
}
