import * as deskDoc from "./desk-api";
import { collectionsWrite } from "dzql/rendering/bento";
import type { Resource } from "dzql/rendering/resources/resource";
import { addressOf } from "dzql/rendering/tabs";

// The desk is the ticker's session: the ground the ticker's cells sit on,
// not a place of its own on the page -- no view. It takes the writes that open a cell,
// a drawer or a modal (the tab's to go to: the kernel moves it), switch a reading or say what find
// says, each field it moves replaced whole: a visit is nobody else's to see, and nothing here is on
// the ledger (./desk-api.ts).

export const desk: Resource = {
  docType: "desk",
  ledger: false, // a visit is not history (./desk-api.ts)
  perSession: true, // keyed by the session id: this session's alone
  under: "/desks",
  resolveDoc(ws) {
    return ws.data.sessionId;
  },
  // what the desk's page writes: a page gone to, and how a collection is read, find's word and its eye (src/rendering/bento.ts)
  permit: (_ws, op) => (op.op === "replace" && op.path === "/page") || collectionsWrite(op) !== undefined,
  shape: (ws, sessionId, ops) => deskDoc.shape({ ...deskDoc.read(sessionId), page: addressOf(ws) }, ops), // from where the tab that sent it stands
};
