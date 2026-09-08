-- Saucin AI v1.9: player-initiated message reports.
-- Reports are always human-reviewed and can never enter Live Enforcement directly.

ALTER TABLE moderation_cases
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'ai_detection';

ALTER TABLE moderation_cases
  DROP CONSTRAINT IF EXISTS moderation_cases_source_check;
ALTER TABLE moderation_cases
  ADD CONSTRAINT moderation_cases_source_check
  CHECK (source IN ('ai_detection','member_report'));

CREATE TABLE IF NOT EXISTS moderation_reports (
  id BIGSERIAL PRIMARY KEY,
  case_id BIGINT NOT NULL REFERENCES moderation_cases(id) ON DELETE CASCADE,
  reporter_user_id TEXT NOT NULL,
  reporter_name TEXT,
  command_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(case_id,reporter_user_id)
);

CREATE INDEX IF NOT EXISTS idx_moderation_reports_reporter_time
  ON moderation_reports(reporter_user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_moderation_reports_case_time
  ON moderation_reports(case_id,created_at DESC);

CREATE OR REPLACE FUNCTION saucin_ai_live_moderation_case_defaults()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  live_enabled BOOLEAN := FALSE;
BEGIN
  SELECT COALESCE(live_enforcement_enabled,FALSE)
    INTO live_enabled
    FROM moderation_settings
   WHERE id = 1;

  NEW.staff_review_required := COALESCE(NEW.offense_number,1) >= 4
    OR COALESCE(NEW.source,'ai_detection') = 'member_report';

  IF COALESCE(live_enabled,FALSE)
     AND COALESCE(NEW.source,'ai_detection') = 'ai_detection' THEN
    NEW.live_action_status := 'pending';
    NEW.live_action_results := '{}'::jsonb;
    NEW.live_action_started_at := NULL;
    NEW.live_action_at := NULL;
  ELSE
    NEW.live_action_status := 'not_applicable';
  END IF;

  RETURN NEW;
END;
$$;

