# CLAUDE.md - Rules for Working on DZQL

## Read the Documentation First

Before working on this codebase, read:
- `philo.md` - **what dzql is for now**: delta's compiled Postgres step, and why
- Workshop's `docs/postgres-split-plan.md` - the plan that made dzql delta's Postgres step
- `packages/dzql/docs/delta/` - delta on Postgres: setting up, the stored functions, row-level security
- `packages/create-dzql/README.md` - `bun create dzql`: a paintbrush app on dzql

## Where the Project Is

`CHANGELOG.md` and `todo.jsonl` are the project's memory between sessions. The
changelog is where dzql has been; `todo.jsonl` is what is open now. Read both
before starting. As you work, keep them current together: what you find or leave
open goes into `todo.jsonl`; what lands goes under `## [Unreleased]` in the
changelog, breaking changes first, and the item it settles becomes `fixed` with a
dated `note`. A release turns `[Unreleased]` into a version, and the settled items
leave `todo.jsonl`.

`todo.jsonl` has one JSON object per line: `n`, `status` (open / fixed / not
fixed), `severity`, `area`, `file`, `summary`, `detail`, plus a dated `note` once
an item is worked on. Same shape as duckdown's.

## Project Structure

```
packages/
├── dzql/                # The dzql package on npm
│   ├── src/postgres/    # delta's Postgres backend: dzql/postgres, dzql/pglite, dzql/auth-jwt
│   ├── src/sql/         # the framework SQL (001a-001g, auth-jwt.sql): tables, delta_apply, the ledger; it calls what generateSql compiles
│   ├── src/compile/     # the compiler from delta's definitions: dzql/compile (compileOpens, owns, ...)
│   ├── docs/delta/      # delta on Postgres: postgres.md, sql.md, rls.md
│   ├── src/postgres/cli.ts  # dzql sql | init | migrate | link (src/cli/index.ts, the bin, runs it)
│   ├── examples/delta/  # delta's Postgres examples: todos-vs-rls, sites-bbox
│   ├── bench/           # delta's bench (bun run bench), todo #25
│   └── tests/           # delta/ (delta's cases), delta-pg/ (delta's Postgres tests), compile/ (compiled, to the framework's recorded answers; the path grammar over modeling-dzql's 204 rules)
└── create-dzql/         # bun create dzql: a paintbrush app on dzql (template/), its tests the end-to-end check
```

## dzql as delta's Postgres step

- **delta's wire and definitions are the contract.** An app's `defineSchema` / `defineDoc` are the
  input; a client talks to dzql exactly as to delta's SQLite. `src/postgres/` was copied from
  delta 0.15.0 and imports only delta's public subpaths and `@blueshed/delta/backend`.
- **delta's cases are the proof.** `tests/delta/` runs `@blueshed/delta/testing` unchanged: the
  path, `owns`, the law over generated writes, the write cases. Never change a case to make dzql
  pass: a different answer is dzql's bug (or delta's, fixed in delta and released first).
- **The compiler is deterministic, and Claude extends it, never stands in for it.** `src/compile/`
  is pure: definitions in, SQL text out, the same every time. A definition it cannot compile is an
  error naming the document and what it lacks. A compiled function must answer what the retired
  framework answered (`tests/compile/`, its answers recorded, on PGlite, on the seed and after
  writes) and pass delta's cases; its text is pinned by a snapshot, updated
  (`bun test --update-snapshots`, whole files: a `-t` filter drops the snapshots it did not run)
  only with the change that explains it. One `generateSql` per database: one app's definitions.
- **Permissions are a document's** (`owns` as a path), **migrations are delta's**: no table rules,
  no upgrade scheme of dzql's own (philo.md).
- **The whole-stack dzql is retired** (0.13): the `domain.ts` compiler, runtime, client and Pinia
  stores are gone. Its story is in CHANGELOG.md; nothing of it comes back unless a story asks.

## Testing

- Run tests: `cd packages/dzql && bun run test`
- Tests run against Docker PostgreSQL (see `packages/dzql/compose.yml`)
- `tests/delta/` and `tests/compile/` run on PGlite with no Docker (`bun test tests/delta tests/compile`)
- The test script handles Docker lifecycle: starts fresh, runs tests, tears down

**Test-Driven Development:** Write tests first. Add failing tests for new features or bugs, then implement until they pass. This ensures the feature works and prevents regressions.

**End-to-End Verification:** Before publishing, always test in a real app. Unit tests passing does not guarantee the feature works end-to-end. The create-dzql template's tests are that check: two real browsers (`Bun.WebView`).

### Testing the create-dzql Template

`create-dzql` makes a paintbrush app on dzql (`packages/create-dzql/template/`): sign in by
link (`auth-link`), and posts as two documents, `posts:` (everyone's, read-only) and `mine:<id>` (one
person's own, every write through it). Its own tests are the end-to-end check, in two real browsers
(`Bun.WebView`), with Postgres in memory (PGlite). Before publishing `create-dzql` or `dzql`, make
an app from the local template with the local dzql linked, and run them:

```bash
cd packages/dzql && bun link                  # the local dzql, for the app to link
cd "$(mktemp -d)"
bun /Users/peterb/Workshop/blueshed/dzql/packages/create-dzql/index.ts dzql-test-app
cd dzql-test-app
sed -i '' 's|"dzql": "[^"]*"|"dzql": "link:dzql"|' package.json   # the local dzql, not npm's
bun install
bun check && bun test
```

`node_modules/dzql` must be a link to the global one (`ls -la node_modules/dzql`): otherwise the
tests ran npm's dzql. To see it by hand: `bun run db:up` (a Postgres server in Docker) and `bun dev`.

Against a delta not yet on npm (the template names its next version), link it too: `bun link` in
delta, and `"@blueshed/delta": "link:@blueshed/delta"` in the app. A linked delta brings its own
railroad, and two copies of railroad break the page ("A second copy of @blueshed/railroad has
loaded" in the console; signals don't cross copies). Make it one: `rm -rf node_modules/@blueshed/railroad &&
ln -s <delta>/node_modules/@blueshed/railroad node_modules/@blueshed/railroad` in the app.

### Cleanup

```bash
docker compose down -v 2>/dev/null           # in the app, if db:up was run
cd packages/dzql && bun unlink
```

## Publishing

`/publish patch|minor|major` (`.claude/commands/publish.md`): the gate, the create-dzql end-to-end
check, one version for both packages, the changelog and ledger promoted, and the tags
`dzql@x.y.z` and `create-dzql@x.y.z`, whose push is what publishes (GitHub Actions, OIDC trusted
publishing). Never `npm publish` by hand.

## Events

Events only have `pk` and `data`. There is no `before`/`after` or `old`/`new`.

- INSERT: `data` contains the new row
- UPDATE: `data` contains the updated row
- DELETE: `data` contains the deleted row (needed for subscription resolution)

## Subscribables

The `_affected_documents` function signature is:
```sql
function_name_affected_documents(p_table_name TEXT, p_op TEXT, p_data JSONB)
```

Three parameters. Not four.

## Listen to the User

If the user tells you something, do it. Don't revert to old patterns. Don't publish without permission. Don't claim tests prove functionality when they don't.
