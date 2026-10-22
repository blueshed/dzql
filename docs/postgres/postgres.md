# Postgres (a server, or PGlite in process)

The imports are `dzql/postgres`, `dzql/pglite`, `dzql/auth-link` and `dzql/auth-jwt`; the commands
are `dzql sql`, `dzql init`, `dzql migrate` and `dzql link`. The definitions are delta's, and so is
its manual (the `delta-doc` skill): this page is what Postgres adds.

An app's documents, the same definitions it had on SQLite, in one call, `openStore`: its history of
migrations makes the tables, the framework and the compiled SQL follow, and the listener serves the
documents.

```ts
import { createWs } from "@blueshed/delta/server";
import { serve } from "@blueshed/delta/serve";
import { openStore } from "dzql/postgres";
import { schema, docs } from "./schema";

const ws = createWs();
// DATABASE_URL's server, else PGlite in the data folder's pg/ (in memory without one), or `database`: a URL, a folder, or ":memory:"
const store = openStore({ schema, migrations: { dir: "migrations", app: "board", schema }, ws }); // said: nothing opened yet
store.register(docs);
await store.open({ dataDir: process.env.DATA_PATH });   // as the server starts: the tables, each document compiled, then served on the socket
// delta's one server: the socket on its path, and on shutdown the listener (it holds a pool client for LISTEN), then the pool
serve({ routes: { "/": index }, ws, close: [store.close] });
```

Without `ws`, the documents are served in the process (`store.delta`), as dzql's thin client reads
them; there the app's `store` is the `Example`'s, and `appOf` opens it as the server starts and
closes it as it stops. `prepare` (an option) runs at each open between the tables made and the
documents served: a seed. A store closed is opened again by the next start, its listener a new one.
How it behaves beside other servers of the app (a deploy, a pool, the ops log): *Deploying*,
below. The steps it takes are below, for a database something else sets up; the
documents' step is one call, `registerDocs(ws, pool, schema, docs, customDocs, options)`, which
takes what delta's SQLite `registerDocs` takes (`ledger`, `who`, `auth`, `owns`, `shared`; and
`namespace`), awaited: an app moving from SQLite changes its import. Its options are in
`packages/dzql/src/postgres/register.ts`, `openStore`'s in `app-store.ts`. Signing in: delta-doc's `auth.md` (on Postgres,
`postgresLinkStore` from `dzql/auth-link`); who may open what: below, and `rls.md`.

## Setting up the database

- **Programmatic**: `applyFramework(pool)`, `applyAuthJwtSchema(pool)` (if `jwtAuth`), then
  `registerDocs(ws, pool, schema, docs, customDocs, { auth, ledger: true })`, which applies
  `generateSql(schema, docs)` and serves the documents.
- **Vendored** (a migration tool or `docker-entrypoint-initdb.d` owns the database):
  `bunx dzql init init_db --with-auth` copies `001a–001g` (and `002-users.sql`);
  `bunx dzql sql ./types.ts --out init_db/003-tables.sql` writes your tables. The SQL
  is yours, in git; only the SQL is vendored, the TypeScript is imported.
- **The history makes the tables**: `migrate(pool, await fromFolder("migrations"), { app, schema })`
  first, then `applyFramework` and `registerDocs`. The same migrations as on
  SQLite (`delta migrations make` writes them from the definitions): a new database runs them from
  the first; one made the older way, holding their tables, adopts them. A change the definitions
  make is the next migration (delta-doc's `migrations.md`). The listener sends and writes the
  columns your `schema` declares, so two versions on one database each see their own columns; the
  compiled documents are the newest version's (below, *Deploying*).
- **After upgrading dzql**, run `init <dir> --upgrade` (it keeps `.bak`s and says what changed)
  or `applyFramework` again. Never edit `001*` by hand: it is the stored-function contract.
- Mount `init_db/` at `/docker-entrypoint-initdb.d`: Postgres applies it alphabetically on the
  first boot of an empty volume, then skips; `docker compose down -v` starts fresh.

## Several apps on one database

Each app in a Postgres schema of its own, named by `namespace` (`public` without one, as always):
its tables, `_delta_*` tables, ledger and compiled functions are made there, and its changes are
told on a channel of its own, `delta:<schema>` (`public`'s is `delta_changes`), so each listener
hears its own app alone. Two apps may have the same table and document names.

```ts
const billing = openStore({ schema, database: process.env.DATABASE_URL, namespace: "billing" });
const rota = openStore({ schema: rotaSchema, database: process.env.DATABASE_URL, namespace: "rota" });
```

`openStore` makes the schema when it is not there, opens the pool with it as every connection's
search path, and runs the migrations, the framework and `generateSql` in it. By the steps:
`openDatabase(url, { namespace })` (from `dzql/pglite`) is that pool (on PGlite, each query and
transaction is given the path, so pools of several schemas share one PGlite);
`applyFramework(pool, { namespace })` and `applySql(pool, sql, { namespace })` apply into the
schema whatever path the pool has (an admin pool may apply, and the app's pool serve); and
`createDocListener(ws, pool, { namespace })` refuses a pool that does not run in it. A namespace is
lower-case letters, digits and `_`, 57 at most. The `SECURITY DEFINER` functions pin the schema
they were applied in. Grant the app's role `USAGE` on its schema, not `public` (`rls.md`).

The advisory locks a write takes on a row, a document or a cursor are the database's: two apps
whose tables or documents share a name may wait on each other's writes for a moment, and neither
sees the other's rows. A listener's own lock is keyed by its schema.

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
no table rules: beneath the documents, each table every document holding it says by a path gets
row-level security derived from those paths, the backstop for the compiled reads and writes, which
run as the caller (`rls.md`).

## Compiled SQL

`generateSql` writes more than your tables. It writes the SQL for each of your documents and
collections, compiled from their definitions: nothing reads `_delta_collections` or `_delta_docs`
to work out what a document means at run time. The framework SQL (`001*`) holds the tables, the
write (`delta_apply`), the ledger and the listener's functions, and calls what `generateSql`
writes. Each compiled piece is pinned by `packages/dzql/tests/compile/`: its answers on every document name of
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
| The ledger's reads: a document whole (a walk's guard), a field the same, a row beyond the document | `dzql_open_whole__<doc>` via `_delta_open`; `_delta_same`, `_delta_row_standing`, per collection. An entry's inverse is taken from the rows the write touched, as it found them (`_delta_apply`'s `before`), never the whole document |
| An index for each column a document looks rows up by: a `refs` or `cascadeOn` column, a scope's column, an `owns` path's hop | `idx_<table>_<column>` on (column, id), beside the parent keys' and the temporal (id, valid_to) (`packages/dzql/src/compile/indexes.ts`) |
| A collection's definition, a table's serial | `_delta_collection`, `_delta_serial_new`, `_delta_serial_past`, per collection |
| Who may have a document (`owns` as a path), and a write that keeps it in reach | `dzql_owns__<doc>`; `_delta_keeps_reach`, asked by `delta_apply` |
| May the person have a document that holds a row (the table's row-level security) | `dzql_may__<coll>`, the policy `dzql_owns`, put on by `_delta_govern` |
| No two current rows overlap (`noOverlap`), and what `$<k>` names | `_delta_overlaps_hold` and each table's `excl_<table>_<start>_<end>` (`packages/dzql/src/compile/overlaps.ts`); `_delta_refs_of` |
| What a remove takes with it, and what a moved row carries | `dzql_cascade_remove__<coll>`, `dzql_cascade_rows__<coll>`, `dzql_hanging_rows__<coll>`, via `_delta_cascade_remove`, `_delta_cascade_rows`, `_delta_hanging_rows` |

Three rules follow:

- **The framework first, then `generateSql`, every time.** `applyFramework` (or vendored `001*`
  files) puts back the uncompiled forms of what `generateSql` writes, which know no document: a
  document's name is refused (`no doc def for: <name>`) until `generateSql` is applied again.
  Re-apply it after `applyFramework` and after `init --upgrade`. Vendored, `003-tables.sql` sorts
  after `001*`, so a tool that re-applies the directory in order gets this right; one that
  re-applies only `001*` must re-apply `003` too. `openStore` applies both together, in one
  transaction (`applyCompiled`), so no other server ever sees the uncompiled forms between them;
  and an `applyFramework` by hand since is noticed at its next open (the functions changed), which
  applies them again.
- **One app per schema.** Each `generateSql` writes the whole set of an app's documents and
  collections; a later one, with other definitions, takes their place. Two apps on one database
  each have a Postgres schema of their own (below), or a database of their own.
- **A document is what its definition compiles to.** Nothing registered by hand is read: add a
  document to your definitions and apply `generateSql`.

The `dzql_*` functions are internal: call `delta_open` / `delta_apply` and their `_as` forms
(`sql.md`), which reach them. What a write costs, compiled, is in `packages/dzql/bench/results-2026-10-15.md`
(under RLS, as an app role).

## Deploying

Several servers of one app on one database, started one after another as a deploy rolls, and
restarted when they fail. What `openStore` does so that none breaks another
(`packages/dzql/src/postgres/app-store.ts`, `bootstrap.ts`, `migrate.ts`):

- **A server starting changes nothing the others use, unless its documents are new.** The
  framework and the compiled SQL are applied together, in one transaction, and only when they are
  not the database's already: the database keeps each set it has had in `_delta_compiled` (its
  hash, a generation, its document types), and a second server of an unchanged app runs no DDL and
  takes no lock. A migration that ran at this start, or the framework applied by hand since, has
  the set applied again.
- **An older server never undoes a newer one's documents.** A set a newer one has replaced (a v1
  instance restarting while v2 rolls out) is not applied: that server runs on the newer set, as a
  v1 still running does, and logs a warning naming both generations. It keeps its own columns (the
  listener writes and sends what its `schema` declares). A rollback is said:
  `openStore({ ..., rollback: true })` or `DZQL_ROLLBACK=1` puts the older set back, as the newest.
  A newer server must keep the documents an older one still serves while both run; dropping a
  document is for a deploy after the last older server is gone. PGlite is one process's: its set
  is always the server's own.
- **The DDL gives way.** As it opens, each lock the migrations and the compiled SQL take is waited
  for `lockTimeout` ms (default 5000), then the transaction gives way and tries again, three
  times, then the open fails saying why, having changed nothing: a long transaction on a table it
  alters holds up the start, never every read queued behind its lock. While a new set is applied
  its transaction holds the framework's tables (an index's lock), so writes wait for it: a moment,
  once per deploy.
- **A migration fences the ledger ahead of its own transaction.** The app's entries before it are
  made not undoable a batch at a time before the migration begins, and `_delta_fences` keeps how
  far that has gone, so the transaction that alters the tables reads only the entries written
  since. A migration that then fails has still fenced them.
- **The pool.** `openStore({ pool })` takes pg's `PoolConfig` (`max`, `ssl`,
  `statement_timeout`, `idleTimeoutMillis`, ...), opened at the URL, or a `Pool` of the app's own,
  used as it is and never ended by the store (in a `namespace`, its connections must run in it:
  `options: "-c search_path=<schema>"`). An idle connection the server ends (a restart, a failover)
  is logged and replaced, never thrown.
- **A real session.** The listener's `LISTEN`, the session-level advisory locks (the listener's
  holder, the open's turn, the migrations') and the session-level `dzql.definer` setting need a
  connection that stays the server's: a pooler in transaction mode (PgBouncer's
  `pool_mode = transaction`, a provider's "pooled" URL on port 6543 and the like) cannot carry
  them. Use session mode, or the database's direct URL.
- **Never PGlite.** Under `NODE_ENV=production` with no Postgres server named (`DATABASE_URL`, or
  `database` a URL), `openStore` refuses to start PGlite, naming `DATABASE_URL`;
  `pgliteInProduction: true` (or `DZQL_PGLITE_IN_PRODUCTION=1`, a smoke test of a production
  build) says it may.
- **What is kept, and for how long.** `_delta_ops_log` is a catch-up buffer: while a store is open
  it prunes it (`delta_prune_ops`) every 10 minutes, what is older than an hour, one server at a
  time (an advisory lock: the rest pass), and with it `_delta_versions` of the names nobody holds;
  `prune: { every, keep }` says otherwise, `prune: false` leaves it to the app (`pruneOpsLog`).
  Keep it longer than a listener may be away (a lost connection): it catches up from the log.
  The ledger (`_delta_ledger`: undo, redo, history) is kept whole, as every write's record: it grows
  with the writes, and nothing of dzql's prunes it; an app that must keeps it short itself (entries
  past a migration's fence are history only). `history` answers 50 entries, 100 at most.

## Gotchas

- `bun add pg`, and `bun add -d @types/pg` to type-check (dzql ships TS source).
- A scope's values are compiled into each document's reads: a column given several conditions
  (`{ lng: [">=:west", "<=:east"] }`) is a condition each, and a timestamptz's value in ISO 8601's
  basic format (`20261020T0800Z`) is read as the instant it names, as delta's `nameInstant` reads it.
- **A `noOverlap` is held twice**: `delta_apply` asks it once the write is done, under an advisory
  lock on the constraint and the row's `same` values, so two writes at once take turns and the second
  is told in delta's words (`_delta_overlaps_hold`, SQLSTATE 23P01, 409); and `generateSql` makes it
  an `EXCLUDE USING gist` constraint on the current rows (`excl_<table>_<start>_<end>`, a
  `tstzrange`, `daterange` or `numrange`, deferred to the commit), the database's own for SQL that
  writes past `delta_apply`. Equal columns need `btree_gist`: `generateSql` makes it where it may
  (PGlite's `openPglite` loads it, as a server's contrib has it); where it cannot, the constraint is
  not made and the write path's check holds alone. Rows that already overlap refuse the constraint,
  so `generateSql` fails until they are moved. One the definitions no longer say is dropped.
- **A `date` is a `DATE`, a `numeric` a `NUMERIC`**, and every read gives a numeric back as its
  text (`"10.50"`, the compiled `rowJson`): `to_jsonb` would write it as a JSON number, which a
  client reads as a float. SQL of your own that hands rows on does the same: `t.amount::text`.
- Ids are BIGINTs from `seq_<table>`: a client id that is not a number, or past 2^53 - 1, is a
  400; one that is moves the sequence past it, but never past 2^53 - 1 less 2^32, so the table
  always has ids left to mint (an id named past that is not one the sequence hands out: once its
  row is gone, an add may name it again). A mint past 2^53 - 1 is refused (2200H), never a row no
  number holds.
- **A row a trigger changes is told only if the trigger says so**: `PERFORM delta_touch('accounts',
  NEW.account_id)` in a trigger a write sets off (before it changes the row) adds the row to the
  write, which tells every open document holding it what changed (`sql.md`).
- Implied documents are named by number here (`room:7`).
- **Each listener has its own types**: two servers in one process each answer for theirs. One
  prefix, one type; `listener.register(type)` replaces its prefix's type (for `bun --hot`).
- `delta_open` raises on configuration errors (unknown prefix or root); NULL only means a
  single root row is not there, which the listener answers 404.
- Write through `delta_apply` (the listener, or `delta_apply_as` from SQL), never a raw
  `INSERT`: only that path versions, logs and NOTIFYs (`sql.md`).
- A hand-written `DocType` hears only its own writes (`DocType` in `packages/dzql/src/postgres/registry.ts`).
- **A write tells every open document that holds a row it touched, in its own transaction**: that
  is what makes each change arrive whole and in order. A row held by many open documents (a feed
  per person, each holding the same new post) costs the write one telling for each. Keep
  documents to what someone needs in front of them, scoped by a parent, a status or a time, never
  a whole table that only grows: a document is opened whole.
- `_delta_ops_log` is a catch-up buffer: `openStore` prunes it (*Deploying*); without it, prune it
  with `pruneOpsLog(pool)` (`delta_prune_ops`).
- A 5xx answer says only that the server failed (`The server failed: what went wrong is in its
  log`): the database's words, which name tables, constraints and types, are logged, never sent.
  An app's own CHECK constraint or trigger `RAISE` is a 400 in the database's words, an exclusion
  constraint (a double booking) a 409.
- A socket holds 1000 documents open at most (`createDocListener`'s `maxOpen`): one more is 429.
- PGlite (`openPglite(dir?)`, `bun add @electric-sql/pglite`) is one process: a `Pool` that
  `dzql/postgres` runs on unchanged.
- **Never deploy PGlite**: it needs far more memory than a small server has. Tests and development
  only: under `NODE_ENV=production`, `openStore` refuses it (*Deploying*).
- **The superuser bypasses RLS**, even with `FORCE`: the policies derived from the paths, and a
  hand-written one, hold only a pool that is neither a superuser nor `BYPASSRLS` (`rls.md`). With
  `auth`, `openStore` warns as it opens on a server when its pool's role is either.
- `jwtAuth`'s `secret` is 32 bytes at least, refused as it is made; a login's wrong passwords
  count against their email, five a minute, then it waits (`maxFailedLogins`, `lockout`), in each
  process.
