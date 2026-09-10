-- Older follow-up workers compared PostgreSQL microsecond timestamps with
-- JavaScript millisecond timestamps. The reminder delivery itself succeeded,
-- but the next scan could miss the sent record and add a duplicate timeline
-- event. Keep the first audit event for each real conversation stage.
WITH duplicate_followups AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY ticket_id,event_type,
                        COALESCE(details->>'followup_kind',''),
                        COALESCE(details->>'trigger_at','')
           ORDER BY created_at,id
         ) AS duplicate_number
    FROM ticket_events
   WHERE event_type='automatic_followup'
)
DELETE FROM ticket_events
 WHERE id IN (
   SELECT id FROM duplicate_followups WHERE duplicate_number>1
 );

-- A successful delivery represents one reminder even if the affected worker
-- repeatedly upserted the same delivery record before this fix was deployed.
UPDATE ticket_followup_events
   SET attempt_count=1,updated_at=NOW()
 WHERE status='sent' AND attempt_count>1;
