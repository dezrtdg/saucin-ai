CREATE TABLE IF NOT EXISTS dashboard_notification_reads (
  user_id TEXT NOT NULL,
  notification_key TEXT NOT NULL,
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, notification_key)
);

CREATE INDEX IF NOT EXISTS idx_dashboard_notification_reads_user_time
  ON dashboard_notification_reads(user_id, read_at DESC);
