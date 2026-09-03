import { db } from '../db.js';

export type DashboardNotificationKind =
  | 'ticket_reply'|'ticket_mention'
  | 'issue_reply'|'issue_mention'
  | 'suggestion_reply'|'suggestion_mention';

export type DashboardNotificationItem = {
  key: string;
  kind: DashboardNotificationKind;
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

  const none=Promise.resolve({rows:[]} as any);
  const zero=Promise.resolve({rows:[{count:0}]} as any);
  const [
    ticketQueue,issueQueue,suggestionQueue,gapQueue,moderationQueue,
    ticketReplies,ticketMentions,issueReplies,issueMentions,suggestionReplies,suggestionMentions
  ]=await Promise.all([
    canTickets?db.query(`SELECT count(*)::int AS count FROM tickets WHERE status='open' AND claimed_by_user_id IS NULL`):zero,
    canIssues?db.query(`SELECT count(*)::int AS count FROM issue_candidates WHERE status IN ('detected','reported')`):zero,
    canSuggestions?db.query(`SELECT count(*)::int AS count FROM suggestions WHERE status IN ('candidate','reviewing')`):zero,
    canGaps?db.query(`SELECT count(*)::int AS count FROM knowledge_gaps WHERE status='open'`):zero,
    canModeration?db.query(`SELECT count(*)::int AS count FROM moderation_cases WHERE status='pending'`):zero,
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
       ORDER BY tm.created_at DESC LIMIT 15`,[input.userId]):none,
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
       ORDER BY tm.created_at DESC LIMIT 15`,[input.userId]):none,
    canIssues?db.query(`
      SELECT e.id,e.created_at,i.id AS issue_id,i.public_id,i.title,e.author_name
        FROM issue_thread_entries e
        JOIN issues i ON i.id=e.issue_id
       WHERE e.discord_user_id IS DISTINCT FROM $1
         AND e.created_at>NOW()-INTERVAL '30 days'
         AND i.status NOT IN ('resolved','wont_fix')
         AND EXISTS (
           SELECT 1 FROM issue_thread_entries mine
            WHERE mine.issue_id=e.issue_id AND mine.discord_user_id=$1 AND mine.created_at<e.created_at
         )
         AND NOT (e.content LIKE ('%<@'||$1||'>%') OR e.content LIKE ('%<@!'||$1||'>%'))
         AND NOT EXISTS (
           SELECT 1 FROM dashboard_notification_reads r
            WHERE r.user_id=$1 AND r.notification_key='issue-reply:'||e.id::text
         )
       ORDER BY e.created_at DESC LIMIT 15`,[input.userId]):none,
    canIssues?db.query(`
      SELECT e.id,e.created_at,i.id AS issue_id,i.public_id,i.title,e.author_name
        FROM issue_thread_entries e
        JOIN issues i ON i.id=e.issue_id
       WHERE e.discord_user_id IS DISTINCT FROM $1
         AND (e.content LIKE ('%<@'||$1||'>%') OR e.content LIKE ('%<@!'||$1||'>%'))
         AND e.created_at>NOW()-INTERVAL '30 days'
         AND i.status NOT IN ('resolved','wont_fix')
         AND NOT EXISTS (
           SELECT 1 FROM dashboard_notification_reads r
            WHERE r.user_id=$1 AND r.notification_key='issue-mention:'||e.id::text
         )
       ORDER BY e.created_at DESC LIMIT 15`,[input.userId]):none,
    canSuggestions?db.query(`
      SELECT e.id,e.created_at,s.id AS suggestion_id,s.public_id,s.title,e.author_name
        FROM suggestion_thread_entries e
        JOIN suggestions s ON s.id=e.suggestion_id
       WHERE e.discord_user_id IS DISTINCT FROM $1
         AND e.created_at>NOW()-INTERVAL '30 days'
         AND s.status NOT IN ('declined','shipped')
         AND EXISTS (
           SELECT 1 FROM suggestion_thread_entries mine
            WHERE mine.suggestion_id=e.suggestion_id AND mine.discord_user_id=$1 AND mine.created_at<e.created_at
         )
         AND NOT (e.content LIKE ('%<@'||$1||'>%') OR e.content LIKE ('%<@!'||$1||'>%'))
         AND NOT EXISTS (
           SELECT 1 FROM dashboard_notification_reads r
            WHERE r.user_id=$1 AND r.notification_key='suggestion-reply:'||e.id::text
         )
       ORDER BY e.created_at DESC LIMIT 15`,[input.userId]):none,
    canSuggestions?db.query(`
      SELECT e.id,e.created_at,s.id AS suggestion_id,s.public_id,s.title,e.author_name
        FROM suggestion_thread_entries e
        JOIN suggestions s ON s.id=e.suggestion_id
       WHERE e.discord_user_id IS DISTINCT FROM $1
         AND (e.content LIKE ('%<@'||$1||'>%') OR e.content LIKE ('%<@!'||$1||'>%'))
         AND e.created_at>NOW()-INTERVAL '30 days'
         AND s.status NOT IN ('declined','shipped')
         AND NOT EXISTS (
           SELECT 1 FROM dashboard_notification_reads r
            WHERE r.user_id=$1 AND r.notification_key='suggestion-mention:'||e.id::text
         )
       ORDER BY e.created_at DESC LIMIT 15`,[input.userId]):none
  ]);

  const personal:DashboardNotificationItem[]=[
    ...ticketReplies.rows.map((row:any)=>({
      key:`ticket-reply:${row.id}`,kind:'ticket_reply' as const,
      title:`Reply on ${row.public_id||`ticket ${row.ticket_id}`}`,
      detail:`${row.author_name||'The ticket opener'} replied to ${row.subject}.`,
      href:`/tickets/${row.ticket_id}`,created_at:new Date(row.created_at).toISOString()
    })),
    ...ticketMentions.rows.map((row:any)=>({
      key:`ticket-mention:${row.id}`,kind:'ticket_mention' as const,
      title:`You were tagged in ${row.public_id||`ticket ${row.ticket_id}`}`,
      detail:`${row.author_name||'Someone'} mentioned you in ${row.subject}.`,
      href:`/tickets/${row.ticket_id}`,created_at:new Date(row.created_at).toISOString()
    })),
    ...issueReplies.rows.map((row:any)=>({
      key:`issue-reply:${row.id}`,kind:'issue_reply' as const,
      title:`Reply on ${row.public_id||`issue ${row.issue_id}`}`,
      detail:`${row.author_name||'Someone'} posted in ${row.title} after your last update.`,
      href:`/issues/${row.issue_id}`,created_at:new Date(row.created_at).toISOString()
    })),
    ...issueMentions.rows.map((row:any)=>({
      key:`issue-mention:${row.id}`,kind:'issue_mention' as const,
      title:`You were tagged in ${row.public_id||`issue ${row.issue_id}`}`,
      detail:`${row.author_name||'Someone'} mentioned you in ${row.title}.`,
      href:`/issues/${row.issue_id}`,created_at:new Date(row.created_at).toISOString()
    })),
    ...suggestionReplies.rows.map((row:any)=>({
      key:`suggestion-reply:${row.id}`,kind:'suggestion_reply' as const,
      title:`Reply on ${row.public_id||`suggestion ${row.suggestion_id}`}`,
      detail:`${row.author_name||'Someone'} posted in ${row.title} after your last update.`,
      href:`/suggestions/${row.suggestion_id}`,created_at:new Date(row.created_at).toISOString()
    })),
    ...suggestionMentions.rows.map((row:any)=>({
      key:`suggestion-mention:${row.id}`,kind:'suggestion_mention' as const,
      title:`You were tagged in ${row.public_id||`suggestion ${row.suggestion_id}`}`,
      detail:`${row.author_name||'Someone'} mentioned you in ${row.title}.`,
      href:`/suggestions/${row.suggestion_id}`,created_at:new Date(row.created_at).toISOString()
    }))
  ].sort((a,b)=>new Date(b.created_at).getTime()-new Date(a.created_at).getTime()).slice(0,30);

  const personalTickets=personal.filter(item=>item.kind==='ticket_reply'||item.kind==='ticket_mention').length;
  const personalIssues=personal.filter(item=>item.kind==='issue_reply'||item.kind==='issue_mention').length;
  const personalSuggestions=personal.filter(item=>item.kind==='suggestion_reply'||item.kind==='suggestion_mention').length;

  const counts={
    tickets:Number(ticketQueue.rows[0]?.count||0)+personalTickets,
    issues:Number(issueQueue.rows[0]?.count||0)+personalIssues,
    suggestions:Number(suggestionQueue.rows[0]?.count||0)+personalSuggestions,
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
      ...(Number(issueQueue.rows[0]?.count||0)?[{key:'issues',label:'Incoming issue reports',count:Number(issueQueue.rows[0].count),href:'/issues?incoming=open'}]:[]),
      ...(Number(suggestionQueue.rows[0]?.count||0)?[{key:'suggestions',label:'Suggestions needing review',count:Number(suggestionQueue.rows[0].count),href:'/suggestions?status=candidate'}]:[]),
      ...(counts.knowledgeGaps?[{key:'knowledge-gaps',label:'Open knowledge gaps',count:counts.knowledgeGaps,href:'/knowledge-gaps?status=open'}]:[]),
      ...(counts.moderation?[{key:'moderation',label:'Moderation reviews',count:counts.moderation,href:'/moderation?status=pending'}]:[])
    ]
  };
}

export async function markDashboardNotificationsRead(userId:string,keys:string[]){
  const clean=[...new Set(keys.map(key=>key.trim()).filter(key=>/^(ticket-reply|ticket-mention|issue-reply|issue-mention|suggestion-reply|suggestion-mention):\d+$/.test(key)))].slice(0,100);
  if(!clean.length)return 0;
  const result=await db.query(`
    INSERT INTO dashboard_notification_reads(user_id,notification_key)
    SELECT $1,unnest($2::text[])
    ON CONFLICT(user_id,notification_key) DO UPDATE SET read_at=NOW()
    RETURNING notification_key`,[userId,clean]);
  return result.rowCount||0;
}
