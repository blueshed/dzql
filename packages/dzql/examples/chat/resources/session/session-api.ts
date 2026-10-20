import { defineDoc } from "@blueshed/delta/sqlite";
import { read as readDoc } from "dzql/rendering/documents";
import { register } from "../../store";

// A session, as its page reads it: a name, a room, and how far back in it you are reading, or none
// of them. Kept in delta (`session:<id>`), on the ledger; it holds every column of its row but the
// cookie's hash. What a write to it may be is ./session.ts's.
register([defineDoc("session:", { root: "sessions", include: [], implied: true, columns: { sessions: ["name", "room", "before"] } })]);

export type SessionDocument = { name: string | null; room: string | null; before: number | null };

/** A session as its page reads it: before its row is made (implied), its columns' defaults, none of them, as delta opens it and as it stood. */
export function read(id: string): SessionDocument {
  const { name, room, before } = readDoc<{ sessions: SessionDocument }>(`session:${id}`).sessions;
  return { name, room, before };
}
