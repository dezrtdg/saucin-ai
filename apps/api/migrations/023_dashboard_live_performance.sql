-- Keep the live staff queues responsive as ticket and discussion history grows.
CREATE INDEX IF NOT EXISTS idx_tickets_unclaimed_queue
  ON tickets(priority,created_at)
  WHERE status='open' AND claimed_by_user_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_ticket_messages_staff_notifications
  ON ticket_messages(discord_user_id,created_at DESC,ticket_id)
  WHERE is_bot=FALSE;

CREATE INDEX IF NOT EXISTS idx_issue_thread_entries_author_time
  ON issue_thread_entries(discord_user_id,created_at DESC,issue_id)
  WHERE discord_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_suggestion_thread_entries_author_time
  ON suggestion_thread_entries(discord_user_id,created_at DESC,suggestion_id)
  WHERE discord_user_id IS NOT NULL;
