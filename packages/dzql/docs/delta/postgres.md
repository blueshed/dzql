# Postgres (a server, or PGlite in process)

> Moved from delta's `delta-doc` skill when delta handed Postgres to dzql (delta 1.0). The
> imports are dzql's (`dzql/postgres`, `dzql/pglite`, `dzql/auth-jwt`); the commands are
> `dzql sql`, `dzql init` and `dzql migrate`.

As delta's kanban example ran on Postgres (it runs on SQLite in delta now): the framework, the tables, the listener.

```ts
import { Pool } from "pg";
import { createWs } from "@blueshed/delta/server";
import { applyFramework, applySql, generateSql, createDocListener, docTypeFromDef } from "dzql/postgres";
import { schema, docs } from "./schema";

const pool = new Pool({ connectionString: process.env.PG_URL });   // or: await openPglite(dir?)
await applyFramework(pool);                          // 001a–001g, idempotent
await applySql(pool, generateSql(schema, docs));     // your tables

const ws = createWs();
const listener = await createDocListener(ws, pool, { types: docs.map((def) => docTypeFromDef(def, pool)) });
const server = Bun.serve({ routes: { "/": index, [ws.path]: ws.upgrade }, websocket: ws.websocket });
ws.setServer(server);   // REQUIRED: without it nothing is broadcast

// shutdown: the listener holds a pool client for LISTEN
await listener.destroy();
await pool.end();
```

Options: `createDocListener` and `docTypeFromDef` in `src/server/postgres/listener.ts` and
`registry.ts`. With auth: `auth.md`, `ownership.md`, `rls.md`.

## Setting up the database

- **Programmatic**: `applyFramework(pool)`, `applyAuthJwtSchema(pool)` (if `jwtAuth`), then
  `applySql(pool, generateSql(schema, docs))`.
- **Vendored** (a migration tool or `docker-entrypoint-initdb.d` owns the database):
  `bunx dzql init init_db --with-auth` copies `001a–001g` (and `002-users.sql`);
  `bunx dzql sql ./types.ts --out init_db/003-tables.sql` writes your tables. The SQL
  is yours, in git; only the SQL is vendored, the TypeScript is imported.
- **Upgrading the app**: `migrate(pool, migrations, { app, schema })` first, then
  `applyFramework` and `applySql(pool, generateSql(…))`. `generateSql` adds a column a later
  schema declares; a migration does the rest (`migrations.md`). Give the listener your
  `schema` (`createDocListener(ws, pool, { types, schema })`): it sends and writes the columns
  it declares, so two versions on one database each see their own.
- **After upgrading delta**, run `init <dir> --upgrade` (it keeps `.bak`s and says what changed)
  or `applyFramework` again. Never edit `001*` by hand: it is the stored-function contract.
- Mount `init_db/` at `/docker-entrypoint-initdb.d`: Postgres applies it alphabetically on the
  first boot of an empty volume, then skips; `docker compose down -v` starts fresh.

## Compiled SQL

`generateSql` writes more than your tables. It writes SQL for each of your documents, compiled
from their definitions, in place of framework functions that read `_delta_collections` and
`_delta_docs` at run time. Each piece answers what the framework answers: dzql's
`tests/compile/` holds each equal to the framework's, on every document name of delta's path
cases, on the seed and after writes. Compiled so far:

| What | Compiled per document | The framework's, kept as |
| --- | --- | --- |
| Opening a document | `dzql_open__<doc>`, `dzql_open_at__<doc>` (and `_as`) | `delta_open`, `delta_open_at` |
| Does a document hold a row | `dzql_holds__<doc>`, via `_delta_doc_holds` | `_delta_doc_holds_framework` |
| May a write touch a row (its scope) | `dzql_in_scope__<doc>`, via `_delta_row_in_scope` | `_delta_row_in_scope_framework` |
| What a document is told of a write | `dzql_told__<doc>`, via `_delta_told` | `_delta_told_framework` |
| Which open documents hold a row (the fan-out) | `_delta_holders` itself, per collection | `_delta_holders_framework` |
| Reading a name by its document's scope | `dzql_scope__<doc>`, via `_delta_resolve_scope` | `_delta_resolve_scope_framework` |
| Is a one-row document's root there, before each op of a write | `dzql_root_there__<doc>`, via `_delta_root_there` | `_delta_root_there_framework` |
| The columns a document writes | `dzql_columns__<doc>`, via `_delta_write_columns` | `_delta_write_columns_framework` |
| Checking a write's fields | `_delta_assert_fields` itself, per collection and set of columns | `_delta_assert_fields_framework` |
| A write's row SQL: lock, store a replace, mint an id, clear a moment, is it there | `_delta_row_lock`, `_delta_row_put`, `_delta_next_id`, `_delta_row_clear_moment`, `_delta_row_there`, per collection | each `_framework` |

Two rules follow:

- **The framework first, then `generateSql`, every time.** `applyFramework` (or vendored
  `001*` files) puts the framework's own `_delta_doc_holds`, `_delta_row_in_scope`,
  `_delta_told`, `_delta_holders`, `_delta_resolve_scope`, `_delta_root_there`, `_delta_write_columns`,
  `_delta_assert_fields` and the row SQL back: everything still works, and writes are answered by
  the framework, slower (the compiled opens stay). Re-apply `generateSql` after it, and after `init
  --upgrade`. Vendored, `003-tables.sql` sorts after `001*`, so a tool that re-applies the
  directory in order gets this right; one that re-applies only `001*` must re-apply `003` too.
- **A document dzql did not compile goes to the framework.** One registered by hand, or by
  another `generateSql`, is answered by the `_framework` functions, as before. The dispatchers
  send each document by its prefix, so a prefix compiled and then registered again by hand with
  another definition answers by the compiled one until `generateSql` runs again.

The `dzql_*` functions are internal: call `delta_open` / `delta_apply` and their `_as` forms
(`sql.md`), which reach them. What a write costs, compiled against the framework, is in
`bench/results-2026-10-15.md` (under RLS, as an app role).

## Gotchas

- `bun add pg`, and `bun add -d @types/pg` to type-check (delta ships TS source).
- Ids are BIGINTs from `seq_<table>`: a client id that is not a number, or past 2^53 - 1, is a
  400; one that is moves the sequence past it.
- Implied documents are named by number here (`room:7`).
- **Each listener has its own types**: two servers in one process each answer for theirs. One
  prefix, one type; `listener.register(type)` replaces its prefix's type (for `bun --hot`).
- `delta_open` raises on configuration errors (unknown prefix or root); NULL only means a
  single root row is not there, which the listener answers 404.
- Write through `delta_apply` (the listener, or `delta_apply_as` from SQL), never a raw
  `INSERT`: only that path versions, logs and NOTIFYs (`sql.md`).
- A hand-written `DocType` hears only its own writes (`custom-docs.md`).
- `_delta_ops_log` is a catch-up buffer: prune it with `pruneOpsLog(pool)` (`delta_prune_ops`).
- PGlite (`openPglite(dir?)`, `bun add @electric-sql/pglite`) is one process: a `Pool` that
  `./postgres` runs on unchanged.
- **The superuser bypasses RLS**, even with `FORCE`: documents need a non-superuser pool (`rls.md`).
