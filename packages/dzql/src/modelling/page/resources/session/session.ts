import type { Resource } from "dzql/rendering/resources/resource";
import { read } from "./session-api";

// The session: who you are, written only by the sign-in page (../../signin.ts); over the wire a
// session may only sign out.

export const session: Resource = {
  docType: "session",
  perSession: true, // keyed by the session id: this session's alone
  ledger: false, // signing in and out is not the model's history (./session-api.ts)
  under: "/sessions",
  resolveDoc: (ws) => ws.data.sessionId,
  permit: (ws, op) => read(ws.data.sessionId).person !== null && op.path === "/person_id" && op.op === "remove",
  // signing out forgets who you are
  shape: () => [{ op: "replace", path: "/person_id", value: null }, { op: "replace", path: "/name", value: null }],
};
