import { db } from '../db.js';

export type DashboardNotificationItem = {
  key: string;
  kind: 'ticket_reply'|'ticket_mention';
  title: string;
  detail: string;
  href: string;
  created_at: string;
};

type NotificationInput = {
  userId: string;
  permissions: string[];
  ownerBypass?: boolean;
};

function allowed(input: NotificationInput, permission: string) {
  return Boolean(input.ownerBypass || input.permissions.includes(permission));
}

export async function getDashboardNotifications(input: NotificationInput) {
  const canTickets=allowed(input,'tickets.view');
  const canIssues=allowed(input,'issues.view');
  const canSuggestions=allowed(input,'suggestions.view');
  const canGaps=allowed(input,'knowledge.gaps.view');
  const canModeration=allowed(input,'moderation.view');

  const [ticketQueue,issueQueue,suggestionQueue,gapQueue,moderationQueue,replies,mentions]=await Promise.all([
    canTickets?db.query(`SELECT count(*)::int AS count FROM tickets WHERE status='open' AND claimed_by_user_id IS NULL`):Promise.resolve({rows:[{count:0}]} as any),
    canIssues?db.query(`SELECT count(*)::int AS count FROM issue_candidates WHERE status IN ('detected','reported')`):Promise.resolve({rows:[{count:0}]} as any),
    canSuggestions?db.query(`SELECT count(*)::int AS count FROM suggestions WHERE status IN ('candidate','reviewing')`):Promise.resolve({rows:[{count:0}]} as any),
    canGaps?db.query(`SELECT count(*)::int AS count FROM knowledge_gaps WHERE status='open'`):Promise.resolve({rows:[{count:0}]} as any),
    canModeration?db.query(`SELECT count(*)::int AS count FROM moderation_cases WHERE status='pending'`):Promise.resolve({rows:[{count:0}]} as any),
    canTickets?db.query(`
      SELECT tm.id,tm.created_at,t.id AS ticket_id,t.public_id,t.subject,tm.author_name
        FROM ticket_messages tm
        JOIN tickets t ON t.id=tm.ticket_id
       WHERE tm.discord_user_id=t.opener_user_id
         AND NOT tm.is_bot
         AND t.claimed_by_user_id=$1
         AND t.status='claimed'
         AND tm.created_at>=COALESCE(t.claimed_at,t.created_at)
         AND tm.created_at > NOW()-INTERVAL '30 days'
         AND NOT (tm.content LIKE ('%<@'||$1||'>%') OR tm.content LIKE ('%<@!'||$1||'>%'))
         AND NOT EXISTS (
           SELECT 1 FROM dashboard_notification_reads r
            WHERE r.user_id=$1 AND r.notification_key='ticket-reply:'||tm.id::text
         )
       ORDER BY tm.created_at DESC LIMIT 15`,[input.userId]):Promise.resolve({rows:[]} as any),
    canTickets?db.query(`
      SELECT tm.id,tm.created_at,t.id AS ticket_id,t.public_id,t.subject,tm.author_name
        FROM ticket_messages tm
        JOIN tickets t ON t.id=tm.ticket_id
       WHERE t.status<>'closed'
         AND tm.discord_user_id<>$1
         AND (tm.content LIKE ('%<@'||$1||'>%') OR tm.content LIKE ('%<@!'||$1||'>%'))
         AND tm.created_at > NOW()-INTERVAL '30 days'
         AND NOT EXISTS (
           SELECT 1 FROM dashboard_notification_reads r
            WHERE r.user_id=$1 AND r.notification_key='ticket-mention:'||tm.id::text
         )
       ORDER BY tm.created_at DESC LIMIT 15`,[input.userId]):Promise.resolve({rows:[]} as any)
  ]);

  const personal:DashboardNotificationItem[]=[
    ...replies.rows.map((row:any)=>({
      key:`ticket-reply:${row.id}`,kind:'ticket_reply' as const,
      title:`Reply on ${row.public_id||`ticket ${row.ticket_id}`}`,
      detail:`${row.author_name||'The ticket opener'} replied to ${row.subject}.`,
      href:`/tickets/${row.ticket_id}`,created_at:new Date(row.created_at).toISOString()
    })),
    ...mentions.rows.map((row:any)=>({
      key:`ticket-mention:${row.id}`,kind:'ticket_mention' as const,
      title:`You were tagged in ${row.public_id||`ticket ${row.ticket_id}`}`,
      detail:`${row.author_name||'Someone'} mentioned you in ${row.subject}.`,
      href:`/tickets/${row.ticket_id}`,created_at:new Date(row.created_at).toISOString()
    }))
  ].sort((a,b)=>new Date(b.created_at).getTime()-new Date(a.created_at).getTime()).slice(0,20);

  const counts={
    tickets:Number(ticketQueue.rows[0]?.count||0)+personal.length,
    issues:Number(issueQueue.rows[0]?.count||0),
    suggestions:Number(suggestionQueue.rows[0]?.count||0),
    knowledgeGaps:Number(gapQueue.rows[0]?.count||0),
    moderation:Number(moderationQueue.rows[0]?.count||0),
    personal:personal.length
  };
  return {
    generated_at:new Date().toISOString(),
    total:counts.tickets+counts.issues+counts.suggestions+counts.knowledgeGaps+counts.moderation,
    counts,
    personal,
    queues:[
      ...(Number(ticketQueue.rows[0]?.count||0)?[{key:'tickets',label:'Unclaimed tickets',count:Number(ticketQueue.rows[0].count),href:'/tickets?status=open'}]:[]),
      ...(counts.issues?[{key:'issues',label:'Incoming issue reports',count:counts.issues,href:'/issues?incoming=open'}]:[]),
      ...(counts.suggestions?[{key:'suggestions',label:'Suggestions needing review',count:counts.suggestions,href:'/suggestions?status=candidate'}]:[]),
      ...(counts.knowledgeGaps?[{key:'knowledge-gaps',label:'Open knowledge gaps',count:counts.knowledgeGaps,href:'/knowledge-gaps?status=open'}]:[]),
      ...(counts.moderation?[{key:'moderation',label:'Moderation reviews',count:counts.moderation,href:'/moderation?status=pending'}]:[])
    ]
  };
}

export async function markDashboardNotificationsRead(userId:string,keys:string[]){
  const clean=[...new Set(keys.map(key=>key.trim()).filter(key=>/^(ticket-reply|ticket-mention):\d+$/.test(key)))].slice(0,100);
  if(!clean.length)return 0;
  const result=await db.query(`
    INSERT INTO dashboard_notification_reads(user_id,notification_key)
    SELECT $1,unnest($2::text[])
    ON CONFLICT(user_id,notification_key) DO UPDATE SET read_at=NOW()
    RETURNING notification_key`,[userId,clean]);
  return result.rowCount||0;
}
