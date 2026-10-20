import type { PatchOp } from "dzql/rendering/json-patch";
import type { Resource } from "dzql/rendering/resources/resource";
import * as boardDoc from "./board-api";
import * as sessionDoc from "../session/session-api";
import { putAway } from "../session/session";
import { keepEveryone } from "../../everyone";

// The couple's document (`board:<wedding>`): the wedding and everything beneath it. Written by the
// couple, who arrived by the wedding's own code; read by them alone. What they keep reaches the
// households by the rows they share -- a household's own document holds its rows (a reply, a
// guest added), and every household reads the lists (`wedding:`) -- so each page that read a row
// that moved is drawn again, and sent only the parts of it that changed.

type Rule = { path: RegExp; ops: PatchOp["op"][] };

const LIST = "(courses|gifts|events|places|venues)";
const CHILD = "(dishes|drinks)";

/** The couple's writable surface: what their page offers, which paths with which ops. A field is
 * emptied by replacing it with nothing, never removed; a row's parent and its order's number are
 * the server's. Whether the value is valid is ./board-api.ts's call. */
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
  { path: /^\/venues\/\d+\/(name|notes|picture_key)$/, ops: ["replace"] },
  { path: new RegExp(`^/courses/\\d+/${CHILD}/-$`), ops: ["add"] },
  { path: new RegExp(`^/courses/\\d+/${CHILD}/\\d+$`), ops: ["remove"] },
  { path: /^\/courses\/\d+\/dishes\/\d+\/(name|dietary)$/, ops: ["replace"] },
  { path: /^\/courses\/\d+\/drinks\/\d+\/name$/, ops: ["replace"] },
];

/** May the couple make this change? The permit's, and the page's, which draws a control only where it says yes. */
export const may = (op: PatchOp["op"], path: string): boolean => RULES.some((r) => r.path.test(path) && r.ops.includes(op));

export const board: Resource = {
  docType: "board",
  resolveDoc(ws) {
    const session = sessionDoc.read(ws.data.sessionId);
    return session.kind === "couple" ? session.id! : undefined;
  },
  permit(ws, op) {
    return sessionDoc.read(ws.data.sessionId).kind === "couple" && may(op.op, op.path);
  },
  shape: (_ws, id, ops) => boardDoc.shape(boardDoc.held(id), ops),
  afterWrite: putAway,
  // a reply, a guest, a gift taken off: what everyone sees follows
  afterChange: () => keepEveryone(),
};
