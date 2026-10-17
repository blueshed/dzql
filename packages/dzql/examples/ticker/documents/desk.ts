import { read as readDoc } from "dzql/rendering/documents";
import { address, collectionsWrite, parseAddress, type Collections } from "dzql/rendering/bento";
import type { PatchOp } from "dzql/rendering/json-patch";

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

/** What a write to the desk becomes, applied to `ui` an op at a time: an address it keeps, or a reading, find's word or the eye (src/bento.ts), each field it moves replaced whole. */
export function shape(ui: Ui, ops: PatchOp[]): PatchOp[] {
  return ops.flatMap((op): PatchOp[] => {
    const bento = collectionsWrite(op, ui);
    if (bento) return bento;
    const page = op.path !== "/page" ? undefined : op.op === "remove" ? "" : placed(op.value);
    if (page === undefined || page === ui.page) return [];
    ui.page = page;
    return [{ op: "replace", path: "/page", value: page }];
  });
}
