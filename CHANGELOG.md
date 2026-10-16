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

- **A collection's definition, a table's serial and a document as it stood are compiled lookups**
  (2c, the step before the framework retires).
  - `_delta_collection(key)` gives a collection's definition (its table, parent, columns,
    validity and what cascades on it). `generateSql` writes each collection in, with any other
    key going to `_delta_collection_framework`.
  - The write (`delta_apply`'s root and each op), an implied root and its first write,
    `_delta_show` and `_delta_show_ops` now ask it. No function that survives the framework reads
    `_delta_collections` itself.
  - `_delta_serial_new` and `_delta_serial_past` name each table's sequence. They stay definer
    functions, with the same privilege checks and search path.
  - `delta_open_at` sends each compiled document to its own read as it stood
    (`dzql_open_at__<prefix>`).
  - Each has a `_framework` version for anything not compiled, as the earlier pieces do.

  Held equal (`tests/compile/lookups.test.ts`):
  - every collection's row, and one that doesn't exist;
  - every table's serial at ids around its sequence and past 2^53, set back between (a sequence
    does not roll back), and for a caller without the table's privilege;
  - every path-case name read as it stood at five times, on the seed and after writes.

  Six mutations each fail it. A write is unchanged (0.588 ms p50 compiled): what this slice buys
  is the framework's retirement.

- **delta's Postgres tests open only documents an app could define.** Every table and document
  the tests in `tests/delta-pg` use is a definition, applied once with `generateSql`. Nothing is
  registered by hand any more, and the SQL fixtures (items, sites, customers) are gone. A
  definition the compiler refuses (a root that is no collection, a scope key that is no column, a
  junk scope operator) is tested as refused when the SQL is written. This is the step before the
  framework retires: no test leans on it to read a document it never compiled.

### Fixed

- **A custom document is told writes in the order they were made.** It hears writes made through
  every document, but each document's notifications were drained on their own. So a slow read of
  one document's ops told the custom document a later write, made through another, first, and its
  copy broke delta's law. The full suite showed it once under load. The custom documents are now
  told in their own queue, one notification after another, in the order Postgres delivers them
  (commit order), each reading the one entry its notification announces. Each document still
  drains to its own subscribers on its own: none waits on another's. A test holds one document's
  reads back and makes the order certain.

## [0.10.0] - 2026-10-15

### Changed

- **The READMEs lead with what dzql is now.** They opened with "define your domain in TypeScript,
  compile to SQL, get a full-stack app", which is the whole-stack dzql that step 5 retires. Both now
  open with delta's compiled Postgres step, and put `domain.ts`, the Quick Start and `bun create
  dzql` under "The whole-stack dzql (retiring)". The npm description follows: "delta's compiled
  Postgres step: an app's delta definitions compiled to SQL" (published with the next release).

- **The docs say what is compiled.** `docs/delta/postgres.md` has a "Compiled SQL" section:
  - a table of each piece, its compiled functions and the framework's it falls back to;
  - the rule that `generateSql` is applied after the framework every time, because
    `applyFramework` puts the framework's dispatchers back (checked on PGlite: writes then go to
    the framework, while the compiled opens stay);
  - what happens to documents dzql did not compile.

  The READMEs, `sql.md` and `rls.md` (the fan-out is still SECURITY DEFINER when compiled) say
  the same.
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
- **A name is read by its document's scope, compiled** (2c, `delta_apply`'s first slice). Every
  write, the framework's reads and the ops log read a document's name by its scope
  (`_delta_resolve_scope`: the conditions as SQL text, the equality values, single or list, a time).
  `generateSql` writes `dzql_scope__<prefix>(name, refuse)` for each document, giving the
  framework's JSON exactly, its `where` in the framework's words, a value refused with the same
  message (raised, or answered as the scope that holds nothing). `_delta_resolve_scope` sends each
  compiled document to its own, any other to `_delta_resolve_scope_framework`. Equal for 1,228
  names, both ways (`tests/compile/resolve.test.ts`): the path cases' and names made to probe each
  check (signs, spaces, zeros, past 2^53, not whole, text for an id, dates not in the calendar,
  empty values). Dropping a `like`'s `%`, the values, the `at`, the refusal's reason, single mode,
  the framework's `AND`, or reading a text id as a number each fail. The resolver's share of a
  write fell from 0.071 to 0.012 ms; a write: 0.657 ms p50 compiled against 1.059 ms framework
  (38% less).
- **A one-row document's root check is compiled** (2c, `delta_apply`'s second slice). Before each
  op, a write through a one-row document asks whether its root is there and meets the whole of its
  name's scope. The framework ran the resolver's conditions as text (`EXECUTE`); `delta_apply` now
  asks `_delta_root_there`. `generateSql` writes `dzql_root_there__<prefix>(name, id)`: the name's
  values checked as the resolver checks them, and the root's current rows asked with typed
  conditions. Documents not compiled go to `_delta_root_there_framework`, which runs the same
  `EXECUTE` as before. It is equal to the framework for 745 names (the path cases' names, plus
  probes) and every root id, each version, ids not there and none, on the seed and after writes that
  close and remove roots (`tests/compile/root.test.ts`). Dropping the scope's conditions, reading
  every version, ignoring an unscoped name's id, or not checking the values each fail.
  - The bench's `bench:` is a list, which never runs this check. Measured ad hoc through a one-row
    document (`bench-item:<id>`, one replace of its root as the app role): 0.651 to 0.636 ms p50
    compiled, about 15 µs a write (framework 0.855 ms), and more per op on longer writes.
- **A write's columns and their checks are compiled** (2c, `delta_apply`'s third slice). The columns
  stay the writing process's (`delta.declared`, else the database's: two versions on one database
  each write by their own), read at run time as before. What follows from the definitions is
  compiled:
  - `dzql_columns__<prefix>(collection, columns_def)` gives the columns a document writes, with
    its own `columns` list written in. `_delta_write_columns` sends each compiled document to its
    own, any other to `_delta_write_columns_framework`.
  - `_delta_assert_fields` checks each set of columns the definitions give a collection (all of
    them, and each document's own) by written statements, with the framework's messages, still
    ordered by SQL's `ORDER BY` so the collation orders both alike. Any other set (a walk's,
    another version's) goes to `_delta_assert_fields_framework`.

  Held equal (`tests/compile/columns.test.ts`) for every document and collection with nothing, the
  app's own or another version's columns declared, and for every collection, set of columns (the
  compiled ones and sets it never saw) and parent key, over values probing each check. A test with
  the framework's checks made to raise shows the compiled sets never reach them. The test caught a
  precedence bug before it landed (`p_value->'n'::text::numeric`). An unknown field's message,
  the parent key, a whole number, the messages' order, the time's pattern, a document's own columns
  and the object check, each broken on purpose, fail. A write: 0.624 ms p50 compiled against
  1.063 ms framework (41% less); through a one-row document, 0.636 to 0.60 ms. The codegen test
  that a plain table has no `valid_from` now asks of the table's DDL: the checks name it, as a
  write's value may carry it.
- **A write's row SQL is written out per collection** (2c, `delta_apply`'s fourth slice). The
  statements a write runs on a row were built from the table's name and planned again on every
  call (`EXECUTE format(...)`). They are now functions that `generateSql` writes for each
  collection, as statements whose plans the database keeps:
  - `_delta_row_lock`: the row as it stands, locked;
  - `_delta_row_put`: a replace's row stored, a temporal one as a new version;
  - `_delta_next_id`: an add's id;
  - `_delta_row_clear_moment`: a version this write made and took back;
  - `_delta_row_there`: is it there now.

  Any other collection goes to each one's `_framework`. Held equal (`tests/compile/rows.test.ts`)
  for every collection and every id (each version, absent, none), on the seed and after writes.
  Each pair runs in one transaction, rolled back to the same savepoint between, so both see one
  `now()`, and the table left behind is compared too. The replaces cover the row again, changed,
  twice in one write, and missing what it must have. Seven mutations each fail it. An add's own
  INSERT stays the framework's: it names the columns the row gives, so one it leaves out takes its
  database default. A write: 0.595 ms p50 compiled against 1.068 ms framework (44% less; 3.25x a
  raw `UPDATE`, from 5.8x); through a one-row document, 0.60 to 0.567 ms; the fan-out with 10
  open, 0.76 to 0.69 ms.
- **Cascades, hanging rows, an add's row and an implied root's first write are compiled** (2c,
  todo #27). They are what a write still built from text after the row SQL.
  - What a remove takes, and what a moved row carries: the framework walked `_delta_collections` at
    run time for a collection's children and the collections that cascade on it. `generateSql` now
    writes `dzql_cascade_remove__<coll>`, `dzql_cascade_rows__<coll>` and
    `dzql_hanging_rows__<coll>` for each collection. Each has the schema's children and `cascadeOn`
    written in, in the framework's order (child collections, then the collections that cascade on
    it, each by `COLLATE "C"`, rows by id). `_delta_cascade_remove`, `_delta_cascade_rows` and
    `_delta_hanging_rows` send each collection to its own, any other to `_framework`, whose own
    recursion goes through the same names. Two collection keys that would share a function name
    are refused when compiling.
  - An add's row: the framework's INSERT names the columns the row gives, so one it leaves out
    takes its database default. Where the row gives exactly every column the schema declares, that
    INSERT is one statement, written per collection (`_delta_row_add`); any other key set is the
    framework's. `_delta_row_read` reads a row as it stands.
  - An implied root's first write asks `_delta_row_there`, `_delta_row_read` and `_delta_row_add`.

  Held equal (`tests/compile/cascades.test.ts`) for every collection and every id (each version,
  absent, none), on the seed and after writes. It covers what a remove would take, the remove,
  a second remove, what is left, the hanging rows, the read, and adds of every column, fewer, a
  taken id and the same id twice. Each pair runs in one transaction from the same savepoint, the
  framework's dispatchers pointed back at it so its recursion stays its own, and every table left
  behind is compared too. A row giving every declared column is stored with the framework made to
  raise. Eight mutations each fail it. Measured ad hoc through `bench:1` as the app role: an add,
  0.59 to 0.56 ms compiled (framework 0.90); a remove, 0.58 to 0.52 ms (framework 0.82). Replaces,
  which the bench times, are unchanged at 0.593 ms.
- **The ledger's reads are compiled** (2c, the ledger walk). An entry's inverse and a walk's guard
  read the document whole, every column whatever it names (`_delta_open(name, TRUE)`). That was
  the framework's interpreting read, beside the compiled opens.
  - `generateSql` writes `dzql_open_whole__<prefix>(name)` for each document: its open with every
    column. `_delta_open` sends each compiled document to its own open, shown or whole, and any
    other to `_delta_open_framework`.
  - `_delta_same` (a field the same in two values, a time by its instant) has each collection's
    time fields written in. It still takes the writing process's declared type
    (`delta.declared`) first.
  - The rows a walk guards beyond the document are read by `_delta_row_standing`, per collection.
  - `_delta_open_held` asks `_delta_row_there`.

  Held equal (`tests/compile/ledger.test.ts`): every path-case name and one no document holds, read
  whole and shown, on the seed and after writes; every collection and field (and ones there are
  not) over pairs of values, with nothing, the app's own and another version's columns declared;
  every collection's rows beyond, and a collection there is not. Seven mutations each fail it.
  Measured ad hoc as the app role, from an empty ledger: a logged write through one row 0.815 to
  0.78 ms compiled (framework 1.12), through a list of 100 1.09 to 1.056 ms (framework 1.63); an
  undo about as before (1.45 and 2.34 ms; framework 2.0 and 3.5): its cost is the walk's own plan,
  not these reads. An undo slows as its cursor's ledger grows (todo #28).
- **The compiler names its functions by one rule** (`named` in `src/compile/opens.ts`), and writes a table's standing rows one way (`standingRows`, `currentOnly`): a simplicity pass before 0.10.0, the SQL it writes unchanged byte for byte (every compile snapshot as it was).
- **Doc comments name dzql's subpaths.** Nine comments in `src/postgres/` and `auth-jwt.sql`
  still said `@blueshed/delta/postgres` and `@blueshed/delta/auth-jwt`, which delta 1.0 no longer
  has; they now say `dzql/postgres` and `dzql/auth-jwt`.

### Fixed

- **An undo no longer slows as its cursor's ledger grows** (todo #28). Each undo and redo found its
  entry by walking every chain the cursor had ever begun (a recursive query over its whole
  history), so one cursor's undo went from about 2 ms to about 15 ms over a few thousand entries.
  `_delta_ledger_tip` now looks newest first among the cursor's own entries, a step at a time on a
  new `(cursor, id)` index. It stops at the first tip that goes the way asked: depth along its
  chain, up to the write that began it, is found by following `undoes`. A redo stops at the
  cursor's last write. It relies on every entry of a chain carrying its write's cursor, as
  `delta_walk` records it.
  - `tests/delta-pg/ledger-tip.test.ts` keeps the old walk as the reference. Over five seeded
    runs of 150 steps (three cursors writing, removing, adding, writing facts, undoing, redoing,
    walking a change by name, conflicts as they come), both take the same entry for every cursor,
    both ways, after every step. Four mutations each fail it.
  - On a cursor with 1,500 write-and-undo pairs, finding an undo's entry reads 1 row of the ledger
    (the old walk read 1,503), counted by the transaction's own table and index counters. Against
    the old function that test fails.
  - Measured ad hoc as the app role, the ledger growing run to run: an undo stays at 1.07 ms
    through one row and 1.6 ms through a list of 100, compiled (it was 1.45 and 2.34 ms from an
    empty ledger, and grew).

  delta's SQLite ledger (`src/server/ledger.ts`) finds the tip by the same recursive walk.
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
