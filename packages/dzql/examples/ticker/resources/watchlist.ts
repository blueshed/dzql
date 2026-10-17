import * as market from "../documents/market";
import * as watchlistDoc from "../documents/watchlist";
import * as deskDoc from "../documents/desk";
import type { Resource } from "dzql/rendering/resources/resource";
import { parseAddress } from "dzql/rendering/bento";
import { activeDocuments, serverWrite, settled } from "dzql/rendering/documents";
import type { PatchOp } from "dzql/rendering/json-patch";

// A session's watchlist: its own to write, seen by nobody else. A change is answered with what
// changed on the page: the count, the summary, the board's mount with its new props (the applet keeps
// the histories it has), the list, a drawer that says "watched" -- whatever shows it, worked out by
// comparing the page, not listed by hand. A person watches and drops at a person's pace; the
// ticks, which are not, never come through here.

/** A modal asks one question; the write that answers it puts it away: watching closes the ask, dropping closes the asking-first. Either way the desk is back on the window it was asked from. */
async function closeAsked(sessionId: string, ops: PatchOp[]): Promise<void> {
  const { path, what } = parseAddress(await settled(activeDocuments(), () => deskDoc.read(sessionId).page));
  const answered = (what === "new" && ops.some((op) => op.op === "add")) || (what === "confirm" && ops.some((op) => op.op === "remove"));
  if (answered) await serverWrite(`desk:${sessionId}`, [{ op: "replace", path: "/desks/page", value: path }]);
}

export const watchlist: Resource = {
  docType: "watchlist",
  perSession: true, // keyed by the session id: this session's alone
  under: "/desks", // eta's `/symbols` is the document's `/desks/symbols`: the session's row
  // No render(): the ticker resource renders the page, this list within it.
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
  afterWrite: (_ws, sessionId, ops) => closeAsked(sessionId, ops),
};
