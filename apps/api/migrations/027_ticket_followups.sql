-- Low-noise ticket follow-ups. A reminder is tied to the conversation stage
-- that caused it, so the worker can retry delivery without posting duplicates.
ALTER TABLE ticket_settings
  ADD COLUMN IF NOT EXISTS followups_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS unclaimed_reminder_minutes INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS staff_followup_hours INTEGER NOT NULL DEFAULT 12,
  ADD COLUMN IF NOT EXISTS awaiting_user_reminder_hours INTEGER NOT NULL DEFAULT 24;

CREATE TABLE IF NOT EXISTS ticket_followup_events (
  id BIGSERIAL PRIMARY KEY,
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  followup_kind TEXT NOT NULL CHECK (followup_kind IN ('unclaimed','staff_reply_due','user_reply_due')),
  trigger_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  discord_message_id TEXT,
  error_message TEXT,
  next_retry_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(ticket_id,followup_kind,trigger_at)
);

CREATE INDEX IF NOT EXISTS idx_ticket_followups_retry
  ON ticket_followup_events(status,next_retry_at)
  WHERE status='failed';
