-- Saucin AI v1.4.1: successful live actions automatically advance repeat escalation.
-- Observe Mode remains staff-confirmed. In Live Mode, the primary action itself is
-- the confirmation event; staff can still dismiss/correct the case afterward.

CREATE OR REPLACE FUNCTION saucin_ai_auto_confirm_successful_live_action()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  primary_succeeded BOOLEAN := FALSE;
  changed_rows INTEGER := 0;
BEGIN
  IF NEW.live_action_status NOT IN ('completed','partial')
     OR NEW.status <> 'pending' THEN
    RETURN NEW;
  END IF;

  primary_succeeded := CASE
    WHEN NEW.recommended_action IN ('reminder','warning')
      THEN COALESCE((NEW.live_action_results->>'notice_sent')::boolean,FALSE)
    WHEN NEW.recommended_action IN ('timeout_10m','timeout_1h')
      THEN COALESCE((NEW.live_action_results->>'timeout_applied')::boolean,FALSE)
    ELSE FALSE
  END;

  IF NOT primary_succeeded THEN
    RETURN NEW;
  END IF;

  UPDATE moderation_cases
     SET status='confirmed',
         reviewed_by_user_id='saucin-ai-live',
         reviewed_at=NOW(),
         review_notes=COALESCE(
           NULLIF(review_notes,''),
           'Automatically confirmed after the primary Live Enforcement action succeeded. Staff may dismiss this case to correct the escalation history.'
         ),
         updated_at=NOW()
   WHERE id=NEW.id
     AND status='pending';

  GET DIAGNOSTICS changed_rows = ROW_COUNT;

  IF changed_rows > 0 THEN
    INSERT INTO moderation_case_events (case_id,event_type,actor_user_id,details)
    VALUES (
      NEW.id,
      'confirmed',
      'saucin-ai-live',
      jsonb_build_object(
        'automatic',TRUE,
        'source','live_enforcement',
        'primary_action',NEW.recommended_action,
        'live_action_status',NEW.live_action_status,
        'note','Successful Live Enforcement actions advance automatically; staff may dismiss to correct.'
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_saucin_ai_auto_confirm_successful_live_action ON moderation_cases;
CREATE TRIGGER trg_saucin_ai_auto_confirm_successful_live_action
AFTER UPDATE OF live_action_status, live_action_results ON moderation_cases
FOR EACH ROW
WHEN (
  OLD.live_action_status IS DISTINCT FROM NEW.live_action_status
  AND NEW.live_action_status IN ('completed','partial')
)
EXECUTE FUNCTION saucin_ai_auto_confirm_successful_live_action();
