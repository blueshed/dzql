import * as deskDoc from "../documents/desk";
import type { PatchOp } from "../../../src/json-patch";
import type { Compartment } from "../../../src/compartments/compartment";

// The desk is the ticker's session (change-request.md item 10): the ground the ticker's cells sit on,
// not a place of its own on the page -- no `render`. It takes the writes that open a cell,
// a drawer or a modal, switch a reading or say what find says, each field it moves replaced whole:
// a visit is nobody else's to see, and nothing here is on the ledger (../delta.ts).

/** What the desk's page writes: a page gone to, and how a collection is read, find's word and its eye, each by the collection's name (src/bento.ts). */
const RULES: { path: RegExp; ops: PatchOp["op"][] }[] = [
  { path: /^\/page$/, ops: ["replace"] },
  { path: /^\/reading\/[^/]+$/, ops: ["replace"] },
  { path: /^\/(filter|hide)\/[^/]+$/, ops: ["replace", "remove"] },
];

export const desk: Compartment = {
  docType: "desk",
  ledger: false, // a visit is not history (../delta.ts)
  perSession: true, // keyed by the session id: this session's alone
  under: "/desks",
  resolveDoc(ws) {
    return ws.data.sessionId;
  },
  permit: (_ws, op) => RULES.some((r) => r.path.test(op.path) && r.ops.includes(op.op)),
  shape(_ws, sessionId, ops) {
    const ui = deskDoc.read(sessionId);
    return deskDoc.between(ui, deskDoc.after(ui, ops));
  },
};
