-- Saucin AI v1.6.4: lock resolved issue discussions and remove them after seven days.

ALTER TABLE issues
  ADD COLUMN IF NOT EXISTS discord_cleanup_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS discord_locked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_issues_discord_cleanup
  ON issues(discord_cleanup_at)
  WHERE discord_cleanup_at IS NOT NULL;

UPDATE issues
   SET discord_cleanup_at=NOW()+INTERVAL '7 days'
 WHERE status='resolved'
   AND discord_thread_id IS NOT NULL
   AND discord_cleanup_at IS NULL;
