import type { Resource } from "dzql/rendering/resources/resource";
import { addressOf } from "dzql/rendering/tabs";
import { read, shape } from "./session-api";

// The session: your draft, and who -- but who is written only by the sign-in page (../../signin.ts);
// over the wire a session's tab may move about, and the session draft and sign out.

export const session: Resource = {
  docType: "session",
  perSession: true, // keyed by the session id: this session's alone
  ledger: false, // signing in, moving about and a draft are not the team's history (./session-api.ts)
  under: "/sessions",
  resolveDoc: (ws) => ws.data.sessionId,
  // Signed in: somewhere to stand, your draft to set, change and drop, and signing out. Never who you are.
  permit(ws, op) {
    if (read(ws.data.sessionId).person === null) return false;
    if (op.path === "/person_id") return op.op === "remove";
    if (op.path === "/draft") return op.op === "replace" || op.op === "remove";
    return op.op === "replace" && (op.path === "/page" || op.path === "/draft/starts" || op.path === "/draft/ends");
  },
  shape: (ws, id, ops) => shape({ ...read(id), page: addressOf(ws) }, ops), // from where the tab that sent it stands
};
