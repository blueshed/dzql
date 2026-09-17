import * as watchlistDoc from "../documents/watchlist";
import type { Compartment } from "../../../src/compartments/compartment";
import { notify } from "../../../src/compartments/audience";
import * as deskDoc from "../documents/desk";

// A session's watchlist: its own to write, seen by nobody else. It has no render and no fragments,
// so a change is answered with the page: the count, the summary, the board's mount with its new
// props (the applet keeps the histories it has), the list, a drawer that says "watched" -- whatever
// shows it, without a list of targets that has to keep up with the desk. A person watches and
// drops at a person's pace; the ticks, which are not, never come through here.

/** A modal asks one question; the write that answers it closes it (rule 14): watching closes the ask, dropping closes the confirm and the row's drawer. */
function closeAsked(sessionId: string, applied: { op: string; path: string }[]): void {
  const ui = deskDoc.read(sessionId);
  const ops: { op: "remove"; path: string }[] = [];
  if (ui.new && applied.some((op) => op.op === "add")) ops.push({ op: "remove", path: "/new" });
  if (ui.confirm && applied.some((op) => op.op === "remove")) ops.push({ op: "remove", path: "/confirm" }, { op: "remove", path: "/focus" });
  if (ops.length) deskDoc.patch(sessionId, ops);
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
  write(_ws, sessionId, ops, undoes) {
    const result = watchlistDoc.patch(sessionId, ops, undoes);
    if (undoes === undefined) closeAsked(sessionId, result.applied);
    notify("watchlist", sessionId, result);
    return result;
  },
};
