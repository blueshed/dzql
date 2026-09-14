import { db } from "./db";
import type { PatchOp } from "./json-patch";

export type LedgerEntry = {
  version: number;
  ops: PatchOp[];
  inverse: PatchOp[];
  sessionId: string;
  at: number;
};

const currentVersionStmt = db.query<{ version: number | null }, [string]>(
  "SELECT MAX(version) AS version FROM ledger WHERE doc = ?",
);
const insertStmt = db.query<unknown, [string, number, string, string, string, number]>(
  "INSERT INTO ledger (doc, version, ops, inverse, session_id, at) VALUES (?, ?, ?, ?, ?, ?)",
);
const historyStmt = db.query<
  { version: number; ops: string; inverse: string; sessionId: string; at: number },
  [string, number]
>(`
  SELECT version, ops, inverse, session_id AS sessionId, at
  FROM ledger
  WHERE doc = ?
  ORDER BY version DESC
  LIMIT ?
`);

function currentVersion(doc: string): number {
  return currentVersionStmt.get(doc)?.version ?? 0;
}

/**
 * Records a patch's ops and their inverse against `doc`, returning the new
 * version. A no-op patch (`ops` empty — nothing in the request actually
 * applied) doesn't create a new version.
 */
export function record(doc: string, ops: PatchOp[], inverse: PatchOp[], sessionId: string): number {
  if (ops.length === 0) return currentVersion(doc);
  const version = currentVersion(doc) + 1;
  insertStmt.run(doc, version, JSON.stringify(ops), JSON.stringify(inverse), sessionId, Date.now());
  return version;
}

export function history(doc: string, limit = 50): LedgerEntry[] {
  return historyStmt.all(doc, limit).map((row) => ({
    version: row.version,
    ops: JSON.parse(row.ops),
    inverse: JSON.parse(row.inverse),
    sessionId: row.sessionId,
    at: row.at,
  }));
}
