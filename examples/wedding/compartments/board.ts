import * as boardDoc from "../documents/board";
import * as sessionDoc from "../documents/session";
import type { PatchOp } from "../../../src/json-patch";
import type { Compartment } from "../../../src/compartments/compartment";
import { serverWrite } from "../../../src/documents";
import { boardPage } from "../views/board";
import { keepEveryone } from "../everyone";

// The couple's document (`board:<wedding>`): the wedding and everything beneath it. Written by the
// couple, who arrived by the wedding's own code; read by them alone. What they keep reaches the
// households by the rows they share -- a household's own document holds its rows (a reply, a
// guest added), and every household reads the lists (`wedding:`) -- so each page that read a row
// that moved is drawn again, and sent only the parts of it that changed.

type Rule = { path: RegExp; ops: PatchOp["op"][] };

const LIST = "(courses|gifts|events|places)";
const CHILD = "(dishes|drinks)";

/** The couple's writable surface: what their page offers, which paths with which ops. A field is
 * emptied by replacing it with nothing, never removed; a row's parent and its order's number are
 * the server's. Whether the value is valid is documents/board.ts's call. */
const RULES: Rule[] = [
  { path: /^\/(name1|name2|day|deadline|venue|message|picture_key)$/, ops: ["replace"] },
  { path: /^\/households\/-$/, ops: ["add"] },
  { path: /^\/households\/\d+\/(email|plus_ones)$/, ops: ["replace"] },
  { path: /^\/households\/\d+\/asks\/\d+\/reply$/, ops: ["replace"] },
  { path: /^\/households\/\d+\/guests\/-$/, ops: ["add"] },
  { path: /^\/households\/\d+\/guests\/\d+$/, ops: ["remove"] },
  { path: new RegExp(`^/${LIST}/-$`), ops: ["add"] },
  { path: new RegExp(`^/${LIST}/\\d+$`), ops: ["remove"] },
  { path: /^\/courses\/\d+\/(name|seq)$/, ops: ["replace"] },
  { path: /^\/gifts\/\d+\/(name|description|link|picture_key|shared|seq)$/, ops: ["replace"] },
  { path: /^\/events\/\d+\/(name|when_at|where_at|notes|seq)$/, ops: ["replace"] },
  { path: /^\/places\/\d+\/(name|notes|link|picture_key|seq)$/, ops: ["replace"] },
  { path: new RegExp(`^/courses/\\d+/${CHILD}/-$`), ops: ["add"] },
  { path: new RegExp(`^/courses/\\d+/${CHILD}/\\d+$`), ops: ["remove"] },
  { path: /^\/courses\/\d+\/dishes\/\d+\/(name|dietary)$/, ops: ["replace"] },
  { path: /^\/courses\/\d+\/drinks\/\d+\/name$/, ops: ["replace"] },
];

/** The couple's page. The board is always there in practice: read() only reports a kind for a code that exists. */
export function renderBoard(session: sessionDoc.SessionDocument): string | undefined {
  const b = boardDoc.read(session.id!);
  return b && boardPage({ session, b });
}

export const board: Compartment = {
  docType: "board",
  resolveDoc(ws) {
    const session = sessionDoc.read(ws.data.sessionId);
    return session.kind === "couple" ? session.id! : undefined;
  },
  permit(ws, op) {
    if (sessionDoc.read(ws.data.sessionId).kind !== "couple") return false;
    return RULES.some((r) => r.path.test(op.path) && r.ops.includes(op.op));
  },
  shape: (_ws, id, ops) => boardDoc.shape(boardDoc.held(id), ops),
  // the modal that asked is put away by the write that answers it
  async afterWrite(ws, _id, ops: PatchOp[]) {
    const put = sessionDoc.answered(sessionDoc.read(ws.data.sessionId), ops);
    if (put.length > 0) await serverWrite(`session:${ws.data.sessionId}`, put);
  },
  // a reply, a guest, a gift taken off: what everyone sees follows
  afterChange: () => keepEveryone(),
};

/** What a household reads of the wedding (`wedding:<id>`): written by the couple, through the board, and by nobody from the wire. */
export const wedding: Compartment = { docType: "wedding", resolveDoc: () => undefined };

/** What a visitor without a code reads (`welcome:<id>`): the wedding's own row. */
export const welcome: Compartment = { docType: "welcome", resolveDoc: () => undefined };

/** Who stands in the photo and how many have claimed each gift (`everyone:<id>`): live, kept by the server. */
export const everyone: Compartment = { docType: "everyone", kind: "live", resolveDoc: () => undefined };
