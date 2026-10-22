/**
 * People: who is here, and signing in as one of them by link (delta's auth-link). A link is
 * someone: its tap makes a session, a cookie the page never reads, and the socket is signed in by
 * it. `people:` is everyone, for anyone signed in (`shared: true`): the names on a list, and whose
 * link to make. Kept in the app's SQLite file, the table made by this resource's history
 * (migrations/), the links and sessions beside it (`sqliteLinkStore`).
 *
 * The types are shared: the page imports them as types only, so none of this reaches it.
 */
import type { Database } from "bun:sqlite";
import { wireAuth } from "@blueshed/delta/auth";
import { linkAuth, sqliteLinkStore } from "@blueshed/delta/auth-link";
import type { WsServer } from "@blueshed/delta/server";
import { defineDoc, defineSchema, importTables, migrate, registerDocs } from "@blueshed/delta/sqlite";
import { migrations } from "./migrations";

/** Someone here. */
export interface Person { id: number; name: string }
/** What `people:` holds: everyone here, by id. */
export interface People { people: Record<string, Person> }

export const schema = defineSchema({
  people: { columns: { name: "text" }, temporal: false },
});

/** `people:`: everyone, for everyone signed in. */
export const docs = [defineDoc("people:", { root: "people", include: [] })];

/** The table made by its history, three people on a new database, and the link sign-in on the socket: answers the auth, for the server's routes. */
export async function peopleApi(ws: WsServer, db: Database) {
  await migrate(db, migrations, { app: "people", schema });
  if (!db.query("SELECT 1 FROM people LIMIT 1").get()) {
    importTables(db, schema, { tables: { people: [{ id: 1, name: "Ann" }, { id: 2, name: "Bo" }, { id: 3, name: "Cy" }] } });
  }
  const auth = linkAuth<Person>({
    store: sqliteLinkStore(db),
    personOf: (id) => db.query<Person, [number]>("SELECT id, name FROM people WHERE id = ?").get(id),
    people: () => db.query<Person, []>("SELECT id, name FROM people ORDER BY name, id").all(),
    // a few people who know each other: anyone here sends anyone their link (unsaid, one's own alone)
    mayLink: () => true,
  });
  wireAuth(ws, auth);   // me, link
  // With auth every document says who may have it: these, anyone signed in
  registerDocs(ws, db, schema, docs, [], { auth, shared: true });
  return auth;
}
