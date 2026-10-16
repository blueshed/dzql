# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **The Shed, a held-out example for the evolve skill** (`evals/shed/`). An allotment society's tool
  library, told as stories in five stages: one shared document, two on a page, rows shared and
  undo, a change on a database holding loans, and two servers on dzql with each member seeing
  their own. It appears in no skill or reference. A fresh session is given only a stage's
  stories (`stories.md`); `expected.md` holds the behaviour, the structure and what must not be
  done, for each stage. The cafe stays the skill's worked example.

### Changed

- **delta 1.0, and the Postgres step is dzql's.** `@blueshed/delta` is `^1.0.0`: delta keeps the
  documents on a JSON file and SQLite, and Postgres moved to dzql, delta's Postgres. The `evolve`
  skill's Postgres step (`references/postgres.md`) adds `dzql` and imports `dzql/postgres` and
  `dzql/pglite`; its schema, documents, page and tests are as they were, and `test:evolve` runs it.

### Added

- **The evolve skill's migrations step** (`references/migrations.md`), on delta 0.14.0's
  `migrate`: when a resource's schema changes on a database that holds data. The schema is the
  contract; a column it adds needs no migration (`migrateSchema` adds it), and a migration is for
  what a schema cannot say. Version two of the order counts an item: its migration,
  `src/resources/order/migrations/001-one-line-per-item.ts`, folds an order's lines of one item
  into one line with its `quantity`, and `orderDocs` runs `migrate` (with the resource's name as
  `app`, and its schema) from `fromFolder`, before `createTables` and `migrateSchema`. Its test makes
  the database as version one left it, starts version two on it, and checks the order came
  through and that a second start runs nothing (`migrationStatus`); the kitchen's test, on a new
  folder, is the other side. `test:evolve` runs it, and the skill's evaluations have a scenario
  for it.

### Changed

- **delta 0.16.0.** The template's documents and tests are unchanged on it (0.16.0 adds only
  `@blueshed/delta/backend`, for dzql). The evolve skill's SQLite step runs `migrateSchema`
  after `createTables`, so a column a later version declares is added to a table made before
  it, and says what a holder is told since delta 0.13.0: a row that stays is told the fields
  that changed (`replace /lines/1/item`), not the whole row, and the kitchen's test now checks
  exactly that with `onOps` (on SQLite, and on PGlite in the Postgres step). Its testing step says
  that delta's case suite in `@blueshed/delta/testing` (0.15.0) is for a backend of one's own,
  dzql for Postgres, not for an app. The Postgres step is as it was: it moves to dzql in a later
  step of the Postgres split.

- **The evolve skill is cut to a compass.** `SKILL.md` holds the mental model, the order of work,
  the invariants and where the types are; `references.md` is now a file per step under
  `references/` (`document`, `testing`, `two-documents`, `sqlite`, `postgres`, `http`, `build`),
  each leading with its example and ending with its gotchas, one line each. `tests/evolve.ts`
  applies each file in place of each section, and fails if a reference file is not in its list.
  The order page's test no longer repeats the refused change (the notes test has it), and the
  closing line about eta leaves the skill.

### Fixed

- **A slow browser start no longer fails the page tests after it** (todo #13). On CI's Chrome the
  first navigation could take a page test past its 30 s, and the tests after it failed on "a
  navigation is already pending" (the delta 1.0 PR, 15 October; GitHub mailed it before the re-run
  passed). `browser()` in `tests/browser.ts` now:
  - makes the first navigation itself, in a `beforeAll` with two minutes of its own, so a cold
    start is not charged to a test;
  - takes navigations one at a time, each after the last has settled, so a test cut off while its
    page loads leaves the next test a page to wait for.

  No test file changes, and nor does any `evolve` reference. Proven with a scratch test whose server
  holds the first page past a test's time: without the change it fails as CI did, with it it passes;
  and, holding a test's page past its time, the test after it passes with the change and fails on
  the pending navigation without it.

## [0.7.0] - 2026-10-12

### Added

- **A test that proves the evolve skill** (`bun run test:evolve`, and a CI step; not part of
  `bun test`). For each section of the skill's references it makes a new app from the template,
  applies the section's code blocks (each names its file on its first line) and its `bun add`
  lines, after those of the sections it builds on, and runs `bun run typecheck` and `bun test` at
  100%. It is about the template, so setup deletes `tests/evolve.ts`, its script and its CI
  step from a new app. Its first run found that `[ws.path]` as a route key
  widened every route's params to `string`, which broke a typed route such as
  `/api/files/:name`: the socket's route is the literal `"/ws"`.
- **Tests for what a person sees and clicks that had none:** the status line with `DATA_PATH`
  set ("mounted volume"), an `<Icon label>` read out as an image (on a small page in `tests/`,
  since the app has no icon on its own yet), Cmd+Enter in the message box, and the "home" link
  on a page that is not found. And a test that `bun dev` serves with hot reload: it starts
  `bun --hot src/main.ts`, saves a source file, and checks that `main.ts` ran again in the same
  process without taking its own pid file for another server.

### Changed

- **delta 0.13.0.** The template's documents and tests are unchanged on it (the message box
  still keeps typing that is not saved). The evolve skill's Postgres step gives the listener its
  document types (`createDocListener(ws, pool, { types })`; `registerDocType` is gone), so it
  now runs inside the app: `orderDocs` keeps the same schema and documents in PGlite, in `pg/`
  in the data folder, and the order's page tests and the kitchen's, undo included, run on it as
  they did on SQLite. The separate in-memory `createLocal()` test is gone. `tests/evolve.ts`
  takes `DELTA_SPEC` (`@blueshed/delta@<tarball>`) to try a delta that is not on npm yet.
- **`startServer()` answers `{ url, port, stop, close }`, not Bun's server.** `stop(force?)`
  stops serving, then closes what a resource opened: one that opens a database pushes its close
  onto `closing` in `server.ts`. `main.ts` stops on SIGTERM and SIGINT, and closes before `bun
  --hot` runs it again. In the evolve skill's Postgres step `orderDocs` answers its close (the
  listener, then the PGlite pool), so a server stopped and started again on the same folder
  carries on: without it Postgres recovered the folder as after a crash and the next id was 34,
  not 2 (`tests/order-pg.test.ts` there). The skill's code blocks can say `in place of <text>`.
- No `typescript` dependency: `bun check` type checks with Bun's built-in TypeScript 7, so tsc
  isn't needed. Bun 1.4.3 or later, as before.

- **The message is a delta document from the start**, because it is shared communication. The
  server registers it with delta's `registerDoc` (still `message.json` in the data folder, now
  `{ "text": ... }`) on the app's one WebSocket; the page opens it with `openDoc` and changes it
  with `message.send([{ op: "replace", path: "/text", value }])`, never locally, so every open
  window follows and the page reconnects and reopens it by itself. `GET` and `PUT /api/message`
  and the app's own `/ws` handler are gone, `startServer` is `async`, and a change that is not a
  replace of `/text` with a string is refused with delta's 400 (an empty one is taken, and
  nothing is written). `status` stays an HTTP route: it
  is not communication. `@blueshed/delta` ^0.12.0 is a dependency, and setup copies its
  `delta-doc` skill into a new app beside railroad's.
- **The evolve skill grows the app by its documents and where they're kept.** It starts from
  the concept in the owner's words (documents are how people communicate; think in documents,
  not entities; what grows is where they're kept), and its references have a section per task,
  each with code and tests: a new document (notes, made the way `message` is), two documents on
  one page (a catalogue and an order), storing documents in SQLite (the kitchen, a document over
  every order's rows, and undo with `{ ledger: true }`), Postgres (PGlite in this process, then a
  server, pointing at delta-doc's reference), HTTP routes for what isn't communication (health,
  status, files in S3), and a production build. The old steps (HTTP routes, then a WebSocket
  push, then a delta document) and their table are gone, and so is pushing changes over the
  WebSocket: a document already does it. eta is one line, marked as private and not run here. The skill's evaluations in
  `evals/` follow it.
- **README.md and CLAUDE.md open with what the app is:** documents are how people communicate,
  and what grows is where they're kept. CLAUDE.md's "Start small" framing gives way to how the
  app grows; its record-keeping and rules stay, with one for delta's documents. "What is here"
  lists the files as they are now, `tests/message.test.ts` and `tests/browser.ts` among them, and
  a new app's README says the same in short.
- **Ctrl+Enter saves the message too**, as Cmd+Enter does: Linux and Windows have no Cmd key.
- **Each resource's tests are in a file of their own.** `tests/message.test.ts` has the message
  document and its view; `tests/site.test.ts` keeps the status, the page's shell and the entry
  point, with the Bun.WebView rules at its top. The page helpers (`open`, `waitFor`,
  `replaceText`, `failFetch`, `refuseWrites`, `withOtherWindow`) are in `tests/browser.ts`, one
  WebView per file. The `evolve` skill's references point there, and eta is one line there,
  marked as private and not run or tested here.

### Fixed

- **What CI does for the browser tests is said right:** it gets Bun from setup-bun and sets up
  the runner's Chrome; it is the web sandbox's hook that installs both.
- **Two reasons in the docs were wrong, and are now what is true.** A `Bun.file(path)` keeps the
  size it first saw (Bun 1.4.3): after `Bun.write` changes the file, `exists()` turns true but
  `.json()` reads only that many bytes, so one that found no file reads nothing and throws (a
  test pins it). And the delta step removes railroad's `bun-route` skill because it scaffolds a
  bare project and keeps hot reload on, where this app turns it off in production; it no longer
  mentions Playwright.
- **The README promises only what is here.** It no longer names eta and shinko as what comes
  next (the `evolve` skill keeps them, marked as outside this app). It says what is proven of the
  web sandbox hook: a test shows it does nothing outside the sandbox; the install there is not
  tested. `CLAUDE.md` says the same.

## [0.6.0] - 2026-10-11

### Added

- A new app's changelog names the paintbrush version it came from ("Started from paintbrush
  0.5.0"), with a link to this changelog: an app has no link back to the template, so updating
  one means reading what changed since that version and carrying across what applies. Found
  when limakilo, made from the template that morning, needed `/release` and had no record of
  which paintbrush it came from.

### Changed

- **railroad 0.16.0.** It drops only the deprecated async route handler that resolves to a
  bare `Promise<Node>` (none here), fixes several disposal cases, and ships a leaner skill, which
  setup copies into a new app.

- The evolve skill has three evaluations in `evals/` (a page, a live push, a shared document),
  which setup deletes from a new app with the rest of what is about the template. Its references'
  contents list links each section. Setup's reason for leaving out railroad's `bun-route` is the
  real one: it scaffolds a bare project with `bun init`, and an app grows through evolve.

- **`bun run typecheck` is `bun check`**, Bun's own type check (TypeScript 7), in place of
  `tsc --noEmit`: the same errors, from one command Bun already has. It needs Bun 1.4.3, so
  `packageManager` (which CI reads) is `bun@1.4.3` and `engines.bun` is `>=1.4.3`. The script
  keeps its name: one called `check` would hide Bun's built-in `bun check`.
- **The `evolve` skill's delta step is run again, on Bun 1.4.3 with railroad 0.16.0 and delta
  0.12.0** (16 tests at 100%; the SQLite and S3 sections too, 26). Its code still works as
  written; its words are corrected. `message.data` is a read-only signal, which only
  `message.send` changes (delta 0.12.0 types it so). `install-skills` also brings railroad's
  `bun-route` skill, which the app was made without (it runs `bun init` and suggests
  Playwright), so the step removes it again. Dropping `failed` drops its `when()` too.
- `/release` checks first that there is a remote to push to, and says how to add one if not. An
  app made by `bun create` has none until someone adds it (limakilo had none), and the release
  would otherwise fail at the push, after the commit and the tag.

## [0.5.0] - 2026-10-03

Paintbrush is again what it was for: routes and resources, with railroad for the page and
Railway for the deploy, that a resource can evolve from. It follows the Bun website conventions
(a small core, tests at 100%), so this release moves nearly everything. It is 0.5.0, after 0.2.4:
the tags `v0.3.0` and `v0.4.0` were taken in February by the framework this replaced, so this
is the first free version.

### Breaking (for apps started from 0.2.x)

- **delta is no longer in the box.** A resource starts as HTTP routes: `GET`/`PUT /api/message`
  and `GET /api/status`, each with a fetching store. `/ws`, `registerDoc`, `registerMethod` and
  `call("status")` are gone, with the imports of `@blueshed/railroad/delta-client` and
  `delta-server`, which railroad removed in 0.7. A resource evolves to a WebSocket and then to a
  delta document: the `evolve` skill has each step, with its tests.
- **Everything is under `src/`.** `src/server.ts` lists the routes and exports `startServer()`,
  `src/main.ts` is the entry point (`dev` is `bun --hot src/main.ts`), and resources are in
  `src/resources/`.
- **`GET /api/status` no longer says where the data is.** It answers `persistent`, `uptime` and
  `bun`; it used to send the server's absolute data path to any client.
- **The default message is "Hello", the heading is "Message", and there is no favicon.** The
  template's name and logo no longer end up in an app.
- **Removed:** the Dockerfile, `@railway/cli`, `feather-icons`, the `/sample` style guide page
  and the `/add-resource` skill (its references pointed at files that no longer existed).

### Changed

- **`CHANGELOG.md` and `todo.jsonl` are named as a pair.** They are the project's memory between
  sessions: the changelog is where it has been, the ledger what is open now. `CLAUDE.md` says to
  read both before starting, and that they move together as work lands: an entry under
  `[Unreleased]`, and the item it settles marked fixed with a dated note. A new app's README and
  the `evolve` skill's checklist say the same. The docs had described the two files apart, and
  an agent that read `CLAUDE.md` took them as separate housekeeping.
- **Bun comes first.** The README and `CLAUDE.md` open with Bun as the server of routes and
  resources, with a WebSocket, SQLite and S3 built in; railroad and Railway come after, as the
  way on.
- **`message` pushes over a WebSocket.** `/ws` is the app's one socket. Each socket subscribes to
  the `message` topic, and `PUT /api/message` publishes what it saved with `server.publish`, so
  every open page follows. The view keeps typing that has not been saved. The store opens the
  socket again when it closes, and loads the message again in case a save was missed. A
  resource without a push (`status`) is still plain HTTP.
- **The `evolve` skill starts from the new app.** Step 2 (a WebSocket) is now what `message`
  does, so the skill describes it instead of giving an echo socket. Step 3 (delta) removes the
  app's `/ws` along with the message routes, and its tests are rewritten for that. It was
  applied to a scratch copy and run: 15 site tests pass at 100%, three runs.
- **`CLAUDE.md` holds what every session needs, and the skill holds the how.** `CLAUDE.md` is
  44 lines of what is here and the rules, and sends adding or changing a resource to the
  `evolve` skill. The skill's `SKILL.md` is the ladder, a workflow and a list of sections. Its
  `references.md`, read only when needed, has a table of contents and one section per task,
  each with code and tests: add a resource, push over the WebSocket, SQLite, S3, a delta
  document, eta, and an optional build.
- **No build.** A hello world runs from source: `bun run start` serves `src/main.ts` with hot
  reload off, and Bun bundles the page on its first request. The `build` and `serve:dist`
  scripts and the build test are gone, Railway runs `bun install` then `bun run start`, and
  `bun test` no longer leaves a `dist/` behind. A build is an optional section of the skill's
  references.
- railroad is `^0.15.1` (was `^0.6.1`); Bun is 1.4 or later; TypeScript 7.
- The rules sit next to what they describe: the design's at the top of `styles.css` (108 lines,
  from 268: only what the page uses), the browser-test rules at the top of the test file, the
  Railway rules at the top of `railway.ts`.

### Added

- **`/release`** (`.claude/commands/release.md`), in every new app. It checks (`main`, a clean
  tree, not behind, unreleased entries, the changelog and the ledger agreeing, a tag that is
  free), runs the typecheck and the tests, turns `[Unreleased]` into the version, takes the
  settled items out of `todo.jsonl`, bumps with `bun pm version --no-git-tag-version`, then
  commits, tags and pushes. With no argument it reports where things stand. Tried first in a
  scratch repo: `bun pm version` refuses any uncommitted change, and onto a tag that already
  exists it commits and then fails, so the command bumps only and tags itself, after checking
  the tag is free.
- A new app starts at version 0.0.0, not the template's, so its first `/release minor` makes
  0.1.0. Setup changes only the `version` line of `package.json`.
- **Icons are lucide, from the start.** `lucide` is a dependency, and `src/resources/icon.tsx` draws
  an icon as a real SVG node (`<Icon icon={Save} />`), sized by the text around it, hidden from
  screen readers beside a label and read out as `label` when alone. The Save button has one, and
  a browser test checks it. `CLAUDE.md` makes it the rule: lucide, through `<Icon>`, never
  another icon set or inline SVG.
- The `evolve` skill's references show how to use SQLite (`bun:sqlite`) and S3 (`Bun.s3`) as
  resources, with their handlers, their routes and their tests, including a stand-in S3 bucket of a few lines so tests
  need no real one. These are not in the box. Run on Bun 1.4.2 in a scratch copy: S3 against
  MinIO and against the stand-in, and the copy's whole suite at 100%.
- A pid file and `bun run stop`, so a server started in the background can be stopped.
- Tests, held at 100% coverage: every route and method with `fetch`, the page and what it does
  in a real browser (`Bun.WebView`), the entry point and pid file by spawning them, the
  production server running from source, and `create/setup.ts`. `bun run typecheck` checks the app, the tests,
  `create/` and `railway.ts`.
- The deploy in the box: `bun run start`, `/health`, and `.railway/railway.ts` with a volume for
  the data.
- The Claude Code web sandbox, whose Bun is older than this app needs and which has no browser:
  a SessionStart hook (railroad's, adapted) installs the latest Bun and a headless Chromium
  there, and does nothing anywhere else. A CI workflow runs the typecheck and the tests on
  GitHub, with Chrome.
- `create/setup.ts`, the template's `bun create` postinstall: a fresh `todo.jsonl` and
  `CHANGELOG.md`, the app's name, and railroad's skill in `.claude/skills` (not its `bun-route`
  skill, which tells a session to run `bun init` and use Playwright). It refuses to run in a
  clone of the template, and ends by leaving the new repository committed: bun create's own git
  step runs while the script does and can fail on a file the script has just deleted (found
  when a new app had no first commit). Run from GitHub on `main` after the merge, twice: both
  times bun create's git step failed that way and setup left one commit and a clean tree, and
  the new app's 17 tests pass at 100%.
- `todo.jsonl`, the ledger of open work, and a `.claude/launch.json` for the dev server.
- On npm: `create-blueshed` 0.3.0 (published from the invoket repo) runs `bun create
  blueshed/paintbrush`, so `bunx create-blueshed myapp`, `bun create blueshed myapp` and
  `npm create blueshed myapp` all make a paintbrush app. This repo itself is not an npm package.

### Fixed

- The `evolve` skill's step 3 view stopped following the other windows once it had saved
  itself: it took a new value only when the box still held what it last took from the document,
  and after a save the box held the saved text instead. It now also takes a value the box
  already holds. The bug showed when a test was added for it.

From the 24 Sep review of 0.2.4:

- The message view showed an empty box when you came back to `/`, because its effect ran before
  the textarea existed.
- A save from another window overwrote what you were typing.
- "Saved" appeared before the write had been answered, so a failed write still said it.
- A failed status call left the status area blank.
- `og:image` was a relative URL, which link-preview crawlers ignore; the tags are gone.
