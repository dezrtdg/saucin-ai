-- v2.5: unified Automation Center, module authority ceilings, and staff calibration.

CREATE TABLE IF NOT EXISTS automation_module_settings (
  module_key TEXT PRIMARY KEY CHECK (module_key IN ('tickets','issues','suggestions','knowledge','moderation','txadmin')),
  autonomy_level TEXT NOT NULL DEFAULT 'observe' CHECK (autonomy_level IN ('off','observe','assist','auto_safe')),
  updated_by_user_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO automation_module_settings(module_key,autonomy_level) VALUES
  ('tickets','assist'),
  ('issues','auto_safe'),
  ('suggestions','auto_safe'),
  ('knowledge','assist'),
  ('moderation','observe'),
  ('txadmin','auto_safe')
ON CONFLICT(module_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS automation_review_state (
  module_key TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('pending','reviewed','helpful','incorrect')),
  note TEXT NOT NULL DEFAULT '',
  reviewed_by_user_id TEXT,
  reviewed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(module_key,resource_type,resource_id)
);

CREATE TABLE IF NOT EXISTS automation_feedback_events (
  id BIGSERIAL PRIMARY KEY,
  module_key TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('reviewed','helpful','incorrect','reopened')),
  note TEXT NOT NULL DEFAULT '',
  actor_user_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE issue_txadmin_links ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'suggested';
ALTER TABLE issue_txadmin_links ADD COLUMN IF NOT EXISTS reviewed_by_user_id TEXT;
ALTER TABLE issue_txadmin_links ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

DO $$ BEGIN
  ALTER TABLE issue_txadmin_links
    ADD CONSTRAINT issue_txadmin_links_review_status_check
    CHECK (review_status IN ('suggested','confirmed','dismissed'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_automation_review_state_outcome
  ON automation_review_state(outcome,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_feedback_events_resource
  ON automation_feedback_events(module_key,resource_type,resource_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_issue_txadmin_links_review
  ON issue_txadmin_links(issue_id,review_status,confidence DESC);
