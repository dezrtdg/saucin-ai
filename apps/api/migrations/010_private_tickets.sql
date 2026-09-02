-- Saucin AI v1.6: private support tickets and reversible moderation actions.

CREATE TABLE IF NOT EXISTS ticket_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  panel_channel_id TEXT,
  panel_message_id TEXT,
  open_category_id TEXT,
  closed_category_id TEXT,
  transcript_channel_id TEXT,
  max_open_per_user INTEGER NOT NULL DEFAULT 2 CHECK (max_open_per_user BETWEEN 1 AND 10),
  allow_user_close BOOLEAN NOT NULL DEFAULT TRUE,
  warning_role_ids TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  timeout_role_ids TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  kick_role_ids TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  ban_role_ids TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  reversal_role_ids TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO ticket_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS ticket_types (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  emoji TEXT,
  intake_prompt TEXT NOT NULL DEFAULT '',
  support_role_ids TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  category_override_id TEXT,
  allow_punishments BOOLEAN NOT NULL DEFAULT FALSE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 100,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO ticket_types
  (key,label,description,emoji,intake_prompt,allow_punishments,sort_order)
VALUES
  ('general-support','General Support','Questions or help that do not fit another ticket type.','🎫','Tell us what you need help with and include any useful details.',FALSE,10),
  ('player-report','Player Report','Privately report another community member or in-game incident.','🚩','Explain what happened, who was involved, when it happened, and attach any evidence you have.',TRUE,20),
  ('staff-report','Staff Report','Privately report a concern involving a staff member.','🛡️','Explain the concern clearly and include dates, messages, screenshots, or other supporting information.',TRUE,30),
  ('punishment-appeal','Punishment Appeal','Appeal a warning, timeout, kick, or ban.','⚖️','Include the punishment or case number, why you believe it should be reviewed, and any new context or evidence.',FALSE,40),
  ('bug-technical','Bug / Technical Issue','Get help with a technical problem or report a possible bug.','🐛','Describe what happened, what you expected, when it started, and any troubleshooting you already tried.',FALSE,50),
  ('contact-development','Contact Development','Privately contact the development team.','🧰','Explain what you need from the development team and include any relevant links, screenshots, or logs.',FALSE,60),
  ('business-gang-support','Business / Gang Support','Request help with an approved business, gang, or organization.','🏢','Name the business or group and explain the request, issue, or change you need reviewed.',FALSE,70)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS tickets (
  id BIGSERIAL PRIMARY KEY,
  public_id TEXT UNIQUE,
  type_key TEXT NOT NULL REFERENCES ticket_types(key),
  guild_id TEXT NOT NULL,
  channel_id TEXT UNIQUE,
  control_message_id TEXT,
  opener_user_id TEXT NOT NULL,
  opener_name TEXT,
  subject TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  involved_user_id TEXT,
  evidence_links TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'creating' CHECK (status IN ('creating','open','claimed','awaiting_user','closed','failed')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  claimed_by_user_id TEXT,
  claimed_by_name TEXT,
  claimed_at TIMESTAMPTZ,
  closed_by_user_id TEXT,
  closed_by_name TEXT,
  close_reason TEXT,
  closed_at TIMESTAMPTZ,
  transcript_channel_id TEXT,
  transcript_message_id TEXT,
  transcript_text TEXT,
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tickets_status_time ON tickets(status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_opener_status ON tickets(opener_user_id,status);
CREATE INDEX IF NOT EXISTS idx_tickets_type_status ON tickets(type_key,status);

CREATE TABLE IF NOT EXISTS ticket_participants (
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  discord_user_id TEXT NOT NULL,
  added_by_user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (ticket_id,discord_user_id)
);

CREATE TABLE IF NOT EXISTS ticket_messages (
  id BIGSERIAL PRIMARY KEY,
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  discord_message_id TEXT NOT NULL,
  discord_user_id TEXT NOT NULL,
  author_name TEXT,
  content TEXT NOT NULL DEFAULT '',
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_bot BOOLEAN NOT NULL DEFAULT FALSE,
  discord_created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(ticket_id,discord_message_id)
);
CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket_time ON ticket_messages(ticket_id,discord_created_at);

CREATE TABLE IF NOT EXISTS ticket_events (
  id BIGSERIAL PRIMARY KEY,
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor_user_id TEXT,
  actor_name TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ticket_events_ticket_time ON ticket_events(ticket_id,created_at DESC);

CREATE TABLE IF NOT EXISTS moderation_punishments (
  id BIGSERIAL PRIMARY KEY,
  public_id TEXT UNIQUE,
  ticket_id BIGINT REFERENCES tickets(id) ON DELETE SET NULL,
  source_moderation_case_id BIGINT REFERENCES moderation_cases(id) ON DELETE SET NULL,
  guild_id TEXT NOT NULL,
  target_user_id TEXT NOT NULL,
  target_name TEXT,
  action_type TEXT NOT NULL CHECK (action_type IN ('warning','timeout','kick','temporary_ban','permanent_ban')),
  duration_seconds INTEGER CHECK (duration_seconds IS NULL OR duration_seconds > 0),
  reason TEXT NOT NULL,
  internal_notes TEXT NOT NULL DEFAULT '',
  evidence_snapshot TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','completed','expired','reversed','failed','superseded')),
  external_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  issued_by_user_id TEXT NOT NULL,
  issued_by_name TEXT,
  issued_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  reversed_by_user_id TEXT,
  reversed_by_name TEXT,
  reversal_reason TEXT,
  reversed_at TIMESTAMPTZ,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_moderation_punishments_target_time ON moderation_punishments(target_user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_moderation_punishments_status_expiry ON moderation_punishments(status,expires_at);
CREATE INDEX IF NOT EXISTS idx_moderation_punishments_ticket ON moderation_punishments(ticket_id,created_at DESC);

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS appealed_punishment_id BIGINT REFERENCES moderation_punishments(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tickets_appealed_punishment ON tickets(appealed_punishment_id,status);

CREATE TABLE IF NOT EXISTS moderation_punishment_events (
  id BIGSERIAL PRIMARY KEY,
  punishment_id BIGINT NOT NULL REFERENCES moderation_punishments(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor_user_id TEXT,
  actor_name TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_moderation_punishment_events_time ON moderation_punishment_events(punishment_id,created_at DESC);
