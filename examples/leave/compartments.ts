import type { Compartment } from "../../src/compartments/compartment";
import { serverWrite } from "../../src/documents";
import type { PatchOp } from "../../src/json-patch";
import { parseAddress } from "../../src/bento";
import { may, placed, session as sessionOf, shape, team as teamOf, TEAM } from "./documents";

// leave's two compartments. The session is the tray: where you are, and who -- but who is written
// only by the sign-in page (./signin.ts); over the wire a session may move about, and sign out.
// The team is everyone's, and what a person may write to it is who they are (./documents.ts).

export const session: Compartment = {
  docType: "session",
  own: true, // keyed by the session id: this session's alone
  ledger: false, // signing in and moving about are not the team's history (./delta.ts)
  at: "/sessions",
  resolveDoc: (ws) => ws.data.sessionId,
  // Somewhere to stand, once signed in; and signing out. Never who you are.
  permit(ws, op) {
    if (op.path === "/person_id") return op.op === "remove" && sessionOf(ws.data.sessionId).person !== null;
    return op.path === "/page" && sessionOf(ws.data.sessionId).person !== null;
  },
  shape(_ws, id, ops) {
    const before = sessionOf(id);
    return ops.flatMap((op): PatchOp[] => {
      if (op.path === "/person_id") return [{ op: "replace", path: "/person_id", value: null }, { op: "replace", path: "/page", value: null }];
      const page = op.op === "remove" ? "" : placed(op.value);
      return page === undefined || page === before.page ? [] : [{ op: "replace", path: "/page", value: page }];
    });
  },
};

export const team: Compartment = {
  docType: "team",
  resolveDoc: (ws) => (sessionOf(ws.data.sessionId).person ? TEAM : undefined),
  permit(ws, op) {
    const me = sessionOf(ws.data.sessionId).person;
    return !!me && may(me, op, teamOf());
  },
  shape: (ws, _id, ops) => shape(sessionOf(ws.data.sessionId).person!, ops),
  // The modal that asked is put away once the write answers it: the ask made, the request taken back.
  async wrote(ws, _id, ops) {
    const { path, what } = parseAddress(sessionOf(ws.data.sessionId).page);
    const answered = (what === "new" && ops.some((op) => op.op === "add")) || (what === "confirm" && ops.some((op) => op.op === "remove"));
    if (answered) await serverWrite(`session:${ws.data.sessionId}`, [{ op: "replace", path: "/sessions/page", value: path }]);
  },
};
