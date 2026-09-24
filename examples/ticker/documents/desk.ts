import { db } from "../db";
import { reading } from "../../../src/reading";
import { address, parseAddress, patchCollections, type Collections } from "../../../src/bento";
import type { PatchOp } from "../../../src/json-patch";
import { parsePointer } from "../../../src/json-pointer";

// The desk: where this session is on the page -- one address (src/bento.ts): the compartment grown
// into the window, and the one thing open over it, a symbol's drawer or the clock's, or the modal
// that asks -- and how the board is read and what find says. Nothing here is a fact: it is never
// on the ledger, and Undo passes over it.

export type Ui = {
  /** "" the desk, "board" or "market" a window; then "?symbol=ALPH", "?clock", "?new", "?confirm=ALPH". */
  page?: string;
} & Collections; // how the board is read, what find says

const readStmt = db.query<{ ui: string }, [string]>("SELECT ui FROM desks WHERE session_id = ?");
const upsertStmt = db.query<unknown, [string, string]>("INSERT INTO desks (session_id, ui) VALUES (?1, ?2) ON CONFLICT(session_id) DO UPDATE SET ui = ?2");

export function read(sessionId: string): Ui {
  reading("desk", sessionId);
  const row = readStmt.get(sessionId);
  return row ? (JSON.parse(row.ui) as Ui) : {};
}

export type DeskPatchResult = { version: number; applied: PatchOp[] };

const SYMBOL = /^[A-Z0-9.]{1,6}$/;

/** The address as the desk keeps it, or undefined when it names nowhere: a window the desk has, and over it a symbol the market could quote, the clock, the ask, or the asking-first. */
function placed(value: unknown): string | undefined {
  const { path, what, which = "" } = parseAddress(String(value ?? ""));
  if (path !== "" && path !== "board" && path !== "market") return undefined;
  if (what === undefined) return path;
  const symbol = which.trim().toUpperCase();
  if (what === "symbol" || what === "confirm") return SYMBOL.test(symbol) ? address(path, what, symbol) : undefined;
  if (what === "clock" || (what === "new" && path === "board")) return address(path, what);
  return undefined;
}

/** Applies what it can; the version is always 0, since nothing here is recorded. */
export function patch(sessionId: string, ops: PatchOp[]): DeskPatchResult {
  const applied: PatchOp[] = [];
  const ui: Ui = { ...read(sessionId) };
  for (const op of ops) {
    const [field] = parsePointer(op.path);
    if (field === "page") {
      const page = op.op === "remove" ? "" : placed(op.value);
      if (page === undefined) continue;
      ui.page = page;
    } else if (!patchCollections(ui, op)) {
      continue; // not a reading, find's word or the eye either (src/bento.ts)
    }
    applied.push(op);
  }
  if (applied.length) upsertStmt.run(sessionId, JSON.stringify(ui));
  return { version: 0, applied };
}
