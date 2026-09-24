import { read as readDoc } from "../../../src/documents";

// A session, as its page reads it: a name and a room, or neither. Kept in delta (`session:<id>`,
// ../delta.ts); what a write to it may be is compartments/session.ts's.

export type SessionDocument = { name: string | null; room: string | null };

export function read(id: string): SessionDocument {
  const doc = readDoc<{ sessions?: { name: string | null; room: string | null } }>(`session:${id}`);
  return { name: doc?.sessions?.name ?? null, room: doc?.sessions?.room ?? null };
}
