-- Preserve ignored AI detections for audit while keeping them out of active suggestion views.
ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ;
ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS dismissed_by TEXT;
CREATE INDEX IF NOT EXISTS idx_suggestions_active
  ON suggestions(last_seen DESC)
  WHERE dismissed_at IS NULL;
