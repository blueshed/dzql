import * as boardDoc from "../documents/board";
import * as sessionDoc from "../documents/session";
import type { PatchOp } from "../../../src/json-patch";
import type { Compartment, WriteResult } from "../../../src/compartments/compartment";
import { allOpenSockets, notify } from "../../../src/compartments/audience";
import { boardPages } from "../views/board";

// The couple's document: the wedding and everything beneath it. Written by the couple, who
// arrived by the wedding's own code; read by them alone (`resolveDoc` below is `sees`'s own
// default here -- the couple's tabs, nobody else, change-request.md item 1), though what they
// keep (the courses, the gifts, the events, where to stay) is on every household's pages, so a
// write here asks everyone to re-render.

type Rule = { path: RegExp; ops: PatchOp["op"][] };

const LIST = "(courses|gifts|events|places)";
const CHILD = "(dishes|drinks)";

/** The couple's writable surface: which paths, with which ops. Whether the value is valid is documents/board.ts's call. */
const RULES: Rule[] = [
  { path: /^\/(name1|name2|day|deadline|venue|message|picture_key)$/, ops: ["replace", "remove"] },
  { path: /^\/households\/-$/, ops: ["add"] },
  { path: /^\/households\/\d+\/(email|plus_ones)$/, ops: ["replace"] },
  { path: /^\/households\/\d+\/asks\/\d+\/reply$/, ops: ["replace", "remove"] },
  { path: /^\/households\/\d+\/guests\/-$/, ops: ["add"] },
  { path: /^\/households\/\d+\/guests\/\d+$/, ops: ["remove"] },
  { path: new RegExp(`^/${LIST}/-$`), ops: ["add"] },
  { path: new RegExp(`^/${LIST}/\\d+$`), ops: ["remove"] },
  { path: new RegExp(`^/${LIST}/\\d+/\\w+$`), ops: ["replace", "remove"] },
  { path: new RegExp(`^/courses/\\d+/${CHILD}/-$`), ops: ["add"] },
  { path: new RegExp(`^/courses/\\d+/${CHILD}/\\d+$`), ops: ["remove"] },
  { path: new RegExp(`^/courses/\\d+/${CHILD}/\\d+/\\w+$`), ops: ["replace", "remove"] },
];

// No `fragments` here yet: the couple's writes are rare beside a household's, and each one
// changes counts and lists on many pages, so every page goes out whole.


/** The couple's pages. The board is always there in practice: read() only reports a kind for a code that exists. */
export function renderBoard(session: sessionDoc.SessionDocument): string | undefined {
  const b = boardDoc.read(session.code!);
  return b && boardPages({ session, b });
}

export const board: Compartment = {
  docType: "board",
  resolveDoc(ws) {
    const session = sessionDoc.read(ws.data.sessionId);
    return session.kind === "couple" ? session.code! : undefined;
  },
  permit(ws, op) {
    if (sessionDoc.read(ws.data.sessionId).kind !== "couple") return false;
    return RULES.some((r) => r.path.test(op.path) && r.ops.includes(op.op));
  },
  write(ws, code, ops, undoes): WriteResult {
    const result = boardDoc.patch(code, ops, ws.data.sessionId, undoes);
    if (undoes === undefined) sessionDoc.closeAnswered(ws.data.sessionId, result.applied);
    notify("board", code, result, { renderTo: allOpenSockets() });
    return result;
  },
};
