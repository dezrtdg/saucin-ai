-- v2.4: actionable txAdmin triage and private issue-to-log evidence links

ALTER TABLE txadmin_settings ADD COLUMN IF NOT EXISTS auto_link_issue_reports BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE txadmin_settings ADD COLUMN IF NOT EXISTS correlation_min_confidence NUMERIC(4,3) NOT NULL DEFAULT 0.550;

DO $$ BEGIN
  ALTER TABLE txadmin_settings
    ADD CONSTRAINT txadmin_settings_correlation_confidence_check
    CHECK (correlation_min_confidence BETWEEN 0.40 AND 0.95);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE service_events ADD COLUMN IF NOT EXISTS attention_kind TEXT NOT NULL DEFAULT 'routine';
ALTER TABLE service_events ADD COLUMN IF NOT EXISTS actionable BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE service_events ADD COLUMN IF NOT EXISTS actionability_reason TEXT;

DO $$ BEGIN
  ALTER TABLE service_events
    ADD CONSTRAINT service_events_attention_kind_check
    CHECK (attention_kind IN ('routine','update_available','startup_blocker','runtime_failure','server_offline'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

UPDATE service_events
   SET attention_kind=CASE
         WHEN event_type='resource.update_available' THEN 'update_available'
         WHEN event_type IN ('server.process_stopped','server.crash') THEN 'server_offline'
         WHEN event_type='resource.start_failed' THEN 'startup_blocker'
         WHEN event_type IN ('resource.error','server.error','database.error')
              AND message ~* '(script error|uncaught|unhandled|no such export|missing dependency|failed dependency|could not load|unable to load|parse error|syntax error|runtime error)' THEN 'runtime_failure'
         ELSE 'routine'
       END,
       actionable=CASE
         WHEN event_type IN ('resource.update_available','server.process_stopped','server.crash','resource.start_failed') THEN TRUE
         WHEN event_type IN ('resource.error','server.error','database.error')
              AND message ~* '(script error|uncaught|unhandled|no such export|missing dependency|failed dependency|could not load|unable to load|parse error|syntax error|runtime error)' THEN TRUE
         ELSE FALSE
       END,
       actionability_reason=CASE
         WHEN event_type='resource.update_available' THEN 'A script or resource reports that an update is available.'
         WHEN event_type IN ('server.process_stopped','server.crash') THEN 'FXServer stopped or crashed.'
         WHEN event_type='resource.start_failed' THEN 'A resource could not start.'
         WHEN event_type IN ('resource.error','server.error','database.error')
              AND message ~* '(script error|uncaught|unhandled|no such export|missing dependency|failed dependency|could not load|unable to load|parse error|syntax error|runtime error)' THEN 'The error appears capable of preventing a resource from running correctly.'
         ELSE NULL
       END
 WHERE source='txadmin';

CREATE TABLE IF NOT EXISTS issue_txadmin_links (
  issue_id BIGINT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  service_event_id BIGINT NOT NULL REFERENCES service_events(id) ON DELETE CASCADE,
  confidence NUMERIC(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  match_types TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  reason TEXT NOT NULL DEFAULT '',
  linked_by TEXT NOT NULL DEFAULT 'automatic',
  first_linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (issue_id,service_event_id)
);

CREATE INDEX IF NOT EXISTS idx_service_events_txadmin_actionable
  ON service_events(actionable,status,attention_kind,last_seen_at DESC) WHERE source='txadmin';
CREATE INDEX IF NOT EXISTS idx_issue_txadmin_links_issue
  ON issue_txadmin_links(issue_id,confidence DESC,last_confirmed_at DESC);
