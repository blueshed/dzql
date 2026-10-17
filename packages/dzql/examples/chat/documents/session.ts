import { read as readDoc } from "dzql/rendering/documents";

// A session, as its page reads it: a name, a room, and how far back in it you are reading, or none
// of them. Kept in delta (`session:<id>`, ../delta.ts); what a write to it may be is
// resources/session.ts's.

export type SessionDocument = { name: string | null; room: string | null; before: string | null };

export function read(id: string): SessionDocument {
  const doc = readDoc<{ sessions?: Partial<SessionDocument> }>(`session:${id}`);
  return { name: doc?.sessions?.name ?? null, room: doc?.sessions?.room ?? null, before: doc?.sessions?.before ?? null };
}
