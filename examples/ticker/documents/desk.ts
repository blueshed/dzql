import { db } from "../db";
import { patchCollections, type Collections } from "../../../src/bento";
import type { PatchOp } from "../../../src/json-patch";
import { parsePointer } from "../../../src/json-pointer";

// The desk: what the tray holds for this session -- the compartment grown into the window, the
// row or the clock whose drawer is open, the modal that asks, how the board is read, what find
// says. Nothing here is a fact: it is never on the ledger, and Undo passes over it.

export type Ui = {
  open?: "board" | "market";
  /** A symbol's drawer, or the clock's. */
  focus?: string;
  /** The modal that asks which symbol to watch. */
  new?: "board";
  /** The modal that asks before a symbol is dropped. */
  confirm?: string;
} & Collections; // how the board is read, what find says

const readStmt = db.query<{ ui: string }, [string]>("SELECT ui FROM desks WHERE session_id = ?");
const upsertStmt = db.query<unknown, [string, string]>("INSERT INTO desks (session_id, ui) VALUES (?1, ?2) ON CONFLICT(session_id) DO UPDATE SET ui = ?2");

export function read(sessionId: string): Ui {
  const row = readStmt.get(sessionId);
  return row ? (JSON.parse(row.ui) as Ui) : {};
}

export type DeskPatchResult = { version: number; applied: PatchOp[] };

const OPENABLE = new Set(["board", "market"]);
const SYMBOL = /^[A-Z0-9.]{1,6}$/;

/** Applies what it can; the version is always 0, since nothing here is recorded. */
export function patch(sessionId: string, ops: PatchOp[]): DeskPatchResult {
  const applied: PatchOp[] = [];
  const ui: Ui = { ...read(sessionId) };
  for (const op of ops) {
    const [field] = parsePointer(op.path);
    const removing = op.op === "remove";
    if (field === "open") {
      if (removing) delete ui.open;
      else if (OPENABLE.has(String(op.value))) ui.open = op.value as Ui["open"];
      else continue;
      delete ui.focus;
      delete ui.new;
      delete ui.confirm;
    } else if (field === "focus" || field === "confirm") {
      const value = String(op.value ?? "").trim().toUpperCase();
      if (removing) delete ui[field];
      else if (field === "focus" && value === "CLOCK") ui.focus = "clock";
      else if (SYMBOL.test(value)) ui[field] = value;
      else continue;
    } else if (field === "new") {
      if (removing) delete ui.new;
      else if (op.value === "board") ui.new = "board";
      else continue;
    } else if (!patchCollections(ui, op)) {
      continue; // not a reading, find's word or the eye either (src/bento.ts)
    }
    applied.push(op);
  }
  if (applied.length) upsertStmt.run(sessionId, JSON.stringify(ui));
  return { version: 0, applied };
}
