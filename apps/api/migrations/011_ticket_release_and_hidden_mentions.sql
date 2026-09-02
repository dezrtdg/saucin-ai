-- Saucin AI v1.6.1: ticket release workflow and concealed staff routing mentions.

ALTER TABLE ticket_settings
  ADD COLUMN IF NOT EXISTS hide_staff_mentions BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS delete_closed_channels BOOLEAN NOT NULL DEFAULT FALSE;
