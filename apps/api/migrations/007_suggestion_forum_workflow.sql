-- Saucin AI Suggestions v2: AI authoring and self-contained Discord forum workflow.

ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS community_context TEXT NOT NULL DEFAULT '';
ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS discord_thread_id TEXT;
ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS discord_status_channel_id TEXT;
ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS discord_status_message_id TEXT;
ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS thread_last_activity_at TIMESTAMPTZ;
ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS thread_summary_updated_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_suggestions_discord_thread
  ON suggestions(discord_thread_id)
  WHERE discord_thread_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS suggestion_automation_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  forum_channel_id TEXT,
  auto_create_forum_posts BOOLEAN NOT NULL DEFAULT TRUE,
  collect_thread_details BOOLEAN NOT NULL DEFAULT TRUE,
  ai_summarize_thread BOOLEAN NOT NULL DEFAULT TRUE,
  edit_original_status_message BOOLEAN NOT NULL DEFAULT TRUE,
  post_status_updates_to_thread BOOLEAN NOT NULL DEFAULT TRUE,
  include_suggestion_id BOOLEAN NOT NULL DEFAULT TRUE,
  include_support_count BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO suggestion_automation_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS suggestion_thread_entries (
  id BIGSERIAL PRIMARY KEY,
  suggestion_id BIGINT NOT NULL REFERENCES suggestions(id) ON DELETE CASCADE,
  discord_message_id BIGINT REFERENCES discord_messages(id) ON DELETE SET NULL,
  discord_user_id TEXT,
  author_name TEXT,
  content TEXT NOT NULL,
  extracted_summary TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_suggestion_thread_entries_message
  ON suggestion_thread_entries(discord_message_id)
  WHERE discord_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_suggestion_thread_entries_suggestion_time
  ON suggestion_thread_entries(suggestion_id,created_at DESC);

CREATE TABLE IF NOT EXISTS suggestion_updates (
  id BIGSERIAL PRIMARY KEY,
  suggestion_id BIGINT NOT NULL REFERENCES suggestions(id) ON DELETE CASCADE,
  update_type TEXT NOT NULL,
  from_value TEXT,
  to_value TEXT,
  note TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_suggestion_updates_suggestion_time
  ON suggestion_updates(suggestion_id,created_at DESC);
