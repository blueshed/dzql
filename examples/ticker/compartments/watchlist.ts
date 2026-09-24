import * as market from "../documents/market";
import * as watchlistDoc from "../documents/watchlist";
import * as deskDoc from "../documents/desk";
import type { Compartment } from "../../../src/compartments/compartment";
import { parseAddress } from "../../../src/bento";
import { activeDocuments, serverWrite, settled } from "../../../src/documents";

// A session's watchlist: its own to write, seen by nobody else. A change is answered with what
// changed on the page: the count, the summary, the board's mount with its new props (the applet keeps
// the histories it has), the list, a drawer that says "watched" -- whatever shows it, worked out by
// comparing the page, not listed by hand. A person watches and drops at a person's pace; the
// ticks, which are not, never come through here.

/**
 * A modal asks one question, and the list changing answers it (rule 14): the ask is put away once
 * the list has moved, the asking-first once the symbol it asked about is gone. Either way the desk
 * is back on the window it was asked from.
 */
async function closeAsked(sessionId: string): Promise<void> {
  const { page, symbols } = await settled(activeDocuments(), () => ({ page: deskDoc.read(sessionId).page, symbols: watchlistDoc.read(sessionId).symbols }));
  const { path, what, which } = parseAddress(page);
  if (what === "new" || (what === "confirm" && !symbols.includes(which ?? ""))) await serverWrite(`desk:${sessionId}`, [{ op: "replace", path: "/desks/page", value: path }]);
}

export const watchlist: Compartment = {
  docType: "watchlist",
  own: true, // keyed by the session id: this session's alone
  at: "/watchlists", // eta's `/symbols` is the document's `/watchlists/symbols`
  // No render(): the ticker compartment renders the page, this list within it.
  resolveDoc(ws) {
    return ws.data.sessionId;
  },
  permit(_ws, op) {
    return (op.op === "add" && op.path === "/symbols/-") || (op.op === "remove" && /^\/symbols\/\d+$/.test(op.path));
  },
  shape(_ws, sessionId, ops) {
    const { symbols } = watchlistDoc.read(sessionId);
    const next = watchlistDoc.after(symbols, ops, market.has);
    return next.join() === symbols.join() ? [] : [{ op: "replace", path: "/symbols", value: next }];
  },
  changed: (sessionId) => closeAsked(sessionId),
};
