-- Saucin AI v1.4: live moderation enforcement state.
-- Detection still uses the existing moderation pipeline. This migration adds a
-- separate live-enforcement switch and durable action/audit state so automated
-- Discord actions can be tracked independently from staff confirmation.

ALTER TABLE moderation_settings
  ADD COLUMN IF NOT EXISTS live_enforcement_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE moderation_cases
  ADD COLUMN IF NOT EXISTS staff_review_required BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE moderation_cases
  ADD COLUMN IF NOT EXISTS live_action_status TEXT NOT NULL DEFAULT 'not_applicable';

ALTER TABLE moderation_cases
  ADD COLUMN IF NOT EXISTS live_action_results JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE moderation_cases
  ADD COLUMN IF NOT EXISTS live_action_started_at TIMESTAMPTZ;

ALTER TABLE moderation_cases
  ADD COLUMN IF NOT EXISTS live_action_at TIMESTAMPTZ;

ALTER TABLE moderation_cases
  DROP CONSTRAINT IF EXISTS moderation_cases_live_action_status_check;

ALTER TABLE moderation_cases
  ADD CONSTRAINT moderation_cases_live_action_status_check
  CHECK (live_action_status IN ('not_applicable','pending','processing','completed','partial','failed','skipped'));

ALTER TABLE moderation_case_events
  DROP CONSTRAINT IF EXISTS moderation_case_events_event_type_check;

ALTER TABLE moderation_case_events
  ADD CONSTRAINT moderation_case_events_event_type_check
  CHECK (event_type IN (
    'detected','confirmed','dismissed','reopened','note',
    'live_action_completed','live_action_partial','live_action_failed','live_action_skipped'
  ));

CREATE INDEX IF NOT EXISTS idx_moderation_cases_live_action
  ON moderation_cases(live_action_status,created_at)
  WHERE live_action_status IN ('pending','processing');

-- Staff review is always required at the fixed 4th+ escalation level, including
-- observe-mode cases. Existing history is normalized for consistent display.
UPDATE moderation_cases
SET staff_review_required = (offense_number >= 4)
WHERE staff_review_required IS DISTINCT FROM (offense_number >= 4);

-- New moderation cases are queued for live execution only when the live switch is
-- enabled at the exact moment the case is inserted. Existing cases are never
-- retroactively punished when Live mode is turned on.
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

  NEW.staff_review_required := COALESCE(NEW.offense_number,1) >= 4;

  IF COALESCE(live_enabled,FALSE) THEN
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

DROP TRIGGER IF EXISTS trg_saucin_ai_live_moderation_case_defaults ON moderation_cases;
CREATE TRIGGER trg_saucin_ai_live_moderation_case_defaults
BEFORE INSERT ON moderation_cases
FOR EACH ROW
EXECUTE FUNCTION saucin_ai_live_moderation_case_defaults();
