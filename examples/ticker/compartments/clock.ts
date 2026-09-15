import * as clockDoc from "../documents/clock";
import type { Compartment } from "../../../src/compartments/compartment";
import { notify } from "../../../src/compartments/audience";

// A session's clock: its own to write, seen by nobody else (any other open tab of the same
// session included -- `sees`'s default already answers that from `resolveDoc` alone, change-
// request.md item 1). The clock applet names this document and takes the `replace /tz` itself --
// the name on the face and the hands follow -- so nothing on the page needs rendering. Undo and
// Redo walk the choice of city like any write.

export const clock: Compartment = {
  docType: "clock",
  // No render(): the ticker compartment renders the page, the clock within it.
  resolveDoc(ws) {
    return ws.data.sessionId;
  },
  permit(_ws, op) {
    return op.op === "replace" && op.path === "/tz";
  },
  write(_ws, sessionId, ops) {
    const result = clockDoc.patch(sessionId, ops);
    notify("clock", sessionId, result);
    return result;
  },
  replay(_ws, sessionId, ops, undoes) {
    const result = clockDoc.patch(sessionId, ops, undoes);
    notify("clock", sessionId, result);
    return result;
  },
  // The clock took the op; nothing on the page to render.
  fragments() {
    return [];
  },
};
