import * as market from "../documents/market";
import * as watchlistDoc from "../documents/watchlist";
import type { Compartment } from "../../../src/compartments/compartment";
import { notify } from "../../../src/compartments/audience";
import { type HtmlOp } from "../../../src/compartments/render";
import { boardMount, watchlistSection } from "../views/page";

// A session's watchlist: its own to write, seen by nobody else (any other open tab of the same
// session included -- `sees`'s default already answers that from `resolveDoc` alone, change-
// request.md item 1). A change re-renders the two pieces of the page that show it -- the list,
// and the board's mount with its new props (the applet keeps the histories it has) -- as
// fragments, never the page.

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
    notify("watchlist", sessionId, result);
    return result;
  },
  replay(_ws, sessionId, ops, undoes) {
    const result = watchlistDoc.patch(sessionId, ops, undoes);
    notify("watchlist", sessionId, result);
    return result;
  },
  fragments(_ws, sessionId): HtmlOp[] {
    const list = watchlistDoc.read(sessionId);
    return [
      { op: "replace", target: "#watchlist", html: watchlistSection(list) },
      { op: "replace", target: "#board", html: boardMount(list, market.read()) },
    ];
  },
};
