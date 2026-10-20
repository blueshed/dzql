import * as sessionDoc from "./session-api";
import type { PatchOp } from "dzql/rendering/json-patch";
import { splitPath } from "@blueshed/delta/core";
import type { Resource } from "dzql/rendering/resources/resource";
import { collectionsWrite } from "dzql/rendering/bento";
import { addressOf, moveTab } from "dzql/rendering/tabs";
import { keepEveryone } from "../../everyone";

// A visit (`session:<id>`): who this session is (a code) and how it reads the lists. This is the
// session -- the ground the household and board resources sit on, not
// a place of its own on the page: it has no view. It takes the writes that move around the
// page -- a code, a page, a drawer, a reading; a page or a drawer is the tab's to go to, and the
// kernel moves the tab that sent it -- and, as a first page opens, makes sure `everyone`
// (../../everyone.ts) says who stands in the photo.

/** Where you are only means something once you are in: everything but the code and a resend needs one. */
const BEFORE_CODE = new Set(["code", "resend"]);

/** What a visit's page writes: a code entered or forgotten, a resend, a page gone to; and how a
 * collection is read, find's word and its eye (`collectionsWrite`, src/rendering/bento.ts). */
const RULES: { path: RegExp; ops: PatchOp["op"][] }[] = [
  { path: /^\/code$/, ops: ["replace", "remove"] },
  { path: /^\/(resend|page)$/, ops: ["replace"] },
];

export const session: Resource = {
  docType: "session",
  ledger: false, // a visit is not history (./session-api.ts)
  perSession: true, // keyed by the session id: this session's alone
  under: "/visits", // eta's `/code` is the document's `/visits/code`
  resolveDoc(ws) {
    return ws.data.sessionId; // every connection always sees its own visit
  },
  permit(ws, op: PatchOp) {
    if (!RULES.some((r) => r.path.test(op.path) && r.ops.includes(op.op)) && !collectionsWrite(op)) return false;
    return BEFORE_CODE.has(splitPath(op.path)[0]!) || sessionDoc.read(ws.data.sessionId).code !== null;
  },
  // A visit is nobody else's to see, and never on the ledger (./session-api.ts): a code entered, a page
  // gone to, a reading switched, each field it moves replaced whole.
  shape: (ws, id, ops) => sessionDoc.shape(id, addressOf(ws), ops), // from where the tab that sent it stands
  // who stands in the photo is kept from the tables; a first page makes sure it is
  onOpen: () => keepEveryone(),
};

/** The household's and the board's `afterWrite`: the modal that asked, in the tab that answered it, is put away by the write that answers it. */
export const putAway: NonNullable<Resource["afterWrite"]> = (ws, _id, ops) => {
  const back = sessionDoc.answered(addressOf(ws), ops);
  if (back !== undefined) moveTab(ws, back);
};
