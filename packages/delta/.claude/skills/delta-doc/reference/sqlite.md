# SQLite (and the JSON file)

A schema, validation (400 for unknown fields, wrong types, missing required ones), temporal
history and the ledger, with no database server. The JSON file is the same engine: SQLite in
memory, loaded from the file and saved after every change.

```ts
import { Database } from "bun:sqlite";
import { createWs } from "@blueshed/delta/server";
import { defineSchema, defineDoc, createTables, registerDocs } from "@blueshed/delta/sqlite";

export const schema = defineSchema({
  lists: { columns: { title: "text?" } },
  todos: { parent: "lists", columns: { text: "text", done: { type: "boolean", default: false } } },
});
export const listDoc = defineDoc("list:", { root: "lists", include: ["todos"], implied: true });

const db = new Database("app.db");
createTables(db, schema);                  // before the first open
const ws = createWs();
registerDocs(ws, db, schema, [listDoc]);   // , customDocs?, { ledger, auth, shared, who }
```

Options: `RegisterOptions` in `src/server/sqlite.ts`. It returns `{ evict }` (the JSON file's
also `persisted()`, resolving once every change so far is in the file).

Working: [examples/sites-bbox](https://github.com/blueshed/dzql/blob/main/packages/delta/examples/sites-bbox/README.md), the tables made and the
world's document registered (`resources/world/world-api.ts`), and on the same database the box's,
told of every write through the world (`resources/box/box-api.ts`, `routes.ts`);
[examples/lists](https://github.com/blueshed/dzql/blob/main/packages/delta/examples/lists/README.md), a shared set (`people:`) and a set by
paths (the lists) on one file (`resources/people/people-api.ts`, `resources/lists/lists-api.ts`).

## Gotchas

- `createTables(db, schema)` before the first open; a missing table's error says so.
  `migrateSchema(db, schema)` only adds what a later schema declares (columns, and
  `console.warn`s on type drift: treat that as a real signal). A rename, a drop, a change of
  type or data moved is a migration, run first: `migrations.md`.
- A single document's root row must exist before it opens: seed it, or declare it `implied: true`.
- A `delta` for a name this process has not opened is 404 `Doc not loaded`. `doc.send` never
  meets it; a script sending `delta` itself opens the document first.
- **Processes may share the file.** A write takes the lock (`BEGIN IMMEDIATE`, 5 s
  `busy_timeout` unless the app set its own) and re-reads any copy another process changed. But a
  document open in one process is **not told** of a write in another until it is next opened or
  written through: live fan-out across processes is Postgres's, the next step (`postgres.md`).
- `bun:sqlite` is synchronous: waiting for another process's lock blocks the event loop. Keep
  writes short on a shared file; a write from another process drops every cached copy here.
- **With `auth`, each document says who may have it**: `owns` as a path in its definition
  (`ownership.md`), or `shared: true` in the options for every document of the call. Nothing
  filters what a document reads: the document's root and parent chain decide what it holds. A
  custom doc's `query`, `matches`, `recompute` must check rows themselves.
- Two registrations on one database (a public set with `shared`, a private set with paths)
  share the ledger and the fan-out: a write through either is told to every document open on
  that handle. A name goes to the longest matching prefix; a prefix already held is refused.
- The JSON file's registrations of one file on one server share one database.
- An included collection with no `parent` is shared: every document of the prefix holds all of it.
- Writing inside your own transaction makes delta's write a savepoint: see `local.md`.
