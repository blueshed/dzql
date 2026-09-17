import * as market from "../documents/market";
import * as watchlistDoc from "../documents/watchlist";
import type { Compartment } from "../../../src/compartments/compartment";
import { notify } from "../../../src/compartments/audience";
import { type HtmlOp } from "../../../src/compartments/render";
import * as clockDoc from "../documents/clock";
import * as deskDoc from "../documents/desk";
import { boardCount, boardList, boardMount, reading } from "../views/page";

// A session's watchlist: its own to write, seen by nobody else (any other open tab of the same
// session included -- `sees`'s default already answers that from `resolveDoc` alone, change-
// request.md item 1). A change re-renders the pieces of the page that show it -- the count on
// the board's head, the board's mount with its new props (the applet keeps the histories it has),
// and the board as a list when that is the open reading -- as fragments, never the page.

/** Sessions whose modal a write has just answered: their next render is the page, not fragments, so the modal goes. */
const answered = new Set<string>();

/** A modal asks one question; the write that answers it closes it (rule 14): watching closes the ask, dropping closes the confirm and the row's drawer. */
function closeAsked(sessionId: string, applied: { op: string; path: string }[]): void {
  const ui = deskDoc.read(sessionId);
  const ops: { op: "remove"; path: string }[] = [];
  if (ui.new && applied.some((op) => op.op === "add")) ops.push({ op: "remove", path: "/new" });
  if (ui.confirm && applied.some((op) => op.op === "remove")) ops.push({ op: "remove", path: "/confirm" }, { op: "remove", path: "/focus" });
  if (ops.length) {
    deskDoc.patch(sessionId, ops);
    answered.add(sessionId);
  }
}

export const watchlist: Compartment = {
  docType: "watchlist",
  // No render(): the ticker compartment renders the page, this list within it.
  resolveDoc(ws) {
    return ws.data.sessionId;
  },
  permit(_ws, op) {
    return (op.op === "add" && op.path === "/symbols/-") || (op.op === "remove" && /^\/symbols\/\d+$/.test(op.path));
  },
  write(_ws, sessionId, ops) {
    const result = watchlistDoc.patch(sessionId, ops);
    closeAsked(sessionId, result.applied);
    notify("watchlist", sessionId, result);
    return result;
  },
  replay(_ws, sessionId, ops, undoes) {
    const result = watchlistDoc.patch(sessionId, ops, undoes);
    notify("watchlist", sessionId, result);
    return result;
  },
  fragments(_ws, sessionId): HtmlOp[] | undefined {
    if (answered.delete(sessionId)) return undefined; // a modal just closed: the page, whole
    const list = watchlistDoc.read(sessionId);
    const ui = deskDoc.read(sessionId);
    // an open drawer says whether its symbol is watched, and offers the other thing; the market's
    // rows say "watching": the page, whole, rather than a list of targets that has to keep up
    if (ui.focus || ui.open === "market") return undefined;
    const ops: HtmlOp[] = [
      { op: "replace", target: "#board-count", html: boardCount(list) },
      { op: "replace", target: "#board", html: boardMount(list, market.read()) },
    ];
    if (ui.open === "board" && reading(ui) === "list") ops.push({ op: "replace", target: "#board-list", html: boardList({ list, market: market.read(), clock: clockDoc.read(sessionId), ui }) });
    return ops;
  },
};
