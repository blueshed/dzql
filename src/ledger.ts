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
const insertStmt = db.query<unknown, [string, number, string, string, string, number, number | null]>(
  "INSERT INTO ledger (doc, version, ops, inverse, session_id, at, undoes) VALUES (?, ?, ?, ?, ?, ?, ?)",
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
// The newest entry this session wrote that is itself an original write (not
// an undo's own inverse-application) and has not already been undone --
// i.e. a cursor into this session's writes, derived from the ledger alone.
const nextUndoStmt = db.query<
  { id: number; doc: string; version: number; ops: string; inverse: string; sessionId: string; at: number },
  [string]
>(`
  SELECT id, doc, version, ops, inverse, session_id AS sessionId, at
  FROM ledger
  WHERE session_id = ?
    AND undoes IS NULL
    AND id NOT IN (SELECT undoes FROM ledger WHERE undoes IS NOT NULL)
  ORDER BY id DESC
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
 * doesn't toggle the same one back and forth).
 */
export function record(doc: string, ops: PatchOp[], inverse: PatchOp[], sessionId: string, undoes?: number): number {
  if (ops.length === 0) return currentVersion(doc);
  const version = currentVersion(doc) + 1;
  insertStmt.run(doc, version, JSON.stringify(ops), JSON.stringify(inverse), sessionId, Date.now(), undoes ?? null);
  return version;
}

export function history(doc: string, limit = 50): LedgerEntry[] {
  return historyStmt.all(doc, limit).map(toEntry);
}

export function nextUndo(sessionId: string): LedgerEntry | undefined {
  const row = nextUndoStmt.get(sessionId);
  return row ? toEntry(row) : undefined;
}
