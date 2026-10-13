import { read as readDoc } from "../../../src/documents";
import { address, parseAddress, patchCollections, type Collections } from "../../../src/bento";
import type { PatchOp } from "../../../src/json-patch";
import { splitPath } from "@blueshed/delta/core";

// The desk, kept in delta (`desk:<id>`, ../delta.ts): where this session is on the page -- one
// address (src/bento.ts): the cell grown into the window, and the one thing open over it,
// a symbol's drawer or the clock's, or the modal that asks -- and how the board is read and what
// find says. Nothing here is a fact: it is never on the ledger, and Undo passes over it.

export type Ui = {
  /** "" the desk, "board" or "market" a window; then "?symbol=ALPH", "?clock", "?new", "?confirm=ALPH". */
  page?: string;
} & Collections; // how the board is read, what find says

const FIELDS = ["page", "reading", "filter", "hide"] as const;

export function read(sessionId: string): Ui {
  const row = readDoc<{ desks?: Record<string, unknown> }>(`desk:${sessionId}`)?.desks ?? {};
  return Object.fromEntries(FIELDS.filter((f) => row[f] != null).map((f) => [f, row[f]])) as Ui;
}

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

/** The desk after `ops`: what applies of them -- an address, a reading, find's word, the eye. */
export function after(ui: Ui, ops: PatchOp[]): Ui {
  const next: Ui = structuredClone(ui);
  for (const op of ops) {
    const [field] = splitPath(op.path);
    if (field === "page") {
      const page = op.op === "remove" ? "" : placed(op.value);
      if (page !== undefined) next.page = page;
    } else {
      patchCollections(next, op); // a reading, find's word or the eye (src/bento.ts), or nothing
    }
  }
  return next;
}

/** The ops that make desk `from` into `to`: each field that differs, replaced whole. */
export function between(from: Ui, to: Ui): PatchOp[] {
  return FIELDS.filter((f) => JSON.stringify(from[f]) !== JSON.stringify(to[f])).map((f) => ({ op: "replace", path: `/${f}`, value: to[f] ?? null }));
}
