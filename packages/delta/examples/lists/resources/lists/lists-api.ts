/**
 * Lists: the server side of `list:<id>` (a list, who is on it and its items) and `mine:<person>`
 * (the lists a person is on). Three tables, behind the documents:
 *
 *   lists     (root)
 *   members   parent: lists → lists_id, and the person on it
 *   items     parent: lists → lists_id
 *
 * Who may have each is said in its definition (`owns`): a list is its members', through the
 * members rows; `mine:<person>` is that person's alone. Every write is kept on the ledger, so
 * each person's undo walks back their own changes and never another's. The tables are made by
 * this resource's history of migrations (migrations/), run at start-up.
 */
import type { Database } from "bun:sqlite";
import type { DeltaAuth } from "@blueshed/delta/auth";
import type { WsServer } from "@blueshed/delta/server";
import { defineDoc, defineSchema, importTables, migrate, registerDocs } from "@blueshed/delta/sqlite";
import type { Person } from "../people/people-api";
import { migrations } from "./migrations";

export interface List   { id: number; title: string }
export interface Member { id: number; lists_id: number; person: number }
export interface Item   { id: number; lists_id: number; title: string; done: boolean }

/** What `list:1` holds: the list, who is on it, and its items, each by id. */
export interface ListDoc { lists: List; members: Record<string, Member>; items: Record<string, Item> }
/** What `mine:1` holds: the person's memberships, by id, each naming a list. */
export interface Mine { members: Record<string, Member> }

export const schema = defineSchema({
  lists:   { columns: { title: "text" }, temporal: false },
  members: { parent: "lists", columns: { person: "integer" }, temporal: false },
  items:   { parent: "lists", columns: { title: "text", done: { type: "boolean", default: false } }, temporal: false },
});

export const docs = [
  // A list for its members: from the list's id, through its members rows, to the person
  defineDoc("list:", { root: "lists", include: ["members", "items"], owns: "@id->members[lists_id=$].person" }),
  // The lists one person is on, for them alone: `mine:1` is every members row of person 1
  defineDoc("mine:", { root: "members", include: [], scope: { person: ":id" }, owns: "@person" }),
];

/** The tables made by their history, three lists on a new database, and the documents on the socket, kept on the ledger. */
export async function listsApi(ws: WsServer, db: Database, auth: DeltaAuth<Person>) {
  await migrate(db, migrations, { app: "lists", schema });
  if (!db.query("SELECT 1 FROM lists LIMIT 1").get()) {
    importTables(db, schema, {
      tables: {
        lists: [{ id: 1, title: "Shopping" }, { id: 2, title: "Holiday" }, { id: 3, title: "Books" }],
        members: [
          { id: 1, lists_id: 1, person: 1 }, { id: 2, lists_id: 1, person: 2 },   // Ann and Bo shop together
          { id: 3, lists_id: 2, person: 1 },                                       // Ann's holiday
          { id: 4, lists_id: 3, person: 3 },                                       // Cy's books
        ],
        items: [],
      },
    });
  }
  // The ledger: every write recorded with what undoes it, by whom (`who`) and on whose cursor
  registerDocs<Person>(ws, db, schema, docs, [], { auth, ledger: true, who: (p) => String(p.id) });
}
