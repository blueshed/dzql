// Every name the diagrams use. The classes are its interfaces, the API is `Api`, a class's states
// are the union named after it (`SessionState`), and its other events a union ending in `Event`.
// watch.ts checks each diagram in src/ against this file and shows where they drift apart.

export type Actor = "user";

export interface User {
  id: string;
  email: string;
  passwordHash: string;
}

export interface Session {
  id: string;
  user: User["id"];
  startedAt: string;
  expiresAt: string;
  state: SessionState;
}

export type SessionState = "signedOut" | "signedIn" | "expired";

/** What happens to a session that no one asks for. */
export type SessionEvent = "timePasses" | "nextRequest";

export interface Api {
  login(req: { email: string; password: string }): { ok: true; session: Session["id"] } | { ok: false; reason: "not recognised" };
  logout(req: { session: Session["id"] }): { ok: true };
}
