-- Some writes are facts, not the person's doing: a price tick, a reading from a sensor. They
-- belong on the ledger (history, replay, inspect) but never under a person's Undo, which would
-- falsify the fact. `undoable` says which; the cursor (nextUndo/nextRedo) never lands on a 0.
ALTER TABLE ledger ADD COLUMN undoable INTEGER NOT NULL DEFAULT 1;
