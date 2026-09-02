CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS app_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  server_name TEXT NOT NULL DEFAULT 'Saucin RP',
  ai_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  reply_confidence_threshold NUMERIC(4,3) NOT NULL DEFAULT 0.780,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO app_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS channel_policies (
  discord_channel_id TEXT PRIMARY KEY,
  channel_name TEXT,
  mode TEXT NOT NULL DEFAULT 'ignored' CHECK (mode IN ('monitor','questions','issues','suggestions','full','ignored')),
  monitor_messages BOOLEAN NOT NULL DEFAULT FALSE,
  auto_reply BOOLEAN NOT NULL DEFAULT FALSE,
  detect_questions BOOLEAN NOT NULL DEFAULT TRUE,
  detect_issues BOOLEAN NOT NULL DEFAULT TRUE,
  detect_suggestions BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Existing installations created before v0.7.2 may still have monitor/TRUE as
-- column defaults. These ALTERs only affect future inserts; existing channel
-- choices are preserved.
ALTER TABLE channel_policies ALTER COLUMN mode SET DEFAULT 'ignored';
ALTER TABLE channel_policies ALTER COLUMN monitor_messages SET DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS knowledge_articles (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  audience TEXT NOT NULL DEFAULT 'public' CHECK (audience IN ('public','whitelisted','leo','ems','staff','admin','developer')),
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published','archived')),
  source_url TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  search_vector TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(title,'') || ' ' || coalesce(body,'') || ' ' || coalesce(category,''))
  ) STORED
);
CREATE INDEX IF NOT EXISTS idx_knowledge_search ON knowledge_articles USING GIN (search_vector);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id BIGSERIAL PRIMARY KEY,
  article_id BIGINT NOT NULL REFERENCES knowledge_articles(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  embedding VECTOR,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(article_id, chunk_index)
);

CREATE TABLE IF NOT EXISTS discord_messages (
  id BIGSERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  channel_name TEXT,
  message_id TEXT NOT NULL UNIQUE,
  author_id TEXT NOT NULL,
  author_name TEXT,
  content TEXT NOT NULL,
  is_bot BOOLEAN NOT NULL DEFAULT FALSE,
  discord_created_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_discord_messages_channel_time ON discord_messages(channel_id, discord_created_at DESC);

CREATE TABLE IF NOT EXISTS ai_activity (
  id BIGSERIAL PRIMARY KEY,
  discord_message_id BIGINT REFERENCES discord_messages(id) ON DELETE SET NULL,
  intent TEXT NOT NULL,
  confidence NUMERIC(4,3) NOT NULL DEFAULT 0,
  should_respond BOOLEAN NOT NULL DEFAULT FALSE,
  rationale TEXT,
  matched_sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  response_text TEXT,
  model_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_activity_time ON ai_activity(created_at DESC);

CREATE TABLE IF NOT EXISTS issues (
  id BIGSERIAL PRIMARY KEY,
  public_id TEXT UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'general',
  resource_name TEXT,
  severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','acknowledged','investigating','fix_in_progress','testing','resolved','wont_fix')),
  public_response TEXT,
  staff_notes TEXT,
  report_count INTEGER NOT NULL DEFAULT 0,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  search_vector TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(title,'') || ' ' || coalesce(description,'') || ' ' || coalesce(category,'') || ' ' || coalesce(resource_name,''))
  ) STORED
);
CREATE INDEX IF NOT EXISTS idx_issues_search ON issues USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status, last_seen DESC);

CREATE TABLE IF NOT EXISTS issue_reports (
  id BIGSERIAL PRIMARY KEY,
  issue_id BIGINT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  discord_message_id BIGINT REFERENCES discord_messages(id) ON DELETE SET NULL,
  discord_user_id TEXT,
  report_text TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'discord',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS suggestions (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'general',
  status TEXT NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate','reviewing','planned','accepted','declined','shipped')),
  mention_count INTEGER NOT NULL DEFAULT 1,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS service_events (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_service_events_source_time ON service_events(source, occurred_at DESC);

CREATE TABLE IF NOT EXISTS announcements (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','sent','cancelled')),
  target_channels JSONB NOT NULL DEFAULT '[]'::jsonb,
  scheduled_for TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- v0.5: editable knowledge categories, audiences, Discord role mapping
CREATE TABLE IF NOT EXISTS knowledge_categories (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 100,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO knowledge_categories (key,label,description,sort_order) VALUES
  ('general','General / FAQ','General server information and frequently asked questions.',10),
  ('rules','Server Rules','Server rules and player conduct.',20),
  ('commands','Commands','Player commands and command usage.',30),
  ('getting-started','Getting Started','Onboarding and new-player information.',40),
  ('radio','Radio','Radio systems and communication guides.',50),
  ('leo','Police / LEO','Law-enforcement guides and procedures.',60),
  ('ems','Fire / EMS','Fire and EMS guides and procedures.',70),
  ('jobs-businesses','Jobs & Businesses','Jobs, businesses, and employment information.',80),
  ('vehicles-garages','Vehicles & Garages','Vehicles, garages, impounds, and related systems.',90),
  ('housing','Housing','Housing and property information.',100),
  ('phone','Phone','Phone features and applications.',110),
  ('banking','Banking','Banking, payments, and financial systems.',120),
  ('crime','Crime','Crime systems and criminal activities.',130),
  ('server-systems','Server Systems','General server mechanics and systems.',140),
  ('known-issues','Known Issues','Known problems and current workarounds.',150),
  ('events','Events','Server and community events.',160),
  ('staff','Staff Information','Internal staff information.',170),
  ('other','Other','Anything that does not fit another category.',999)
ON CONFLICT (key) DO NOTHING;

-- Normalize free-text categories created before v0.5 and preserve them as dashboard categories.
UPDATE knowledge_articles
   SET category = COALESCE(NULLIF(trim(BOTH '-' FROM lower(regexp_replace(category, '[^a-zA-Z0-9_-]+', '-', 'g'))), ''), 'general')
 WHERE category !~ '^[a-z0-9][a-z0-9_-]*$';
INSERT INTO knowledge_categories (key,label,description,sort_order)
SELECT DISTINCT category, initcap(replace(replace(category, '-', ' '), '_', ' ')), 'Imported from existing knowledge articles.', 500
  FROM knowledge_articles
 WHERE category IS NOT NULL AND category <> ''
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS knowledge_audiences (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  public_access BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 100,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO knowledge_audiences (key,label,description,public_access,sort_order) VALUES
  ('public','Public','Available to everyone.',TRUE,10),
  ('whitelisted','Whitelisted','Available to configured whitelisted-member roles.',FALSE,20),
  ('leo','LEO','Available to configured law-enforcement roles.',FALSE,30),
  ('ems','EMS','Available to configured Fire/EMS roles.',FALSE,40),
  ('staff','Staff','Available to configured staff roles.',FALSE,50),
  ('admin','Admin','Available to configured administrator roles.',FALSE,60),
  ('developer','Developer','Available to configured developer roles.',FALSE,70)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS knowledge_audience_roles (
  audience_key TEXT NOT NULL REFERENCES knowledge_audiences(key) ON DELETE CASCADE,
  discord_role_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (audience_key, discord_role_id)
);
CREATE INDEX IF NOT EXISTS idx_knowledge_audience_roles_role ON knowledge_audience_roles(discord_role_id);

ALTER TABLE knowledge_articles ADD COLUMN IF NOT EXISTS audiences TEXT[];
UPDATE knowledge_articles SET audiences = ARRAY[audience] WHERE audiences IS NULL OR cardinality(audiences) = 0;
ALTER TABLE knowledge_articles ALTER COLUMN audiences SET DEFAULT ARRAY['public']::TEXT[];
ALTER TABLE knowledge_articles ALTER COLUMN audiences SET NOT NULL;
ALTER TABLE knowledge_articles DROP CONSTRAINT IF EXISTS knowledge_articles_audience_check;
CREATE INDEX IF NOT EXISTS idx_knowledge_audiences ON knowledge_articles USING GIN (audiences);

-- v0.6: broader retrieval metadata, semantic search, fuzzy matching, and knowledge gaps
CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE knowledge_articles ADD COLUMN IF NOT EXISTS aliases TEXT[] NOT NULL DEFAULT '{}'::TEXT[];
ALTER TABLE knowledge_articles ADD COLUMN IF NOT EXISTS related_topics TEXT[] NOT NULL DEFAULT '{}'::TEXT[];
ALTER TABLE knowledge_articles ADD COLUMN IF NOT EXISTS example_questions TEXT[] NOT NULL DEFAULT '{}'::TEXT[];
ALTER TABLE knowledge_articles ADD COLUMN IF NOT EXISTS embedding VECTOR(1536);
ALTER TABLE knowledge_articles ADD COLUMN IF NOT EXISTS embedding_updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_knowledge_title_trgm ON knowledge_articles USING GIN (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_knowledge_aliases ON knowledge_articles USING GIN (aliases);
CREATE INDEX IF NOT EXISTS idx_knowledge_related_topics ON knowledge_articles USING GIN (related_topics);
CREATE INDEX IF NOT EXISTS idx_knowledge_example_questions ON knowledge_articles USING GIN (example_questions);
CREATE INDEX IF NOT EXISTS idx_knowledge_embedding_hnsw ON knowledge_articles USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS knowledge_gaps (
  id BIGSERIAL PRIMARY KEY,
  fingerprint TEXT NOT NULL UNIQUE,
  normalized_question TEXT NOT NULL,
  sample_question TEXT NOT NULL,
  topic TEXT,
  discord_user_id TEXT,
  channel_id TEXT,
  matched_sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  occurrences INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed','resolved','ignored')),
  first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_knowledge_gaps_status_seen ON knowledge_gaps(status, last_seen DESC);


-- v0.7: direct mention / clarification behavior
CREATE TABLE IF NOT EXISTS bot_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  direct_mentions_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  direct_mentions_bypass_channel_mode BOOLEAN NOT NULL DEFAULT TRUE,
  direct_mentions_use_reply_context BOOLEAN NOT NULL DEFAULT TRUE,
  direct_mentions_use_recent_context BOOLEAN NOT NULL DEFAULT TRUE,
  direct_mentions_context_messages INTEGER NOT NULL DEFAULT 8 CHECK (direct_mentions_context_messages BETWEEN 0 AND 25),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO bot_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- v0.8: bug intelligence + knowledge gap workflow
ALTER TABLE issues ADD COLUMN IF NOT EXISTS aliases TEXT[] NOT NULL DEFAULT '{}'::TEXT[];
ALTER TABLE issues ADD COLUMN IF NOT EXISTS symptoms TEXT[] NOT NULL DEFAULT '{}'::TEXT[];
ALTER TABLE issues ADD COLUMN IF NOT EXISTS log_patterns TEXT[] NOT NULL DEFAULT '{}'::TEXT[];
ALTER TABLE issues ADD COLUMN IF NOT EXISTS workaround TEXT;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS embedding VECTOR(1536);
ALTER TABLE issues ADD COLUMN IF NOT EXISTS embedding_updated_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_issues_aliases ON issues USING GIN (aliases);
CREATE INDEX IF NOT EXISTS idx_issues_symptoms ON issues USING GIN (symptoms);

DELETE FROM issue_reports a USING issue_reports b
 WHERE a.id > b.id AND a.issue_id=b.issue_id AND a.discord_user_id=b.discord_user_id
   AND a.discord_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_issue_reports_unique_user
  ON issue_reports(issue_id, discord_user_id)
  WHERE discord_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS issue_candidates (
  id BIGSERIAL PRIMARY KEY,
  fingerprint TEXT NOT NULL UNIQUE,
  sample_text TEXT NOT NULL,
  normalized_text TEXT NOT NULL,
  topic TEXT,
  related_terms TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  discord_user_id TEXT,
  channel_id TEXT,
  discord_message_id BIGINT REFERENCES discord_messages(id) ON DELETE SET NULL,
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  confirmed_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'detected' CHECK (status IN ('detected','reported','promoted','dismissed')),
  matched_issue_id BIGINT REFERENCES issues(id) ON DELETE SET NULL,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_issue_candidates_status_seen ON issue_candidates(status, last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_issue_candidates_normalized_trgm ON issue_candidates USING GIN (normalized_text gin_trgm_ops);

CREATE TABLE IF NOT EXISTS issue_candidate_confirmations (
  candidate_id BIGINT NOT NULL REFERENCES issue_candidates(id) ON DELETE CASCADE,
  discord_user_id TEXT NOT NULL,
  confirmation_type TEXT NOT NULL DEFAULT 'report',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (candidate_id, discord_user_id)
);
ALTER TABLE knowledge_gaps ADD COLUMN IF NOT EXISTS converted_article_id BIGINT REFERENCES knowledge_articles(id) ON DELETE SET NULL;
ALTER TABLE knowledge_gaps ADD COLUMN IF NOT EXISTS display_question TEXT;

-- v0.8.2: preserve the evidence used to create a knowledge gap so re-analysis never destroys context
ALTER TABLE knowledge_gaps ADD COLUMN IF NOT EXISTS conversation_context TEXT;
ALTER TABLE knowledge_gaps ADD COLUMN IF NOT EXISTS partial_answer TEXT;
ALTER TABLE knowledge_gaps ADD COLUMN IF NOT EXISTS discord_message_id BIGINT REFERENCES discord_messages(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_knowledge_gaps_discord_message ON knowledge_gaps(discord_message_id);

-- v0.9: bug operations, triage evidence, editable issue categories
CREATE TABLE IF NOT EXISTS issue_categories (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 100,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO issue_categories (key,label,description,sort_order) VALUES
  ('general','General','General or uncategorized server issues.',10),
  ('vehicles-garages','Vehicles & Garages','Vehicle spawning, storage, garages, impounds, keys, and persistence.',20),
  ('phone','Phone','Phone, apps, calls, messages, and related integrations.',30),
  ('banking','Banking','Banks, payments, accounts, paychecks, and transfers.',40),
  ('inventory','Inventory','Inventory, items, weapons, stashes, and containers.',50),
  ('housing','Housing','Housing, properties, doors, storage, and ownership.',60),
  ('jobs-businesses','Jobs & Businesses','Jobs, businesses, duty, society, and employee systems.',70),
  ('leo','Police / LEO','Law-enforcement scripts, MDT, dispatch, radar, and equipment.',80),
  ('ems','Fire / EMS','Medical, EMS, Fire, hospital, revive, and treatment systems.',90),
  ('voice-radio','Voice & Radio','Voice chat, radio, proximity, and communication systems.',100),
  ('ui','UI / Menus','Menus, HUD, NUI, prompts, and interface problems.',110),
  ('performance','Performance / Crashes','Client crashes, server performance, hitching, lag, and timeouts.',120),
  ('server-systems','Server Systems','Core framework, database, permissions, and shared systems.',130),
  ('other','Other','Anything that does not fit another issue category.',999)
ON CONFLICT (key) DO NOTHING;

INSERT INTO issue_categories (key,label,description,sort_order)
SELECT DISTINCT category, initcap(replace(replace(category, '-', ' '), '_', ' ')), 'Imported from existing known issues.', 500
  FROM issues
 WHERE category IS NOT NULL AND category <> ''
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS issue_candidate_events (
  id BIGSERIAL PRIMARY KEY,
  candidate_id BIGINT NOT NULL REFERENCES issue_candidates(id) ON DELETE CASCADE,
  discord_message_id BIGINT REFERENCES discord_messages(id) ON DELETE SET NULL,
  discord_user_id TEXT,
  report_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_issue_candidate_events_message
  ON issue_candidate_events(candidate_id,discord_message_id)
  WHERE discord_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_issue_candidate_events_candidate_time
  ON issue_candidate_events(candidate_id,created_at DESC);

INSERT INTO issue_candidate_events (candidate_id,discord_message_id,discord_user_id,report_text,created_at)
SELECT c.id,c.discord_message_id,c.discord_user_id,c.sample_text,c.first_seen
  FROM issue_candidates c
 WHERE NOT EXISTS (SELECT 1 FROM issue_candidate_events e WHERE e.candidate_id=c.id);

CREATE TABLE IF NOT EXISTS issue_updates (
  id BIGSERIAL PRIMARY KEY,
  issue_id BIGINT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  update_type TEXT NOT NULL,
  from_value TEXT,
  to_value TEXT,
  note TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_issue_updates_issue_time ON issue_updates(issue_id,created_at DESC);

-- v1.0: Discord issue tickets, community evidence, and status-driven public responses
ALTER TABLE issues DROP CONSTRAINT IF EXISTS issues_status_check;
ALTER TABLE issues ADD CONSTRAINT issues_status_check CHECK (status IN ('new','acknowledged','investigating','fix_in_progress','testing','monitoring','resolved','wont_fix'));
ALTER TABLE issues ADD COLUMN IF NOT EXISTS discord_thread_id TEXT;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS discord_status_channel_id TEXT;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS discord_status_message_id TEXT;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS community_summary TEXT;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS reproduction_steps TEXT[] NOT NULL DEFAULT '{}'::TEXT[];
ALTER TABLE issues ADD COLUMN IF NOT EXISTS reported_locations TEXT[] NOT NULL DEFAULT '{}'::TEXT[];
ALTER TABLE issues ADD COLUMN IF NOT EXISTS thread_last_activity_at TIMESTAMPTZ;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS thread_summary_updated_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_issues_discord_thread ON issues(discord_thread_id) WHERE discord_thread_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS issue_automation_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  intake_channel_id TEXT,
  auto_create_threads BOOLEAN NOT NULL DEFAULT TRUE,
  allow_player_details BOOLEAN NOT NULL DEFAULT TRUE,
  auto_summarize_thread BOOLEAN NOT NULL DEFAULT TRUE,
  auto_update_symptoms BOOLEAN NOT NULL DEFAULT TRUE,
  auto_collect_workarounds BOOLEAN NOT NULL DEFAULT TRUE,
  auto_collect_reproduction BOOLEAN NOT NULL DEFAULT TRUE,
  auto_collect_locations BOOLEAN NOT NULL DEFAULT TRUE,
  edit_original_status_message BOOLEAN NOT NULL DEFAULT TRUE,
  post_status_updates_to_thread BOOLEAN NOT NULL DEFAULT TRUE,
  auto_public_response BOOLEAN NOT NULL DEFAULT TRUE,
  include_bug_id BOOLEAN NOT NULL DEFAULT TRUE,
  include_workaround BOOLEAN NOT NULL DEFAULT TRUE,
  include_affected_count BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO issue_automation_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS issue_status_templates (
  status TEXT PRIMARY KEY,
  template TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT issue_status_templates_status_check CHECK (status IN ('new','acknowledged','investigating','fix_in_progress','testing','monitoring','resolved','wont_fix'))
);
INSERT INTO issue_status_templates (status,template) VALUES
  ('new','We have received reports of **{{title}}**. Staff are reviewing the reports now.'),
  ('acknowledged','We are aware of **{{title}}** and have acknowledged the reports.'),
  ('investigating','We are aware of **{{title}}** and are currently investigating the cause.'),
  ('fix_in_progress','We have identified the issue affecting **{{title}}** and a fix is currently being worked on.'),
  ('testing','A potential fix for **{{title}}** is currently being tested. Please continue reporting it if you still experience the issue.'),
  ('monitoring','A fix for **{{title}}** has been deployed. We are monitoring for additional reports before marking it resolved.'),
  ('resolved','The issue affecting **{{title}}** has been resolved. If you still experience the problem, please report it so staff can investigate further.'),
  ('wont_fix','**{{title}}** has been reviewed and is not currently planned for a fix.')
ON CONFLICT (status) DO NOTHING;

CREATE TABLE IF NOT EXISTS issue_thread_entries (
  id BIGSERIAL PRIMARY KEY,
  issue_id BIGINT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  discord_message_id BIGINT REFERENCES discord_messages(id) ON DELETE SET NULL,
  discord_user_id TEXT,
  author_name TEXT,
  content TEXT NOT NULL,
  extracted JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_issue_thread_entries_issue_time ON issue_thread_entries(issue_id,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_issue_thread_entries_message ON issue_thread_entries(discord_message_id) WHERE discord_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS issue_observations (
  id BIGSERIAL PRIMARY KEY,
  issue_id BIGINT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('symptom','workaround','reproduction','location','clue')),
  value TEXT NOT NULL,
  normalized_value TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'community' CHECK (status IN ('community','verified','rejected')),
  confirmations INTEGER NOT NULL DEFAULT 0,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(issue_id,kind,normalized_value)
);
CREATE INDEX IF NOT EXISTS idx_issue_observations_issue_kind ON issue_observations(issue_id,kind,status,confirmations DESC);

CREATE TABLE IF NOT EXISTS issue_observation_confirmations (
  observation_id BIGINT NOT NULL REFERENCES issue_observations(id) ON DELETE CASCADE,
  discord_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (observation_id,discord_user_id)
);

-- v1.1: knowledge content types + AI authoring metadata
CREATE TABLE IF NOT EXISTS knowledge_content_types (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  moderation_eligible BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 100,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO knowledge_content_types (key,label,description,moderation_eligible,sort_order) VALUES
  ('server_rule','Server Rule','FiveM/server rules, roleplay expectations, and gameplay conduct.',FALSE,10),
  ('discord_rule','Discord Rule','Discord/community conduct rules. These can later be connected to moderation automation.',TRUE,20),
  ('guide','Guide','How-to instructions and player guides.',FALSE,30),
  ('faq','FAQ','Frequently asked questions and concise answers.',FALSE,40),
  ('sop','SOP / Department','Department procedures, SOPs, and internal operational guidance.',FALSE,50),
  ('reference','Reference','Commands, systems, definitions, and reference information.',FALSE,60),
  ('other','Other','Knowledge that does not fit another content type.',FALSE,999)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE knowledge_articles ADD COLUMN IF NOT EXISTS content_type TEXT NOT NULL DEFAULT 'other';
UPDATE knowledge_articles SET content_type='server_rule' WHERE content_type='other' AND category='rules';
UPDATE knowledge_articles SET content_type='sop' WHERE content_type='other' AND category IN ('leo','ems','staff');
UPDATE knowledge_articles SET content_type='guide' WHERE content_type='other' AND category IN ('getting-started','radio','commands');
CREATE INDEX IF NOT EXISTS idx_knowledge_content_type ON knowledge_articles(content_type,status,updated_at DESC);


-- v1.2: role-based dashboard permissions
CREATE TABLE IF NOT EXISTS dashboard_permission_config (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  configured BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO dashboard_permission_config (id,configured) VALUES (1,FALSE) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS dashboard_role_permissions (
  role_id TEXT NOT NULL,
  permission_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (role_id,permission_key)
);
CREATE INDEX IF NOT EXISTS idx_dashboard_role_permissions_role ON dashboard_role_permissions(role_id);

CREATE TABLE IF NOT EXISTS dashboard_permission_audit (
  id BIGSERIAL PRIMARY KEY,
  role_id TEXT NOT NULL,
  permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  changed_by_user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dashboard_permission_audit_time ON dashboard_permission_audit(created_at DESC);


-- v1.3: moderation observe mode
CREATE TABLE IF NOT EXISTS moderation_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  mode TEXT NOT NULL DEFAULT 'off' CHECK (mode IN ('off','observe')),
  minimum_confidence NUMERIC(4,3) NOT NULL DEFAULT 0.900 CHECK (minimum_confidence >= 0 AND minimum_confidence <= 1),
  repeat_window_days INTEGER NOT NULL DEFAULT 7 CHECK (repeat_window_days BETWEEN 1 AND 90),
  audit_channel_id TEXT,
  post_observations_to_audit BOOLEAN NOT NULL DEFAULT FALSE,
  exempt_role_ids TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO moderation_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS moderation_rule_settings (
  article_id BIGINT PRIMARY KEY REFERENCES knowledge_articles(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  minimum_confidence NUMERIC(4,3) CHECK (minimum_confidence IS NULL OR (minimum_confidence >= 0 AND minimum_confidence <= 1)),
  recommended_action TEXT NOT NULL DEFAULT 'staff_review' CHECK (recommended_action IN ('staff_review','reminder','warning','delete_message','timeout_10m','timeout_1h')),
  repeat_window_days INTEGER CHECK (repeat_window_days IS NULL OR repeat_window_days BETWEEN 1 AND 90),
  exempt_role_ids TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  channel_ids TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS moderation_cases (
  id BIGSERIAL PRIMARY KEY,
  public_id TEXT UNIQUE,
  discord_message_id BIGINT UNIQUE REFERENCES discord_messages(id) ON DELETE SET NULL,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  channel_name TEXT,
  message_id TEXT NOT NULL,
  discord_user_id TEXT NOT NULL,
  author_name TEXT,
  message_content TEXT NOT NULL,
  rule_article_id BIGINT REFERENCES knowledge_articles(id) ON DELETE SET NULL,
  rule_title TEXT NOT NULL,
  confidence NUMERIC(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  ai_reason TEXT NOT NULL DEFAULT '',
  evidence TEXT NOT NULL DEFAULT '',
  recommended_action TEXT NOT NULL DEFAULT 'staff_review' CHECK (recommended_action IN ('staff_review','reminder','warning','delete_message','timeout_10m','timeout_1h')),
  prior_confirmed_count INTEGER NOT NULL DEFAULT 0,
  mode TEXT NOT NULL DEFAULT 'observe' CHECK (mode IN ('observe')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','dismissed')),
  review_notes TEXT,
  reviewed_by_user_id TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_moderation_cases_status_time ON moderation_cases(status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_moderation_cases_user_time ON moderation_cases(discord_user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_moderation_cases_rule_time ON moderation_cases(rule_article_id,created_at DESC);

CREATE TABLE IF NOT EXISTS moderation_case_events (
  id BIGSERIAL PRIMARY KEY,
  case_id BIGINT NOT NULL REFERENCES moderation_cases(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('detected','confirmed','dismissed','reopened','note')),
  actor_user_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_moderation_case_events_case_time ON moderation_case_events(case_id,created_at DESC);



-- v1.3.1: moderation diagnostics / observe-mode tracing
ALTER TABLE moderation_settings ADD COLUMN IF NOT EXISTS diagnostics_enabled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS moderation_diagnostics (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'live' CHECK (source IN ('live','manual')),
  result_code TEXT NOT NULL,
  guild_id TEXT,
  channel_id TEXT,
  channel_name TEXT,
  discord_message_id TEXT,
  discord_user_id TEXT,
  author_name TEXT,
  message_content TEXT NOT NULL DEFAULT '',
  matched_rule_id BIGINT REFERENCES knowledge_articles(id) ON DELETE SET NULL,
  matched_rule_title TEXT,
  confidence NUMERIC(4,3) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  threshold NUMERIC(4,3) CHECK (threshold IS NULL OR (threshold >= 0 AND threshold <= 1)),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_moderation_diagnostics_time ON moderation_diagnostics(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_moderation_diagnostics_result_time ON moderation_diagnostics(result_code,created_at DESC);


-- v1.3.4: repeat-offense action ladders (observe-mode simulation only)
ALTER TABLE moderation_rule_settings
  ADD COLUMN IF NOT EXISTS action_ladder JSONB;

ALTER TABLE moderation_cases
  ADD COLUMN IF NOT EXISTS offense_number INTEGER NOT NULL DEFAULT 1;

ALTER TABLE moderation_cases
  ADD COLUMN IF NOT EXISTS repeat_window_days_used INTEGER;

ALTER TABLE moderation_cases
  ADD COLUMN IF NOT EXISTS action_ladder_snapshot JSONB;

-- Existing cases already saved prior_confirmed_count. Use that to give historical
-- rows a sensible offense number without changing their saved recommended action.
UPDATE moderation_cases
SET offense_number = GREATEST(1, prior_confirmed_count + 1)
WHERE offense_number = 1 AND prior_confirmed_count > 0;


-- v1.3.5: allow Delete Message as a secondary action on each escalation step
ALTER TABLE moderation_cases
  ADD COLUMN IF NOT EXISTS delete_message_recommended BOOLEAN NOT NULL DEFAULT FALSE;

-- Preserve the meaning of older observe-mode cases where Delete Message was the
-- only simulated recommendation.
UPDATE moderation_cases
SET delete_message_recommended = TRUE
WHERE recommended_action = 'delete_message'
  AND delete_message_recommended = FALSE;
