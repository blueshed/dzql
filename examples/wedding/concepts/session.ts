import type { ServerWebSocket } from "bun";
import * as sessionDoc from "../documents/session";
import * as weddingDoc from "../documents/wedding";
import type { ConnectionData } from "../../../src/connection";
import { patchMessage, type PatchOp } from "../../../src/json-patch";
import { parsePointer } from "../../../src/json-pointer";
import type { Concept } from "../../../src/concepts/concept";
import { welcome } from "../views/welcome";
import * as presence from "./presence";

// A visit: who this session is (a code) and where it is on the site. Renders the welcome until
// there is a code; after that the household or board concept renders the page, and this concept
// only takes the writes that move around it -- a page, a drawer, a reading.

/** Where you are only means something once you are in: everything but the code and a resend needs one. */
const BEFORE_CODE = new Set(["code", "resend"]);
const WRITABLE = new Set(["code", "resend", "page", "focus", "gift", "keep", "answering", "reading"]);

export const session: Concept = {
  docType: "session",
  render(sessionId) {
    const s = sessionDoc.read(sessionId);
    return s.code ? undefined : welcome(weddingDoc.wedding(), s.note);
  },
  resolveDoc(ws) {
    return ws.data.sessionId; // every connection always sees its own visit
  },
  permit(ws, op: PatchOp) {
    const [field] = parsePointer(op.path);
    if (!field || !WRITABLE.has(field)) return false;
    return BEFORE_CODE.has(field) || sessionDoc.read(ws.data.sessionId).code !== null;
  },
  write(ws: ServerWebSocket<ConnectionData>, id, ops) {
    const result = sessionDoc.patch(id, ops);
    // Echoed to this connection only: a visit is nobody else's to see. Not on the ledger (see
    // documents/session.ts), so the version is always 0 and there is no replay.
    if (result.applied.length > 0) ws.send(patchMessage("session", result.version, result.applied));
    return result;
  },
  onOpen(ws) {
    presence.join(ws);
  },
  onClose(ws) {
    presence.leave(ws);
  },
};
