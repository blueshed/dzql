import * as boardDoc from "../documents/board";
import * as sessionDoc from "../documents/session";
import { patchMessage, type PatchOp } from "../../../src/json-patch";
import type { Concept, WriteResult } from "../../../src/concepts/concept";
import { renderRequested } from "../../../src/concepts/render";
import { boardPages } from "../views/board";
import * as presence from "./presence";

// The couple's document: the wedding and everything beneath it. Written by the couple, who
// arrived by the wedding's own code; read by them alone, though what they keep (the courses, the
// gifts, the events, where to stay) is on every household's pages, so a write here asks everyone
// to re-render.

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
function echoAndNotify(code: string, result: WriteResult): void {
  if (result.applied.length === 0) return;
  const payload = patchMessage("board", result.version, result.applied);
  for (const ws of presence.seeingBoard()) ws.send(payload);
  renderRequested.emit({ sockets: presence.everyone(), write: { docType: "board", docId: code, result } });
}

export const board: Concept = {
  docType: "board",
  render(sessionId) {
    const session = sessionDoc.read(sessionId);
    if (session.kind !== "couple") return undefined;
    const b = boardDoc.read(session.code!);
    if (!b) return undefined; // unreachable in practice: read() only reports a kind for a code that exists
    return boardPages({ session, b });
  },
  resolveDoc(ws) {
    const session = sessionDoc.read(ws.data.sessionId);
    return session.kind === "couple" ? session.code! : undefined;
  },
  permit(ws, op) {
    if (sessionDoc.read(ws.data.sessionId).kind !== "couple") return false;
    return RULES.some((r) => r.path.test(op.path) && r.ops.includes(op.op));
  },
  write(ws, code, ops): WriteResult {
    const result = boardDoc.patch(code, ops, ws.data.sessionId);
    echoAndNotify(code, result);
    return { ...result, rendered: result.applied.length > 0 };
  },
  replay(ws, code, ops, undoes): WriteResult {
    const result = boardDoc.patch(code, ops, ws.data.sessionId, undoes);
    echoAndNotify(code, result);
    return { ...result, rendered: result.applied.length > 0 };
  },
};
