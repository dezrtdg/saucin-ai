-- Trusted, retrieval-based calibration. These are staff-reviewed examples used
-- at decision time; the bot never changes model weights or promotes player
-- claims into facts.
CREATE TABLE IF NOT EXISTS automation_learning_examples (
  id BIGSERIAL PRIMARY KEY,
  module_key TEXT NOT NULL CHECK (module_key IN ('tickets','issues','suggestions','knowledge','moderation','txadmin')),
  decision_type TEXT NOT NULL CHECK (decision_type IN ('routing','priority','category','moderation','txadmin_match','general')),
  source_resource_type TEXT NOT NULL,
  source_resource_id TEXT NOT NULL,
  input_text TEXT NOT NULL,
  normalized_text TEXT NOT NULL,
  predicted_value TEXT NOT NULL DEFAULT '',
  corrected_value TEXT NOT NULL DEFAULT '',
  staff_note TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  trusted BOOLEAN NOT NULL DEFAULT TRUE,
  reviewed_by_user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(module_key,decision_type,source_resource_type,source_resource_id)
);

CREATE INDEX IF NOT EXISTS idx_automation_learning_kind_time
  ON automation_learning_examples(decision_type,module_key,updated_at DESC)
  WHERE trusted=TRUE;

CREATE INDEX IF NOT EXISTS idx_automation_learning_text_trgm
  ON automation_learning_examples USING GIN(normalized_text gin_trgm_ops)
  WHERE trusted=TRUE;

-- Seed the learning layer from decisions staff already made.
INSERT INTO automation_learning_examples
  (module_key,decision_type,source_resource_type,source_resource_id,input_text,normalized_text,
   predicted_value,corrected_value,staff_note,metadata,trusted,reviewed_by_user_id,created_at,updated_at)
SELECT 'moderation','moderation','moderation_case',c.id::text,
       COALESCE(c.message_content,'')||E'\n'||COALESCE(c.context_snapshot,''),
       lower(regexp_replace(COALESCE(c.message_content,'')||' '||COALESCE(c.context_snapshot,''),'[^a-zA-Z0-9/_-]+',' ','g')),
       COALESCE(c.rule_title,'possible violation'),c.status,COALESCE(c.review_notes,''),
       jsonb_build_object('rule_article_id',c.rule_article_id,'confidence',c.confidence),TRUE,c.reviewed_by_user_id,
       COALESCE(c.reviewed_at,c.created_at),COALESCE(c.reviewed_at,c.updated_at)
  FROM moderation_cases c
 WHERE c.status IN ('confirmed','dismissed')
   AND c.reviewed_by_user_id IS NOT NULL
   AND c.reviewed_by_user_id<>'saucin-ai-live'
ON CONFLICT(module_key,decision_type,source_resource_type,source_resource_id) DO NOTHING;

INSERT INTO automation_learning_examples
  (module_key,decision_type,source_resource_type,source_resource_id,input_text,normalized_text,
   predicted_value,corrected_value,metadata,trusted,reviewed_by_user_id,created_at,updated_at)
SELECT 'txadmin','txadmin_match','txadmin_match',l.issue_id::text||':'||l.service_event_id::text,
       COALESCE(i.title,'')||E'\n'||COALESCE(i.description,'')||E'\n'||COALESCE(i.resource_name,'')||E'\n'||COALESCE(e.resource_name,'')||' '||COALESCE(e.message,''),
       lower(regexp_replace(COALESCE(i.title,'')||' '||COALESCE(i.description,'')||' '||COALESCE(i.resource_name,'')||' '||COALESCE(e.resource_name,'')||' '||COALESCE(e.message,''),'[^a-zA-Z0-9/_-]+',' ','g')),
       'suggested',l.review_status,
       jsonb_build_object('issue_resource',i.resource_name,'event_resource',e.resource_name,'confidence',l.confidence),
       TRUE,l.reviewed_by_user_id,COALESCE(l.reviewed_at,l.first_linked_at),COALESCE(l.reviewed_at,l.last_confirmed_at)
  FROM issue_txadmin_links l
  JOIN issues i ON i.id=l.issue_id
  JOIN service_events e ON e.id=l.service_event_id
 WHERE l.review_status IN ('confirmed','dismissed') AND l.reviewed_by_user_id IS NOT NULL
ON CONFLICT(module_key,decision_type,source_resource_type,source_resource_id) DO NOTHING;
