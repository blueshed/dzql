import type { Compartment } from "dzql/rendering/compartments/compartment";
import { may, model, MODEL, session as sessionOf, shape } from "./model";

// modeling's two compartments. The session: who you are, written only by the sign-in page
// (./signin.ts); over the wire a session may only sign out. The model is the two keepers' alike:
// what a write to it may be is ./model.ts's.

export const session: Compartment = {
  docType: "session",
  perSession: true, // keyed by the session id: this session's alone
  ledger: false, // signing in and out is not the model's history (./delta.ts)
  under: "/sessions",
  resolveDoc: (ws) => ws.data.sessionId,
  permit: (ws, op) => sessionOf(ws.data.sessionId).person !== null && op.path === "/person_id" && op.op === "remove",
  // signing out forgets who you are
  shape: () => [{ op: "replace", path: "/person_id", value: null }, { op: "replace", path: "/name", value: null }],
};

export const modelCompartment: Compartment = {
  docType: "model",
  resolveDoc: (ws) => (sessionOf(ws.data.sessionId).person ? MODEL : undefined),
  permit: (ws, op) => sessionOf(ws.data.sessionId).person !== null && may(model(), op),
  shape: (_ws, _id, ops) => shape(model(), ops),
};
