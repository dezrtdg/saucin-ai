-- Suggestions v4: testing workflow state and dashboard-originated staff updates.

ALTER TABLE suggestions DROP CONSTRAINT IF EXISTS suggestions_status_check;
ALTER TABLE suggestions
  ADD CONSTRAINT suggestions_status_check
  CHECK (status IN ('candidate','reviewing','planned','accepted','testing','declined','shipped'));

