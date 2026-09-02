-- Discord Forum channels may require a tag on every new post.
ALTER TABLE suggestion_automation_settings
  ADD COLUMN IF NOT EXISTS forum_tag_id TEXT;
