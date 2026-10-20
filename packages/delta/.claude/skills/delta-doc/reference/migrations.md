# Migrations: a history from empty

**Every change to the tables is a migration, from the first table on.** A migration is a list of
changes (a table made, a column added, renamed or dropped), which every backend makes alike
(SQLite here, Postgres in dzql), and, for what changes cannot say, an `up` that moves data. Folded
in order, the migrations are the tables the history leads to. `delta migrations make` writes the
next one from what your definitions say beyond them, so a person writes only what a diff cannot
know: a rename, a change of type, data. A new database runs the history from its first migration;
one database, many years, one history (`tests/migrations-from-empty.test.ts`).

**`createTables(db, schema)` is for a database thrown away**: `:memory:` in a test or a script, or
a demo that starts afresh each run (`testing.md`). It makes the tables straight from the schema,
with no history, so a database an app keeps never takes it: an app's tables are its migrations.

```ts
// migrations/001-people.ts and 002-posts.ts, as `delta migrations make src/db.ts` writes them
import { createTable } from "@blueshed/delta/migrations";
export const changes = [createTable("people", { columns: { name: { type: "text" } }, temporal: false })];

// migrations/003-short-name.ts: a column, and the data that fills it, in one transaction
import { addColumn } from "@blueshed/delta/migrations";
export const changes = [addColumn("people", "short", "text?")];
export const up = (db) => db.run("UPDATE people SET short = name");

// start-up: the history, and only the history, makes the tables
import { fromFolder, migrate } from "@blueshed/delta/sqlite";
const result = await migrate(db, await fromFolder("migrations"), { app: "team", schema });
// result.drift: what the definitions say beyond the history (empty: they agree)
```

Working: [examples/lists](https://github.com/blueshed/dzql/blob/main/packages/delta/examples/lists/README.md), whose history renames a column
on a database that holds data (`resources/lists/migrations/002-title.ts`: `make` wrote a drop and
an add, made a `renameColumn` by hand), run at start-up, with undo fenced across it.

- **Changes:** `createTable(key, def)` (a `defineSchema` entry), `dropTable`, `renameTable(key, to)`,
  `addColumn(key, column, def)`, `dropColumn`, `renameColumn(key, from, to)`,
  `addUnique(key, columns, { whereNull })`, `dropUnique(key, columns)`, from
  `@blueshed/delta/migrations` (`src/server/changes.ts`). `make` writes a unique constraint too.
- **A row an `up` adds takes `nextId`**: `up(tx, { nextId })`, where `await nextId("items")` is the
  collection's next serial, moved on as `add /items/-` moves it, so a row a write makes later
  never meets it. Never write `_delta_sequences` (SQLite) or `seq_<table>` (Postgres) yourself:
  they are delta's (`MigrationTools` in `src/server/migrate.ts`).
- **`delta migrations make <module> [--dir migrations] [--name <name>] [--export schema]`** writes
  `NNN-<name>.ts`: the changes, and as `// By hand:` comments what it cannot make. A column gone
  and one new may be a rename: it drops and adds, and says so. A changed type, nullability or
  default, or a table's parent or versions, is an `up` for you to write. With nothing to make, it
  writes nothing.
- **Drift:** given the schema, `migrate` answers `drift`, a line for each thing the definitions say
  beyond the history, and logs it. Make the next migration; never edit one that has run.
- **Once, in order.** Each migration runs in its own transaction with its record in
  `delta_migrations (app, id, ran_at)`: its changes, then its `up`. A failure rolls that one back,
  changes and all, and throws naming it; the ones before it stay.
- **`migrationStatus(db, list, options)`**: what ran, what is pending, ids recorded that the list
  no longer has. From a shell: `bunx @blueshed/delta migrate <database> --app <name> --status`
  (`cli.md`). On Postgres, `migrate` is dzql's, the same lists (`postgres.md`).
- **An `up` is its backend's SQL.** A new database whose rows come imported, migrated already
  (`importTables` after the run, as an app moves to Postgres), says `imported: true`: the changes
  make the tables, and each `up` is recorded as run, never run. Once the history is recorded there,
  the next `up` runs. Never edit an `up` that has run to hold two backends.

## A database made the older way adopts the history

A database whose tables were made from the schema at start-up (`createTables` /
`migrateSchema`, or dzql's `generateSql`), and which has recorded none of the history, **adopts** it
when it holds every table and column the history leads to: each migration is recorded as run,
none is run (`fresh: true`). Write the history's first migrations to match what it holds, then go
on from there.

## The older way: `up` alone

A list whose first migration has no `changes` is the older way: the schema makes the tables at
start-up (`createTables`, then `migrateSchema` adds what it declares), and a migration is only
what a schema cannot say (`up`, with the helpers `renameColumn`, `dropColumn`, `renameTable` in
`@blueshed/delta/sqlite`). There, an app new to a database records every migration and runs none.
It keeps working; a history from empty is the way for a new app.

## The schema is the contract

delta sees only what the schema declares: what it sends and what it writes are the declared
columns (and the id, the parent key, a temporal row's validity). A database may hold **more** (a
migration ahead of this version), never **less**. So an upgrade can expand and contract with two
versions on one database: a migration adds a column the running version is blind to; the new
version declares it and uses it; once none declares the old column, a later migration drops it
(`tests/schema-contract.test.ts`).

## Gotchas

- **Never edit a migration that has run anywhere**, nor rename its id: write the next one.
- **A migration is for the tables and the data that must be kept.** Seed data is the seed's.
- **The ledger is fenced.** A migration moves rows under the ledger's paths, so it makes the
  app's entries before it (those over its schema's collections; with no schema, every entry)
  not undoable: undo and redo answer `null`, `history` shows them with `undoable: false`.
  Another app on the database undoes on.
- Run migrations at start-up, outside a transaction, before any document opens.
- **The JSON file has no migrations.** The file backend is for documents you can reset; to keep
  data across upgrades, keep it in SQLite.
