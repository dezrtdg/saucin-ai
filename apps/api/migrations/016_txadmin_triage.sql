-- v1.9: quiet txAdmin triage, recurring issue drafts, and developer alerts

CREATE TABLE IF NOT EXISTS txadmin_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  group_window_minutes INTEGER NOT NULL DEFAULT 60 CHECK (group_window_minutes BETWEEN 5 AND 1440),
  auto_draft_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  draft_min_occurrences INTEGER NOT NULL DEFAULT 5 CHECK (draft_min_occurrences BETWEEN 2 AND 1000),
  alert_channel_id TEXT,
  alert_role_ids TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  notify_critical BOOLEAN NOT NULL DEFAULT TRUE,
  notify_recurring_errors BOOLEAN NOT NULL DEFAULT TRUE,
  hide_alert_mentions BOOLEAN NOT NULL DEFAULT TRUE,
  noise_patterns TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO txadmin_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE service_events ADD COLUMN IF NOT EXISTS suppressed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE service_events ADD COLUMN IF NOT EXISTS suppression_reason TEXT;
ALTER TABLE service_events ADD COLUMN IF NOT EXISTS issue_candidate_id BIGINT REFERENCES issue_candidates(id) ON DELETE SET NULL;
ALTER TABLE service_events ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ;
ALTER TABLE service_events ADD COLUMN IF NOT EXISTS draft_created_at TIMESTAMPTZ;

ALTER TABLE issue_candidates ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'discord';
DO $$ BEGIN
  ALTER TABLE issue_candidates
    ADD CONSTRAINT issue_candidates_source_check CHECK (source IN ('discord','txadmin'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_service_events_txadmin_attention
  ON service_events(suppressed,status,severity,last_seen_at DESC) WHERE source='txadmin';
CREATE INDEX IF NOT EXISTS idx_service_events_txadmin_candidate
  ON service_events(issue_candidate_id) WHERE issue_candidate_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_issue_candidates_source_seen
  ON issue_candidates(source,status,last_seen DESC);
