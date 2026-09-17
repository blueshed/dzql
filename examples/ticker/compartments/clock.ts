import * as clockDoc from "../documents/clock";
import type { Compartment } from "../../../src/compartments/compartment";
import { notify } from "../../../src/compartments/audience";

// A session's clock: its own to write, seen by nobody else. The clock applet names this document
// and takes the `replace /tz` itself, so the face and the hands follow at once; the page says the
// city too (on the clock's compartment, in its drawer), so the write is answered with the page,
// and the applets, being a morph boundary, are left as they are. Undo and Redo walk the choice of
// city like any write.

export const clock: Compartment = {
  docType: "clock",
  // No render(): the ticker compartment renders the page, the clock within it.
  resolveDoc(ws) {
    return ws.data.sessionId;
  },
  permit(_ws, op) {
    return op.op === "replace" && op.path === "/tz";
  },
  write(_ws, sessionId, ops, undoes) {
    const result = clockDoc.patch(sessionId, ops, undoes);
    notify("clock", sessionId, result);
    return result;
  },
};
