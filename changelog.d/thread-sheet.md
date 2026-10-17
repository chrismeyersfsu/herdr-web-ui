### Added
- Thread sheet (off by default, Settings → Chat): selecting text in a pi reply offers
  "Learn more", a side conversation the pi threads extension runs in a background session while
  the chat stays put. The sheet lists a conversation's threads with live status and streams the
  active thread's turns; new endpoints `GET /api/pane/threads` and `GET /api/pane/thread` read
  the extension's registry and transcripts.
