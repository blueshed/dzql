import * as deskDoc from "../documents/desk";
import { parsePointer } from "../../../src/json-pointer";
import type { Compartment } from "../../../src/compartments/compartment";

// The desk is the tray (change-request.md item 10): the ground the ticker's compartments sit on,
// not a place of its own on the page -- no `render`. It takes the writes that open a compartment,
// a drawer or a modal, switch a reading or say what find says, each field it moves replaced whole:
// a visit is nobody else's to see, and nothing here is on the ledger (../delta.ts).

const WRITABLE = new Set(["page", "reading", "filter", "hide"]);

export const desk: Compartment = {
  docType: "desk",
  own: true, // keyed by the session id: this session's alone
  at: "/desks",
  resolveDoc(ws) {
    return ws.data.sessionId;
  },
  permit(_ws, op) {
    const [field] = parsePointer(op.path);
    return !!field && WRITABLE.has(field);
  },
  shape(_ws, sessionId, ops) {
    const ui = deskDoc.read(sessionId);
    return deskDoc.between(ui, deskDoc.after(ui, ops));
  },
};
