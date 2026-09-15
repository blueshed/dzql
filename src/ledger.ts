import { db } from "./db";
import type { PatchOp } from "./json-patch";

export type LedgerEntry = {
  id: number;
  doc: string;
  version: number;
  ops: PatchOp[];
  inverse: PatchOp[];
  sessionId: string;
  at: number;
};

const currentVersionStmt = db.query<{ version: number | null }, [string]>(
  "SELECT MAX(version) AS version FROM ledger WHERE doc = ?",
);
const insertStmt = db.query<unknown, [string, number, string, string, string, number, number | null, number]>(
  "INSERT INTO ledger (doc, version, ops, inverse, session_id, at, undoes, undoable) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
);
const historyStmt = db.query<
  { id: number; doc: string; version: number; ops: string; inverse: string; sessionId: string; at: number },
  [string, number]
>(`
  SELECT id, doc, version, ops, inverse, session_id AS sessionId, at
  FROM ledger
  WHERE doc = ?
  ORDER BY version DESC
  LIMIT ?
`);
// Undo and redo are one cursor over this session's entries, read from the ledger alone. An
// entry's `undoes` links it to the entry it walked back, so entries form chains: a write, the
// undo of it, the redo of that (an undo of the undo), and so on. Depth along the chain says
// which way an entry went (even: forward, a write or a redo; odd: backward, an undo), and the
// entry at the end of a chain -- the tip, nothing has undone it yet -- is the one that counts.
// A fresh write ends what could be redone: a redo candidate must be newer than the session's
// newest original write, as in any editor. A write recorded as not undoable (a fact: a price
// tick) starts no chain and ends no redo: the cursor passes over it as if it were not there.
const tipsCte = `
  WITH RECURSIVE chain(id, depth) AS (
    SELECT id, 0 FROM ledger WHERE session_id = ?1 AND undoes IS NULL AND undoable = 1
    UNION ALL
    SELECT l.id, c.depth + 1 FROM ledger l JOIN chain c ON l.undoes = c.id
  ),
  tips AS (
    SELECT c.id, c.depth FROM chain c WHERE c.id NOT IN (SELECT undoes FROM ledger WHERE undoes IS NOT NULL)
  )
`;
const entryColumns = "l.id, l.doc, l.version, l.ops, l.inverse, l.session_id AS sessionId, l.at";
type EntryRow = { id: number; doc: string; version: number; ops: string; inverse: string; sessionId: string; at: number };
// The newest forward tip: the next write to walk back.
const nextUndoStmt = db.query<EntryRow, [string]>(`${tipsCte}
  SELECT ${entryColumns} FROM ledger l JOIN tips t ON t.id = l.id
  WHERE t.depth % 2 = 0
  ORDER BY l.id DESC
  LIMIT 1
`);
// The newest backward tip, unless a fresh write has come since: the next undo to walk forward again.
const nextRedoStmt = db.query<EntryRow, [string]>(`${tipsCte}
  SELECT ${entryColumns} FROM ledger l JOIN tips t ON t.id = l.id
  WHERE t.depth % 2 = 1
    AND l.id > COALESCE((SELECT MAX(id) FROM ledger WHERE session_id = ?1 AND undoes IS NULL AND undoable = 1), 0)
  ORDER BY l.id DESC
  LIMIT 1
`);

function currentVersion(doc: string): number {
  return currentVersionStmt.get(doc)?.version ?? 0;
}

/** The ledger's `doc` column is always `<docType>:<docId>` -- one shared convention, defined once. */
export function prefixDoc(docType: string, docId: string): string {
  return `${docType}:${docId}`;
}

export function splitDoc(doc: string): { docType: string; docId: string } {
  const separator = doc.indexOf(":");
  return { docType: doc.slice(0, separator), docId: doc.slice(separator + 1) };
}

function toEntry(row: {
  id: number;
  doc: string;
  version: number;
  ops: string;
  inverse: string;
  sessionId: string;
  at: number;
}): LedgerEntry {
  return {
    id: row.id,
    doc: row.doc,
    version: row.version,
    ops: JSON.parse(row.ops),
    inverse: JSON.parse(row.inverse),
    sessionId: row.sessionId,
    at: row.at,
  };
}

/**
 * Records a patch's ops and their inverse against `doc`, returning the new
 * version. A no-op patch (`ops` empty — nothing in the request actually
 * applied) doesn't create a new version. `undoes` marks this entry as the
 * inverse-application of an earlier entry, so it is never itself picked as
 * a future undo target (a cursor walks back through original writes, it
 * doesn't toggle the same one back and forth). `undoable: false` records a
 * fact -- a price tick, a reading -- for history, but keeps it off every
 * session's Undo, which would otherwise falsify it.
 */
export function record(doc: string, ops: PatchOp[], inverse: PatchOp[], sessionId: string, undoes?: number, undoable = true): number {
  if (ops.length === 0) return currentVersion(doc);
  const version = currentVersion(doc) + 1;
  insertStmt.run(doc, version, JSON.stringify(ops), JSON.stringify(inverse), sessionId, Date.now(), undoes ?? null, undoable ? 1 : 0);
  return version;
}

export function history(doc: string, limit = 50): LedgerEntry[] {
  return historyStmt.all(doc, limit).map(toEntry);
}

export function nextUndo(sessionId: string): LedgerEntry | undefined {
  const row = nextUndoStmt.get(sessionId);
  return row ? toEntry(row) : undefined;
}

/** The undo this session would walk forward again: applying its `inverse` is the original write over, recorded with `undoes` set to it. */
export function nextRedo(sessionId: string): LedgerEntry | undefined {
  const row = nextRedoStmt.get(sessionId);
  return row ? toEntry(row) : undefined;
}
