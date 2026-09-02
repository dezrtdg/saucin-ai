import { NextResponse } from 'next/server';
import { api, DashboardApiError } from '../../../../lib/api';

export const dynamic='force-dynamic';

function value(formData:FormData,key:string){return String(formData.get(key)||'').trim();}
function checked(formData:FormData,key:string){const raw=formData.get(key);return raw==='on'||raw==='true';}
function integer(formData:FormData,key:string,fallback=100){const number=Number(value(formData,key));return Number.isInteger(number)?number:fallback;}
function unique(formData:FormData,key:string){return [...new Set(formData.getAll(key).map(item=>String(item).trim()).filter(Boolean))];}
function slugify(input:string){return input.toLowerCase().trim().replace(/[^a-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,64);}
function resource(formData:FormData){return value(formData,'_resource');}

async function call<T=unknown>(path:string,init:RequestInit){
  return api<T>(path,{...init,signal:AbortSignal.timeout(10000)});
}

export async function POST(request:Request){
  try{
    const formData=await request.formData();
    const operation=value(formData,'_operation');
    const id=resource(formData);

    switch(operation){
      case 'bot.update': {
        const count=Number(value(formData,'direct_mentions_context_messages')||8);
        await call('/api/bot/settings',{method:'PUT',body:JSON.stringify({
          direct_mentions_enabled:checked(formData,'direct_mentions_enabled'),
          direct_mentions_bypass_channel_mode:checked(formData,'direct_mentions_bypass_channel_mode'),
          direct_mentions_use_reply_context:checked(formData,'direct_mentions_use_reply_context'),
          direct_mentions_use_recent_context:checked(formData,'direct_mentions_use_recent_context'),
          direct_mentions_context_messages:Number.isInteger(count)?Math.max(0,Math.min(25,count)):8
        })});
        break;
      }

      case 'issues.automation.update':
        await call('/api/issues/automation',{method:'PUT',body:JSON.stringify({
          intake_channel_id:value(formData,'intake_channel_id')||null,
          auto_create_threads:checked(formData,'auto_create_threads'),
          allow_player_details:checked(formData,'allow_player_details'),
          auto_summarize_thread:checked(formData,'auto_summarize_thread'),
          auto_update_symptoms:checked(formData,'auto_update_symptoms'),
          auto_collect_workarounds:checked(formData,'auto_collect_workarounds'),
          auto_collect_reproduction:checked(formData,'auto_collect_reproduction'),
          auto_collect_locations:checked(formData,'auto_collect_locations'),
          edit_original_status_message:checked(formData,'edit_original_status_message'),
          post_status_updates_to_thread:checked(formData,'post_status_updates_to_thread'),
          auto_public_response:checked(formData,'auto_public_response'),
          include_bug_id:checked(formData,'include_bug_id'),
          include_workaround:checked(formData,'include_workaround'),
          include_affected_count:checked(formData,'include_affected_count')
        })});
        break;

      case 'suggestions.automation.update':
        await call('/api/suggestions/settings',{method:'PUT',body:JSON.stringify({
          forum_channel_id:value(formData,'forum_channel_id')||null,
          forum_tag_id:value(formData,'forum_tag_id')||null,
          auto_create_forum_posts:checked(formData,'auto_create_forum_posts'),
          collect_thread_details:checked(formData,'collect_thread_details'),
          ai_summarize_thread:checked(formData,'ai_summarize_thread'),
          edit_original_status_message:checked(formData,'edit_original_status_message'),
          post_status_updates_to_thread:checked(formData,'post_status_updates_to_thread'),
          include_suggestion_id:checked(formData,'include_suggestion_id'),
          include_support_count:checked(formData,'include_support_count')
        })});
        break;

      case 'tickets.settings.update':
        await call('/api/tickets/settings',{method:'PUT',body:JSON.stringify({
          enabled:checked(formData,'enabled'),panel_channel_id:value(formData,'panel_channel_id')||null,
          open_category_id:value(formData,'open_category_id')||null,closed_category_id:value(formData,'closed_category_id')||null,
          transcript_channel_id:value(formData,'transcript_channel_id')||null,
          max_open_per_user:Math.max(1,Math.min(10,integer(formData,'max_open_per_user',2))),
          allow_user_close:checked(formData,'allow_user_close'),
          warning_role_ids:unique(formData,'warning_role_ids'),timeout_role_ids:unique(formData,'timeout_role_ids'),
          kick_role_ids:unique(formData,'kick_role_ids'),ban_role_ids:unique(formData,'ban_role_ids'),
          reversal_role_ids:unique(formData,'reversal_role_ids')
        })});
        break;

      case 'tickets.type.update':
        if(!id) return NextResponse.json({error:'Missing ticket type.'},{status:400});
        await call(`/api/tickets/types/${encodeURIComponent(id)}`,{method:'PUT',body:JSON.stringify({
          label:value(formData,'label'),description:value(formData,'description'),emoji:value(formData,'emoji')||null,
          intake_prompt:value(formData,'intake_prompt'),support_role_ids:unique(formData,'support_role_ids'),
          category_override_id:value(formData,'category_override_id')||null,
          allow_punishments:checked(formData,'allow_punishments'),enabled:checked(formData,'enabled'),
          sort_order:integer(formData,'sort_order',100)
        })});
        break;

      case 'tickets.panel.publish':
        await call('/api/tickets/panel',{method:'POST',body:JSON.stringify({})});
        break;

      case 'issues.template.update':
        if(!id) return NextResponse.json({error:'Missing issue status.'},{status:400});
        await call(`/api/issues/templates/${encodeURIComponent(id)}`,{method:'PUT',body:JSON.stringify({
          template:value(formData,'template'),enabled:checked(formData,'enabled')
        })});
        break;

      case 'issues.category.create':
        await call('/api/issues/categories',{method:'POST',body:JSON.stringify({
          key:value(formData,'key'),label:value(formData,'label'),description:value(formData,'description'),
          sort_order:integer(formData,'sort_order'),enabled:checked(formData,'enabled')
        })});
        break;

      case 'issues.category.update':
        if(!id) return NextResponse.json({error:'Missing issue category.'},{status:400});
        await call(`/api/issues/categories/${encodeURIComponent(id)}`,{method:'PUT',body:JSON.stringify({
          label:value(formData,'label'),description:value(formData,'description'),sort_order:integer(formData,'sort_order'),enabled:checked(formData,'enabled')
        })});
        break;

      case 'issues.category.delete':
        if(!id) return NextResponse.json({error:'Missing issue category.'},{status:400});
        await call(`/api/issues/categories/${encodeURIComponent(id)}`,{method:'DELETE'});
        break;

      case 'knowledge.contentType.create': {
        const label=value(formData,'label');
        const key=slugify(value(formData,'key')||label);
        if(!label||!key) return NextResponse.json({error:'Content type name is required.'},{status:400});
        await call('/api/knowledge/content-types',{method:'POST',body:JSON.stringify({
          key,label,description:value(formData,'description'),moderation_eligible:checked(formData,'moderation_eligible'),sort_order:integer(formData,'sort_order'),enabled:true
        })});
        break;
      }

      case 'knowledge.contentType.update':
        if(!id) return NextResponse.json({error:'Missing content type.'},{status:400});
        await call(`/api/knowledge/content-types/${encodeURIComponent(id)}`,{method:'PUT',body:JSON.stringify({
          label:value(formData,'label'),description:value(formData,'description'),moderation_eligible:checked(formData,'moderation_eligible'),sort_order:integer(formData,'sort_order'),enabled:checked(formData,'enabled')
        })});
        break;

      case 'knowledge.contentType.delete':
        if(!id) return NextResponse.json({error:'Missing content type.'},{status:400});
        await call(`/api/knowledge/content-types/${encodeURIComponent(id)}`,{method:'DELETE'});
        break;

      case 'knowledge.category.create': {
        const label=value(formData,'label');
        const key=slugify(value(formData,'key')||label);
        if(!label||!key) return NextResponse.json({error:'Category name is required.'},{status:400});
        await call('/api/knowledge/categories',{method:'POST',body:JSON.stringify({
          key,label,description:value(formData,'description'),sort_order:integer(formData,'sort_order'),enabled:true
        })});
        break;
      }

      case 'knowledge.category.update':
        if(!id) return NextResponse.json({error:'Missing knowledge category.'},{status:400});
        await call(`/api/knowledge/categories/${encodeURIComponent(id)}`,{method:'PUT',body:JSON.stringify({
          label:value(formData,'label'),description:value(formData,'description'),sort_order:integer(formData,'sort_order'),enabled:checked(formData,'enabled')
        })});
        break;

      case 'knowledge.category.delete':
        if(!id) return NextResponse.json({error:'Missing knowledge category.'},{status:400});
        await call(`/api/knowledge/categories/${encodeURIComponent(id)}`,{method:'DELETE'});
        break;

      case 'knowledge.audience.create': {
        const label=value(formData,'label');
        const key=slugify(value(formData,'key')||label);
        if(!label||!key) return NextResponse.json({error:'Audience name is required.'},{status:400});
        await call('/api/knowledge/audiences',{method:'POST',body:JSON.stringify({
          key,label,description:value(formData,'description'),public_access:checked(formData,'public_access'),sort_order:integer(formData,'sort_order'),enabled:true
        })});
        break;
      }

      case 'knowledge.audience.update':
        if(!id) return NextResponse.json({error:'Missing knowledge audience.'},{status:400});
        await call(`/api/knowledge/audiences/${encodeURIComponent(id)}`,{method:'PUT',body:JSON.stringify({
          label:value(formData,'label'),description:value(formData,'description'),public_access:checked(formData,'public_access'),sort_order:integer(formData,'sort_order'),enabled:checked(formData,'enabled')
        })});
        await call(`/api/knowledge/audiences/${encodeURIComponent(id)}/roles`,{method:'PUT',body:JSON.stringify({role_ids:unique(formData,'role_ids')})});
        break;

      case 'knowledge.audience.delete':
        if(!id) return NextResponse.json({error:'Missing knowledge audience.'},{status:400});
        await call(`/api/knowledge/audiences/${encodeURIComponent(id)}`,{method:'DELETE'});
        break;

      case 'permissions.role.update':
        if(!id) return NextResponse.json({error:'Missing Discord role.'},{status:400});
        await call(`/api/permissions/roles/${encodeURIComponent(id)}`,{method:'PUT',body:JSON.stringify({permissions:unique(formData,'permissions')})});
        break;

      case 'moderation.global.update': {
        const desired=value(formData,'mode')||'off';
        if(!['off','observe','live'].includes(desired)) return NextResponse.json({error:'Invalid moderation mode.'},{status:400});
        const baseMode=desired==='off'?'off':'observe';
        await call('/api/moderation/settings',{method:'PUT',body:JSON.stringify({
          mode:baseMode,
          minimum_confidence:Number(value(formData,'minimum_confidence')||.9),
          repeat_window_days:Number(value(formData,'repeat_window_days')||7),
          audit_channel_id:value(formData,'audit_channel_id')||null,
          post_observations_to_audit:desired==='live'?false:checked(formData,'post_observations_to_audit'),
          exempt_role_ids:unique(formData,'exempt_role_ids'),
          diagnostics_enabled:checked(formData,'diagnostics_enabled')
        })});
        await call('/api/moderation/live',{method:'PUT',body:JSON.stringify({mode:desired})});
        break;
      }

      case 'moderation.diagnostics.clear':
        await call('/api/moderation/diagnostics',{method:'DELETE'});
        break;

      default:
        return NextResponse.json({error:'Unsupported settings action.'},{status:400});
    }

    return NextResponse.json({ok:true});
  }catch(error){
    if(error instanceof DashboardApiError){
      return NextResponse.json({error:error.message},{status:error.status>=400&&error.status<600?error.status:500});
    }
    const name=error instanceof Error?error.name:'';
    if(name==='TimeoutError'||name==='AbortError') return NextResponse.json({error:'The internal API did not respond within 10 seconds.'},{status:504});
    return NextResponse.json({error:error instanceof Error?error.message:'Unable to complete settings action.'},{status:500});
  }
}
