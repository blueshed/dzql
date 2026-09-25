import type { Compartment } from "../../src/compartments/compartment";
import { serverWrite } from "../../src/documents";
import { address, parseAddress } from "../../src/bento";
import { may, session as sessionOf, shape, shapeSession, team as teamOf, TEAM } from "./documents";

// leave's two compartments. The session is the tray: where you are, and who -- but who is written
// only by the sign-in page (./signin.ts); over the wire a session may move about, and sign out. The team is everyone's, and what a person may write to it is who they are
// (./documents.ts).

export const session: Compartment = {
  docType: "session",
  own: true, // keyed by the session id: this session's alone
  ledger: false, // signing in, moving about and a draft are not the team's history (./delta.ts)
  at: "/sessions",
  resolveDoc: (ws) => ws.data.sessionId,
  // Signed in: somewhere to stand, and signing out. Never who you are.
  permit(ws, op) {
    if (sessionOf(ws.data.sessionId).person === null) return false;
    if (op.path === "/person_id") return op.op === "remove";
    return op.path === "/page";
  },
  shape: (_ws, id, ops) => shapeSession(sessionOf(id), ops),
};

export const team: Compartment = {
  docType: "team",
  resolveDoc: (ws) => (sessionOf(ws.data.sessionId).person ? TEAM : undefined),
  permit(ws, op) {
    const me = sessionOf(ws.data.sessionId).person;
    return !!me && may(me, op, teamOf());
  },
  shape: (ws, _id, ops) => shape(sessionOf(ws.data.sessionId).person!, ops, teamOf()),
  // Where the write leaves its writer: a draft set opens its drawer; a draft asked for, or dropped,
  // closes it; the modal that asked to take a request back closes.
  async wrote(ws, _id, ops) {
    const { path, what } = parseAddress(sessionOf(ws.data.sessionId).page);
    const drafted = ops.some((op) => op.path.startsWith("/draft") && op.op !== "remove");
    const closed = ops.some((op) => op.op === "add" || op.path === "/draft") || (what === "confirm" && ops.some((op) => op.op === "remove"));
    const page = drafted ? address(path, "draft") : closed ? path : undefined;
    if (page !== undefined) await serverWrite(`session:${ws.data.sessionId}`, [{ op: "replace", path: "/sessions/page", value: page }]);
  },
};
