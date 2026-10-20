# Changelog

What changed across the repository: where the packages came from and how they are worked on
together. Each package's own `CHANGELOG.md` has its detail; `todo.jsonl` beside this file is
what is open across them. Newest first.

## [Unreleased]

### delta keeps three stores and its kinds (20 October, #37, delta's part)

- **The free-form document is gone** (`registerDoc`, breaking): a document is kept in the JSON
  file, SQLite or dzql's Postgres, each with a schema, or it is a kind. railroad's realtime
  reference and paintbrush's evaluations now show the JSON file's `registerDocs`. Two exports
  nothing used go with it: `normalizeForBroadcast` and the named snapshots (`createSnapshot`,
  `resolveSnapshot`). delta's CHANGELOG says how to move across.

### The Bun, the hook and the root's statements, said once (20 October)

- **/publish moves the sibling ranges `scripts/ranges.ts` names** (#78), rather than a list kept by
  hand; railroad's CLAUDE.md gives its release gate as its two tiers, as `publish.yml` runs them.
- **One way to install a package's skills** (#100, #101): `delta install-skills`, which delta's
  `prepare` now is too; railroad's README teaches it; the starters' words point at the one list.
- **paintbrush's leave-behind list, once** (#109): `UNCOPIED`, read by create-blueshed's copy and pack.
- **delta-doc's recipe draws with railroad, and its SKILL.md is under 600 words** (#30).
- **sites-bbox once** (#62): dzql's Postgres server of it runs over delta's schema, and its test over
  delta's story.
- **A new app's skills, again on every install; one copy of the template** (#68): paintbrush's
  setup gives the app `prepare`, as create-dzql's has; `copyTemplate` copies and packs it, and
  the evolve test makes its apps with create-blueshed.
- **The plans of 19 October, done, are the record** (#70): `docs/history/`.
- **One way to start a store on Postgres** (#108): dzql's `openStore`, which now serves on a socket
  too, is what every snippet teaches.
- **The changelog and ledger rules, once** (#106): in the root CLAUDE.md; railroad's and delta's
  point at it. **The gate, named** (#98): each CLAUDE.md names its scripts, never their contents.
- **A value someone may change is stored** (#39): delta-doc's and evolve's rule against storing what
  is worked out says its limit.

- **One Bun, said in one place** (#97): the root's `packageManager`. `scripts/ranges.ts`, in the
  gate, holds each package's `@types/bun` and a new app's `packageManager` to it, and each README's
  "Bun x or later" to its own package's floor (`engines.bun`: railroad's is lower, on purpose).
- **One session-start hook** (#99): paintbrush's, which a new app ships with; the root's runs it.
- **What the root says, true again** (#86, #87, #88): which packages keep a CLAUDE.md, CHANGELOG and
  todo; CI is `ci.yml`; the root `package.json` without scripts and fields nothing used, and the old
  compiler's `dist/` gone; no doc names a path on Peter's Mac as its authority.

- **`bun create dzql` installs and makes the first commit, as `bun create blueshed` does**
  (19 October): it copied files and stopped. It runs `bun install` (which installs the skills) and
  commits, with the same `--no-install`, `--no-git` and `--local`, and the same rules: no repository
  without git, or inside one already.

- **`bun create blueshed` with no git, or inside a repository** (19 October): Bun's `spawnSync`
  throws on a program it cannot find, so on a machine with no git the starter died at `git init`,
  after copying and installing, and paintbrush's setup died before doing anything. Both ask for git
  first (`Bun.which`): without it the app is made and the starter says no repository was. Inside an
  existing repository (an app made in a monorepo) it makes none of its own either, and says so.

### The shape of a package, said once

The plan's shape is done (`docs/plan.md`, steps 1 to 6): railroad's and delta's code in `src/`,
dzql's tests out of `src/` and its model's page into it, the starters alike, one app shape. The root
CLAUDE.md says it (*The shape of a package*), and each package's CLAUDE.md points there.

### The starters alike; one `model` script; one app shape

An app from `bun create dzql` is laid out as one from `bun create blueshed`: `stories.ts` at its root,
its tests in `tests/`, a `CHANGELOG.md` and `todo.jsonl` to start its memory, and its own CI
(paintbrush's, without the template's evolve step). dzql finds the stories in either place
(`storiesIn`), so a prototype and a performance app look alike from the first day.

Both starters are `cli.ts` (create-dzql's was `index.ts`), and both refuse a folder that exists and
a name that is not lower case and dashes, in the same words (only create-dzql checked the name). A
new app from either has one `model` script, `dzql model` by dzql's bin, where it had `model` and
`cli:model`, the same command reaching into `node_modules/dzql/src`.

- **The root `tsconfig.json` is a config, not an error** (19 October, Zed's report): it said
  `"files": []`, which TypeScript refuses (TS18002). It checks the root's own `scripts/` now, which
  nothing checked before, and `bun run affected` runs it beside the docs and ranges checks; each
  package's `include` still replaces it.

### One CI workflow; each release through its package's own gate

On Peter's word (19 October). The seven per-package workflows, whose path filters were a hand copy
of the dependency graph and had drifted, are one: `.github/workflows/ci.yml` runs `bun
scripts/affected.ts --slow`, the graph the Mac's gate uses (`affected.ts` takes `--base <commit>`).
CI stays paused: `ci.yml` runs only when started by hand, and says how to unpause. `publish.yml`
releases a package through its own `test:fast` and `test:slow`, so a create-dzql release runs
create-dzql's end-to-end test (it ran dzql's Postgres suite instead); create-blueshed's `test:slow`
is paintbrush's, which it packs. Bun, the install and Chrome are one composite action,
`.github/actions/setup`, and Bun's version is read from `packageManager` in the root package.json.

### The ledgers sorted

Every `todo.jsonl` read through (19 October, Peter: "ones that affect more than one package are
raised to root, and make sure they are consistent and correct"). The root keeps what is open across
packages: 36 items that were one package's alone moved to that package's ledger, each noting its
root number (`docs/history/review-2026-10-19.md` lists where), and two of paintbrush's that are not
paintbrush's (duckdown's bun-create entry, shinko) came up to the root. Each item has the same eight
fields, in order; severities are low, medium or high; paths name where the files are now. Delta's two
fixed items, released in 1.3.0, left its ledger, and `/publish` settles every ledger alike: each
package's at its release, the root's once a round (it said so only of dzql's). #74 (paintbrush's old
scaffolding) is fixed. Then every open item was checked against the code: settled are root #16 (branches
pruned across the Mac), #17 (CLAUDE.md says which package and skill), paintbrush #13 and dzql #76
(/publish stamps dzql's skills); not to be done are root #19 (llms.txt), #111 (shinko) and #112
(duckdown's own), and dzql #30 (by design); the cafe's orders will name the dish and read its price
as it stood (dzql #52, on Peter's rule).

### The review's four bugs

A read-only DRY/YAGNI/KISS review of the whole repository (its findings, in the order they are done,
in `docs/plan.md`) found four bugs, fixed first: `bun run affected` ran a part of dzql's fast tier
chosen by path, and missed both ways (each package now runs its whole fast tier); importing
`dzql/modelling` made a `db.sqlite`; `dzql serve` failed in every app `bun create dzql` makes (it
goes); and a new paintbrush app kept the template's name and a broken `test:slow`.

### ref

The first feature after the plan: in a dzql model a field may name a row of a list document by its
path (`dish:menu:/items`, kept as `dish_id`). dzql's CHANGELOG has the detail. Then the right thing over the least: every table
the model makes keeps its history (delta's default, which the model had turned off), so a ref never
dangles and an order reads the menu as it stood when it was made.

### The DRY sweep's three breakages

A sweep for things said in more than one place found three copies that had drifted far enough to
break: create-dzql's own `dzql ^0.13.0` (and `@blueshed/delta ^1.2.0`) no longer took the
workspace's 0.14.0, so its tests ran against npm's dzql 0.13.0 (now `^0.14.0` and `^1.3.0`, and
`scripts/ranges.ts`, run by `bun run affected` beside the docs check, fails any sibling range that
leaves out the workspace's version); the sites-bbox README named a server and a script that are not
there (now delta's `server.ts` and `bun run test:setup`); and delta's CLAUDE.md gave a by-hand run
of the session hook without the two variables it needs. The hook's header points at railroad's
CLAUDE.md, where its section is.

### Released 19 October

railroad 0.17.0, delta 1.3.0, dzql 0.14.0, create-dzql 0.14.0 and create-blueshed 0.4.0, each
published from this repository by `publish.yml` with provenance (the first from here for railroad,
delta and create-blueshed, whose trusted publishers now stand). Two things the round found, fixed:
GitHub makes no event for a tag pushed with more than three others, so each release tag goes on its
own; and the publish job needed Bun for delta's `prepare` script.

### Changed

- **One look for both clients** (19 October, todo #51; `docs/client-plan.md`; Peter: "bento is
  not part of paintbrush - should it be?"). The bento's stylesheet is a frame whose every look
  decision is a token: the tray it had, and the plain look drawn for Paintbrush
  (`docs/bento/paintbrush/`), which both starters now use. dzql's `bento.ts` draws what that design
  has (a heading, runs, a row's own deed, pins, totals); paintbrush draws the same HTML with
  railroad (`src/resources/bento.tsx`, held to dzql's by a test), its page a box, and its evolve
  references draw with it. A prototype keeps its look as it grows: a page moves to the server by
  turning each handler into a write (packages/dzql/CHANGELOG.md, packages/paintbrush/CHANGELOG.md).
- **Every package publishes from this repository** (19 October): npm's trusted publisher for
  @blueshed/railroad, @blueshed/delta and create-blueshed is now blueshed/dzql's `publish.yml`
  (allowed: npm publish), in place of blueshed/railroad, blueshed/delta and blueshed/invoket, as
  dzql and create-dzql already were (todo #14). Each is pending until its first publish, which
  npm wants by 21 October or the publisher is made again (todo #50).
- **One shape for a starter: routes and resources** (18 October): `bun create dzql` now lays an
  app out as paintbrush does, `src/routes.ts` and `src/resources/<name>/`, the server-drawn page
  among its routes (packages/dzql/CHANGELOG.md). One starter for both is the next step, once this
  one has run a cafe.

### Added

- **The thin client on Postgres** (19 October): `bun create dzql` and the cafe keep their documents
  in Postgres, PGlite in the process or a server at `DATABASE_URL`, through dzql's `openStore`
  (packages/dzql/CHANGELOG.md). create-dzql's template takes `@electric-sql/pglite` and `pg`.

- **dzql's worked example: the cafe, from its model** (18 October): `packages/dzql/examples/cafe`,
  told, made and built as routes and resources, read back with no gaps; the skills point at it.
- **dzql's tools agree** (18 October): one reading of a model (`dzql/modelling/reading`) taken by
  the checks, the proof, the guards and the read-back, and a conformance test that runs the proof
  through the guards over fixture models; a document can list every row of its root (`menu:`); a
  guard's refusal is the story's words alone; the newest migration is rewritten in place until it
  is committed (packages/dzql/CHANGELOG.md).
- **Sign-in by link everywhere** (18 October): dzql's `signInLinks` (`dzql/rendering/links`) is
  how any app's people come in, the model's page included; the eta-app skill, first-app.md and
  create-dzql's starter say so, passwords only when a story asks (packages/dzql/CHANGELOG.md).
- **The model is a file, checked, then made into types, migrations and tests** (18 October, a
  modelling session with Peter on a cafe): the model is `model.json`, which the page edits;
  `dzql model` runs hjeli's six, Easy's coverage and derive-ux's playability after every change,
  and while none is open writes into `model/` (never the app's `src/`) `types.ts`, `guards.ts`,
  its next migration and a proof on SQLite. dzql's rendering composes routes and resources and
  owns no server; the model is a route mounted only by `dzql serve <app> --model`; sign-in is by
  link; and three reviews and a fresh app's run made it usable before a third cafe
  (packages/dzql/CHANGELOG.md; create-dzql's template follows).
- dzql: hjeli's three that `dzql model` lacked, each over the model's file, proven on leave's model
  told through the MCP server to a running page. `dzql model guards` writes the guarded write layer
  (`dzql/modelling/guards`: who, what, the document, the row, and what a story `requires`, checked in
  front of any of delta's stores by `guardWrites`; a `cannot` story is the refusal's reason), and only
  once the six registers are closed. `dzql model site` writes the model as one static page a customer
  reads. `dzql model mcp` serves every model verb as an MCP tool over stdio. Paused here, on Peter's
  word of 18 October (one thread at a time), to resume on top of the Mac session's `dzql model`.
- **What dzql and eta lost, found and put back** (18 October): `docs/inventory.md` lists every
  feature of eta 62c2d36, dzql 3611d0c and hjeli, run old and new. hjeli's six registers run on the
  model's page as it is told, with `dzql model audit`; the session-id guard is back where the cookie
  is the session (packages/dzql/CHANGELOG.md).

### Fixed

- **docs/ tells one story** (17 October, Peter: "is our docs folder telling a consistent story?").
  Every record of a past plan, request or review opens by saying it is a record, with a link to
  the root README's *How an app is made*. The guidance pages say what the code does now: eta's
  first app quotes chat's documents as they are (messages scoped by room, `-` for a new row,
  `session: sessions.of`); the bento's places on the page are cells again (the rename to resource
  had reached them); Postgres serves on delta's one server (`serve`) and cites the paths its
  example and tests moved to; dzql paths are written from the root. An applet is said one way
  everywhere: the piece of a page with state of its own, an island when written with railroad.
- **The skills teach `owns` as a path, and a part as going where its whole goes** (17 October,
  Shed run 3's two "partly" must-nots). Run 3 wrote `owns: (me, name) => name === "member:" + me.id`,
  near enough the line delta-doc's sign-in page showed (`owns: (me, name) => name === \`mine:${me.id}\``);
  its ownership page led with a function and said a list could take no path. Now delta-doc's
  `ownership.md` leads with paths in their shapes (one's own, a group's through its memberships,
  a list for some people, anyone signed in), says rows hang under what decides who sees them, and
  keeps a function for what no path can say; its sign-in and SQLite pages register by path.
  delta's permission cases gain the list for some people (a path that starts at a table), asked
  of SQLite, the JSON file and PGlite. A part under its whole is already lent only with it: the
  skills now say so (a write names the whole), and how rows become parts in a migration. No API
  changed. No skill page uses the Shed's nouns any more (the eval holds its example out):
  delta-doc's recompute example is a hotel's desk.

- **Two bugs found by the code review** (17 October): a person's id on Postgres sign-in overflowed
  past 2^31 (dzql); a session's own echo dropped any value equal to its id, so session 3 joining
  room "3" was told an empty room (dzql/rendering). Each has a test that failed before. railroad's
  `waitIn` no longer waits forever under `setSystemTime`.

### Added

- **dzql says three things, each standing alone** (17 October, Peter: "install dzql and use
  rendering", "install dzql and use modelling for json, sqlite or postgres", "install dzql and we
  can compile a postgres server"). dzql's README opens with each: a file, the commands, and a test
  that runs them as written. Modelling now ends in delta's definitions (`dzql model export`,
  `dzql/modelling/definitions`), which delta's JSON file, SQLite and dzql's Postgres all take, so it
  no longer needs a page the server draws; `dzql serve` and `dzql model` start the page and the
  model's page from any project. Detail in packages/dzql/CHANGELOG.md.

### Changed

- **One front door, saying what it offers** (17 October, Peter: start on one front door, remove
  nothing without discussion). `bun create blueshed my-app` gives an app whose README is the offer and
  shows it in the app's own code, with the model's page and the modelling skill that only
  `bun create dzql` had. Nothing was removed; create-blueshed's test makes such an app and starts
  its model page.
- **An app's documents are a schema and a `defineDoc` from its first document** (17 October,
  Peter: go with the judgement that the documents you model are the app's documents from the first
  story). paintbrush's `message` and the evolve skill's notes and order are on delta's JSON file
  (`@blueshed/delta/json`); moving to SQLite or Postgres changes the import and carries the rows,
  and the page stays the same. Two delta bugs found on the way are fixed in delta (a write of
  `[null]` answered 500; an empty write saved the JSON file).
- **The code reads more simply, used exactly as before** (17 October, Peter: "We are trying to be
  understandable and consistent"). The review is `/mnt/project-files/code-review/`. delta's SQLite
  `registerDocs` is split into `sqlite/write.ts` and `sqlite/walk.ts`, and its 3,000-line path
  cases into a file per feature; `install-skills` has a file of its own. eta's story harness
  `run()` is a short sequence of named steps, and reads JSON Pointers with delta's `splitPath` /
  `joinPath`. delta's schema-contract and migrate tests are cases in `./testing`, which dzql asks of
  Postgres instead of keeping copies. No export, name or file an app uses has moved.
- **The vision is said once** (17 October, Peter: "cleanup the vision ... kiss clean dry and
  yagni. It is all there!"). The root README's *How an app is made* is the one statement: stories
  first, documents not entities, what grows is where they're kept, routes and resources on both
  sides joined by documents, two ways to draw the page, small enough for an AI to hold. delta's,
  dzql's, paintbrush's and railroad's READMEs say only their own part and link to it. Gone, as
  unbuilt or superseded: `docs/dzql/philo.md` (its patterns were never built; its one principle,
  Claude writes the compiler and is never the compiler, is in the root README),
  `docs/delta/peared-plan.md` (proposed, not started), `docs/stories-plan.md` (superseded).
  `docs/README.md` separates guidance from the record (plans and requests, all built, kept because
  code comments cite them); `least-resistance.md` says what is built in the present tense.
  create-blueshed's README says `--local` needs `bun install` at the checkout's root.
- **One namespace for document kinds** (17 October, Peter's word, todo #10): eta's resources use
  delta's kind names (`memory`, `source`, `static`; stored when omitted), and eta's `fact` is a
  stored document with `undoable: false`. Breaking for an app; how to move across is in
  `packages/dzql/CHANGELOG.md`. The skills and docs follow from the concept review.
- **The gate covers what a change reaches** (17 October): `bun run affected` runs create-blueshed
  when paintbrush changes (a package that packs a sibling depends on it), and paintbrush's CI runs
  on a change to dzql's modelling and runs create-blueshed's tests. Root scripts
  `test:create-blueshed`, `test:create-dzql`. The docs say the shape once: routes and resources on
  both sides of the socket, joined by documents, entities behind them (root README, delta, railroad,
  dzql, paintbrush; `/mnt/project-files/concepts-review/metaphor.md`), and document kinds in delta's
  one namespace (stored, memory, source, static).
- **eta's screens are URLs the server routes** (17 October, Peter's choice: server-drawn, with
  URLs). A tab opened at a screen's URL is drawn on that screen first time (`Example.address`;
  detail in `packages/dzql/CHANGELOG.md`). Browser tests ran here on a staged Chromium; run them
  on Peter's Mac too (`bun run affected --slow`).
- **eta's examples are on numbered ids** (17 October, todo #11), so they can move onto dzql's
  Postgres. Every row is named by its table's serial; no example names a row with text. Breaking
  for a dev database made before this: delete it (`data/` or `DB_PATH`), and the seed makes it
  again; leave's own upgrade (`examples/leave/upgrade/004-numbered.ts`) carries its tables across.
  Detail in `packages/dzql/CHANGELOG.md`. Run only the fast tier and the stories here (a cloud
  container, no Docker, no Chrome of its own): **the browser and Postgres tiers still need a run on
  Peter's Mac** (`bun run affected --slow`).
- **The skills an agent builds from say what the code does** (17 October, from
  /mnt/project-files/concepts-review/alignment.md). bun-route and delta-doc add a route to delta's
  `serve`, never a `Bun.serve` of the app's own; eta-app and modelling describe a `bun create dzql`
  project, which now gets its skills on `bun install` and the model's page (`bun run model`);
  delta's `install-skills` follows a workspace's linked packages.
- **What the Shed's run 2 tripped on is fixed at its source** (17 October). delta: a unique
  constraint in the schema, on every backend (#81); a migration's `up` takes `nextId`, so no app
  writes `_delta_sequences`; whether a tool is out is worked out by a recompute document, never
  stored (#79). dzql: unique indexes in `generateSql` and `migrate`, `nextId` from `seq_<table>`,
  and a test pinning that a replace is an UPDATE (the fix itself, dzql #43, is in its unreleased
  changes). The skills an app reads (delta-doc, paintbrush's evolve) say a line is a row, a fact
  from rows is worked out, "one at a time" is `unique`, and show an `owns` path through
  memberships. Run on PGlite here; dzql's Postgres server suite and paintbrush's `test:evolve` were green
  on Peter's Mac after (#25). (packages/delta, packages/dzql, packages/paintbrush CHANGELOG.md)
- **eta's compartment is now a resource** (Peter's word, the concept review): the server side of a
  resource, as paintbrush's resources are. `Compartment` is `Resource`, `src/rendering/compartments/`
  is `src/rendering/resources/` (`resource.ts`), each example's `compartments` is its `resources`,
  the eta-app skill's `compartment.md` is `resource.md`, everywhere in code, tests, docs and skills
  (not in changelogs or history). The modelling grammar's `resource` flag, a junction's fk to what
  a group is granted, is `reach`, so the word means one thing.
- **`bun create dzql my-app` makes eta's starter** (17 October), no longer a paintbrush app on
  Postgres: `src/` is dzql's `examples/starter` (its page, no stories or documents yet), run by
  dzql's `start.ts` on delta's one server (`bun dev`, `bun run start`, `bun run stop` is `delta
  stop`), so the app has no server or pid file of its own. Kept on SQLite once it has documents.
  `packages/create-dzql/tests/create.test.ts` makes a fresh app, type-checks it, runs its tests and
  starts it; CI's dzql-eta workflow runs it (`test:fast` in create-dzql, so `bun run affected` does
  too). The starter is copied in when create-dzql is packed, so the two never differ.
- **One repository: railroad, delta and dzql** (17 October). railroad and delta moved in as Bun
  workspaces with their history (`packages/railroad`, `packages/delta`); dzql and create-dzql moved
  to `packages/dzql` and `packages/create-dzql`. The repository keeps the name **blueshed/dzql**
  (not renamed to bluetools: npm's trusted publishing names this repository at the next release);
  every package's repository field, homepage and README links point here. One `bun.lock`, one CI
  workflow per package (`.github/workflows/<package>.yml`, run when it or a sibling it depends on
  changes), one `/publish`. Gates passed on Peter's Mac with Docker and Chrome: railroad 293,
  delta 1013, dzql 4558.
- **eta is in dzql: `dzql/modelling` and `dzql/rendering`** (17 October), with eta's history.
  Modelling is the stories, the harness that tells them, by hand in a browser, and the costs;
  rendering is pages the server draws (eta's kernel). One package, each part its own entry;
  railroad is an optional peer, needed only by an island. eta's examples are in
  `packages/dzql/examples/`, its skills in `packages/dzql/.claude/skills/`, its docs, changelog and
  ledger in `packages/dzql/docs/eta/`. eta's own `bun create` and `eta:update` retired: an app
  installs dzql. (packages/dzql/CHANGELOG.md)
- **Two test configurations in dzql**: `bunfig.toml` is eta's (100% coverage, the client's read
  from Chrome), and dzql's Postgres tests run with `tests/bunfig.toml`. CI's `dzql.yml` has an eta
  job; railroad's job that checked out eta's repository is gone.
- **The gate is `bun run affected`**: each package a change touches, and each that depends on one,
  runs its fast tier (a type check, the tests with no browser and no Postgres server): railroad
  1.4 s, delta 18 s, dzql 26 s, about 46 s for all three. The slow tier (browsers, Postgres, eta's
  stories and costs) is CI's and a release's (`--slow`). CI's eta job runs two workers with a
  longer wait, as a runner is slower than a Mac.
- **One server, in delta** (`@blueshed/delta/serve`): `serve()` serves an app's routes with delta's
  socket, `/health` and a 404; `run()` is the process around it (the pid file, `bun --hot`, the
  signals, closing what the resources opened); `delta stop` stops it. paintbrush, eta's `createServer` (`bun run start`/`stop` in dzql), delta's
  examples, the recipe and the skills are on it; no package writes a `Bun.serve` of its own. The
  create-dzql template is left as it is, as `bun create dzql` is to make eta's starter instead.

- **paintbrush is in, at `packages/paintbrush`**, with its history: the starting website, run and
  tested where it lives (`bun run test:paintbrush`). **`bun create blueshed my-app`** makes one:
  `packages/create-blueshed` is the small command (create-blueshed on npm, until now published from
  blueshed/invoket, where it ran `bun create blueshed/paintbrush`); publishing it copies paintbrush in.
  paintbrush keeps its ignores as `gitignore`, which setup dots, since npm drops a `.gitignore`. The
  READMEs say `bun create blueshed my-app`. blueshed/paintbrush and blueshed/invoket on GitHub are
  untouched, and `bun create blueshed/paintbrush` works until Peter archives it.
- Root scripts test each package from the top: `bun run test:railroad`, `test:delta`, `test:dzql`,
  `test:paintbrush` (the fast tier), and `:slow` beside each that has one; `bun run test` is every
  package's fast tier.

- **paintbrush is on delta's one server**: `src/server.ts` and `src/main.ts` became `src/routes.ts`,
  the app's routes and documents (`startServer` gives them to `serve`; run as the entry, `run` is the
  process). `bun run stop` is `delta stop`. The evolve skill's references and their test follow;
  in its home the evolve test installs the delta beside it, packed, since paintbrush needs what npm's
  delta does not have yet: **delta and dzql are released before create-blueshed** (dzql: `dzql/modelling`, todo #29).
- **Bun 1.4.3 and `bun check`**: every package.json says `engines.bun >=1.4.3` (railroad keeps its
  1.3.14 floor, which its CI proves), `@types/bun ^1.4.3`, the root `packageManager: bun@1.4.3`; the
  root's override of `@types/node` and railroad's `typescript` dev dependency are gone, and no
  script runs `tsc` (railroad's consumer check is `bun check` alone). `@types/node` stays only as
  what `bun-types` and `@types/pg` themselves depend on.
- **One `tsconfig.json` at the root**: what every package compiles with (strict, ESNext, bundler
  resolution, Bun's types); railroad's, delta's and dzql's extend it with only their JSX and files.
  paintbrush and create-dzql's template stand alone, since a new app leaves the repository. No
  shared `bunfig.toml`: Bun reads only the one where a command runs, and each package's differs
  (dzql's and paintbrush's coverage gates, railroad's happy-dom; delta has none).
- **One `docs/` at the root**, by package: `docs/railroad/` (why-railroad), `docs/dzql/` (philo.md;
  `modelling/stories.md`; `rendering/`, eta's docs and the bento; `postgres/`, delta on Postgres;
  `eta-history/`, eta's changelog and ledger), and across them `monorepo-plan.md` (moved in from
  Workshop/docs, a pointer left there) and `stories-as-code.md`. Each package's README, CHANGELOG,
  CLAUDE.md and skills stay where npm and `install-skills` find them; dzql no longer publishes
  `docs/delta`, and its README links to the docs on GitHub. `docs/README.md` is the index. From
  Workshop/docs, copied (the originals stay): the postgres split plan, the stories plan, the link
  sign-in and pears plans, eta's language, CSS review and modeller, document proofs, and the history.
- **CI runs less for a change** (a designer's review, applied): dzql's workflow is two,
  `dzql-postgres.yml` (the compiler and backend against Postgres) and `dzql-eta.yml` (modelling and
  rendering in a browser), each run only when its half, or what it stands on, changes; a railroad
  change runs `delta-railroad.yml`, only delta's five test files that load railroad, not all of
  delta; railroad's browser suite runs once, not twice; and railroad's oldest-Bun check (1.3.14)
  moved to the release workflow. (The TypeScript 5.9 check had already gone with `tsc`. The 27 SVG
  tag tests to collapse were not found in railroad's suite: its SVG tests are each a different case.)
- **A browser test kit in railroad**: `@blueshed/railroad/webview` (`browser`, `waitIn`, and the
  Bun.WebView rules), from paintbrush's `tests/browser.ts`, which keeps only its `refuseWrites`.
- **delta's `registerDoc` takes `accept`** (validation, and an empty write writes nothing), so
  paintbrush's `message-api.ts` is a type and one call.
- **Tests that help, not slow** (the CI design, `ci-design/design.md`, steps 1 to 4 and its four
  calls, taken on Peter's word): every workflow cancels a stale run on main (`concurrency`); delta's
  fast tier runs the law on one seed of 50 steps (CI keeps 3 of 200; a release, more); delta's client
  takes a first reconnect `backoff` (default 500 ms), so its tests wait 10 ms, not a second
  (client tests 8.2 s to 1.6 s); dzql's compile tests share one PGlite, its `public` schema made
  afresh for each file (9.5 s to 6.1 s); the path cases run once on PGlite (the duplicate
  `tests/delta/path-pglite.test.ts` is gone) and wait on what was heard, not a 100 ms beat (path
  and owns, about 15 s together); the framework matrices in `tests/compile/root` and `resolve`
  retired to one hand-picked probe row per kind (2,722 tests to 1,323, every kept answer the same);
  eta's 100% coverage guards the kernel, not the examples; in CI delta's path cases run on the
  Postgres server, PGlite keeping owns, permissions and the law; `test-budget.json` gives each
  package's fast tier its seconds, which `bun run affected` says when over, beside a note on any
  changed test that waits a fixed time; `stories:all` runs at a release, as `by-hand.test` tells
  them per push.
- **The root README** says what each package is now (create-blueshed and paintbrush among them),
  the gate and the per-package scripts, and where the changelog, todo, docs and rules are.
- **Stories as code** (docs/stories-as-code.md; Peter: option (b), and a story with no body is
  unproven): `story(name)` from `dzql/modelling/stories` is a sentence alone, which an app's tests
  tell, named from it; `untold(stories, sources)` names any no test tells. A `Stories` list keeps
  such stories in `unproven`, and the harness says them unproven, never failed. paintbrush's
  `stories.md` is `stories.ts`, each test that makes one true is named from it, and
  `tests/stories.test.ts` fails a story no test tells. So paintbrush pulls none of Postgres,
  **dzql's `pg`, `@electric-sql/pglite` and `jose` are optional peers**: an app at the Postgres step
  adds them (`bun add dzql pg @electric-sql/pglite`).
- eta's whole test run says each line of an example's client no page ran, without holding it to
  every line (the kernel's are held), as the CI design asked.
- **paintbrush's last two trims** (Peter: do both): setup installs the skills with delta's
  `install-skills --skip bun-route` (a new `--skip`), not copies of its own; the evolve skill's
  references link to delta-doc where they restated delta (fan-out, the ledger, migrations, sign-in,
  ownership, Postgres) and keep what is the app's own: the code `test:evolve` applies and runs.
- **The Shed runs on the packages as they are** (Peter: no release until a working, improved Shed;
  no debugging through npm): `create-blueshed --local` (or `BLUESHED_LOCAL=1`) makes the app with
  railroad, delta and dzql from the checkout, held by `overrides`. The eval's record gains a scorecard
  (tests, must-nots, minutes and lines a stage); run 2 is the baseline, its minutes and lines worked
  out from its commits. The Postgres step adds only `pg` and PGlite, since the app has dzql already.
- **The Shed, run 4** (`packages/paintbrush/evals/shed/runs/2026-10-17-run-4.md`), at b8953ac5 by
  the same driver: 31 of 31 stories told, 48.8 minutes (67), 2,942 lines (3,191). The kit is lent
  as a whole, and three of stage 5's four `owns` are paths (run 3: none). Not every must-not
  passes: stage 4 fails (the due date worked out in the page, not stored), and stage 5 is partly
  (a field's loans owned by a function; the list kept as JSON in a table the app writes over
  delta's internals). Its friction is todo #39 to #42.
- **The Shed, run 3** (`packages/paintbrush/evals/shed/runs/2026-10-17-run-3.md`), made with `--local`
  at 3b321038 and run by `evals/shed/driver/`: 31 of 31 stories told by a test (run 2: 8), stage 3's
  must-not passes (run 2 failed it), and run 2's friction is gone (out worked out, unique
  constraints, no delete-then-insert, no drift); 67 minutes (83), 3,191 lines (3,448). Stages 4 and 5
  are still partly: a kit lent together by the page, and `owns` as functions, not paths.

### Fixed

- **CI was red after eta came in, 17 October** (the workflows are paused on Peter's word, and stay so
  until he says): eta's by-hand stories had never run on Linux, where the phone-sized tab is Chrome,
  and a page left for `about:blank` waited in Chrome's back/forward cache with its socket open, so
  the server never heard the tab close: that tab's Chrome now keeps no such cache. paintbrush's
  evolve test installed npm's railroad, which has no `@blueshed/railroad/webview` yet: it installs
  the railroad and delta beside it, packed. Every workflow's steps were run on Linux in Docker
  (Chrome, a Postgres server) and on the Mac before the push.

### Removed

- `feedback.md`, on Peter's word: its findings are fixed and its tensions are in `todo.jsonl`.
- The empty `.agents/` and `.gemini/` folders on the Mac (made by a tool outside the repos on
  16 October), and `.gitignore` keeps them out.

### Reviewed

- `feedback.md` (a code review of dzql, 16 October): its five findings are fixed in dzql's
  `[Unreleased]` (no `_delta_docs` read when a write is told; a replace updates in place; no
  `./compile` export; names that fit Postgres; `bunx dzql` in the messages). Its three tensions
  stay open as design notes: fan-out cost inside the write, RLS derived from `owns` (dzql #19), and
  unbounded collections.
