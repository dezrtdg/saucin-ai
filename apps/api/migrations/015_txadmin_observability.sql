-- v1.8: read-only txAdmin/FiveM observability collector

CREATE TABLE IF NOT EXISTS txadmin_collectors (
  collector_id TEXT PRIMARY KEY,
  server_name TEXT NOT NULL,
  hostname TEXT NOT NULL,
  txdata_path TEXT NOT NULL,
  collector_version TEXT NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE service_events ADD COLUMN IF NOT EXISTS collector_id TEXT;
ALTER TABLE service_events ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'general';
ALTER TABLE service_events ADD COLUMN IF NOT EXISTS resource_name TEXT;
ALTER TABLE service_events ADD COLUMN IF NOT EXISTS fingerprint TEXT;
ALTER TABLE service_events ADD COLUMN IF NOT EXISTS repeat_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE service_events ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMPTZ;
ALTER TABLE service_events ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
ALTER TABLE service_events ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open';
ALTER TABLE service_events ADD COLUMN IF NOT EXISTS matched_issue_id BIGINT REFERENCES issues(id) ON DELETE SET NULL;
ALTER TABLE service_events ADD COLUMN IF NOT EXISTS source_file TEXT;
ALTER TABLE service_events ADD COLUMN IF NOT EXISTS line_number BIGINT;
ALTER TABLE service_events ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ;
ALTER TABLE service_events ADD COLUMN IF NOT EXISTS acknowledged_by_user_id TEXT;

UPDATE service_events
   SET first_seen_at=COALESCE(first_seen_at,occurred_at),
       last_seen_at=COALESCE(last_seen_at,occurred_at)
 WHERE first_seen_at IS NULL OR last_seen_at IS NULL;

ALTER TABLE service_events ALTER COLUMN first_seen_at SET DEFAULT NOW();
ALTER TABLE service_events ALTER COLUMN last_seen_at SET DEFAULT NOW();

DO $$ BEGIN
  ALTER TABLE service_events
    ADD CONSTRAINT service_events_status_check
    CHECK (status IN ('open','acknowledged','resolved'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_txadmin_collectors_heartbeat
  ON txadmin_collectors(last_heartbeat_at DESC);
CREATE INDEX IF NOT EXISTS idx_service_events_txadmin_status
  ON service_events(status,severity,last_seen_at DESC) WHERE source='txadmin';
CREATE INDEX IF NOT EXISTS idx_service_events_txadmin_fingerprint
  ON service_events(collector_id,fingerprint,last_seen_at DESC) WHERE source='txadmin';
CREATE INDEX IF NOT EXISTS idx_service_events_matched_issue
  ON service_events(matched_issue_id,last_seen_at DESC) WHERE matched_issue_id IS NOT NULL;
