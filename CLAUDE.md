# CLAUDE.md - Rules for Working on DZQL

## Read the Documentation First

Before working on this codebase, read:
- `philo.md` - **what dzql is for now**: delta's compiled Postgres step, and why
- Workshop's `docs/postgres-split-plan.md` - the plan dzql is part way through (steps 2-5)
- `packages/dzql/docs/for_ai.md` - AI guide for the whole-stack dzql (`domain.ts`), which retires in step 5
- `packages/dzql/docs/README.md` - General documentation
- `packages/dzql/docs/project-setup.md` - Project setup guide
- `packages/create-dzql/README.md` - Starter template documentation

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
│   ├── src/sql/         # delta's framework SQL (001a-001g, auth-jwt.sql), replaced piece by piece by compiled SQL
│   ├── src/compile/     # the compiler from delta's definitions: dzql/compile (compileOpens, ...)
│   ├── src/cli, runtime, client, shared   # the whole-stack dzql (domain.ts), retiring in step 5
│   ├── docs/            # Documentation of the whole-stack dzql
│   ├── src/postgres/cli.ts  # dzql sql | init | migrate (src/cli/index.ts hands them here)
│   ├── examples/delta/  # delta's Postgres examples: todos-vs-rls, sites-bbox
│   ├── bench/           # delta's bench (bun run bench), todo #25
│   └── tests/           # delta/ (delta's cases), delta-pg/ (delta's Postgres tests), compile/ (compiled = framework), integration/ (whole stack)
└── create-dzql/         # Starter template (bun create dzql), retiring in step 5
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
  error naming the document and what it lacks. A compiled function must answer what the framework
  answers (`tests/compile/`, both ways on PGlite, on the seed and after writes); its text is pinned
  by a snapshot, updated (`bun test --update-snapshots`) only with the change that explains it.
- **Permissions are a document's** (`owns` as a path), **migrations are delta's**: no table rules,
  no upgrade scheme of dzql's own (philo.md).
- **The whole-stack dzql** (`src/cli`, `runtime`, `client`, the Pinia stores, `create-dzql`) is kept
  working until step 5 retires it: fix what breaks, add nothing to it.

## Testing

- Run tests: `cd packages/dzql && bun run test`
- Tests run against Docker PostgreSQL (see `packages/dzql/compose.yml`)
- `tests/delta/` and `tests/compile/` run on PGlite with no Docker (`bun test tests/delta tests/compile`)
- Follow patterns in `packages/dzql/tests/integration/` for the whole stack
- The test script handles Docker lifecycle: starts fresh, runs tests, tears down

**Test-Driven Development:** Write tests first. Add failing tests for new features or bugs, then implement until they pass. This ensures the feature works and prevents regressions.

**End-to-End Verification:** Before publishing, always test in a real app. Unit tests passing does not guarantee the feature works end-to-end. Use Playwright to verify real-time features like subscriptions actually work in the browser.

### Testing the create-dzql Template

Before publishing changes to `create-dzql` or `dzql`, test by creating a sample app using the local template **with local packages linked**:

```bash
# 1. Link local dzql package globally
cd /Users/peterb/Workshop/blueshed/dzql/packages/dzql
bun link

# 2. Create test app from local template
cd /tmp
rm -rf dzql-test-app
bun /Users/peterb/Workshop/blueshed/dzql/packages/create-dzql/index.ts dzql-test-app
cd dzql-test-app

# 3. Link local dzql into the test app (uses local code, not npm published version)
bun link dzql

# 4. Install remaining dependencies
bun install

# 5. Compile and start database
bun run db:rebuild

# 6. Start dev servers
bun run dev
```

**IMPORTANT:** The `bun link dzql` step is critical - without it, `bun install` fetches the published npm version, not your local changes. Always verify you're testing local code, not the old published version.

**Verify local code is linked:** After `bun run db:rebuild`, check the generated manifest to confirm your changes are present:
```bash
cat .dzql/manifest.json | head -20
```

Then use Playwright (via MCP Docker) to test at `http://host.docker.internal:5173`:

1. **Register a user**: Click "Create one", fill name/email/password, submit
2. **Create a post**: Click "New Post", navigate to `/posts/new`, fill title/content, click Publish
3. **Verify real-time**: Post should appear in list immediately (no refresh needed)
4. **Edit a post**: Click "Edit" on your post, modify content, save - verify update appears
5. **Delete a post**: Click "Delete", confirm - verify post is removed from list

**Key things to verify:**
- Real-time updates work (posts appear/update/disappear without refresh)
- Edit button only shows for posts you authored
- Routes work: `/`, `/posts/new`, `/posts/:id/edit`

### Cleanup

**IMPORTANT:** Always clean up after E2E testing to avoid polluting your environment.

```bash
# 1. Kill dev servers first (vite processes left running in background)
pkill -f "vite" 2>/dev/null

# 2. Stop and remove test app
cd /tmp/dzql-test-app
docker compose down -v
cd /tmp && rm -rf dzql-test-app

# 3. Remove the global bun link
cd /Users/peterb/Workshop/blueshed/dzql/packages/dzql
bun unlink
```

The `bun unlink` step removes the global link so future projects use the published npm version, not your local code.

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
