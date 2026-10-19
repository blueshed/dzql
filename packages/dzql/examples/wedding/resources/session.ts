import * as sessionDoc from "../documents/session";
import type { PatchOp } from "dzql/rendering/json-patch";
import { splitPath } from "@blueshed/delta/core";
import type { Resource } from "dzql/rendering/resources/resource";
import { serverWrite } from "dzql/rendering/documents";
import { collectionsWrite } from "dzql/rendering/bento";
import { keepEveryone } from "../everyone";

// A visit (`session:<id>`): who this session is (a code) and where it is on the site. This is the
// session -- the ground the household and board resources sit on, not
// a place of its own on the page: it has no `render`. It takes the writes that move around the
// page -- a code, a page, a drawer, a reading -- and, as a first page opens, makes sure `everyone`
// (../everyone.ts) says who stands in the photo.

/** Where you are only means something once you are in: everything but the code and a resend needs one. */
const BEFORE_CODE = new Set(["code", "resend"]);

/** What a visit's page writes: a code entered or forgotten, a resend, a page gone to; and how a
 * collection is read, find's word and its eye (`collectionsWrite`, src/bento.ts). */
const RULES: { path: RegExp; ops: PatchOp["op"][] }[] = [
  { path: /^\/code$/, ops: ["replace", "remove"] },
  { path: /^\/(resend|page)$/, ops: ["replace"] },
];

export const session: Resource = {
  docType: "session",
  ledger: false, // a visit is not history (../delta.ts)
  perSession: true, // keyed by the session id: this session's alone
  under: "/visits", // eta's `/page` is the document's `/visits/page`
  resolveDoc(ws) {
    return ws.data.sessionId; // every connection always sees its own visit
  },
  permit(ws, op: PatchOp) {
    if (!RULES.some((r) => r.path.test(op.path) && r.ops.includes(op.op)) && !collectionsWrite(op)) return false;
    return BEFORE_CODE.has(splitPath(op.path)[0]!) || sessionDoc.read(ws.data.sessionId).code !== null;
  },
  // A visit is nobody else's to see, and never on the ledger (../delta.ts): a code entered, a page
  // gone to, a reading switched, each field it moves replaced whole.
  shape: (_ws, id, ops) => sessionDoc.shape(id, ops),
  // who stands in the photo is kept from the tables; a first page makes sure it is
  onOpen: () => keepEveryone(),
};

/** The household's and the board's `afterWrite`: the modal that asked is put away by the write that answers it. */
export const putAway: NonNullable<Resource["afterWrite"]> = async (ws, _id, ops) => {
  const put = sessionDoc.answered(sessionDoc.read(ws.data.sessionId), ops);
  if (put.length > 0) await serverWrite(`session:${ws.data.sessionId}`, put);
};
