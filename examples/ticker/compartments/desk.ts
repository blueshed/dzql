import * as deskDoc from "../documents/desk";
import { parsePointer } from "../../../src/json-pointer";
import { patchMessage } from "../../../src/json-patch";
import type { Compartment } from "../../../src/compartments/compartment";
import { renderRequested } from "../../../src/compartments/render";

// The desk is the tray (change-request.md item 10): the ground the ticker's compartments sit on,
// not a place of its own on the page -- no `render`, not in the example's `compartments`. It
// takes the writes that open a compartment, a drawer or a modal, switch a reading or say what
// find says, echoes them to their own connection, and asks for the page: a visit is nobody
// else's to see, and nothing here is on the ledger, so there is no replay.

const WRITABLE = new Set(["open", "focus", "new", "confirm", "reading", "filter", "hide"]);

export const desk: Compartment = {
  docType: "desk",
  resolveDoc(ws) {
    return ws.data.sessionId;
  },
  permit(_ws, op) {
    const [field] = parsePointer(op.path);
    return !!field && WRITABLE.has(field);
  },
  write(ws, sessionId, ops) {
    const result = deskDoc.patch(sessionId, ops);
    if (result.applied.length > 0) {
      ws.send(patchMessage("desk", result.version, result.applied));
      renderRequested.emit([ws]);
    }
    return result;
  },
};
