import { read as readDoc } from "dzql/rendering/documents";
import { address, collectionsWrite, parseAddress, type Collections } from "dzql/rendering/bento";
import type { PatchOp } from "dzql/rendering/json-patch";

// The desk, kept in delta (`desk:<id>`, ../delta.ts): how this session reads the board and what
// find says. Nothing here is history: it is never on the ledger, and Undo passes over it. Where a
// tab is on the page -- one address (src/rendering/bento.ts): the cell grown into the window, and
// the one thing open over it, a symbol's drawer or the clock's, or the modal that asks -- is the
// tab's own (dzql/rendering/tabs), given beside the desk to draw and to shape a write by.

export type Ui = {
  /** Where the tab stands: "" the desk, "board" or "market" a window; then "?symbol=ALPH", "?clock", "?new", "?confirm=ALPH". */
  page?: string;
} & Collections; // how the board is read, what find says

const FIELDS = ["reading", "filter", "hide"] as const;

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

/** What a write to the desk becomes, applied to `ui` (the desk, where the tab that sent it stands) an op at a time: an address the tab goes to (the kernel moves it), or a reading, find's word or the eye (src/rendering/bento.ts), each field it moves replaced whole. */
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
