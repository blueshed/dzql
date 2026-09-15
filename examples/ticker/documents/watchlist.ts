import { db } from "../db";
import type { PatchOp } from "../../../src/json-patch";
import { parsePointer } from "../../../src/json-pointer";
import { prefixDoc, record } from "../../../src/ledger";
import { has } from "./market";

// A session's watchlist: the symbols its board shows, in the order added. `add /symbols/-` and
// `remove /symbols/<index>`, each with its inverse on the ledger -- the writes Undo and Redo
// walk in this example.

export type WatchlistDocument = { symbols: string[] };

const listStmt = db.query<{ symbol: string }, [string]>("SELECT symbol FROM watchlists WHERE session_id = ? ORDER BY seq");
const insertStmt = db.query<unknown, [string, string, number]>("INSERT INTO watchlists (session_id, symbol, seq) VALUES (?, ?, ?)");
const deleteStmt = db.query<unknown, [string, string]>("DELETE FROM watchlists WHERE session_id = ? AND symbol = ?");
const maxSeqStmt = db.query<{ seq: number | null }, [string]>("SELECT MAX(seq) AS seq FROM watchlists WHERE session_id = ?");

export function read(sessionId: string): WatchlistDocument {
  return { symbols: listStmt.all(sessionId).map((r) => r.symbol) };
}

export type WatchlistPatchResult = { version: number; applied: PatchOp[] };

/** One transaction: every statement here, the ledger row, and the version it returns commit together or not at all. */
export const patch = db.transaction(function patch(sessionId: string, ops: PatchOp[], undoes?: number): WatchlistPatchResult {
  const applied: PatchOp[] = [];
  const inverse: PatchOp[] = [];

  for (const op of ops) {
    const [field, key] = parsePointer(op.path);
    if (field !== "symbols" || key === undefined) continue;
    const { symbols } = read(sessionId);

    if (key === "-" && op.op === "add") {
      const symbol = String(op.value ?? "").trim().toUpperCase();
      if (!symbol || !has(symbol) || symbols.includes(symbol)) continue;
      insertStmt.run(sessionId, symbol, (maxSeqStmt.get(sessionId)?.seq ?? 0) + 1);
      applied.push({ ...op, value: symbol });
      inverse.unshift({ op: "remove", path: `/symbols/${symbols.length}` });
    } else if (op.op === "remove") {
      const index = Number(key);
      const symbol = Number.isInteger(index) ? symbols[index] : undefined;
      if (symbol === undefined) continue;
      deleteStmt.run(sessionId, symbol);
      applied.push(op);
      // Coming back lands at the end, not its old place -- enough for undo, which never re-inverts this.
      inverse.unshift({ op: "add", path: "/symbols/-", value: symbol });
    }
  }

  const version = record(prefixDoc("watchlist", sessionId), applied, inverse, sessionId, undoes);
  return { version, applied };
});
