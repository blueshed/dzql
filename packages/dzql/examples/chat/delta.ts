import { defineDoc, defineSchema, registerDocs } from "@blueshed/delta/sqlite";
import { createLocal } from "@blueshed/delta/local";
import { registerMemory } from "@blueshed/delta/kinds";
import { db, openTables } from "dzql/rendering/db";
import { sessionRows } from "dzql/rendering/sessions";

// Chat's documents, in delta (`@blueshed/delta`). A session -- your name, your room, how far back you read --
// and a room's messages are written by people, stored, and on the ledger. Who is in a room, and
// which rooms there are, are live: kept by the server from the sessions and the connections, in
// memory. The tables are chat's own (`chat_`), beside anything else in the database. Every row is
// numbered by its table's serial; a room is its name, which its messages carry.

export const schema = defineSchema({
  // `cookie`: the hash of the cookie that names the session (dzql/rendering/sessions), never in its document
  sessions: { table: "chat_sessions", columns: { name: "text?", room: "text?", before: "integer?", cookie: "text?" }, temporal: false }, // a visit is no history
  // numbered as they are said, so the number is the order
  messages: { table: "chat_messages", columns: { room: "text", name: "text", text: "text", sent_at: "integer" } },
});

/** Its tables: its own migrations (./migrations), then what the schema says beyond them. */
export const migrating = await openTables(schema, "chat", `${import.meta.dir}/migrations`);

export const delta = createLocal();

registerDocs(
  delta.server,
  db,
  schema,
  [
    defineDoc("session:", { root: "sessions", include: [], implied: true, columns: { sessions: ["name", "room", "before"] } }),
    // a room's messages, named by the room: there before its first message, as a name is
    defineDoc("room:", { root: "messages", scope: { room: ":room" }, include: [] }),
  ],
  [],
  { ledger: true },
);

// The session a cookie names, found and made by the cookie's hash, off the ledger: a visit is no one's doing.
registerDocs(delta.server, db, schema, [defineDoc("visit:", { root: "sessions", scope: { cookie: ":cookie" }, include: [] })]);
export const sessions = sessionRows(delta, "sessions");

/** Who is in a room: `here:<room>`, the names present, in the order they came. */
registerMemory(delta.server, { prefix: "here:", empty: () => ({ people: {} as Record<string, true> }) });
/** Which rooms there are -- a room is there while someone is in it or something has been said in it: `lobby:all`. */
registerMemory(delta.server, { prefix: "lobby:", empty: () => ({ rooms: {} as Record<string, true> }) });

export { db };
