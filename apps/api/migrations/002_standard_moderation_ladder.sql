-- Saucin AI moderation standard ladder.
-- The escalation sequence is intentionally uniform across every moderation-eligible rule:
--   1st      Reminder
--   2nd      Warning
--   3rd      10 minute timeout + delete offending message
--   4th+     1 hour timeout + delete offending message + staff review
--
-- Staff review is a workflow requirement derived from offense level 4+; the existing
-- Observe Mode case workflow already supports staff confirmation/dismissal. Live
-- enforcement will use the same fixed sequence when enabled in a later release.

ALTER TABLE moderation_rule_settings
  ALTER COLUMN action_ladder SET DEFAULT
  '{"first":{"action":"reminder","delete_message":false},"second":{"action":"warning","delete_message":false},"third":{"action":"timeout_10m","delete_message":true},"fourth_plus":{"action":"timeout_1h","delete_message":true}}'::jsonb;

-- Normalize every existing rule to the same ladder while preserving confidence,
-- enable/disable, repeat-window, role exemption, and channel-scope settings.
UPDATE moderation_rule_settings
SET recommended_action = 'reminder',
    action_ladder = '{"first":{"action":"reminder","delete_message":false},"second":{"action":"warning","delete_message":false},"third":{"action":"timeout_10m","delete_message":true},"fourth_plus":{"action":"timeout_1h","delete_message":true}}'::jsonb;

-- Ensure every currently published moderation-eligible article has a settings row.
INSERT INTO moderation_rule_settings (article_id, enabled, recommended_action, action_ladder, updated_at)
SELECT a.id,
       TRUE,
       'reminder',
       '{"first":{"action":"reminder","delete_message":false},"second":{"action":"warning","delete_message":false},"third":{"action":"timeout_10m","delete_message":true},"fourth_plus":{"action":"timeout_1h","delete_message":true}}'::jsonb,
       NOW()
FROM knowledge_articles a
JOIN knowledge_content_types ct ON ct.key = a.content_type
WHERE a.status = 'published'
  AND ct.moderation_eligible = TRUE
ON CONFLICT (article_id) DO UPDATE
SET recommended_action = 'reminder',
    action_ladder = EXCLUDED.action_ladder;

-- New/published moderation rules automatically receive the same fixed ladder.
CREATE OR REPLACE FUNCTION saucin_ai_standardize_moderation_article()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'published'
     AND EXISTS (
       SELECT 1
       FROM knowledge_content_types ct
       WHERE ct.key = NEW.content_type
         AND ct.moderation_eligible = TRUE
     ) THEN
    INSERT INTO moderation_rule_settings (article_id, enabled, recommended_action, action_ladder, updated_at)
    VALUES (
      NEW.id,
      TRUE,
      'reminder',
      '{"first":{"action":"reminder","delete_message":false},"second":{"action":"warning","delete_message":false},"third":{"action":"timeout_10m","delete_message":true},"fourth_plus":{"action":"timeout_1h","delete_message":true}}'::jsonb,
      NOW()
    )
    ON CONFLICT (article_id) DO UPDATE
    SET recommended_action = 'reminder',
        action_ladder = EXCLUDED.action_ladder;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_saucin_ai_standardize_moderation_article ON knowledge_articles;
CREATE TRIGGER trg_saucin_ai_standardize_moderation_article
AFTER INSERT OR UPDATE OF status, content_type ON knowledge_articles
FOR EACH ROW
EXECUTE FUNCTION saucin_ai_standardize_moderation_article();

-- If a content type is later made moderation-eligible, immediately provision all
-- already-published articles using that type with the standard ladder.
CREATE OR REPLACE FUNCTION saucin_ai_standardize_moderation_content_type()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.moderation_eligible = TRUE THEN
    INSERT INTO moderation_rule_settings (article_id, enabled, recommended_action, action_ladder, updated_at)
    SELECT a.id,
           TRUE,
           'reminder',
           '{"first":{"action":"reminder","delete_message":false},"second":{"action":"warning","delete_message":false},"third":{"action":"timeout_10m","delete_message":true},"fourth_plus":{"action":"timeout_1h","delete_message":true}}'::jsonb,
           NOW()
    FROM knowledge_articles a
    WHERE a.status = 'published'
      AND a.content_type = NEW.key
    ON CONFLICT (article_id) DO UPDATE
    SET recommended_action = 'reminder',
        action_ladder = EXCLUDED.action_ladder;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_saucin_ai_standardize_moderation_content_type ON knowledge_content_types;
CREATE TRIGGER trg_saucin_ai_standardize_moderation_content_type
AFTER INSERT OR UPDATE OF moderation_eligible ON knowledge_content_types
FOR EACH ROW
EXECUTE FUNCTION saucin_ai_standardize_moderation_content_type();
