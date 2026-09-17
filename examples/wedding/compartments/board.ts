import * as boardDoc from "../documents/board";
import * as sessionDoc from "../documents/session";
import { patchMessage, type PatchOp } from "../../../src/json-patch";
import type { Compartment, WriteResult } from "../../../src/compartments/compartment";
import { allOpenSockets, audienceFor } from "../../../src/compartments/audience";
import { renderRequested } from "../../../src/compartments/render";
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
function echoAndNotify(code: string, result: WriteResult): void {
  if (result.applied.length === 0) return;
  const payload = patchMessage("board", result.version, result.applied);
  for (const ws of audienceFor("board", code)) ws.send(payload);
  renderRequested.emit({ sockets: allOpenSockets(), write: { docType: "board", docId: code, result } });
}


/** A modal asks one question; the write that answers it closes it (rule 14): an add closes the ask, a removal closes the confirm and the row's drawer. */
function closeAsked(sessionId: string, applied: { op: string; path: string }[]): void {
  const { ui } = sessionDoc.read(sessionId);
  const ops: PatchOp[] = [];
  if (ui.new && applied.some((op) => op.op === "add" && op.path.endsWith("/-"))) ops.push({ op: "remove", path: "/new" });
  if (ui.confirm && applied.some((op) => op.op === "remove")) ops.push({ op: "remove", path: "/confirm" }, { op: "remove", path: "/keep" });
  if (ops.length) sessionDoc.patch(sessionId, ops);
}

export const board: Compartment = {
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
  write(ws, code, ops, undoes): WriteResult {
    const result = boardDoc.patch(code, ops, ws.data.sessionId, undoes);
    if (undoes === undefined) closeAsked(ws.data.sessionId, result.applied);
    echoAndNotify(code, result);
    return result;
  },
};
