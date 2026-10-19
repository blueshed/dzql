import * as deskDoc from "../documents/desk";
import { collectionsWrite } from "dzql/rendering/bento";
import type { Resource } from "dzql/rendering/resources/resource";

// The desk is the ticker's session: the ground the ticker's cells sit on,
// not a place of its own on the page -- no `render`. It takes the writes that open a cell,
// a drawer or a modal, switch a reading or say what find says, each field it moves replaced whole:
// a visit is nobody else's to see, and nothing here is on the ledger (../delta.ts).

export const desk: Resource = {
  docType: "desk",
  ledger: false, // a visit is not history (../delta.ts)
  perSession: true, // keyed by the session id: this session's alone
  under: "/desks",
  resolveDoc(ws) {
    return ws.data.sessionId;
  },
  // what the desk's page writes: a page gone to, and how a collection is read, find's word and its eye (src/rendering/bento.ts)
  permit: (_ws, op) => (op.op === "replace" && op.path === "/page") || collectionsWrite(op) !== undefined,
  shape: (_ws, sessionId, ops) => deskDoc.shape(deskDoc.read(sessionId), ops),
};
