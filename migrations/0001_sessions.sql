CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  name TEXT,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);
