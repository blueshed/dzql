import type { ServerWebSocket } from "bun";
import * as sessionDoc from "../documents/session";
import type { ConnectionData } from "../../../src/connection";
import { patchMessage, type PatchOp } from "../../../src/json-patch";
import { parsePointer } from "../../../src/json-pointer";
import type { Compartment } from "../../../src/compartments/compartment";
import { renderRequested } from "../../../src/compartments/render";

// A visit: who this session is (a code) and where it is on the site. This is the tray
// (change-request.md item 10) -- the ground the household and board compartments sit on, not a
// place of its own on the page: it has no `render`, and `household.ts` is the one that shows the
// welcome now, absorbing what used to be the tray's own page. This only takes the writes that
// move around the page it hands off to -- a page, a drawer, a reading. No `onOpen`/`onClose`
// either: which connections are open at all is the kernel's own registry now (change-request.md
// item 1), not something this example tracks for itself (that was `concepts/presence.ts`, gone).

/** Where you are only means something once you are in: everything but the code and a resend needs one. */
const BEFORE_CODE = new Set(["code", "resend"]);
const WRITABLE = new Set(["code", "resend", "page", "focus", "gift", "keep", "answering", "reading"]);

export const session: Compartment = {
  docType: "session",
  resolveDoc(ws) {
    return ws.data.sessionId; // every connection always sees its own visit
  },
  permit(ws, op: PatchOp) {
    const [field] = parsePointer(op.path);
    if (!field || !WRITABLE.has(field)) return false;
    return BEFORE_CODE.has(field) || sessionDoc.read(ws.data.sessionId).code !== null;
  },
  // Not a compartment, so there's no owning element for rule 2's default to re-render -- the
  // tray always asks for its own full page instead.
  write(ws: ServerWebSocket<ConnectionData>, id, ops) {
    const result = sessionDoc.patch(id, ops);
    // Echoed to this connection only: a visit is nobody else's to see. Not on the ledger (see
    // documents/session.ts), so the version is always 0 and there is no replay.
    if (result.applied.length > 0) {
      ws.send(patchMessage("session", result.version, result.applied));
      renderRequested.emit([ws]);
    }
    return result;
  },
};
