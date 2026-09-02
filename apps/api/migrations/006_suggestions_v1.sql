-- Saucin AI Suggestions v1
-- Turns the original placeholder suggestions table into a traceable community-intake workflow.

ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS public_id TEXT;
ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS normalized_text TEXT;
ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS fingerprint TEXT;
ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS related_terms TEXT[] NOT NULL DEFAULT '{}'::TEXT[];
ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS discord_user_id TEXT;
ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS channel_id TEXT;
ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS discord_message_id BIGINT REFERENCES discord_messages(id) ON DELETE SET NULL;
ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS staff_notes TEXT NOT NULL DEFAULT '';
ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS embedding VECTOR(1536);
ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS embedding_updated_at TIMESTAMPTZ;
ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE suggestions
   SET public_id = 'SUG-' || lpad(id::text, 4, '0')
 WHERE public_id IS NULL OR public_id = '';

UPDATE suggestions
   SET normalized_text = left(trim(regexp_replace(lower(coalesce(NULLIF(summary,''), title)), '[^a-z0-9/_ -]+', ' ', 'g')), 1000)
 WHERE normalized_text IS NULL OR normalized_text = '';

UPDATE suggestions
   SET fingerprint = md5(coalesce(normalized_text, lower(title)))
 WHERE fingerprint IS NULL OR fingerprint = '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_suggestions_public_id ON suggestions(public_id);
CREATE INDEX IF NOT EXISTS idx_suggestions_status_seen ON suggestions(status,last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_suggestions_normalized_trgm ON suggestions USING GIN (normalized_text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_suggestions_related_terms ON suggestions USING GIN (related_terms);
CREATE INDEX IF NOT EXISTS idx_suggestions_embedding_hnsw ON suggestions USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS suggestion_events (
  id BIGSERIAL PRIMARY KEY,
  suggestion_id BIGINT NOT NULL REFERENCES suggestions(id) ON DELETE CASCADE,
  discord_message_id BIGINT REFERENCES discord_messages(id) ON DELETE SET NULL,
  discord_user_id TEXT,
  suggestion_text TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'discord',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_suggestion_events_message
  ON suggestion_events(suggestion_id,discord_message_id)
  WHERE discord_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_suggestion_events_suggestion_time ON suggestion_events(suggestion_id,created_at DESC);

CREATE TABLE IF NOT EXISTS suggestion_supporters (
  suggestion_id BIGINT NOT NULL REFERENCES suggestions(id) ON DELETE CASCADE,
  discord_user_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'discord',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (suggestion_id,discord_user_id)
);
CREATE INDEX IF NOT EXISTS idx_suggestion_supporters_user ON suggestion_supporters(discord_user_id);

-- Preserve the original mention_count for old rows while ensuring newly observed supporters
-- can be represented without double-counting the same Discord member.
INSERT INTO suggestion_supporters (suggestion_id,discord_user_id,source)
SELECT id,discord_user_id,'legacy_origin'
  FROM suggestions
 WHERE discord_user_id IS NOT NULL AND discord_user_id <> ''
ON CONFLICT DO NOTHING;
