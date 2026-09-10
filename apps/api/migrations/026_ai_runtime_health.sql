-- Central operational state for every OpenAI-backed workflow. This records only
-- sanitized provider status; prompts, Discord messages, and API credentials are
-- never stored here.
CREATE TABLE IF NOT EXISTS ai_runtime_health (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id=1),
  status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (status IN ('unknown','healthy','degraded','cooling_down')),
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  total_requests BIGINT NOT NULL DEFAULT 0,
  total_failures BIGINT NOT NULL DEFAULT 0,
  last_request_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  last_error_kind TEXT,
  last_error_message TEXT,
  cooldown_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO ai_runtime_health(id) VALUES (1)
ON CONFLICT(id) DO NOTHING;
