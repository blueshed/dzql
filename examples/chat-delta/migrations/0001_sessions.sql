-- The session is eta's own document (the tray): who you are and which room you are in. The
-- rooms and their messages are delta's (delta.ts), which makes its own tables.
CREATE TABLE cd_sessions (
  id TEXT PRIMARY KEY,
  name TEXT,
  room TEXT,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);
