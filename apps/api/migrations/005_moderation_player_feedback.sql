-- Saucin AI v1.4.2: player moderation feedback + captured conversation context.
-- Player feedback is a signal, not an automatic override. Only later staff review
-- produces trusted calibration data.

ALTER TABLE moderation_cases
  ADD COLUMN IF NOT EXISTS context_snapshot TEXT;

ALTER TABLE moderation_cases
  ADD COLUMN IF NOT EXISTS player_acknowledged_at TIMESTAMPTZ;

ALTER TABLE moderation_cases
  ADD COLUMN IF NOT EXISTS player_contested_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_moderation_cases_player_contested
  ON moderation_cases(player_contested_at DESC)
  WHERE player_contested_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS moderation_player_feedback (
  id BIGSERIAL PRIMARY KEY,
  case_id BIGINT NOT NULL REFERENCES moderation_cases(id) ON DELETE CASCADE,
  discord_user_id TEXT NOT NULL,
  feedback_type TEXT NOT NULL CHECK (feedback_type IN ('understood','incorrect')),
  context_snapshot TEXT,
  reanalysis JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(case_id,discord_user_id,feedback_type)
);
CREATE INDEX IF NOT EXISTS idx_moderation_player_feedback_case_time
  ON moderation_player_feedback(case_id,created_at DESC);

-- Preserve the exact five-message context window the moderation classifier uses.
CREATE OR REPLACE FUNCTION saucin_ai_capture_moderation_context()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.context_snapshot IS NULL OR btrim(NEW.context_snapshot) = '' THEN
    SELECT string_agg(
      COALESCE(x.author_name,'member') || ': ' || x.clean_content,
      E'\n' ORDER BY x.id
    )
    INTO NEW.context_snapshot
    FROM (
      SELECT dm.id,
             dm.author_name,
             left(regexp_replace(COALESCE(dm.content,''), E'[\\n\\r\\t ]+', ' ', 'g'),500) AS clean_content
        FROM discord_messages dm
       WHERE dm.channel_id = NEW.channel_id
         AND dm.id < NEW.discord_message_id
         AND dm.is_bot = FALSE
         AND btrim(COALESCE(dm.content,'')) <> ''
       ORDER BY dm.id DESC
       LIMIT 5
    ) x;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_saucin_ai_capture_moderation_context ON moderation_cases;
CREATE TRIGGER trg_saucin_ai_capture_moderation_context
BEFORE INSERT ON moderation_cases
FOR EACH ROW
EXECUTE FUNCTION saucin_ai_capture_moderation_context();

ALTER TABLE moderation_case_events
  DROP CONSTRAINT IF EXISTS moderation_case_events_event_type_check;
ALTER TABLE moderation_case_events
  ADD CONSTRAINT moderation_case_events_event_type_check
  CHECK (event_type IN (
    'detected','confirmed','dismissed','reopened','note',
    'live_action_completed','live_action_partial','live_action_failed','live_action_skipped',
    'player_acknowledged','player_contested','feedback_reanalyzed'
  ));

-- Trusted calibration examples intentionally require a human staff outcome. An
-- automatic Live confirmation or a player's Incorrect click alone does not train
-- future moderation behavior.
CREATE OR REPLACE VIEW moderation_trusted_calibration_examples AS
SELECT f.id AS feedback_id,
       f.case_id,
       f.feedback_type,
       f.context_snapshot,
       f.reanalysis,
       c.rule_article_id,
       c.rule_title,
       c.message_content,
       c.status AS staff_outcome,
       c.reviewed_by_user_id,
       c.reviewed_at,
       f.created_at AS feedback_at
  FROM moderation_player_feedback f
  JOIN moderation_cases c ON c.id=f.case_id
 WHERE c.status IN ('confirmed','dismissed')
   AND c.reviewed_by_user_id IS NOT NULL
   AND c.reviewed_by_user_id <> 'saucin-ai-live';
