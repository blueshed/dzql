# Backends: where documents are kept

Moving the recipe's chat from the JSON file to SQLite changes `room-api.ts`, and `routes.ts`
awaits `roomApi` (`const room = await roomApi(ws)`). The tables are the room's history of migrations. First,
on `room-api.ts` as it stands, `bunx @blueshed/delta migrations make resources/room/room-api.ts
--dir resources/room/migrations --name room` writes the first (every table) and the folder's
`index.ts` (`migrations.md`). Then `room-api.ts` takes them:

```ts
import { Database } from "bun:sqlite";
import type { WsServer } from "@blueshed/delta/server";
import { exportTables } from "@blueshed/delta/json";
import { defineDoc, defineSchema, importTables, migrate, registerDocs } from "@blueshed/delta/sqlite";
import { migrations } from "./migrations";

// schema, docs and the types as they were

export async function roomApi(ws: WsServer, dir = ".") {
  const db = new Database(`${dir}/chat.db`);
  await migrate(db, migrations, { app: "room", schema });   // the history makes the tables
  if (!db.query("SELECT 1 FROM rooms").get()) importTables(db, schema, exportTables(`${dir}/chat.json`, schema));   // once, into empty tables
  return registerDocs(ws, db, schema, docs);   // its close() closes db
}
```

Working: [create-blueshed/template](https://github.com/blueshed/dzql/blob/main/packages/create-blueshed/template/src/resources/message/message-api.ts), a document kept in the JSON file
(`src/resources/message/message-api.ts`), moved to SQLite, its tables made by a history of
migrations and its rows carried with `exportTables` and `importTables`, by its evolve skill's `references/sqlite.md`, applied to a new app and tested;
[examples/sites-bbox](https://github.com/blueshed/dzql/blob/main/packages/delta/examples/sites-bbox/README.md), one schema and its documents
(`resources/schema.ts`) on SQLite, and on Postgres in dzql's `server-pg.ts`.

## Pick the smallest that fits

- **JSON file** (`registerDocs(ws, file, …)`, `./json`): starting out, one process, a file you can read.
- **SQLite** (`migrate`, then `registerDocs(ws, db, …)`, `./sqlite`): more rows, a schema that
  changes on kept data; processes may share the file but hear only their own writes live
  (`sqlite.md`).
- **Postgres**: servers that share the data, people who see only their own: the next step is
  dzql's, not delta's (`postgres.md`).
- **Memory, source, static**: not tables (`kinds.md`).

The two table backends take one schema and one set of `defineDoc`s; `./json` and `./sqlite` each
export `defineSchema`, `defineDoc`, `defineCustomDoc`, so moving on changes the import path.
Each `registerDocs` returns `close()`, which a test awaits and `serve`'s `close` takes: the JSON
file's waits for its last save, SQLite's closes the database.

## Moving on

`exportTables` from where the rows are, `importTables` into where they go (both table backends
have them; one `Snapshot`, `src/schema.ts`). Rows, temporal versions and sequences carry, so the
next id follows on. The ledger does not: undo history starts fresh.

## The same on every table backend

`src/cases/path.ts` asks each of them (dzql answers the same cases for Postgres):

- One scope rule, single or list (`scope.md`); one error table (`paths.md`).
- A replace of a row is the row; `add /<coll>/-` takes the next serial (`paths.md`).
- Ids and parent keys come back as numbers; temporal rows without `valid_from` / `valid_to`.
- A write is told to every open document holding a row it changed (`fanout.md`).
- `open_at`; with `ledger: true`, undo, redo, history and a version on every change.
- `auth`, `owns` and `shared` (`ownership.md`).

## What differs

- The JSON file is one process, a file you can read; SQLite's processes may share the file, each
  told live only of its own writes (`sqlite.md`).
- The JSON file has no migrations: keep data that must last across upgrades in SQLite
  (`migrations.md`).
- An implied document named by text (`room:attic`) works on both; name by number (`room:7`) for
  an app that will move on to Postgres.

## Gotchas

- Several kinds and backends register on one server, each owning its prefix.
