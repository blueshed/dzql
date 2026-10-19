# Postgres (a server, or PGlite in process)

The imports are `dzql/postgres`, `dzql/pglite`, `dzql/auth-link` and `dzql/auth-jwt`; the commands
are `dzql sql`, `dzql init`, `dzql migrate` and `dzql link`. The definitions are delta's, and so is
its manual (the `delta-doc` skill): this page is what Postgres adds.

An app's documents, the same definitions it had on SQLite: its history of migrations makes the
tables, the framework and the compiled SQL follow, and the listener serves the documents.

```ts
import { Pool } from "pg";
import { createWs } from "@blueshed/delta/server";
import { serve } from "@blueshed/delta/serve";
import { applyFramework, applySql, generateSql, createDocListener, docTypeFromDef, fromFolder, migrate } from "dzql/postgres";
import { schema, docs } from "./schema";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });   // or: await openPglite(dir) in tests
await migrate(pool, await fromFolder("migrations"), { app: "board", schema });   // the history makes the tables
await applyFramework(pool);                          // 001a–001g, idempotent
await applySql(pool, generateSql(schema, docs));     // each document compiled

const ws = createWs();
const listener = await createDocListener(ws, pool, { types: docs.map((def) => docTypeFromDef(def, pool)) });
// delta's one server: the socket on its path, and on shutdown the listener (it holds a pool client for LISTEN), then the pool
serve({ routes: { "/": index }, ws, close: [() => listener.destroy(), () => pool.end()] });
```

Options: `createDocListener` and `docTypeFromDef` in `src/postgres/listener.ts` and
`registry.ts`. Signing in: delta-doc's `auth.md` (on Postgres, `postgresLinkStore` from
`dzql/auth-link`); who may open what: below, and `rls.md`.

## Setting up the database

- **Programmatic**: `applyFramework(pool)`, `applyAuthJwtSchema(pool)` (if `jwtAuth`), then
  `applySql(pool, generateSql(schema, docs))`.
- **Vendored** (a migration tool or `docker-entrypoint-initdb.d` owns the database):
  `bunx dzql init init_db --with-auth` copies `001a–001g` (and `002-users.sql`);
  `bunx dzql sql ./types.ts --out init_db/003-tables.sql` writes your tables. The SQL
  is yours, in git; only the SQL is vendored, the TypeScript is imported.
- **The history makes the tables**: `migrate(pool, await fromFolder("migrations"), { app, schema })`
  first, then `applyFramework` and `applySql(pool, generateSql(…))`. The same migrations as on
  SQLite (`delta migrations make` writes them from the definitions): a new database runs them from
  the first; one made the older way, holding their tables, adopts them. A change the definitions
  make is the next migration (delta-doc's `migrations.md`). Give the listener your
  `schema` (`createDocListener(ws, pool, { types, schema })`): it sends and writes the columns
  it declares, so two versions on one database each see their own.
- **After upgrading dzql**, run `init <dir> --upgrade` (it keeps `.bak`s and says what changed)
  or `applyFramework` again. Never edit `001*` by hand: it is the stored-function contract.
- Mount `init_db/` at `/docker-entrypoint-initdb.d`: Postgres applies it alphabetically on the
  first boot of an empty volume, then skips; `docker compose down -v` starts fresh.

## Who may open a document

A document is the permission: opening it is the read, a write goes only through what it holds,
and its `owns` says who may have it, as a path from its row to the person (delta-doc's
`ownership.md`):

```ts
defineDoc("venue:", { root: "venues", include: ["areas"], owns: "@org_id->members[org_id=$]{active}.person_id" });
```

`generateSql` compiles each path into the document's own function, `dzql_owns__<doc>(name,
person)`, through delta's `pathSql`: the same SQL SQLite runs. The listener asks it before open,
write, history and a walk, and before telling each socket of a change, so someone the path stops
reaching is let go. A write that would leave the path not reaching the writer (handing the row
away) is refused, 403. A path that cannot be followed is an error naming the document. There are
no table rules.

## Compiled SQL

`generateSql` writes more than your tables. It writes the SQL for each of your documents and
collections, compiled from their definitions: nothing reads `_delta_collections` or `_delta_docs`
to work out what a document means at run time. The framework SQL (`001*`) holds the tables, the
write (`delta_apply`), the ledger and the listener's functions, and calls what `generateSql`
writes. Each compiled piece is pinned by `tests/compile/`: its answers on every document name of
delta's path cases, on the seed and after writes, and its text.

| What | Compiled |
| --- | --- |
| Opening a document | `dzql_open__<doc>`, `dzql_open_at__<doc>` (and `_as`), via `delta_open`, `delta_open_at` |
| The document a name is of | `_delta_find_doc`, each prefix written in, the longest first |
| Does a document hold a row | `dzql_holds__<doc>`, via `_delta_doc_holds` |
| May a write touch a row (its scope) | `dzql_in_scope__<doc>`, via `_delta_row_in_scope` |
| What a document is told of a write | `dzql_told__<doc>`, via `_delta_told` |
| Which open documents hold a row (the fan-out) | `_delta_holders` itself, per collection |
| Reading a name by its document's scope | `dzql_scope__<doc>`, via `_delta_resolve_scope` |
| Is a one-row document's root there, before each op of a write | `dzql_root_there__<doc>`, via `_delta_root_there` |
| The columns a document writes | `dzql_columns__<doc>`, via `_delta_write_columns` |
| Checking a write's fields | `_delta_assert_fields` itself, per collection and set of columns; another set (a walk's, another version's) by the columns given |
| A write's row SQL: lock, store a replace, mint an id, clear a moment, is it there, read, store an add | `_delta_row_lock`, `_delta_row_put`, `_delta_next_id`, `_delta_row_clear_moment`, `_delta_row_there`, `_delta_row_read`, `_delta_row_add`, per collection |
| The ledger's reads: a document whole (an entry's inverse, a walk's guard), a field the same, a row beyond the document | `dzql_open_whole__<doc>` via `_delta_open`; `_delta_same`, `_delta_row_standing`, per collection |
| A collection's definition, a table's serial | `_delta_collection`, `_delta_serial_new`, `_delta_serial_past`, per collection |
| Who may have a document (`owns` as a path), and a write that keeps it in reach | `dzql_owns__<doc>`; `_delta_keeps_reach`, asked by `delta_apply` |
| What a remove takes with it, and what a moved row carries | `dzql_cascade_remove__<coll>`, `dzql_cascade_rows__<coll>`, `dzql_hanging_rows__<coll>`, via `_delta_cascade_remove`, `_delta_cascade_rows`, `_delta_hanging_rows` |

Three rules follow:

- **The framework first, then `generateSql`, every time.** `applyFramework` (or vendored `001*`
  files) puts back the uncompiled forms of what `generateSql` writes, which know no document: a
  document's name is refused (`no doc def for: <name>`) until `generateSql` is applied again.
  Re-apply it after `applyFramework` and after `init --upgrade`. Vendored, `003-tables.sql` sorts
  after `001*`, so a tool that re-applies the directory in order gets this right; one that
  re-applies only `001*` must re-apply `003` too.
- **One app per database.** Each `generateSql` writes the whole set of an app's documents and
  collections; a later one, with other definitions, takes their place. Two apps on one Postgres
  server each have a database of their own (`CREATE DATABASE`), which keeps their changes apart too
  (LISTEN/NOTIFY is per database). A schema per app is not supported yet (todo #29).
- **A document is what its definition compiles to.** Nothing registered by hand is read: add a
  document to your definitions and apply `generateSql`.

The `dzql_*` functions are internal: call `delta_open` / `delta_apply` and their `_as` forms
(`sql.md`), which reach them. What a write costs, compiled, is in `bench/results-2026-10-15.md`
(under RLS, as an app role).

## Gotchas

- `bun add pg`, and `bun add -d @types/pg` to type-check (dzql ships TS source).
- Ids are BIGINTs from `seq_<table>`: a client id that is not a number, or past 2^53 - 1, is a
  400; one that is moves the sequence past it.
- Implied documents are named by number here (`room:7`).
- **Each listener has its own types**: two servers in one process each answer for theirs. One
  prefix, one type; `listener.register(type)` replaces its prefix's type (for `bun --hot`).
- `delta_open` raises on configuration errors (unknown prefix or root); NULL only means a
  single root row is not there, which the listener answers 404.
- Write through `delta_apply` (the listener, or `delta_apply_as` from SQL), never a raw
  `INSERT`: only that path versions, logs and NOTIFYs (`sql.md`).
- A hand-written `DocType` hears only its own writes (`DocType` in `src/postgres/registry.ts`).
- **A write tells every open document that holds a row it touched, in its own transaction**: that
  is what makes each change arrive whole and in order. A row held by many open documents (a feed
  per person, each holding the same new post) costs the write one telling for each. Keep
  documents to what someone needs in front of them, scoped by a parent, a status or a time, never
  a whole table that only grows: a document is opened whole.
- `_delta_ops_log` is a catch-up buffer: prune it with `pruneOpsLog(pool)` (`delta_prune_ops`).
- PGlite (`openPglite(dir?)`, `bun add @electric-sql/pglite`) is one process: a `Pool` that
  `dzql/postgres` runs on unchanged.
- **Never deploy PGlite**: it needs far more memory than a small server has. Tests and development only.
- **The superuser bypasses RLS**, even with `FORCE`: a hand-written policy needs a non-superuser pool (`rls.md`).
