import * as market from "../documents/market";
import * as watchlistDoc from "../documents/watchlist";
import { patchMessage } from "../../../src/json-patch";
import type { Compartment, WriteResult } from "../../../src/compartments/compartment";
import { renderRequested, type HtmlOp } from "../../../src/compartments/render";
import { boardMount, watchlistSection } from "../views/page";

// A session's watchlist: its own to write, seen by nobody else. A change re-renders the two
// pieces of the page that show it -- the list, and the board's mount with its new props (the
// applet keeps the histories it has) -- as fragments, never the page.

function echoAndNotify(ws: Parameters<Compartment["write"]>[0], result: WriteResult): void {
  if (result.applied.length === 0) return;
  ws.send(patchMessage("watchlist", result.version, result.applied));
  renderRequested.emit({ sockets: [ws], write: { docType: "watchlist", docId: ws.data.sessionId, result } });
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
  write(ws, sessionId, ops) {
    const result = watchlistDoc.patch(sessionId, ops);
    echoAndNotify(ws, result);
    return { ...result, rendered: result.applied.length > 0 };
  },
  replay(ws, sessionId, ops, undoes) {
    const result = watchlistDoc.patch(sessionId, ops, undoes);
    echoAndNotify(ws, result);
    return { ...result, rendered: result.applied.length > 0 };
  },
  fragments(_ws, sessionId): HtmlOp[] {
    const list = watchlistDoc.read(sessionId);
    return [
      { op: "replace", target: "#watchlist", html: watchlistSection(list) },
      { op: "replace", target: "#board", html: boardMount(list, market.read()) },
    ];
  },
};
