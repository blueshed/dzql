import { defineDoc } from "@blueshed/delta/sqlite";
import { read as readDoc } from "dzql/rendering/documents";
import { register } from "../../store";

// A session (`session:<id>`), as the page reads it: who is signed in, if anyone. A numbered row,
// kept off the ledger -- signing in and out is not the model's history -- and holding every column
// of its row but the cookie's hash.
register([defineDoc("session:", { root: "sessions", include: [], implied: true, columns: { sessions: ["person_id", "name"] } })], { ledger: false });

export type Person = { id: string; name: string };

/** Who a session is, if anyone. */
export function read(sessionId: string): { person: Person | null } {
  const row = readDoc<{ sessions?: { person_id?: string | null; name?: string | null } }>(`session:${sessionId}`)?.sessions ?? {};
  return { person: row.person_id == null ? null : { id: String(row.person_id), name: row.name ?? "" } };
}
