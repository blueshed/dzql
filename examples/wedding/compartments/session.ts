import * as sessionDoc from "../documents/session";
import type { PatchOp } from "../../../src/json-patch";
import { parsePointer } from "../../../src/json-pointer";
import type { Compartment } from "../../../src/compartments/compartment";
import { keepEveryone } from "../everyone";

// A visit (`session:<id>`): who this session is (a code) and where it is on the site. This is the
// tray (change-request.md item 10) -- the ground the household and board compartments sit on, not
// a place of its own on the page: it has no `render`. It takes the writes that move around the
// page -- a code, a page, a drawer, a reading -- and, as a first page opens, makes sure `everyone`
// (../everyone.ts) says who stands in the photo.

/** Where you are only means something once you are in: everything but the code and a resend needs one. */
const BEFORE_CODE = new Set(["code", "resend"]);
const WRITABLE = new Set(["code", "resend", "page", "reading", "filter", "hide"]);

export const session: Compartment = {
  docType: "session",
  own: true, // keyed by the session id: this session's alone
  at: "/visits", // eta's `/page` is the document's `/visits/page`
  resolveDoc(ws) {
    return ws.data.sessionId; // every connection always sees its own visit
  },
  permit(ws, op: PatchOp) {
    const [field] = parsePointer(op.path);
    if (!field || !WRITABLE.has(field)) return false;
    return BEFORE_CODE.has(field) || sessionDoc.read(ws.data.sessionId).code !== null;
  },
  // A visit is nobody else's to see, and never on the ledger (../delta.ts): a code entered, a page
  // gone to, a reading switched, each field it moves replaced whole.
  shape: (_ws, id, ops) => sessionDoc.shape(id, ops),
  // who stands in the photo is kept from the tables; a first page makes sure it is
  onOpen: () => keepEveryone(),
};
