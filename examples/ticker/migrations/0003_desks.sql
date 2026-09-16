-- The desk: the tray's own state per session -- which compartment is open, whose drawer, how the
-- board is read, what find says. A visit's, never on the ledger. No sign-in here: a session is
-- whoever is at the desk.
CREATE TABLE desks (
  session_id  TEXT PRIMARY KEY,
  ui          TEXT NOT NULL DEFAULT '{}'
);
