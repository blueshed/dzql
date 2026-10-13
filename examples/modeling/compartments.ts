import type { Compartment } from "../../src/compartments/compartment";
import { chosenOf, may, model, MODEL, session as sessionOf, shape } from "./model";

// modeling's two compartments. The session: who you are, written only by the sign-in page
// (./signin.ts), and what you have picked; over the wire a session may pick, and sign out. The
// model is the two keepers' alike: what a write to it may be is ./model.ts's.

export const session: Compartment = {
  docType: "session",
  perSession: true, // keyed by the session id: this session's alone
  ledger: false, // signing in, out, and picking something to look at are not the model's history (./delta.ts)
  under: "/sessions",
  resolveDoc: (ws) => ws.data.sessionId,
  // Signed in: something picked, or nothing, and signing out. Never who you are.
  permit(ws, op) {
    if (sessionOf(ws.data.sessionId).person === null) return false;
    if (op.path === "/person_id") return op.op === "remove";
    return op.path === "/chosen" && (op.op === "remove" || chosenOf(op.value as string) !== undefined);
  },
  // signing out forgets who you are, and what you had picked; picking what is picked already puts it down
  shape(_ws, id, ops) {
    const before = sessionOf(id).chosen;
    return ops.flatMap((op) => {
      if (op.path === "/person_id") return [{ op: "replace", path: "/person_id", value: null }, { op: "replace", path: "/name", value: null }, { op: "replace", path: "/chosen", value: null }];
      const value = op.op === "remove" || (before && `${before.k}:${before.id}` === op.value) ? null : op.value;
      return value === null && before === undefined ? [] : [{ op: "replace", path: "/chosen", value }];
    });
  },
};

export const modelCompartment: Compartment = {
  docType: "model",
  resolveDoc: (ws) => (sessionOf(ws.data.sessionId).person ? MODEL : undefined),
  permit: (ws, op) => sessionOf(ws.data.sessionId).person !== null && may(model(), op),
  shape: (_ws, _id, ops) => shape(model(), ops),
};
