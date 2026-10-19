# CLAUDE.md - Rules for Working on DZQL

For a Claude session working on dzql itself. What dzql is and why: [README.md](README.md). How to
build with it: the `dzql-app` skill (an app) and the `modelling` skill (taking the stories down),
the manual. This file is the rules for changing dzql.

dzql is the path an app takes from its stories to its documents to its pages, and its last storage
step: **modelling** (`dzql/modelling`: the stories, told against the app), **rendering**
(`dzql/rendering`: pages the server draws, the thin client's kernel) and **the compiled Postgres step**
(`dzql/postgres`, `dzql/pglite`). One package; each part is its own entry, and nobody pays for a
part they do not import: `@blueshed/railroad` is an optional peer that only an applet drawn by railroad needs (`dzql/rendering/applet`).

**The public API is `package.json`'s `exports`, each named; no wildcard.** A module not listed
is dzql's own and may change. `tests/readme/exports.test.ts` holds it: every `dzql/...` path an example,
a skill, a README or a doc names must be exported. Make a module public by listing it, with the
change that first needs it.

## Read the Documentation First

Before working on this codebase, read:
- the root `README.md`, *How an app is made* - **the one statement of the vision**: stories, documents, the storage path, routes and resources, and the compiled step
- `docs/` (at the root): `stories.md` (what the stories are for), `rendering.md` (the thin client, its measured costs), `bento/` (how a page looks and moves), `postgres/` (delta on Postgres), `plan.md` (what is decided, what is next)
- `examples/cafe/` and its README: an app built from its model, the path the `dzql-app` skill follows
- `packages/create-dzql/README.md` - `bun create dzql`: the thin client's starter

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
├── dzql/                # The dzql package on npm, shaped as the root CLAUDE.md says (The shape of a package)
│   ├── src/modelling/   # dzql/modelling: stories.ts (the format), harness.ts (stories told; harness/: a page's controls, its applets,
│   │                    #   a document's paths), by-hand.ts (in a browser), costs.ts, reading, definitions, guards;
│   │                    #   page/ is the model's page, an app dzql ships (`dzql model` serves it)
│   ├── src/rendering/   # dzql/rendering: the kernel: server.ts, resources/, client/ (the browser's), bento, applet.ts (an applet drawn by railroad)
│   ├── src/postgres/    # delta's Postgres backend: dzql/postgres, dzql/pglite, dzql/auth-jwt; cli.ts: dzql sql | init | migrate | link
│   ├── src/sql/         # the framework SQL (001a-001g, auth-jwt.sql): tables, delta_apply, the ledger; it calls what generateSql compiles
│   ├── src/compile/     # the compiler from delta's definitions, a module per kind of function (generateSql runs them all)
│   ├── src/cli/         # the bin (index.ts): dzql model (model.ts, model-tools.ts), then the Postgres commands
│   ├── examples/<app>/  # the examples: cafe (the worked one, shipped beside the skills), chat, leave, starter, ticker, wedding
│   ├── examples/delta/  # delta's Postgres examples: todos-vs-rls, sites-bbox
│   ├── .claude/skills/  # modelling (someone telling the stories), dzql-app (building an app on dzql/rendering)
│   ├── bench/           # delta's bench (bun run bench), todo #25
│   └── tests/           # modelling/ (its page/ too), rendering/, readme/ (bun run test:coverage, scripts/tests.ts);
│                        #   compile/, delta/, delta-pg/ (bun run test:pg: the compiler, delta's cases on Postgres)
└── create-dzql/         # bun create dzql: the starter (examples/starter) as an app, tests/ makes one and starts it
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
  no upgrade scheme of dzql's own.
- **The Postgres step imports nothing of modelling or rendering**, and they nothing of it: an app on
  SQLite uses `dzql/rendering` with no Postgres, and one on Postgres uses `dzql/postgres` with no page.
  What dzql was before delta (its own client and runtime) is in CHANGELOG.md; nothing of it comes back.

## Modelling and rendering

What a change to them must not break. How the pieces work is in the skills; the types in
`src/modelling/` and `src/rendering/` are the contract.

- Someone telling you the stories, there to answer: the **modelling** skill. Building or extending an
  app or an example, or touching the `Resource` contract, an app's `delta.ts`, the applet
  registry or the wire: the **dzql-app** skill. Documents: delta's **delta-doc** skill.
- **Stories first.** `docs/stories.md` is what it is for. An app's `stories.ts` says who does
  what and who then sees it; everything else follows. Start a feature with its story, watch it fail,
  build the least that makes it pass. Build nothing no story needs.
- **The shape.** `src/rendering` and `src/modelling` never import from `examples/` (their tests
  may). `examples/<name>/` is a whole app with a `routes.ts` exporting `app: Example` and serving it,
  importing dzql as an app does (`dzql/rendering/...`); examples never import from each other.
  `examples/starter/` is laid out as `bun create dzql` makes an app (routes and resources); the
  kernel finds any of them by `appIn` (`src/rendering/names.ts`).
  `src/modelling/page/` is the model's page, an app dzql ships (`dzql model` serves it); its `loader/` reads an app that exists.
- railroad only in `src/rendering/applet.ts`; the examples add `lucide`; the kernel imports no icon set.
- Documents are delta's: rendering owns people and pages, delta owns documents, their ledger and
  their one stream of changes. A **resource** owns one `docType` (the server side; the server draws the page) and has no place on the page; a
  place on the page is a **cell**, in the bento's **tray**; the visitor's own document is the **session**.
- **The wire.** HTML is the only vocabulary: no node or JSON tree on the wire or in the client. A
  write names a document (`<docType>:<docId>`) and a JSON Pointer path, never a function. A
  connection is told about, and may write, only what its page read. The server is the only renderer;
  the client morphs, never replaces `innerHTML`, never descends into a `[data-applet]`. After a
  write each page that read the document gets only its changed parts. Every change is told from
  delta's one stream. A change to what the wire carries bumps `WIRE`.
- **Pages.** A page's shape comes from its stories; the bento (`docs/bento/README.md`) is how to
  check it. Say a thing once.
- Verify every bug fix by reverting it, watching its test fail, then restoring it.

## Testing

- **Modelling and rendering** (no Docker): `bun check`, `bun run test:coverage` (the default
  `bunfig.toml`: 100% coverage, the client's too, read from Chrome), `bun run stories:all`,
  `bun run costs --check`. The browser tests need Chrome (the dzql-app skill's *Tests*).
- **The Postgres step**: `cd packages/dzql && bun run test:pg` (`tests/bunfig.toml`)
- Tests run against Docker PostgreSQL (see `packages/dzql/compose.yml`)
- `tests/compile/` runs on PGlite with no Docker (it is in the fast tier); `tests/delta/` mostly does, but its write cases and link store need the Postgres server too, so it runs in `test:pg`
- The test script handles Docker lifecycle: starts fresh, runs tests, tears down. It removes the
  database as it starts and ends, so **never run it while another run is going** (a person's, a
  session's): each wipes the other's database, and both fail

**Test-Driven Development:** Write tests first. Add failing tests for new features or bugs, then implement until they pass. This ensures the feature works and prevents regressions.

**End-to-End Verification:** Before publishing, always test in a real app. Unit tests passing does not guarantee the feature works end-to-end. create-dzql's test is the first check: a fresh app type-checks, passes its tests and starts.

### Testing the create-dzql Template

`create-dzql` makes the starter an app: `template/` (its package.json, tsconfig, README) and
`examples/starter` copied into `src/` (packed as `starter/` by `prepack`, read where it lives in
the repository). `bun run --cwd packages/create-dzql test:fast` makes one in a temporary folder with
the workspace's packages linked in, and checks it type-checks, passes its own tests, and starts on
delta's one server (the page, drawn over the socket, and `/health`). By hand:

```bash
cd "$(mktemp -d)"
bun <this repository>/packages/create-dzql/cli.ts dzql-test-app
cd dzql-test-app
ln -s <this repository>/node_modules node_modules   # the workspace's dzql and delta, not npm's
bun check && bun test && bun dev
```

Against a delta not yet on npm (the template names its next version), link it too: `bun link` in
delta, and `"@blueshed/delta": "link:@blueshed/delta"` in the app. A linked delta brings its own
railroad, and two copies of railroad break the page ("A second copy of @blueshed/railroad has
loaded" in the console; signals don't cross copies). Make it one: `rm -rf node_modules/@blueshed/railroad &&
ln -s <delta>/node_modules/@blueshed/railroad node_modules/@blueshed/railroad` in the app.

### Cleanup

```bash
cd packages/dzql && bun unlink
```

## Publishing

Not a step of a plan: finish every stage first, then release once, on Peter's word. Across
packages, test by linking or packing (above), never by publishing.

The monorepo's `/publish` (the root's `.claude/commands/publish.md`, dzql's row in its table), only
on Peter's explicit word: the gate, the create-dzql end-to-end check, one version for both
packages, the changelog and ledger promoted, and the tags `dzql@x.y.z` and `create-dzql@x.y.z`,
whose push is what publishes (GitHub Actions, OIDC trusted publishing). Never `npm publish` by hand.

## Listen to the User

If the user tells you something, do it. Don't revert to old patterns. Don't publish without permission. Don't claim tests prove functionality when they don't.
