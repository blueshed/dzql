import * as clockDoc from "../documents/clock";
import { patchMessage } from "../../../src/json-patch";
import type { Compartment, WriteResult } from "../../../src/compartments/compartment";
import { renderRequested } from "../../../src/compartments/render";

// A session's clock: its own to write, seen by nobody else. The clock applet names this document
// and takes the `replace /tz` itself -- the name on the face and the hands follow -- so nothing
// on the page needs rendering. Undo and Redo walk the choice of city like any write.

function echoAndNotify(ws: Parameters<Compartment["write"]>[0], result: WriteResult): void {
  if (result.applied.length === 0) return;
  ws.send(patchMessage("clock", result.version, result.applied));
  renderRequested.emit({ sockets: [ws], write: { docType: "clock", docId: ws.data.sessionId, result } });
}

export const clock: Compartment = {
  docType: "clock",
  // No render(): the ticker compartment renders the page, the clock within it.
  resolveDoc(ws) {
    return ws.data.sessionId;
  },
  permit(_ws, op) {
    return op.op === "replace" && op.path === "/tz";
  },
  write(ws, sessionId, ops) {
    const result = clockDoc.patch(sessionId, ops);
    echoAndNotify(ws, result);
    return result;
  },
  replay(ws, sessionId, ops, undoes) {
    const result = clockDoc.patch(sessionId, ops, undoes);
    echoAndNotify(ws, result);
    return result;
  },
  // The clock took the op; nothing on the page to render.
  fragments() {
    return [];
  },
};
