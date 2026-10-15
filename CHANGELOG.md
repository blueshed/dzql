# Changelog

How dzql got here. Newest first. Versions are those of the `dzql` package on npm;
`create-dzql` shares the version number from 0.6.

## The short story

1. **September 2025: an idea.** Database-first CRUD, permissions, notifications and graph
   rules as PostgreSQL functions, driven by a small server.
2. **November 2025: the interpreter (0.1 to 0.5).** Published as `dzql`. Generic SQL
   functions read entity metadata at runtime. Live-query subscriptions arrived in 0.2.
   A first compiler appeared beside it in 0.1.4 and slowly reached parity.
3. **December 2025: the rewrite (0.6.0).** A TypeScript compiler, developed as `tzql`,
   turns a `domain.ts` into static SQL, a runtime manifest, a typed client and stores.
   From 0.6.2 it was published as `dzql` and the interpreter became `dzql-legacy`.
4. **January 2026: hardening the compiler (0.6.x).** The `create-dzql` template,
   trusted publishing from GitHub Actions, list subscriptions, temporal entities.
5. **October 2026: review and consolidation (0.7.0).** A security review, a
   rewritten permission path compiler proved against a real model, and one package:
   the interpreter and the `tzql` name are gone.

---

## [Unreleased]

### Changed

- **Who holds a row is compiled** (2c, the writes' first piece). Every write asks each open
  document whether it holds each row it changed (`_delta_holders`, the fan-out). `generateSql` now
  writes `dzql_holds__<prefix>(name, collection, row)` for each document -- which collections it
  holds, its name's conditions tested on the row's own values, a temporal row and a time past, an
  included row's parents up to the root as written lookups -- and `_delta_doc_holds`, which sends
  each compiled document to its own and any other to the framework (`_delta_doc_holds_framework`,
  as it was). `tests/compile/holds.test.ts` holds each equal to the framework for every name the
  path cases open, every collection and every row (made-up ones too), on the seed and after writes;
  breaking the parent chain on purpose fails 25 of them. Re-apply the framework SQL
  (`applyFramework`, or `dzql init --upgrade`) and then `generateSql`.
- **A write's scope is compiled** (2c, piece 2): "you may write what you may read", asked of every
  row an op names (`_delta_row_in_scope`). `generateSql` writes `dzql_in_scope__<prefix>(name,
  collection, id)`: a list holds its included collections whole and its root rows by the name's
  conditions; a single document a row whose parents, walked up as written lookups, reach its root,
  which meets the rest of its name's scope. `_delta_row_in_scope` sends each compiled document to
  its own, any other to `_delta_row_in_scope_framework`. Equal to the framework for every name,
  collection and id (`tests/compile/scope.test.ts`); dropping the root's other conditions on purpose
  fails `fo-guest:1:z@x`, and a list's root holding everything fails 55.
- **What a document is told of a write is compiled** (2c, piece 3). `_delta_tell`'s answer for
  one document is now its own function, `_delta_told(def, name, rows)` (the framework's,
  `_delta_told_framework`, as it was). `generateSql` writes `dzql_told__<prefix>(name, rows)` for
  each document: whether the name makes it one row, its root, the columns it shows (`columns`, with
  the id and parent key), the empty root an implied one opens with. `_delta_told` sends each
  compiled document to its own, any other to the framework. Equal to the framework for every name
  over a write touching every row in every way (arrives, stays with all, one or no field changed,
  carried, leaves, no concern of anyone's), on the seed and after writes
  (`tests/compile/told.test.ts`). Showing every row whole, not skipping a carried row, telling an
  implied root's leaving as null, or dropping the parent key each fail. A write: 0.745 ms p50
  compiled against 1.000 ms framework (26% less, from 22%).
- **The fan-out is compiled** (2c, piece 4): which open documents hold a row a write touched
  (`_delta_holders`). `generateSql` writes `_delta_holders` itself: for the row's collection, each
  document that holds it in turn -- its prefix's lock, its open names (by the root the row hangs
  from, the chain written as lookups, or every open name of its prefix), the writer's, each name
  its prefix owns whose document holds the row (`dzql_holds__<prefix>`). A document not compiled
  is asked by the framework's, now `_delta_holders_framework(collection, row, writer, skip)`, told
  the prefixes asked already. Still SECURITY DEFINER with pg_temp last, compiled or not. Equal to
  the framework for every collection, row and writer (`tests/compile/holders.test.ts`): on the
  seed, with only the writer open, after writes, and with documents registered by hand beside the
  compiled ones, one a longer prefix taking a compiled one's names. Dropping the longest-prefix
  rule, the fallback, the writer, the chain, or finding a scoped document by its root each fail. A
  write: 0.706 ms p50 compiled against 1.049 ms framework (33% less); the fan-out with 10 open,
  0.88 to 0.79 ms.

### Fixed

- **A late telling no longer reddens the path cases on a server.** The listener fetches what a
  NOTIFY announced after the write has answered, so under CI's load a write's telling could land
  after the case opened its documents again and cleared what was heard, and `expectSilent` counted
  it (`an add names a new id, past the serial`, on blueshed/dzql#25). The harness
  (`tests/delta-pg/postgres-path.test.ts`) now waits, before each open, until every open document
  has heard up to the version the database has for it. Delta's case is unchanged. With every
  telling delayed 200 ms, that case fails without this and passes with it.
- **The bench measures row-level security (todo #25).** Every timed write runs as `bench_app`
  (NOSUPERUSER NOBYPASSRLS); the bench refuses to run as a role that bypasses RLS; the policy reads
  `NULLIF(current_setting('app.user_id', true), '')`, so a pooled connection's `''` no longer breaks
  it. It times delta's write with the framework's reads and checks and with them compiled, against
  a raw `UPDATE`: 1.078 ms, 0.839 ms (22% less) and 0.184 ms p50 (`bench/results-2026-10-15.md`).
  The 0.3.0 results are labelled as taken with RLS bypassed.

## [0.9.0] - 2026-10-15

### Added

- **dzql holds everything Postgres that delta held** (step 4 of the split, dzql's side), so delta
  can drop it: delta's Postgres tests (`tests/delta-pg/`: the listener, RLS, the ledger, custom
  documents, isolation, the pointer and walk vectors in SQL, migrations and the schema contract,
  `auth-jwt`, the 0.10.0 ledger SQL, the review findings), its Postgres examples
  (`examples/delta/todos-vs-rls`, `examples/delta/sites-bbox`), its bench (`bench/`, `bun run
  bench`) and its todo #77 (now #25), and its Postgres commands: `dzql sql`, `dzql init` and
  `dzql migrate` (a postgres:// URL or a PGlite folder; a SQLite file stays `delta migrate`).
  `dzql init` stamps what it vendors `@blueshed/dzql`, and upgrades a file `delta init` stamped.
  delta's Postgres skill pages are `docs/delta/` (postgres, rls, sql), and the cases that left delta's
  CLI and client tests run here against dzql's Postgres (`tests/delta-pg/cli-and-client.test.ts`).

### Changed

- **`@blueshed/delta` is a peer, `^1.0.0`**: an app installs delta and dzql side by side, and they
  share the one delta (its server, its client, its definitions). delta 1.0.0 is delta without
  Postgres; dzql is its Postgres.
- **A document registered by hand opens through the framework.** `docTypeFromDef` reads through a
  document's compiled functions when `generateSql` made them, and through `delta_open` /
  `delta_open_at` for a document whose SQL was written by hand.
- **A compiled read gives the row as stored** (minus a temporal row's validity), narrowed only by
  a document's held columns, as `delta_open` does: two versions on one database each show their
  own schema's columns (the schema is the contract), where a read compiled for one version's
  columns hid a column the other declares.

### Changed

- **The listener opens documents through compiled SQL** (step 2c, its first piece). `generateSql`
  now writes each document's reads compiled from its definitions -- `dzql_open__<prefix>(name)` and
  `dzql_open_at__<prefix>(name, at)`, each with its `_as` -- and `docTypeFromDef`'s `open` and
  `openAt` call them in place of `delta_open` and `delta_open_at`. Nothing changes for an app that
  applies `generateSql` as before. delta's cases pass through them unchanged (the path, `owns`, the
  law, the writes), and `tests/compile/` holds each equal to the framework's read for every name
  the path cases open, now and at three times, on the seed and after writes. The `dzql_open`
  dispatcher is gone: each registration calls its own document's function, and a dispatcher one
  `generateSql` wrote would lose another's documents. Writes, the ledger and a name's scope still
  run on the framework SQL.
- **A document's name is read by compiled SQL too** (2c, scope). Each document's open reads its
  name's values by position, checks each as its column takes it with the framework's own messages
  (an integer, a number, a date read as midnight UTC, an id past 2^53 - 1), and writes its
  conditions as typed SQL. The opens no longer call `_delta_resolve_scope` or build a query from
  text (`EXECUTE`); a document that cannot be one row has no single branch. Equal to the framework
  for every name, errors included; dropping one check on purpose fails its names.

### Docs

- **`philo.md` says what dzql is for now**: delta's compiled Postgres step. Stories, then
  documents, then entities; delta's definitions as the input and its wire as the contract; Claude
  writes the compiler and is never it; delta's cases as the proof; permissions a document's,
  migrations delta's. The patterns (Workflow, Activity Stream) stay the vision, over documents.
- **CLAUDE.md** names the new parts (`src/postgres`, `src/sql`, `src/compile`, `tests/delta`,
  `tests/compile`) and their rules; `docs/for_ai.md`, `project-setup.md` and `docs/README.md` open
  with a note that they describe the whole-stack dzql, which step 5 retires.

### Added

- **Compiled opens: `dzql/compile`'s `compileOpens(schema, docs)`** (step 2b of the Postgres split).
  From an app's delta definitions (`defineSchema`, `defineDoc`) it writes one function per
  document, `dzql_open__<prefix>(name)`, and `dzql_open(name)`, which finds a name's document by
  its longest prefix as `delta_open` does. Each query is written out from the definitions --
  which table, the columns a document shows (its held columns too), how an included collection
  hangs from the root (a join up its parent chain; none where the chain ends short of it), a
  temporal row standing now or at a time in the name, an implied root's defaults -- where the
  framework reads its tables of definitions at run time. A name's scope and the version stay the
  framework's until 2c. A pure function: the same definitions give the same text, pinned by a
  snapshot; a document over a collection the schema lacks, or two whose functions would share a
  name, is refused. `tests/compile/opens.test.ts` opens every name delta's path cases open, both
  ways on PGlite, on the seed and after writes of every kind: 82 names, equal, errors included.

## [0.8.0] - 2026-10-15

### Added

- **dzql is delta's Postgres step: `dzql/postgres`, `dzql/pglite` and `dzql/auth-jwt`** (step 2a
  of the Postgres split, `docs/postgres-split-plan.md` in Workshop). delta's Postgres backend --
  the listener, the registry, codegen, carry, migrations, bootstrap, PGlite, the JWT reference and
  the framework SQL (`src/sql/001a`-`001g`, `auth-jwt.sql`) -- is copied in as it is at delta
  0.15.0 (`711186e`), importing only delta's public subpaths and `@blueshed/delta/backend`
  (`@blueshed/delta` ^0.16.0 is a dependency, with `pg` and `@electric-sql/pglite`). A delta
  app moves its `@blueshed/delta/postgres` and `/pglite` imports to `dzql/postgres` and
  `dzql/pglite`, the same names; nothing else changes. dzql's tests run delta's published cases
  unchanged (`@blueshed/delta/testing`): the path, `owns` and the law over generated writes on
  PGlite, with no Docker, and the write cases on PGlite and the test database
  (`tests/delta/`). The compiled SQL replaces the copied framework SQL in later releases.

### Changed

- **jose ^6** (was ^5), as delta's JWT reference takes it; the runtime's `SignJWT` and `jwtVerify`
  are the same.

## [0.7.0] - 2026-10-15

October 2026. Pull requests #8 to #16. The last release of dzql as a whole stack:
next it becomes the compiled Postgres step for delta projects.

### Breaking

- **An empty or missing rule list denies everyone**: `view`, `create`, `update`,
  `delete` and `canSubscribe`. Before, an empty list allowed everyone (including
  anonymous users), though the docs said both "deny all" and "logged-in users only".
  Write `['TRUE']` for public and the new `['AUTHENTICATED']` for any signed-in user.
- **A path the compiler can't compile is a build error**, naming the entity, the
  action and the rule. That covers bad syntax, unknown tables and columns, and start
  fields that aren't integer keys. Before, such rules compiled to `FALSE` with a
  warning, and an unparseable `canSubscribe` fell back to "any signed-in user".
- **`@field` in `canSubscribe` means the root row's field equals the user**, as it
  does everywhere else. It used to mean membership through a hard-coded `acts_for`.
- **A list subscription's `canSubscribe` may only be `TRUE`, `FALSE` or
  `AUTHENTICATED`**: a list has no root row for a path to start from.
- **An update must pass its rule on the stored row and on the row after the
  change.** An owner can no longer hand a row to someone else through `save`, and a
  member can't move a row into an org they don't belong to.
- **Pushes for a subscription reach only subscribers who may see the row.** The
  runtime calls a new generated `<name>_can_receive` before every push.

### Security

- `search_*` validates filter and sort columns against an allow-list. This closes an
  ORDER BY injection and an oracle on hidden columns (#8).
- Update permission is checked against the stored row, not the request body; a
  non-owner could take over any row by putting their own id in the body (#9).
- The JWT secret fails closed in production; `register_user` only sets allowed
  columns; FK and many-to-many expansion and subscriptions no longer leak hidden
  columns; realtime pushes re-check access (#10).
- List subscriptions return only the rows each subscriber may view, in the initial
  fetch and in every push (#11, #12).

### Permission path compiler (#11)

Found by compiling a real model's 204 rules: 31 compiled to `FALSE`, 15 silently
dropped `role=owner`, and create/update/delete enforced only the first rule in a list.

- Filtered middle hops (`->occasion_promoters[occasion_id=$].promoter_id->`) compile
  to nested `EXISTS`, following every matching row.
- `[org_id=$,role=owner]` reads every condition.
- Every rule in a list is enforced: any one of them grants access.
- One compiler serves permissions, `canSubscribe` and notifications.
- A rule that checks its own table no longer shadows the row being checked.
- `search_*` escapes quoted values in its view rule; `lookup_*` compiles its view
  rule against the alias it queries.
- Every path is checked against the domain at build time (`compileDomain`).
- An entity whose only column is its key generates valid save SQL.

### Fixed

- **The client reconnects to where it connected.** A dropped socket reconnected with no URL,
  so outside a browser it went to `ws://localhost:3000/ws` whatever `connect(url)` had
  named, and a failed attempt was an unhandled rejection. It now goes back to the last URL
  given; a failed attempt only schedules the next. `disconnect()` stays disconnected (its
  socket's close no longer reconnects), and a socket replaced by a later `connect()` does
  not reconnect beside it (`tests/ws_reconnect.test.ts`). Found when CI ran again.

### Repository

- **`/publish patch|minor|major`** (`.claude/commands/publish.md`), the release procedure
  railroad, delta and eta share, for dzql's two packages and their tags.
- `bun run test` fails when its database does not start, or a test fails: it answered
  with the teardown's exit code, so a setup that could not bind its port passed.
- CI runs again, on every push to `main` and every pull request: Bun pinned at 1.4.3, a
  type check, then the suite against a Postgres service. It had run only by hand since a
  Bun download problem.
- One package: the interpreter (`dzql-legacy`, never published under that name) is
  removed and `packages/tzql` moved to `packages/dzql`, so the folder, the npm name
  and the release tags all say dzql (#13).
- The Python version (`blueshed-dzql`) and the `modeling-dzql` app are archived
  off GitHub.
- The full-stack test fails when its example doesn't compile, instead of skipping.
- `.env.sample` names the token variable the client actually reads
  (`DZQL_TOKEN_NAME`).

---

## 0.6: the compiler

### 0.6.32 to 0.6.37 (26 January 2026)

- Path expression improvements and temporal entities.
- Security and performance fixes from a review.
- `search_*` and `lookup_*` return `SETOF jsonb`, for streaming.

### 0.6.25 to 0.6.31 (19 to 20 January 2026)

- Client `disconnect()`; the compiler reports its version from `package.json`.
- `search_*` binds `p_user_id` in its dynamic SQL.
- Entity notifications compile to `<entity>_notify_users` functions.
- Subscribable `root.key` must match a param; list subscriptions (no `root.key`).

### 0.6.17 to 0.6.24 (6 January 2026)

- TypeScript types preserved for auth, subscribables and custom functions.
- Auth follows the `_profile()` pattern with individual params.
- `get_*` expands foreign keys from `includes`.
- Entities are created in foreign-key order; circular foreign keys are added in a
  second phase.
- The permission compiler accepts several filter conditions; graph rules accept string
  params.

### 0.6.10 to 0.6.16 (3 January 2026)

- invoket integration for CLI task automation (`dzql/namespace`).
- `useDzql` syncs user state when the connection is ready.
- The test script manages its Docker database.
- Notifications for list subscriptions without params; save events include FK
  expansions.

### 0.6.2 to 0.6.9 (1 to 2 January 2026)

- Published as `dzql` from GitHub Actions with trusted publishing (OIDC). Tags are
  `dzql@X.Y.Z` and `create-dzql@X.Y.Z`.
- The `create-dzql` template (`bun create dzql`).
- Fixes for list subscriptions, auth user id and WebSocket realtime connections.
- A logger with access logging; TypeScript strict mode.
- The repository pruned of obsolete packages; generated `dist` removed from git.

### 0.6.0 (29 to 30 December 2025)

- The rewrite. A TypeScript compiler, developed as `tzql`, compiles `domain.ts` to
  PostgreSQL functions (CRUD, search, lookup, subscribables, notifications, graph
  rules), a runtime manifest, a typed WebSocket client and stores.

---

## 0.1 to 0.5: the interpreter

The `dzql` package on npm up to 0.5.33. Generic PostgreSQL functions read entity
metadata at runtime; a compiler grew beside them from 0.1.4.

### 0.5 (30 November to 16 December 2025)

- **Breaking:** auth functions take an options parameter; `users.name` removed.
- Composite primary keys in save, get and delete.
- Multi-hop permission paths.
- Atomic updates for subscribables; the schema and scope tables are embedded in the
  compiled subscribable result; "via" relations.
- DELETE events carry the full deleted row, for subscription resolution;
  `_affected_documents(table, op, data)` takes one data parameter.
- `db:init` and a quickstart guide.

### 0.4 (22 to 27 November 2025)

- `DzqlNamespace` exported for use in other projects; the CLI runs in compiled mode.
- The compiler reaches parity with the interpreter: notify actions and conditions in
  graph rules, custom field defaults, temporal filtering.
- Dynamic `_profile`; `register_user` accepts extra fields.

### 0.3 (20 to 21 November 2025)

- Field defaults, custom function pass-through, many-to-many relations (with junction
  sync in compiled operations).
- A migration CLI (`migrate:new`, `migrate:up`, `migrate:status`).
- A PostgreSQL-based test suite.
- Soft-delete filtering in search and lookup; CASCADE, SET NULL and RESTRICT graph
  rules.
- The event model simplified: events carry `pk` and `data`, no `before`/`after`.

### 0.2 (18 to 19 November 2025)

- **Live query subscriptions**: subscribables, compiled to SQL, with server handlers,
  event listening and client integration.
- A metadata-driven Vue admin client ("DZQL Air").
- SSL for Heroku; configurable JWT storage key.

### 0.1 (2 to 17 November 2025)

- First published as `dzql` (0.1.0-alpha.1, 2 November).
- Graph rules with validation and function execution; CI.
- A fix for graph rules running twice and a search permission bypass (0.1.3).
- **The first compiler** (0.1.4, 16 November): entity definitions to PostgreSQL, with
  permission and notification paths, graph rules, search operators and password auth.
- Canonical Pinia stores (0.1.6).

### Before npm (September to October 2025)

- A first pass at the API: permissions and notifications, a monorepo, graph rules,
  composite primary keys. Named dzql on 11 September 2025.
