-- The tray's own state: which compartment is open, whose drawer, what find says. A visit's, not a
-- fact: never on the ledger, forgotten on logout.
ALTER TABLE sessions ADD COLUMN ui TEXT NOT NULL DEFAULT '{}';
