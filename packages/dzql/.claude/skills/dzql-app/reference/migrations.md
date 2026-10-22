# Migrations (`migrations/NNN-name.ts`)

People keep real data in an app. A new table or column the schema adds by itself; a field renamed
or dropped, or data moved, is a migration, or the data is lost.

## On Postgres (the starter, the cafe)

`openStore` runs the history first, each time it opens: the starter's is the model's folder.

```ts
// src/store.ts
export const store = openStore({ schema, migrations: { dir: `${import.meta.dir}/../model/migrations`, app: "leave", schema } });
```

```ts
// model/migrations/001-requests.ts: what `dzql model` (or `delta migrations make`) writes
import { createTable } from "@blueshed/delta/migrations";

export const changes = [createTable("requests", { columns: { title: { type: "text", nullable: true } }, temporal: true })];
```

```ts
// model/migrations/002-reason.ts: a request says why; every one asked before was a holiday
import type { PoolClient } from "pg";
import { addColumn } from "@blueshed/delta/migrations";

export const changes = [addColumn("requests", "reason", { type: "text", nullable: true })];

export async function up(client: PoolClient): Promise<void> {
  await client.query("UPDATE requests SET reason = 'holiday' WHERE reason IS NULL");
}
```

The schema says the new shape in the same commit: `requests: { columns: { title: "text", reason: "text?" } }`.

Working: [examples/cafe](https://github.com/blueshed/dzql/tree/main/packages/dzql/examples/cafe/model/migrations), its model's three steps
(`model/migrations/`: the tables made, two columns renamed and one added, changes alone), run by
`openStore` on PGlite as its tests and stories open it; and `tests/readme/migrations.test.ts`,
which runs the two files above as written: the first on a new database, a request written, then
the second over it, the request now a holiday.

- A file exports `changes` (`@blueshed/delta/migrations`: `createTable`, `addColumn`,
  `renameColumn`, `dropColumn`, `renameTable`, ...), made by every backend alike, then `up`, for
  what changes cannot say (data): `up(client, { nextId })`, given the `PoolClient` of its
  transaction, as the tables' owner, past the documents' policies. A row it inserts takes its id
  from `nextId(collection)`. Either, or both. A list in place of the folder is
  `Migration<PoolClient>[]` (`{ id, changes?, up? }`, from `dzql/postgres`): `migrations: { list, app, schema }`.
- They run in name order, once each, each in its own transaction with its record in
  `delta_migrations`, then the framework and the compiled SQL: one that throws is rolled back and
  stops the start. Two servers opening at once take turns.
- A new database runs them from the first: the history makes the tables.
- `dzql migrate <database> --status --dir model/migrations --app leave` says what has run there and what would.

## On SQLite (the other examples)

```ts
// examples/leave/upgrade/001-reason.ts: a request says why; every one asked before was a holiday
export function up(db: Database): void {
  db.run("ALTER TABLE leave_requests ADD COLUMN reason TEXT");
  db.run("UPDATE leave_requests SET reason = 'holiday'");
}

// 002-person.ts: `asked_by` is `person_id` now
export function up(db: Database) { renameColumn(db, "leave_requests", "asked_by", "person_id"); }

// 003-days.ts: the calendar works the days out; the count kept goes
export function up(db: Database) { dropColumn(db, "leave_requests", "days"); }
```

`examples/leave/upgrade.test.ts` runs these on a database leave's previous version left, then
leave's stories on it. The helpers are delta's (`@blueshed/delta/sqlite`: `renameColumn`,
`dropColumn`, `renameTable`).

Working: [examples/leave](https://github.com/blueshed/dzql/tree/main/packages/dzql/examples/leave/upgrade), its next version's migrations
(`upgrade/001-reason.ts` to `upgrade/004-numbered.ts`: a column added and filled, one renamed, one
dropped), run by `upgrade.test.ts` on the database the version before left, with an undo from
before, then leave's stories on it.

- `store.ts` runs them first, then the schema: `await openTables(schema, app, folder)`
  (`dzql/rendering/db`) is delta's `migrate`, then `createTables`, then `migrateSchema`. Change the
  schema to its new shape in the same commit.
- A file is `NNN-name.ts` exporting `up(db)`; its name is its id, recorded in `delta_migrations`.
  They run in name order, once each, each in its own transaction: one that throws is rolled back
  and stops start-up.
- A new database runs none: the schema makes it as they would leave it, and each is recorded.
- A column the new schema declares, add in the migration that fills it: migrations run before
  `migrateSchema`.
- `bunx delta migrate --status` says what has run here and what would.

## On either

- `app` is whose they are, recorded with each id: apps sharing a database each run only their own.
  `schema` says whether the app is new here (its tables not there), and which ledger entries a
  migration fences. Without them, another app's tables make it not new, and every app's undo is fenced.
- Never edit, rename or delete a migration that has run anywhere: write another.
- Move what must be kept before you drop it: rename, or copy into the new place, then drop.
- Undo never reaches back across a migration: delta fences the ledger, and every entry before it
  is no longer undoable (history still shows them).
