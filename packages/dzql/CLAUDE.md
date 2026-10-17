# CLAUDE.md - Rules for Working on DZQL

dzql is the path an app takes from its stories to its documents to its pages, and its last storage
step: **modelling** (`dzql/modelling`: the stories, told against the app), **rendering**
(`dzql/rendering`: pages the server draws, eta's kernel) and **the compiled Postgres step**
(`dzql/postgres`, `dzql/pglite`). One package; each part is its own entry, and nobody pays for a
part they do not import: `@blueshed/railroad` is an optional peer that only an island needs.

## Read the Documentation First

Before working on this codebase, read:
- `philo.md` - **what dzql is for now**: stories to documents to pages, and the compiled Postgres step
- `docs/eta/` - eta's docs: `stories.md` (what it is for), `eta.md` (what it is, its measured costs), the bento
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
│   ├── src/modelling/   # dzql/modelling: stories.ts (the format), harness.ts (stories told), by-hand.ts (in a browser), costs.ts
│   ├── src/rendering/   # dzql/rendering: eta's kernel: server.ts, compartments/, client/ (the browser's), bento, island.ts (railroad)
│   ├── examples/<app>/  # eta's examples: chat, leave, modeling (the model's page), starter, ticker, wedding
│   ├── src/postgres/    # delta's Postgres backend: dzql/postgres, dzql/pglite, dzql/auth-jwt
│   ├── src/sql/         # the framework SQL (001a-001g, auth-jwt.sql): tables, delta_apply, the ledger; it calls what generateSql compiles
│   ├── src/compile/     # the compiler from delta's definitions, a module per kind of function (generateSql runs them all)
│   ├── docs/delta/      # delta on Postgres: postgres.md, sql.md, rls.md
│   ├── docs/eta/        # eta's docs, its CHANGELOG.md and todo.jsonl until folded into dzql's
│   ├── .claude/skills/  # modelling (someone telling the stories), eta-app (building an app on dzql/rendering)
│   ├── src/postgres/cli.ts  # dzql sql | init | migrate | link (src/cli/index.ts, the bin, runs it)
│   ├── examples/delta/  # delta's Postgres examples: todos-vs-rls, sites-bbox
│   ├── bench/           # delta's bench (bun run bench), todo #25
│   └── tests/           # delta/ (delta's cases), delta-pg/ (delta's Postgres tests), compile/ (compiled, to the framework's recorded answers; the path grammar over modeling-dzql's 204 rules)
└── create-dzql/         # bun create dzql: a paintbrush app on dzql (template/), its tests the end-to-end check
```

## dzql as delta's Postgres step

- **delta's wire and definitions are the contract.** An app's `defineSchema` / `defineDoc` are the
  input; a client talks to dzql exactly as to delta's SQLite. `src/postgres/` imports only delta's
  public subpaths and `@blueshed/delta/backend`.
- **delta's cases are the proof.** `tests/delta/` runs `@blueshed/delta/testing` unchanged: the
  path, `owns`, the law over generated writes, the write cases. Never change a case to make dzql
  pass: a different answer is dzql's bug (or delta's, fixed in delta and released first).
- **The compiler is deterministic, and Claude extends it, never stands in for it.** `src/compile/`
  is pure: definitions in, SQL text out, the same every time. A definition it cannot compile is an
  error naming the document and what it lacks. A compiled function passes delta's cases, and
  `tests/compile/` pins its answers (on PGlite, on the seed and after writes) and its text, by
  snapshots updated
  (`bun test --update-snapshots`, whole files: a `-t` filter drops the snapshots it did not run)
  only with the change that explains it. One `generateSql` per database: one app's definitions.
- **Permissions are a document's** (`owns` as a path), **migrations are delta's**: no table rules,
  no upgrade scheme of dzql's own (philo.md).
- **The Postgres step imports nothing of modelling or rendering**, and they nothing of it: an app on
  SQLite uses `dzql/rendering` with no Postgres, and one on Postgres uses `dzql/postgres` with no page.
  What dzql was before delta (its own client and runtime) is in CHANGELOG.md; nothing of it comes back.

## Modelling and rendering (eta)

What a change to them must not break. How the pieces work is in the skills; the types in
`src/modelling/` and `src/rendering/` are the contract.

- Someone telling you the stories, there to answer: the **modelling** skill. Building or extending an
  app or an example, or touching the `Compartment` contract, an app's `delta.ts`, the applet
  registry or the wire: the **eta-app** skill. Documents: delta's **delta-doc** skill.
- **Stories first.** `docs/eta/stories.md` is what it is for. An app's `stories.ts` says who does
  what and who then sees it; everything else follows. Start a feature with its story, watch it fail,
  build the least that makes it pass. Build nothing no story needs.
- **The shape.** `src/rendering` and `src/modelling` never import from `examples/` (their tests
  may). `examples/<name>/` is a whole app with an `index.ts` exporting `example: Example`, importing
  dzql as an app does (`dzql/rendering/...`); examples never import from each other.
  `examples/modeling/` is the model's page; its `loader/` reads an app that exists.
- railroad only in `src/rendering/island.ts`; the examples add `lucide`; the kernel imports no icon set.
- Documents are delta's: rendering owns people and pages, delta owns documents, their ledger and
  their one stream of changes. A **compartment** owns one `docType` and has no place on the page; a
  place on the page is a **cell**, in the bento's **tray**; the visitor's own document is the **session**.
- **The wire.** HTML is the only vocabulary: no node or JSON tree on the wire or in the client. A
  write names a document (`<docType>:<docId>`) and a JSON Pointer path, never a function. A
  connection is told about, and may write, only what its page read. The server is the only renderer;
  the client morphs, never replaces `innerHTML`, never descends into a `[data-applet]`. After a
  write each page that read the document gets only its changed parts. Every change is told from
  delta's one stream. A change to what the wire carries bumps `WIRE`.
- **Pages.** A page's shape comes from its stories; the bento (`docs/eta/bento/README.md`) is how to
  check it. Say a thing once.
- Verify every bug fix by reverting it, watching its test fail, then restoring it.

## Testing

- **Modelling and rendering** (no Docker): `bun check`, `bun run test:eta` (the default
  `bunfig.toml`: 100% coverage, the client's too, read from Chrome), `bun run stories:all`,
  `bun run costs --check`. The browser tests need Chrome (the eta-app skill's *Tests*).
- **The Postgres step**: `cd packages/dzql && bun run test` (`tests/bunfig.toml`)
- Tests run against Docker PostgreSQL (see `packages/dzql/compose.yml`)
- `tests/delta/` and `tests/compile/` run on PGlite with no Docker (`bun --config=tests/bunfig.toml test tests/delta tests/compile`)
- The test script handles Docker lifecycle: starts fresh, runs tests, tears down. It removes the
  database as it starts and ends, so **never run it while another run is going** (a person's, a
  session's): each wipes the other's database, and both fail

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

Not a step of a plan: finish every stage first, then release once, on Peter's word. Across
packages, test by linking or packing (above), never by publishing.

`/publish patch|minor|major` (`.claude/commands/publish.md`): the gate, the create-dzql end-to-end
check, one version for both packages, the changelog and ledger promoted, and the tags
`dzql@x.y.z` and `create-dzql@x.y.z`, whose push is what publishes (GitHub Actions, OIDC trusted
publishing). Never `npm publish` by hand.

## Listen to the User

If the user tells you something, do it. Don't revert to old patterns. Don't publish without permission. Don't claim tests prove functionality when they don't.
