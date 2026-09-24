import { createTables, defineDoc, defineSchema, registerDocs } from "@blueshed/delta/sqlite";
import { createLocal } from "@blueshed/delta/local";
import { registerMemory } from "@blueshed/delta/kinds";
import { db } from "../../src/db";

// Chat's documents, in delta (Workshop/docs/eta-on-delta.md). A session -- your name, your room --
// and a room's messages are written by people, stored, and on the ledger. Who is in a room, and
// which rooms there are, are live: kept by the server from the sessions and the connections, in
// memory. The tables are chat's own (`chat_`), beside anything else in the database.

export const schema = defineSchema({
  sessions: { table: "chat_sessions", columns: { name: "text?", room: "text?" }, temporal: false },
  rooms: { table: "chat_rooms", columns: {}, temporal: false },
  // keyed by a time-ordered id (UUID v7), so the key is the order
  messages: { table: "chat_messages", parent: "rooms", columns: { name: "text", text: "text", sent_at: "integer" }, temporal: false },
});

createTables(db, schema);

export const delta = createLocal();

registerDocs(
  delta.server,
  db,
  schema,
  [
    // a session is there before its first write, as a room is before its first message
    defineDoc("session:", { root: "sessions", include: [], implied: true }),
    defineDoc("room:", { root: "rooms", include: ["messages"], implied: true }),
  ],
  [],
  { ledger: true },
);

/** Who is in a room: `here:<room>`, the names present, in the order they came. */
registerMemory(delta.server, { prefix: "here:", empty: () => ({ people: {} as Record<string, true> }) });
/** Which rooms there are -- a room is there while someone is in it or something has been said in it: `lobby:all`. */
registerMemory(delta.server, { prefix: "lobby:", empty: () => ({ rooms: {} as Record<string, true> }) });

export { db };
