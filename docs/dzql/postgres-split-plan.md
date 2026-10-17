# Moving Postgres from delta to dzql: the plan

*Written 15 October 2026, after delta 0.14.0 and dzql 0.7.0. A plan for Peter to agree before any
code is written. Nothing here has been changed in either repo.*

*16 October: what is left of this plan (2c to the framework's retirement, step 3, step 5) is done
before the move into one repo (`monorepo-plan.md`, "When"): Peter, "get all development slated
done and then address the monorepo".*

## What was decided

The design path is stories → documents → entities. delta's storage path was json → sqlite →
pglite → postgres, and its last step is compiled Postgres, which is dzql.

- **delta keeps** the browser client, the wire, the definitions (`defineSchema`, `defineDoc`), the
  JSON file and SQLite backends, and a published case suite.
- **dzql takes everything Postgres**: the listener, PGlite and a Postgres server, compiled from
  delta's definitions by a deterministic compiler. Claude writes and extends the compiler, with
  tests; Claude is never the compiler.
- **The seam is delta's wire**, not SQL functions. A delta client talks to a dzql server exactly as
  to a SQLite one.
- **dzql's path language moves into delta as the way a document says who may open it**: `owns`
  written as a path from the document's row to the person. Permissions are a document's, never a
  table's, as a document is what someone needs to act and the tables follow. delta parses, checks
  and follows the path on SQLite and the JSON file; dzql compiles it into each document's functions,
  run as the caller under `FORCE ROW LEVEL SECURITY`, with the policies derived from the documents
  (closing dzql todo #19).
- **dzql's own runtime, client, Pinia stores and create-dzql retire.**

Why, as measured on 15 October: delta's Postgres side is about 4,860 of its 11,800 source lines
(1,667 TypeScript, 3,190 SQL); its Postgres tests take 140 s and need Docker; every scope, pointer
and walk rule is kept twice, in TypeScript and SQL; and delta todo #77 measured the framework SQL at
about 20% extra per write under RLS.

## What moves where

| Now in delta | Goes to | Notes |
|---|---|---|
| `src/server/postgres/` (listener, registry, codegen, schema, bootstrap, carry, migrate, auth, sql) | dzql | the listener first as it is, then its SQL replaced by compiled SQL (step 2) |
| `src/server/pglite.ts` | dzql | the slice of `pg`'s Pool over PGlite |
| `src/sql/001a–001g`, `auth-jwt.sql` | dzql, then gone | replaced function by function by compiled SQL |
| `src/server/auth-jwt.ts`, `auth-jwt-sql.ts` | dzql | it checks passwords with Postgres functions (see Q9) |
| CLI `delta sql`, `delta init`, the Postgres half of `delta migrate` | dzql's CLI | `open`, `watch`, `delta`, `call` and SQLite's `migrate` stay |
| `bench/`, `compose.yml`, todo #77 | dzql | the bench is rebuilt to run as an app role |
| `examples/todos-vs-rls`, `examples/sites-bbox/server-pg.ts` | dzql | |
| `examples/kanban` (Postgres) | stays in delta, on SQLite (Q7) | it is delta's JSX example (`bun check -p examples/kanban`) |
| skill pages `postgres.md`, `rls.md`, `sql.md`, the Postgres parts of `migrations.md`, `schema.md`, `custom-docs.md` | dzql's skill | delta-doc's `backends.md` points to dzql for the last step |
| `tests/helpers/path.ts`'s cases, the law driver | delta's `./testing` | step 1 |
| dzql `src/cli/compiler/paths.ts` (the parser) and `path-validator.ts` | delta | step 3; dzql keeps the lowering to SQL |
| dzql `src/runtime/`, `src/client/`, the client, Pinia and manifest generators, `packages/create-dzql` | removed | step 5 |

## Migrations stay delta's

Migrations came into delta in 0.14.0 and stay delta's on every step of the path: the runner
(`runMigrations` and its `Store`), the `delta_migrations` table, the undo fence, and the schema as
the contract. SQLite's store stays in delta. Only Postgres's store and its helpers (`renameColumn`,
`dropColumn`, `renameTable` as Postgres does them) move, and dzql builds them on delta's runner
(through `@blueshed/delta/backend`, Q2). So:

- **An app has one list of migrations**, `migrations/NNN-name.ts`, whatever it runs on. Moving from
  SQLite to dzql it keeps the list: the new database records every id and runs none, as `migrate`
  does for a database made from the schema.
- **dzql brings no upgrade scheme of its own.** Its `generated/db/migrations` (Docker init scripts)
  and `db:rebuild` (drop the database and make it again) retire in step 5. A change to an app's
  tables is a migration; the compiled functions are applied again at start-up, `CREATE OR
  REPLACE`, as the framework SQL is now.
- **A dzql release that changes the tables it keeps for itself** (`_delta_*` or its own) ships the
  change as a migration under its own app name, so a database upgrades in place. **Question
  (Q14):** agree `app: "dzql"` for those?

## The steps

The order below is the agreed one. Steps 1 and 2 can overlap: dzql works against a linked local
delta while step 1 is being finished, and pins the release once it is out.

### 1. delta publishes its case suite in `./testing`

*Done 15 October: delta 0.15.0 (blueshed/delta#7). From the packed package alone the path, the
write suites and the law ran against SQLite (186 pass); the gate 1,579 pass. On the way the write
cases found and fixed a SQLite/JSON clock bug in `importTables`.*

Today `tests/helpers/path.ts` (3,025 lines) holds the one schema (`pathSpec`: weddings, households,
courses, drinks, tags, notes, seats, slots, favours, asks), the documents cut different ways over
it, the seed, and the cases (`pathCases`, `drivenCases`, `registrationCases`, `serialCases`,
`asItStoodCases`, `columnCases`, `documentCases`, `fanOutCases`), every one ending on the law. A
backend supplies an adapter (`PathBackend`: a process to call, `quiet()`, `exportTables()`,
optionally `storeSetsT()`). `tests/law-driver.test.ts` runs seeded random steps on SQLite, the JSON
file and PGlite at once, through a `Place` each.

The work:

- Move the cases into the package beside `pointerVectors` and `walkVectors`, exported from
  `@blueshed/delta/testing`: the schema, documents and seed, `PathBackend`, every `*Cases`
  function, and the law driver as a function that takes a list of places (`Place` exported), with
  SQLite's place supplied by delta so another backend is always compared with SQLite.
- The parts written per backend come from the adapter, not the suite. Today the custom documents'
  first reads are written twice (`sqliteInbox` / `postgresInbox`, and the menu card, emails,
  guests, open seats): the suite exports them as functions that take the read, delta keeps
  SQLite's reads, and the Postgres reads go to dzql with the rest of Postgres.
- delta's own `path-json`, `path-sqlite` and `law-driver` tests import the suite as a consumer
  would, and keep passing with the same number of cases.

**Done when** a scratch project with only `@blueshed/delta` installed (no `tests/` folder) runs
`pathCases` and the law driver against SQLite and passes; `tests/package-exports.test.ts` names the
new exports; `reference/testing.md` says how another backend runs them; released as a minor
(additive) delta, 0.15.0.

**Question for Peter (Q1):** publish the other every-backend cases too? `tests/helpers/owns.ts` and
`tests/helpers/isolation.ts` already take an adapter, and `error-codes`, `create-row` and
`write-scope` ask every backend. I'd publish all five, so dzql proves the error table, a server-named
row, write scope, `owns` and isolation as well as the path.

### 2. dzql compiles delta's definitions, speaks delta's wire, and runs delta's cases on PGlite

Three parts, each a release of dzql:

**2a. A listener that speaks delta's wire.** delta's `listener.ts`, `registry.ts`, `pglite.ts`,
the Postgres `carry` and `migrate`, `bootstrap` and the framework SQL are copied into dzql as they
are at delta 0.15.0 (the commit names delta's), with the Postgres reads of the case suite's custom
documents. dzql moves from the `postgres` driver to the `pg` Pool slice delta uses, so PGlite and a
server take the same code. The listener registers on delta's `createWs` server, as now.

The listener uses delta internals today: `trackSubscribe`, `trackUnsubscribe`, `onClientDrop`
(server), `createCustomDocs`, `assertOwned`, `sendTo`, `NOT_FOUND` (custom documents),
`socketCursor`, `ledgerWho`, `isEntryId` (ledger), `resolveScope`, `assertScopeKeys`, `pastSafeId`
(scope), `showDoc`, `showOps`, `q`, `isoTime`, `lastId`, `defaultForType` (schema),
`runMigrations` and its friends, `authless`, `ownerless`. **Question (Q2):** delta exports these
from one new subpath, `@blueshed/delta/backend`, for a backend to build on, with a test that lists
them. Agree the name?

**Done when** dzql's `bun run test` runs delta's published cases (step 1, and Q1's) and the law
driver on PGlite with no Docker, and they pass unchanged; the same cases run against a Postgres
server in CI only; released as dzql 0.8.0.

*2a done 15 October: delta 0.16.0 adds `@blueshed/delta/backend` (blueshed/delta#8); dzql 0.8.0
carries `dzql/postgres`, `dzql/pglite`, `dzql/auth-jwt` and runs delta's cases unchanged
(blueshed/dzql#17; 497 pass, the create-dzql end-to-end check green). Alignment round: paintbrush
on delta 0.16 (blueshed/paintbrush#6), eta (blueshed/eta#1), both open for merging.*

**2b. The compiler takes delta's definitions.** dzql's loader reads an app's `schema` and `docs`
(`defineSchema`, `defineDoc`, imported from `@blueshed/delta`) in place of `domain.ts`, and builds
its IR from them: tables, parent keys, `cascadeOn`, temporal rows, a document's root, includes,
scope and held columns. The compiler is a pure function from definitions to SQL text, tested on the
case suite's schema and on each example.

**Done when** `dzql compile` (or the listener at start-up) turns the case suite's definitions into
SQL, with tests that pin what it generates for each kind of document (single, list, implied, a time
in the name, held columns).

*2b done 15 October (blueshed/dzql#18, merged, not yet released): `compileOpens` writes a
function per document and `dzql_open`; on PGlite it equals `delta_open` for all 82 names the path
cases open, on the seed and after writes; the text is pinned by a snapshot. Scope and version stay
the framework's until 2c.*

*2c under way 15 October, a piece per PR; released in dzql 0.10.0 (15 October, with the undo fix, dzql todo #28): who holds a row (blueshed/dzql#23), a
write's scope with the bench measuring RLS (#24), what a document is told (#25), the fan-out
(`_delta_holders`). Each
equals its framework function on PGlite for every path-case name, on the seed and after writes,
with a mutation check. Then `delta_apply` a slice at a time, by the profile: slice 1, a name read
by its scope (`_delta_resolve_scope`). A write under RLS: framework 1.059 ms, compiled 0.657 ms p50
(38% less). Slice 2, a one-row document's root check before each op (`_delta_root_there`), about
15 µs a write through such a document. Slice 3, a write's columns and their checks (still the
writing process's columns, `delta.declared`, read at run time). A write under RLS: framework 1.063
ms, compiled 0.624 ms p50 (41% less). Slice 4, each collection's row SQL written out (lock, a
replace's store, an id, a moment cleared, is it there): 0.595 ms (44% less, 3.25x a raw `UPDATE`).
Then todo #27: the cascades, hanging rows, an add's row (one statement where the row gives every
declared column) and an implied root's first write. An add 0.56 ms, a remove 0.52 ms compiled
(framework 0.90, 0.82). What a write still builds from text: an add whose row leaves a declared
column out (its INSERT names the row's columns, so the database's defaults hold). Then the ledger
walk's reads (a document whole, a field the same, a row beyond): a logged write 0.78 ms through one
row (framework 1.12). An undo slows as its cursor's ledger grows (dzql todo #28). What is left before
the framework retires (todo #26): `_delta_find_doc`, the walk's own plan, and the framework's
fallbacks themselves.*

**2c. Compiled SQL replaces the framework SQL, a piece at a time.** Each piece of `001a–001g` that
reads the schema at run time (`delta_apply`'s dynamic queries, `_delta_holders`, `_delta_tell`,
`delta_open`, the walk) is replaced by functions generated for the app's own tables and documents,
one piece per change, each passing the whole case suite before the next begins. The bench (#77)
moves with it, fixed first so it runs as a `NOSUPERUSER NOBYPASSRLS` role, so each piece is measured
against the 20%.

**Done when** no SQL that reads the schema at run time is left; every function dzql applies was
generated from the app's definitions; the cases pass on PGlite and a server; a dzql app upgrades
through delta's `migrate` (the Postgres cases of `tests/migrate.test.ts` and
`tests/schema-contract.test.ts` pass on compiled SQL: two versions on one database, rename and drop,
the fence); the bench, run as an app role, says what a write costs compiled against the framework
SQL's numbers.

**At the end of 2c the framework SQL retires** (decided 15 October). Every document is compiled,
and `001a–001g`'s interpreting functions go: no `_framework` fallbacks and no dispatchers that send
a document by its prefix. dzql is then one implementation, held equal to delta's cases rather than
to its own framework. That also removes the rule that `generateSql` must be applied after
`applyFramework` or writes quietly go slow. What stays of `001*` is what reads no definitions: the
`_delta_*` tables, versions, the ops log, the ledger's storage, the serials, `_delta_held`.

*What retires and what stays (16 October, mapping PR B).*
- **Interpreters of definitions retire.** These are the functions that read a document's or
  collection's shape at run time and act on it:
  - scope resolution, the open and as-it-stood reads, `_delta_read_list`/`_delta_load_collection*`;
  - holds, write scope, the fan-out, telling, the root check, `_delta_chain_root`;
  - the row SQL, cascades and hanging rows;
  - `_delta_find_doc`, `_delta_collection`, the serials' table lookup.

  Each compiled document and collection has its own version. A name or key not compiled is
  refused ("not compiled here: apply generateSql"), not sent to a framework.
- **Functions over the declared columns stay, renamed.** These are the field checks for a set of
  columns (`_delta_assert_fields_framework`), a document's write columns under `delta.declared`,
  and `_delta_same` for a field's declared type. The schema is the contract, so a process's columns
  are run-time data by design (a walk's stored columns, another version's declared ones), and the
  compiled code rightly hands any set it does not know to them. They keep working as generic
  helpers, without the `_framework` name.
- **The proof.** The equivalence tests whose answers do not depend on the clock (the resolver,
  holds, scope, the root check, telling, the fan-out, columns, opens and as-it-stood reads, the
  collection lookup) record the framework's answers as snapshots before it goes, so their probes
  stay. Those whose answers carry times and sequence values (the row SQL, cascades, serials) retire
  with it. Their last green run is the proof at retirement; from then on delta's cases cover their
  behaviour and their text is pinned.

What this asks:
- **Documents registered by hand.** Test fixtures and anything that inserts into `_delta_docs`
  itself are defined with `defineDoc` and go through `generateSql`. A hand-written `DocType` (a
  custom document) is unaffected: it never reads `_delta_docs`.
- **Proof that has to change.** `tests/compile/` holds each piece equal to the framework while the
  framework exists. Before the framework goes, each piece's proof becomes delta's cases alone, plus
  the pinned text. The equivalence tests are retired with the framework, not kept against a copy.
- **Order.** The last slice of `delta_apply` and the ledger walk compile first. Then one change
  removes the framework functions, the dispatchers and the `_framework` names, with the full case
  suite and the bench run as the gate, and its changelog says so as a breaking change. An app
  re-applies `generateSql` once.

*Done 16 October (blueshed/dzql B1 #38, B2).* As mapped above, with three things learned:
- **A name of none is refused as before** (`no doc def for: <name>`), and a collection there is not
  keeps the framework's answer (no row, nothing to take, no definition, no id new): the ledger asks
  cascade rows of every op's path before the write checks its collection, so a refusal there turned
  delta's 404 into a 400 (the law, seed 3).
- **One app per database** (Peter). Dispatchers are database-wide, so one `generateSql` serves one
  app's definitions; a second app on the same server gets its own database. Postgres schemas could
  separate apps within one database (dzql todo #29: the pool's search path, a change channel per
  schema). Shared dispatch across apps was considered and set aside.
- **The rows and cascades equivalence tests retired** (their answers carry the write's time and the
  sequences' state); every other piece's framework answers are recorded and stay the measure.
  Full suite 4,791 pass; a write under RLS 0.55 ms p50, the fan-out flat to 100,000 names.

**Question (Q3):** may step 4 (delta drops Postgres) follow 2a, once dzql passes the cases with the
moved code, while 2c goes on inside dzql under the same cases? I'd say yes: apps then move once,
by an import, and the compiling is dzql's own business. The other order keeps delta's Postgres, its
Docker suite and its two-language rules alive until the last piece is compiled.

**Question (Q4):** which of the rules kept in two languages does dzql call from delta's TypeScript
rather than compile? The pointer grammar and the reading of a document's name are parsed once per
message and could be delta's `splitPath` and `resolveScope`, leaving `pointerVectors` and the scope
rule one language each. The walk planner reads the document inside the transaction; it could stay
in SQL (and `walkVectors` keep proving it) or run as delta's `planWalk` over rows read in that
transaction. I'd decide each in 2c, piece by piece, by what the cases and the bench show.

### 3. The path language moves into delta, as a document's `owns`

A document is already the permission: opening it is the read check (a document nobody may open is
one nobody can read), a write goes only through what it holds and in the scope it reads by, and
`columns` narrows both to the fields it holds. What dzql's language adds is the **path from a row to
a person** (`@owner_id`, `@org_id->acts_for[org_id=$]{active}.user_id`). In delta that path is how a
document says who may open it: `owns` given as a path, beside `owns` as a function (Q5).

```ts
defineDoc("fo-board:", {
  root: "weddings",
  include: ["households", "answers"],
  owns: "->wedding_members[wedding_id=$].user_id",   // from the root to the person
})
```

- **The grammar** moves into delta with no dependencies: `TRUE | FALSE | AUTHENTICATED | @field |
  chain`, a chain hopping `table[filters]{conditions}.field`. `parsePath` and its check become
  delta's; `defineDoc` throws on a path it cannot follow against the schema, naming the document
  and the path (no path ever becomes `FALSE`).
- **Where a path starts**: a single document's root row; a list document's row its name points at
  (`courses-of:<wedding>`: the wedding). A list whose name names no row (`all-courses:`) takes only
  `TRUE`, `FALSE` or `AUTHENTICATED`, as dzql 0.7 has it for a list subscription.
- **Who the person is**: `auth.asSqlArg(identity)`, the value delta already sets as `app.user_id`.
- **What a document may write** stays what it holds: the three verbs over its root and includes,
  narrowed by `columns`. Two parties who each write their own part of one thing are two documents
  over the same rows, each holding its own columns (the asker's ask, the asked's answer). An update
  that would move a row out of the document is refused, as delta already does for a root or a parent
  key; that is dzql 0.7's "checked on the row after the change", said by the document.
- **`owns` as a function stays**, for what a path cannot say; it runs in the listener, and dzql
  compiles only paths.
- **On SQLite and the JSON file** (one evaluation: the JSON file is SQLite in memory): the path
  becomes an `EXISTS` over the same tables, asked when the document is opened and when a socket
  goes on hearing it, as `owns` is asked now.
- **On Postgres (dzql)**: each document's path is compiled into its open and write functions,
  `SECURITY INVOKER`. Row-level security is **derived from the documents, never written**: a person
  may touch a row of a table where some document holding that table reaches them by its path. The
  tables are `ENABLE` and `FORCE ROW LEVEL SECURITY`, and dzql's tests run as a `NOSUPERUSER
  NOBYPASSRLS` role. This closes dzql #19, and #20 (an included row is the document's, under its
  path).
- **Path cases as data**: `permissionVectors` in `./testing` beside `pointerVectors` and
  `walkVectors` (a schema, rows, a document with its path, a person: may open or not; a write
  through it: taken or refused), which SQLite and dzql both answer.

**Tests from dzql's model, in two parts.** The grammar: every one of the 204 paths in
`tests/fixtures/modeling-dzql.domain.ts` parses and checks against the model's schema, translated
into `defineSchema` once by a script kept beside the test, paths untouched (the unpatched model
refused naming exactly the eleven columns of `MISSING_COLUMNS`). The outcomes: dzql's permission
integration cases (`path_permissions`, `save_permissions`, `list_subscribable_view`: one-hop and
multi-hop, a member sees only their org's venues, promoters and sponsors their own packages, a row
not handed away) said again through documents, each person allowed or refused as before. The 204
table rules themselves do not carry over: they were written per entity, and their documents are
design work for when that model is built again.

**Done when** the grammar test passes, `permissionVectors` pass on SQLite and the JSON file, and the
case suite gains documents with paths (a person who may not open a document cannot, and stops
hearing it when the path stops reaching them; two documents over one row each write only their
columns); dzql passes the same vectors and cases on PGlite as an app role under `FORCE ROW LEVEL
SECURITY`, with its policies derived; released as delta 0.16.0 and a dzql minor.

**Uncertain, to check first:** that PGlite enforces RLS for a `NOSUPERUSER` role (`CREATE ROLE`,
`SET ROLE`, policies). If it does not, dzql's RLS cases run only against a server in CI, and the
fast tests cover everything else. And that a policy derived from several documents over one table
stays a plain, plannable `EXISTS` (measured by the bench, #77).

**Question (Q6):** the shared view in the two-party case (both read the whole ask; each writes
only their part) is a third document holding every column. Should a `defineDoc` be able to say it
is read-only (403 to a write, as custom, static and source documents already answer), or is a
custom document the way to show it?

### 4. delta drops Postgres (a major version)

*Done 15 October: delta 1.0.0 (blueshed/delta#9) has no Postgres; its gate is `bun run ci` with no
Docker (948 tests, ~17 s; CI 32 s). dzql 0.9.0 (blueshed/dzql#22) holds all of it -- the listener,
the framework SQL, the tests (`tests/delta-pg/`), the examples, the bench, `dzql sql | init |
migrate`, the skill's postgres/rls/sql pages -- and takes delta as a peer, `^1.0.0`. kanban runs on
SQLite. Alignment: paintbrush's evolve Postgres step is dzql's (blueshed/paintbrush#7), eta on
delta 1.0 (blueshed/eta#2). Opens and a name's scope are compiled (2c, first pieces); writes, the
ledger and fan-out still run on the framework SQL.*

Removed from delta: `src/server/postgres/`, `src/server/pglite.ts`, `src/sql/`, `auth-jwt.ts` and
`auth-jwt-sql.ts`, the `./postgres`, `./pglite` and `./auth-jwt` exports, the CLI's `sql` and
`init` and the Postgres half of `migrate` (a `postgres://` URL or a PGlite folder), the Postgres
tests (`postgres-*`, `path-pglite`, `kinds-pglite`, `owns-pglite`, `auth-jwt`,
`ledger-0.10.0-sql`, `review-findings`, and the Postgres halves of `write-scope`, `create-row`,
`error-codes`, `schema-contract`, `migrate`; these go to dzql where they prove something the case
suite does not), `bench/`, `compose.yml`, the `db:*` and `test:pg`
scripts, Docker in CI, the Postgres set-up in `.claude/hooks/session-start.sh`, and the peers `pg`,
`@electric-sql/pglite` and `jose`. todo #77 moves to dzql's `todo.jsonl`.

CLAUDE.md loses the rules kept in two languages (the pointer grammar's two parsers, the scope
twin, the walk planner's twin, the framework SQL contract): each becomes one TypeScript rule with
its vectors in `./testing`, which dzql answers. The gate (`bun run ci`) no longer starts Docker,
and `test` is every test.

**The migration note** (CHANGELOG, under Breaking): an app on `@blueshed/delta/postgres` changes its
imports — `createDocListener`, `docTypeFromDef`, `defineCustomDoc`, `applyFramework`/`applySql`/
`generateSql`, `migrate`, `exportTables`/`importTables`, `withAppAuth` from dzql; `openPglite` from
dzql; `jwtAuth` from dzql — while `defineSchema` and `defineDoc` come from `@blueshed/delta`, the
same definitions. A worked before and after, from `examples/todos-vs-rls`.

**Done when** delta's gate passes with no Docker and no Postgres; the case suite still runs against
SQLite and the JSON file; the delta-doc skill and README describe SQLite as delta's last step of its
own and dzql as the next; `examples/todos-vs-rls` runs on dzql as its README says, by the migration
note alone.

**Question (Q7):** kanban (delta's JSX example) moves onto SQLite and stays in delta? I'd say yes.

**Question (Q8):** which version is "a major"? delta is at 0.x, and its breaking releases so far have
been minors (0.9.0, 0.13.0). 1.0.0, or the next minor?

**Question (Q9):** `auth-jwt` checks passwords with Postgres functions, so it goes to dzql; a SQLite
app has no JWT reference then. Leave it so, or give SQLite its own later?

**Question (Q10):** an existing Postgres database. If dzql keeps delta's table layout (the app's
tables as `generateSql` made them, and `_delta_versions`, `_delta_ops_log`, `_delta_ledger`), a
database upgrades in place and its undo history survives. Otherwise it moves by `exportTables` /
`importTables` and the ledger starts fresh, as on every other step of the path. I'd keep the
app's tables as they are and let dzql decide the `_delta_*` tables in 2c, fencing the ledger as a
migration does if it must.

### 5. dzql's runtime, client, Pinia stores and create-dzql retire

Removed from dzql: `src/runtime/` (server, ws, subscriptions, namespace, auth, js_functions,
manifest_loader, logger, projection, db, errors), `src/client/`, the generators of the client
(`codegen/client.ts`), stores (`pinia.ts`, `subscribable_store.ts`), manifest (`manifest.ts`) and
`realtime.ts`, the tests of these (`client`, `pinia`, `realtime`, `runtime`, `namespace`,
`ws_reconnect`, `subscribable_reactivity`, the full-stack and e2e integration tests),
`packages/create-dzql`, and the create-dzql end-to-end check in CLAUDE.md and `/publish`. The
`vue`, `pinia`, `postgres`, `dotenv` dependencies go.

dzql's open todos: #12 (dead Pinia and realtime generators), #18 (the logger) and #24 (notify
inside the write) go with the runtime; #16 (affected keys guessed from foreign-key names) goes
with dzql's subscriptions, delta's documents being told by who holds a row; #19 closes in step 3;
#13, #14, #15, #17, #20, #23 are judged again against the new compiler.

paintbrush's `evolve` skill: `references/postgres.md` (today PGlite and a server through
`@blueshed/delta/postgres`) becomes the dzql step, the same schema and documents with dzql's
imports, and `bun run test:evolve` applies it to a scratch app and runs it. The skill's description
names dzql for "servers share the data, or people see only their own".

**Done when** dzql's package is the compiler, the listener, PGlite and its CLI, nothing else; its
README and `docs/for_ai.md` describe it as delta's Postgres step; paintbrush's evolve runs the dzql
step green.

**Question (Q11):** create-dzql and dzql's old runtime are on npm. Deprecate create-dzql there
(`npm deprecate`, outward-facing, on your word), and say in dzql's README that 0.7.0 was the last
whole-stack release?

**Question (Q12):** dzql features that delta's definitions do not express: graph rules (actions
on create, update, delete), `search_*` and `lookup_*` (sorting, paging), many-to-many expansion,
custom functions, `register_user`. I'd let them retire with the runtime and bring back only what a
story asks for, as a definition in delta first. Agree?

## After each release: paintbrush and eta brought along

paintbrush and eta both stand on delta (both `^0.13`), and each release above moves the ground
under them. So every delta or dzql release in this plan is followed by an alignment round, before
the next step starts:

- **A team of two sessions, one per repo, each in its own worktree**, on the default model, with
  a reviewer only where the change touches a critical path. Each takes the release, runs its own
  gate, adapts what it must, and ends in a PR. I merge and keep the ledger.
- **paintbrush** (light): bump delta (and dzql once it is a step), run `bun run test:evolve`, and
  keep the `evolve` skill true to the release: its `references/` pages (SQLite, delta) after each
  delta release; after step 2, its Postgres step (`references/postgres.md`) points at dzql and is
  run by `test:evolve`; after step 3, a page for a document's `owns` as a path. paintbrush is the
  way into dzql (step 5), so its dzql step is green before create-dzql is deprecated.
- **eta** (heavier, still in development): its own work is not paused for this. The eta session
  takes each release at a point the eta plan chooses, with its scope from eta's own ledger, and
  its stories as the test; it uses delta's `core`, `local`, `sqlite`, `kinds` and `server`, so
  steps 1 to 3 should ask little of it. After step 1 it can run delta's published cases against
  its own documents where that proves something; after step 3, a document's `owns` as a path is
  open to its compartments. canyou-eta follows eta, as it links it.
- **Done for a round** when paintbrush and eta are on the release with their gates green (eta's
  stories, paintbrush's `test:evolve`), or eta has said in its ledger when it will take it.

## Who uses `@blueshed/delta/postgres` today

Searched across `~/Workshop` (not `node_modules`, not archives):

| Project | delta | Uses Postgres? | What must change |
|---|---|---|---|
| eta | ^0.13.1 | No: `core`, `local`, `sqlite`, `kinds`, `server` | Nothing. Comments in `src/server.ts` and `src/documents.ts` say "over Postgres"; true still, with dzql |
| canyou-eta | ^0.13.1 | No | Nothing |
| canyou | ^0.11.0 | No: `client`, `core`, `server`, `sqlite` | Nothing |
| debk | ^0.13.0 | No | Nothing |
| paintbrush (the template) | ^0.13.0 | Only in the `evolve` skill's `references/postgres.md` | The dzql step (step 5) |
| tony-site | ^0.5.0 | No | Nothing |
| **hjeli** | 0.5.1, pinned | **Yes**: its generator (`src/core/gen.ts`, `cli.ts`) writes `@blueshed/delta/postgres`, `auth` and `auth-jwt` imports; `scripts/sync-framework-sql.ts` vendors the framework SQL into `src/core/framework-sql/`; `data/playground` and `data/workflow` use them | Nothing while pinned. To upgrade: the generator writes dzql imports, and the SQL sync goes (dzql generates its SQL) |
| **medwyn/apps/allocate** | ^0.4.4 | **Yes**: `src/server/server.ts`, `auth.ts`, the catalogue and venue documents, `tasks.ts`, `src/database/002-users.sql` (auth-jwt), `test/ws.test.ts`, `test/delta.test.ts` | Nothing while on 0.4 (`^0.4.4` never reaches the new version). To upgrade: from 0.4 the 0.5–0.14 breaking changes come first, then the import change |
| medwyn (root, `apps/medwyn`) | ^0.4.10, ^0.4.4 | No | Nothing |
| zeta, epsilon | none | Their own `pglite.ts` and listeners, not delta's | Nothing (being archived) |
| `blueshed/delta-migrate` | — | A git worktree of delta on `feat/migrations`, merged in 0.14.0 | Not a user; can be removed |

No live project depends on dzql: only archived ones (`blueshed/archive/projects`,
`blueshed/archive/hump`) import it. Retiring its runtime breaks nothing in use.

**Question (Q13):** are hjeli and medwyn/allocate to be brought forward to dzql, or left pinned
where they are? Both are on old deltas already; I'd leave them pinned unless one is picked up
again.

## The questions, in one place

*Answered by Peter, 15 October: each as recommended below (Q2 `@blueshed/delta/backend`; Q4 piece
by piece in 2c; Q5 and Q6 as written; Q8 1.0.0; Q9 auth-jwt to dzql; Q10 keep the app's tables;
Q11 deprecate create-dzql when step 5 lands, on his word then; Q12 retire, back only when a story
asks). Step 1 started the same day.*

1. Publish `owns`, isolation, error-code, create-row and write-scope cases too? (I'd say yes.)
2. A `@blueshed/delta/backend` export for what dzql's listener builds on: agree the name?
3. delta drops Postgres once dzql passes the cases with the moved code (2a), compiling on after?
   (I'd say yes.)
4. Which two-language rules dzql calls from delta's TypeScript: decided piece by piece in 2c?
5. Permissions are a document's (`owns` as a path), never a table's; row-level security derived from the documents? (I'd say yes.)
6. A read-only `defineDoc` (403 to a write) for the shared view, or a custom document? (I'd say a read-only `defineDoc`.)
7. kanban to SQLite, staying in delta? (I'd say yes.)
8. 1.0.0, or the next minor, for the release that drops Postgres?
9. `auth-jwt` goes to dzql and SQLite has no JWT reference: fine?
10. Existing Postgres databases: keep the app's tables, dzql decides the `_delta_*` tables in 2c?
11. Deprecate create-dzql on npm?
12. Graph rules, search and lookup, many-to-many, custom functions and `register_user` retire?
13. hjeli and medwyn/allocate: bring forward, or leave pinned? (I'd leave them.)
14. A dzql release's own table changes as migrations under `app: "dzql"`? (I'd say yes.)
