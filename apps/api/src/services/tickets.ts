import { db } from '../db.js';

export type TicketStatus = 'creating'|'open'|'claimed'|'awaiting_user'|'closed'|'failed';
export type TicketPunishmentAction = 'warning'|'timeout'|'kick'|'temporary_ban'|'permanent_ban';

export type TicketSettings = {
  enabled:boolean;
  panel_channel_id:string|null;
  panel_message_id:string|null;
  open_category_id:string|null;
  closed_category_id:string|null;
  transcript_channel_id:string|null;
  max_open_per_user:number;
  allow_user_close:boolean;
  warning_role_ids:string[];
  timeout_role_ids:string[];
  kick_role_ids:string[];
  ban_role_ids:string[];
  reversal_role_ids:string[];
};

export type TicketType = {
  key:string;
  label:string;
  description:string;
  emoji:string|null;
  intake_prompt:string;
  support_role_ids:string[];
  category_override_id:string|null;
  allow_punishments:boolean;
  enabled:boolean;
  sort_order:number;
};

function unique(values:string[],max=100){
  return [...new Set(values.map(value=>String(value).trim()).filter(Boolean))].slice(0,max);
}

export async function getTicketSettings():Promise<TicketSettings>{
  const result=await db.query('SELECT * FROM ticket_settings WHERE id=1');
  const row=result.rows[0]||{};
  return {
    enabled:row.enabled!==false,
    panel_channel_id:row.panel_channel_id?String(row.panel_channel_id):null,
    panel_message_id:row.panel_message_id?String(row.panel_message_id):null,
    open_category_id:row.open_category_id?String(row.open_category_id):null,
    closed_category_id:row.closed_category_id?String(row.closed_category_id):null,
    transcript_channel_id:row.transcript_channel_id?String(row.transcript_channel_id):null,
    max_open_per_user:Math.max(1,Math.min(10,Number(row.max_open_per_user||2))),
    allow_user_close:row.allow_user_close!==false,
    warning_role_ids:Array.isArray(row.warning_role_ids)?row.warning_role_ids.map(String):[],
    timeout_role_ids:Array.isArray(row.timeout_role_ids)?row.timeout_role_ids.map(String):[],
    kick_role_ids:Array.isArray(row.kick_role_ids)?row.kick_role_ids.map(String):[],
    ban_role_ids:Array.isArray(row.ban_role_ids)?row.ban_role_ids.map(String):[],
    reversal_role_ids:Array.isArray(row.reversal_role_ids)?row.reversal_role_ids.map(String):[]
  };
}

export async function updateTicketSettings(input:Omit<TicketSettings,'panel_message_id'>){
  const result=await db.query(`
    UPDATE ticket_settings
       SET enabled=$1,panel_channel_id=$2,open_category_id=$3,closed_category_id=$4,
           transcript_channel_id=$5,max_open_per_user=$6,allow_user_close=$7,
           warning_role_ids=$8,timeout_role_ids=$9,kick_role_ids=$10,ban_role_ids=$11,reversal_role_ids=$12,updated_at=NOW()
     WHERE id=1 RETURNING *`,[
    input.enabled,input.panel_channel_id||null,input.open_category_id||null,input.closed_category_id||null,
    input.transcript_channel_id||null,Math.max(1,Math.min(10,input.max_open_per_user)),input.allow_user_close,
    unique(input.warning_role_ids),unique(input.timeout_role_ids),unique(input.kick_role_ids),unique(input.ban_role_ids),unique(input.reversal_role_ids)
  ]);
  return result.rows[0];
}

export async function setTicketPanelMessage(channelId:string,messageId:string){
  await db.query('UPDATE ticket_settings SET panel_channel_id=$1,panel_message_id=$2,updated_at=NOW() WHERE id=1',[channelId,messageId]);
}

export async function listTicketTypes(includeDisabled=true):Promise<TicketType[]>{
  const result=await db.query(`SELECT * FROM ticket_types ${includeDisabled?'':'WHERE enabled=TRUE'} ORDER BY sort_order,label`);
  return result.rows.map(row=>({
    ...row,
    key:String(row.key),
    support_role_ids:Array.isArray(row.support_role_ids)?row.support_role_ids.map(String):[],
    allow_punishments:Boolean(row.allow_punishments),
    enabled:Boolean(row.enabled),
    sort_order:Number(row.sort_order)
  })) as TicketType[];
}

export async function getTicketType(key:string):Promise<TicketType|null>{
  const result=await db.query('SELECT * FROM ticket_types WHERE key=$1',[key]);
  if(!result.rowCount) return null;
  const row=result.rows[0];
  return {
    ...row,key:String(row.key),support_role_ids:Array.isArray(row.support_role_ids)?row.support_role_ids.map(String):[],
    allow_punishments:Boolean(row.allow_punishments),enabled:Boolean(row.enabled),sort_order:Number(row.sort_order)
  } as TicketType;
}

export async function updateTicketType(key:string,input:{
  label:string;description:string;emoji?:string|null;intake_prompt:string;support_role_ids:string[];
  category_override_id?:string|null;allow_punishments:boolean;enabled:boolean;sort_order:number;
}){
  const result=await db.query(`
    UPDATE ticket_types
       SET label=$1,description=$2,emoji=$3,intake_prompt=$4,support_role_ids=$5,
           category_override_id=$6,allow_punishments=$7,enabled=$8,sort_order=$9,updated_at=NOW()
     WHERE key=$10 RETURNING *`,[
    input.label.trim(),input.description.trim(),input.emoji?.trim()||null,input.intake_prompt.trim(),unique(input.support_role_ids),
    input.category_override_id||null,input.allow_punishments,input.enabled,input.sort_order,key
  ]);
  return result.rows[0]||null;
}

export async function countOpenTicketsForUser(guildId:string,userId:string){
  const result=await db.query(`
    SELECT count(*)::int AS count FROM tickets
     WHERE guild_id=$1 AND opener_user_id=$2 AND status IN ('creating','open','claimed','awaiting_user')`,[guildId,userId]);
  return Number(result.rows[0]?.count||0);
}

export async function createTicketRecord(input:{
  typeKey:string;guildId:string;openerUserId:string;openerName:string;subject:string;description:string;
  involvedUserId?:string|null;evidenceLinks?:string;appealedPunishmentId?:number|null;
}){
  const result=await db.query(`
    INSERT INTO tickets
      (type_key,guild_id,opener_user_id,opener_name,subject,description,involved_user_id,evidence_links,appealed_punishment_id,status,last_message_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'creating',NOW()) RETURNING *`,[
    input.typeKey,input.guildId,input.openerUserId,input.openerName,input.subject.trim(),input.description.trim(),
    input.involvedUserId||null,String(input.evidenceLinks||'').trim(),input.appealedPunishmentId||null
  ]);
  const id=Number(result.rows[0].id);
  const publicId=`TKT-${String(id).padStart(4,'0')}`;
  const updated=await db.query('UPDATE tickets SET public_id=$1 WHERE id=$2 RETURNING *',[publicId,id]);
  await addTicketEvent(id,'created',input.openerUserId,input.openerName,{type_key:input.typeKey});
  return updated.rows[0];
}

export async function activateTicket(id:number,channelId:string,controlMessageId?:string|null){
  const result=await db.query(`
    UPDATE tickets SET channel_id=$1,control_message_id=$2,status='open',updated_at=NOW() WHERE id=$3 RETURNING *`,
    [channelId,controlMessageId||null,id]);
  if(result.rowCount) await addTicketEvent(id,'opened',null,'Saucin AI',{channel_id:channelId});
  return result.rows[0]||null;
}

export async function failTicketCreation(id:number,error:string){
  await db.query(`UPDATE tickets SET status='failed',close_reason=$1,closed_at=NOW(),updated_at=NOW() WHERE id=$2`,[error.slice(0,1000),id]);
  await addTicketEvent(id,'creation_failed',null,'Saucin AI',{error:error.slice(0,1000)});
}

export async function getTicketByChannel(channelId:string){
  const result=await db.query(`
    SELECT t.*,tt.label AS type_label,tt.support_role_ids,tt.allow_punishments,tt.emoji AS type_emoji
      FROM tickets t JOIN ticket_types tt ON tt.key=t.type_key
     WHERE t.channel_id=$1 LIMIT 1`,[channelId]);
  return result.rows[0]||null;
}

export async function getTicket(id:number){
  const result=await db.query(`
    SELECT t.*,tt.label AS type_label,tt.description AS type_description,tt.support_role_ids,
           tt.allow_punishments,tt.emoji AS type_emoji,
           COALESCE((SELECT jsonb_agg(e ORDER BY e.created_at DESC) FROM ticket_events e WHERE e.ticket_id=t.id),'[]'::jsonb) AS events,
           COALESCE((SELECT jsonb_agg(m ORDER BY m.discord_created_at ASC) FROM (
             SELECT id,discord_message_id,discord_user_id,author_name,content,attachments,is_bot,discord_created_at
               FROM ticket_messages WHERE ticket_id=t.id ORDER BY discord_created_at ASC LIMIT 1000
           ) m),'[]'::jsonb) AS messages,
           COALESCE((SELECT jsonb_agg(p ORDER BY p.created_at DESC) FROM moderation_punishments p WHERE p.ticket_id=t.id OR p.id=t.appealed_punishment_id),'[]'::jsonb) AS punishments
      FROM tickets t JOIN ticket_types tt ON tt.key=t.type_key
     WHERE t.id=$1`,[id]);
  return result.rows[0]||null;
}

export async function listTickets(input?:{status?:string;typeKey?:string;limit?:number}){
  const params:unknown[]=[];
  const where:string[]=[];
  if(input?.status){params.push(input.status);where.push(`t.status=$${params.length}`);}
  if(input?.typeKey){params.push(input.typeKey);where.push(`t.type_key=$${params.length}`);}
  params.push(Math.max(1,Math.min(500,input?.limit||250)));
  const result=await db.query(`
    SELECT t.*,tt.label AS type_label,tt.emoji AS type_emoji,
           COALESCE((SELECT count(*)::int FROM ticket_messages tm WHERE tm.ticket_id=t.id),0) AS message_count,
           COALESCE((SELECT count(*)::int FROM moderation_punishments mp WHERE mp.ticket_id=t.id),0) AS punishment_count
      FROM tickets t JOIN ticket_types tt ON tt.key=t.type_key
      ${where.length?`WHERE ${where.join(' AND ')}`:''}
     ORDER BY CASE t.status WHEN 'open' THEN 1 WHEN 'claimed' THEN 2 WHEN 'awaiting_user' THEN 3 WHEN 'creating' THEN 4 ELSE 5 END,
              COALESCE(t.last_message_at,t.created_at) DESC
     LIMIT $${params.length}`,params);
  return result.rows;
}

export async function saveTicketMessage(ticketId:number,input:{
  messageId:string;userId:string;authorName:string;content:string;attachments:unknown[];isBot:boolean;createdAt:Date;
}){
  const result=await db.query(`
    INSERT INTO ticket_messages
      (ticket_id,discord_message_id,discord_user_id,author_name,content,attachments,is_bot,discord_created_at)
    VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)
    ON CONFLICT (ticket_id,discord_message_id) DO NOTHING RETURNING id`,[
    ticketId,input.messageId,input.userId,input.authorName,input.content,JSON.stringify(input.attachments),input.isBot,input.createdAt
  ]);
  if(result.rowCount) await db.query('UPDATE tickets SET last_message_at=$1,updated_at=NOW() WHERE id=$2',[input.createdAt,ticketId]);
  return Boolean(result.rowCount);
}

export async function addTicketEvent(ticketId:number,eventType:string,actorUserId?:string|null,actorName?:string|null,details:Record<string,unknown>={}){
  await db.query(`INSERT INTO ticket_events (ticket_id,event_type,actor_user_id,actor_name,details) VALUES ($1,$2,$3,$4,$5::jsonb)`,[
    ticketId,eventType,actorUserId||null,actorName||null,JSON.stringify(details)
  ]);
}

export async function claimTicket(id:number,actor:{userId:string;name:string}){
  const result=await db.query(`
    UPDATE tickets SET status='claimed',claimed_by_user_id=$1,claimed_by_name=$2,claimed_at=NOW(),updated_at=NOW()
     WHERE id=$3 AND status IN ('open','claimed','awaiting_user') RETURNING *`,[actor.userId,actor.name,id]);
  if(result.rowCount) await addTicketEvent(id,'claimed',actor.userId,actor.name);
  return result.rows[0]||null;
}

export async function setTicketStatus(id:number,status:Extract<TicketStatus,'open'|'claimed'|'awaiting_user'>,actor:{userId:string;name:string},note?:string){
  const result=await db.query(`UPDATE tickets SET status=$1,updated_at=NOW() WHERE id=$2 AND status<>'closed' RETURNING *`,[status,id]);
  if(result.rowCount) await addTicketEvent(id,'status_changed',actor.userId,actor.name,{status,note:note||null});
  return result.rows[0]||null;
}

export async function closeTicketRecord(id:number,actor:{userId:string;name:string},reason:string,transcript?:{text:string;channelId?:string|null;messageId?:string|null}){
  const result=await db.query(`
    UPDATE tickets SET status='closed',closed_by_user_id=$1,closed_by_name=$2,close_reason=$3,closed_at=NOW(),
           transcript_text=COALESCE($4,transcript_text),transcript_channel_id=COALESCE($5,transcript_channel_id),
           transcript_message_id=COALESCE($6,transcript_message_id),updated_at=NOW()
     WHERE id=$7 AND status<>'closed' RETURNING *`,[
    actor.userId,actor.name,reason.trim()||'Ticket closed.',transcript?.text||null,transcript?.channelId||null,transcript?.messageId||null,id
  ]);
  if(result.rowCount) await addTicketEvent(id,'closed',actor.userId,actor.name,{reason:reason.trim()||'Ticket closed.'});
  return result.rows[0]||null;
}

export async function buildTicketTranscript(ticketId:number){
  const ticket=await getTicket(ticketId);
  if(!ticket) return '';
  const lines=[
    `${ticket.public_id} — ${ticket.subject}`,
    `Type: ${ticket.type_label}`,
    `Opened by: ${ticket.opener_name||ticket.opener_user_id} (${ticket.opener_user_id})`,
    `Opened: ${new Date(ticket.created_at).toISOString()}`,
    `Status: ${ticket.status}`,
    '',
    'Initial description:',
    String(ticket.description||''),
    ticket.evidence_links?`\nInitial evidence / links:\n${ticket.evidence_links}`:'',
    '',
    'Conversation:'
  ];
  for(const message of ticket.messages||[]){
    const attachments=Array.isArray(message.attachments)
      ? message.attachments.map((item:any)=>item?.url||item?.name).filter(Boolean).join(' | ')
      : '';
    lines.push(`[${new Date(message.discord_created_at).toISOString()}] ${message.author_name||message.discord_user_id} (${message.discord_user_id})${message.is_bot?' [BOT]':''}`);
    if(message.content) lines.push(String(message.content));
    if(attachments) lines.push(`Attachments: ${attachments}`);
    lines.push('');
  }
  return lines.join('\n').slice(0,2_000_000);
}

export async function createPunishmentRecord(input:{
  ticketId?:number|null;sourceModerationCaseId?:number|null;guildId:string;targetUserId:string;targetName?:string|null;
  actionType:TicketPunishmentAction;durationSeconds?:number|null;reason:string;internalNotes?:string;evidenceSnapshot?:string;
  issuedByUserId:string;issuedByName:string;
}){
  const result=await db.query(`
    INSERT INTO moderation_punishments
      (ticket_id,source_moderation_case_id,guild_id,target_user_id,target_name,action_type,duration_seconds,reason,
       internal_notes,evidence_snapshot,issued_by_user_id,issued_by_name,status)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending') RETURNING *`,[
    input.ticketId||null,input.sourceModerationCaseId||null,input.guildId,input.targetUserId,input.targetName||null,
    input.actionType,input.durationSeconds||null,input.reason.trim(),input.internalNotes?.trim()||'',
    input.evidenceSnapshot?.trim()||'',input.issuedByUserId,input.issuedByName
  ]);
  const id=Number(result.rows[0].id);
  const publicId=`PUN-${String(id).padStart(4,'0')}`;
  const updated=await db.query('UPDATE moderation_punishments SET public_id=$1 WHERE id=$2 RETURNING *',[publicId,id]);
  await addPunishmentEvent(id,'created',input.issuedByUserId,input.issuedByName,{ticket_id:input.ticketId||null});
  return updated.rows[0];
}

export async function getPunishment(id:number){
  const result=await db.query(`
    SELECT p.*,t.public_id AS ticket_public_id,t.channel_id AS ticket_channel_id,
           COALESCE((SELECT jsonb_agg(e ORDER BY e.created_at DESC) FROM moderation_punishment_events e WHERE e.punishment_id=p.id),'[]'::jsonb) AS events
      FROM moderation_punishments p LEFT JOIN tickets t ON t.id=p.ticket_id WHERE p.id=$1`,[id]);
  return result.rows[0]||null;
}

export async function listPunishments(input?:{ticketId?:number;targetUserId?:string;status?:string;limit?:number}){
  const params:unknown[]=[];const where:string[]=[];
  if(input?.ticketId){params.push(input.ticketId);where.push(`p.ticket_id=$${params.length}`);}
  if(input?.targetUserId){params.push(input.targetUserId);where.push(`p.target_user_id=$${params.length}`);}
  if(input?.status){params.push(input.status);where.push(`p.status=$${params.length}`);}
  params.push(Math.max(1,Math.min(500,input?.limit||200)));
  const result=await db.query(`
    SELECT p.*,t.public_id AS ticket_public_id,t.subject AS ticket_subject
      FROM moderation_punishments p LEFT JOIN tickets t ON t.id=p.ticket_id
      ${where.length?`WHERE ${where.join(' AND ')}`:''}
     ORDER BY p.created_at DESC LIMIT $${params.length}`,params);
  return result.rows;
}

export async function updatePunishmentApplied(id:number,input:{status:'active'|'completed';targetName?:string|null;externalState?:Record<string,unknown>;expiresAt?:Date|null}){
  const result=await db.query(`
    UPDATE moderation_punishments SET status=$1,target_name=COALESCE($2,target_name),external_state=$3::jsonb,
           issued_at=NOW(),expires_at=$4,failure_reason=NULL,updated_at=NOW() WHERE id=$5 RETURNING *`,[
    input.status,input.targetName||null,JSON.stringify(input.externalState||{}),input.expiresAt||null,id
  ]);
  await addPunishmentEvent(id,'applied',null,'Saucin AI',{status:input.status,expires_at:input.expiresAt?.toISOString()||null});
  return result.rows[0]||null;
}

export async function markPunishmentFailed(id:number,error:string){
  const result=await db.query(`UPDATE moderation_punishments SET status='failed',failure_reason=$1,updated_at=NOW() WHERE id=$2 RETURNING *`,[error.slice(0,1000),id]);
  await addPunishmentEvent(id,'failed',null,'Saucin AI',{error:error.slice(0,1000)});
  return result.rows[0]||null;
}

export async function markPunishmentReversed(id:number,actor:{userId:string;name:string},reason:string,status:'reversed'|'expired'='reversed'){
  const result=await db.query(`
    UPDATE moderation_punishments SET status=$1,reversed_by_user_id=$2,reversed_by_name=$3,reversal_reason=$4,reversed_at=NOW(),updated_at=NOW()
     WHERE id=$5 AND status IN ('active','completed') RETURNING *`,[
    status,actor.userId,actor.name,reason.trim(),id
  ]);
  if(result.rowCount) await addPunishmentEvent(id,status,actor.userId,actor.name,{reason:reason.trim()});
  return result.rows[0]||null;
}

export async function addPunishmentEvent(punishmentId:number,eventType:string,actorUserId?:string|null,actorName?:string|null,details:Record<string,unknown>={}){
  await db.query(`
    INSERT INTO moderation_punishment_events (punishment_id,event_type,actor_user_id,actor_name,details)
    VALUES ($1,$2,$3,$4,$5::jsonb)`,[punishmentId,eventType,actorUserId||null,actorName||null,JSON.stringify(details)]);
}

export async function expiringPunishments(limit=100){
  const result=await db.query(`
    SELECT * FROM moderation_punishments
     WHERE status='active' AND expires_at IS NOT NULL AND expires_at<=NOW()
     ORDER BY expires_at ASC LIMIT $1`,[Math.max(1,Math.min(500,limit))]);
  return result.rows;
}
