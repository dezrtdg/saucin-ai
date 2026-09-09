-- Staff-confirmed issue resolutions can become reusable knowledge drafts.
-- Drafts remain private until a staff member explicitly publishes them.

ALTER TABLE issues
  ADD COLUMN IF NOT EXISTS resolution_summary TEXT,
  ADD COLUMN IF NOT EXISTS resolution_article_id BIGINT REFERENCES knowledge_articles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolution_draft_updated_at TIMESTAMPTZ;

UPDATE issues
   SET resolved_at = COALESCE(resolved_at, updated_at)
 WHERE status = 'resolved' AND resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_issues_resolution_article
  ON issues(resolution_article_id)
  WHERE resolution_article_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS issue_knowledge_gap_matches (
  issue_id BIGINT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  gap_id BIGINT NOT NULL REFERENCES knowledge_gaps(id) ON DELETE CASCADE,
  confidence NUMERIC(5,4) NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1),
  reason TEXT NOT NULL DEFAULT '',
  review_status TEXT NOT NULL DEFAULT 'suggested' CHECK (review_status IN ('suggested','linked','dismissed')),
  reviewed_by_user_id TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (issue_id, gap_id)
);

CREATE INDEX IF NOT EXISTS idx_issue_gap_matches_review
  ON issue_knowledge_gap_matches(issue_id, review_status, confidence DESC);

CREATE OR REPLACE FUNCTION close_linked_resolution_gaps()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'published' AND OLD.status IS DISTINCT FROM 'published' THEN
    UPDATE knowledge_gaps g
       SET status = 'resolved',
           converted_article_id = COALESCE(g.converted_article_id, NEW.id),
           notes = CASE
             WHEN position(('Resolved through published knowledge article #' || NEW.id::text) in g.notes) > 0 THEN g.notes
             WHEN g.notes = '' THEN 'Resolved through published knowledge article #' || NEW.id::text || '.'
             ELSE g.notes || E'\n' || 'Resolved through published knowledge article #' || NEW.id::text || '.'
           END
      FROM issue_knowledge_gap_matches m
      JOIN issues i ON i.id = m.issue_id
     WHERE i.resolution_article_id = NEW.id
       AND m.gap_id = g.id
       AND m.review_status = 'linked'
       AND g.status IN ('open','reviewed');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_close_linked_resolution_gaps ON knowledge_articles;
CREATE TRIGGER trg_close_linked_resolution_gaps
AFTER UPDATE OF status ON knowledge_articles
FOR EACH ROW EXECUTE FUNCTION close_linked_resolution_gaps();
