CREATE TABLE ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc TEXT NOT NULL,
  version INTEGER NOT NULL,
  ops TEXT NOT NULL,
  inverse TEXT NOT NULL,
  session_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  -- Set when this row is itself the inverse-application of an earlier row,
  -- so undo can exclude both from future candidates (a cursor, not a toggle).
  undoes INTEGER REFERENCES ledger(id),
  UNIQUE(doc, version)
);
