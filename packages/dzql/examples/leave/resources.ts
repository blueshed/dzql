import type { Resource } from "dzql/rendering/resources/resource";
import { serverWrite } from "dzql/rendering/documents";
import { addressOf, moveTab } from "dzql/rendering/tabs";
import { address, parseAddress } from "dzql/rendering/bento";
import { splitPath } from "@blueshed/delta/core";
import { may, session as sessionOf, shape, shapeSession, team as teamOf, TEAM, type Request } from "./documents";

// leave's two resources. The session: your draft, and who -- but who is written only by the sign-in
// page (./signin.ts); over the wire a session's tab may move about, and the session draft and sign
// out. The team is everyone's, and what a person may write to it is who they are (./documents.ts).

export const session: Resource = {
  docType: "session",
  perSession: true, // keyed by the session id: this session's alone
  ledger: false, // signing in, moving about and a draft are not the team's history (./delta.ts)
  under: "/sessions",
  resolveDoc: (ws) => ws.data.sessionId,
  // Signed in: somewhere to stand, your draft to set, change and drop, and signing out. Never who you are.
  permit(ws, op) {
    if (sessionOf(ws.data.sessionId).person === null) return false;
    if (op.path === "/person_id") return op.op === "remove";
    if (op.path === "/draft") return op.op === "replace" || op.op === "remove";
    return op.op === "replace" && (op.path === "/page" || op.path === "/draft/starts" || op.path === "/draft/ends");
  },
  shape: (ws, id, ops) => shapeSession({ ...sessionOf(id), page: addressOf(ws) }, ops), // from where the tab that sent it stands
};

export const team: Resource = {
  docType: "team",
  resolveDoc: (ws) => (sessionOf(ws.data.sessionId).person ? TEAM : undefined),
  permit(ws, op) {
    const me = sessionOf(ws.data.sessionId).person;
    return !!me && may(me, op, teamOf());
  },
  shape(ws, _id, ops) {
    const { person, draft } = sessionOf(ws.data.sessionId);
    return shape(person!, ops, teamOf(), draft);
  },
  // Where the write leaves its writer's tab: asked for, a draft is gone and its drawer shows the
  // request it became, by the id it landed with; the modal that asked to take a request back closes.
  async afterWrite(ws, _id, ops, landed) {
    const { path, what } = parseAddress(addressOf(ws));
    const asked = ops.some((op) => op.op === "add" && op.value === undefined); // the draft, asked for
    const made = landed.find((op) => op.op === "add");
    const page = made ? address(path, "request", splitPath(made.path)[1]) : what === "confirm" && ops.some((op) => op.op === "remove") ? path : undefined;
    if (page !== undefined) moveTab(ws, page);
    if (asked) await serverWrite(`session:${ws.data.sessionId}`, [{ op: "replace", path: "/sessions/draft", value: null }]);
  },
  // An ask undone gives its draft back, as it was; asked again by Redo, that draft goes again.
  async afterWalk(ws, _id, { way, ops, inverse }) {
    const { person, draft } = sessionOf(ws.data.sessionId);
    const asks = ops.some((op) => op.op === (way === "undo" ? "remove" : "add")); // an ask, not a take-back
    const ask = (way === "undo" ? inverse : ops).find((op) => op.op === "add")?.value as Request | undefined;
    if (!asks || !ask || String(ask.person_id) !== person!.id) return;
    const back = way === "undo" ? { starts: ask.starts, ends: ask.ends } : null;
    if (back || (draft?.starts === ask.starts && draft.ends === ask.ends)) await serverWrite(`session:${ws.data.sessionId}`, [{ op: "replace", path: "/sessions/draft", value: back }]);
  },
};
