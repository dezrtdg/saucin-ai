-- LB Phone builds its registered key mappings dynamically, so the static scanner
-- intentionally left them in review. Import the verified defaults from the
-- official LB Phone keybind documentation instead.

INSERT INTO knowledge_articles
  (title,body,content_type,category,audience,audiences,status,source_url,aliases,related_topics,example_questions,created_by)
SELECT
  'Phone Keybinds',
  $body$
Press **F1** to open your phone. You can also use the **/phone** command.

### General phone controls

- **F1** — Open the phone.
- **Left Alt** — Toggle the phone cursor.
- **Space** — Open or expand the phone when prompted.

### Phone-call controls

- **Enter** — Answer an incoming call.
- **Backspace** — Decline an incoming call.

### Phone-camera controls

- **Up Arrow** — Flip the camera.
- **Enter** — Take a photo or video.
- **E** — Toggle the camera flash.
- **Left Arrow** — Cycle the camera mode left.
- **Right Arrow** — Cycle the camera mode right.

These are the LB Phone defaults. Existing players keep any keybind already saved to their FiveM profile, even when the server default changes. If a control does not match, open **GTA V Settings → Key Bindings → FiveM** and search for the phone action.
$body$,
  'reference',
  'keybinds',
  'public',
  ARRAY['public'],
  'published',
  'https://docs.lbscripts.com/phone/configuration/keybinds/',
  ARRAY[
    'lb-phone','LB Phone','phone','cellphone','cell phone','mobile phone','phone controls','phone keybinds',
    'open phone','access phone','phone button','phone key','F1','/phone','toggle phone cursor',
    '/togglePhoneFocus','answer call','decline call','phone camera'
  ],
  ARRAY['keybinds','controls','phone','LB Phone','phone calls','phone camera','FiveM key bindings'],
  ARRAY[
    'How do I open my phone?',
    'What key opens the phone?',
    'What button do I press to use my phone?',
    'What is the phone command?',
    'How do I toggle the phone cursor?',
    'How do I answer or decline a phone call?',
    'What are the phone camera controls?',
    'Why does F1 not open my phone?'
  ],
  'LB Phone documentation · imported 2026-09-04'
WHERE NOT EXISTS (
  SELECT 1 FROM knowledge_articles
  WHERE lower(title) IN ('phone keybinds','lb phone keybinds')
     OR created_by='LB Phone documentation · imported 2026-09-04'
);

