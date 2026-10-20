import { defineDoc, defineSchema, registerDocs, type DocDef } from "@blueshed/delta/sqlite";
import { createLocal } from "@blueshed/delta/local";
import { db, openTables } from "dzql/rendering/db";
import { sessionRows } from "dzql/rendering/sessions";

// Chat's store: SQLite (dzql/rendering/db), its documents in delta (`@blueshed/delta`). A session --
// your name, your room, how far back you read -- and a room's messages are written by people,
// stored, and on the ledger. Who is in a room, and which rooms there are, are live: kept by the
// server from the sessions and the connections, in memory. Each resource registers its documents
// (`register`, in `resources/<name>/<name>-api.ts`). The tables are said once, here, not in each
// api: the database makes them once, its migrations first, and a new table or column after
// (`openTables`), before any document is registered over them. They are chat's own (`chat_`),
// beside anything else in the database. Every row is numbered by its table's serial; a room is its
// name, which its messages carry.

export const schema = defineSchema({
  // `cookie`: the hash of the cookie that names the session (dzql/rendering/sessions), never in its document
  sessions: { table: "chat_sessions", columns: { name: "text?", room: "text?", before: "integer?", cookie: "text?" }, temporal: false }, // a visit is no history
  // numbered as they are said, so the number is the order
  messages: { table: "chat_messages", columns: { room: "text", name: "text", text: "text", sent_at: "integer" } },
});

/** Its tables: its own migrations (./migrations), then what the schema says beyond them. */
export const migrating = await openTables(schema, "chat", `${import.meta.dir}/migrations`);

export const delta = createLocal();

/** A resource's documents, on delta over chat's tables: on the ledger unless it says not. */
export const register = (docs: DocDef[], { ledger = true } = {}) => registerDocs(delta.server, db, schema, docs, [], { ledger });

// The session a cookie names, found and made by the cookie's hash, off the ledger: a visit is no one's doing.
register([defineDoc("visit:", { root: "sessions", scope: { cookie: ":cookie" }, include: [] })], { ledger: false });
export const sessions = sessionRows(delta, "sessions");

export { db };
