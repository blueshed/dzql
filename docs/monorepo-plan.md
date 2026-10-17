# bluetools: one repo for the lineage

> **A record.** Kept as it was written, for the history and the citations. How an app is made
> now is the root [README](../README.md#how-an-app-is-made); where this differs from the code, the code is
> right.

*15 October 2026, reviewed 16 October. A plan, not code: nothing in railroad, delta, dzql or eta
has been changed.
Peter agreed the shape in conversation: eta becomes a package beside dzql, railroad and delta move
in too, create-dzql comes back as the way to start an app, and the repo is called **bluetools**.
(The 16 October review proposes the starter be named `@blueshed/create-eta` instead: question 9.)
Written from each repo's package.json, CI and `/publish`, eta's `create/`, dzql's CLAUDE.md and
`docs/postgres-split-plan.md`. The stories plan (`stories-plan.md`) is reordered to match.*

## When: after the development slated now (16 October)

Peter, 16 October: **get all the development slated done, then address the monorepo.** The move
starts when these have landed in the repos as they are today, each with its own PRs and releases:

1. **dzql, the rest of 2c** (`postgres-split-plan.md`): `_delta_find_doc` compiled (the prefix
   lookup every write and read makes), the walk's own plan (`_delta_walk_plan`), the reads the
   framework still does for a document it did not compile; then **the framework SQL retires**
   (dzql todo #26), one breaking change, an app re-applying `generateSql` once.
2. **Step 3, `owns` as a path**: the grammar and its vectors in delta (a delta release), and dzql
   compiling a path into its reads and RLS.
3. **Step 5, dzql's whole-stack runtime retires**: `src/runtime`, `src/client`, the Pinia stores,
   the old create-dzql template; paintbrush's `evolve` gains the dzql step.
4. **delta#10** (the SQLite ledger's newest-first tip, the twin of dzql#35) merged, and released
   with delta's next significant change.
5. **The stories plan, steps 1 to 4**, in today's repos: the words and `storyCases` in delta
   (delta 1.1.0), eta's stories widening delta's, stories told against dzql's Postgres. They need
   no monorepo: a sibling's published version is enough.
6. **eta's work in flight**: the ETA plan session lands or closes its 13 unpushed commits and its
   worktrees. eta is released only on Peter's word.

dzql's question in step 0 ("its work in flight") is settled by item 1: when 2c is done and released,
the checkout is on a clean main.

## Review (16 October)

The shape is right for railroad, delta and dzql, and the 15 October work is the evidence:

- **The seam it closes is real.** dzql imports about 37 names from `@blueshed/delta/backend`,
  delta's server internals among them (`trackSubscribe`, `sendTo`, `socketCursor`,
  `createCustomDocs`, `runMigrations`). A delta change can break dzql today and nothing in delta's
  gate notices; in one workspace it is red in the same PR.
- **One bug, two PRs.** The undo that slowed as a cursor's ledger grew was fixed in dzql (#35) and
  needed a second session and PR for the same query in delta (delta#10). In one repo, one PR.
- **The alignment round goes** ("After each release" in the split plan), and with it most of the
  peer-range drift.

Four changes to the plan follow from the review. Each is written into the step it touches.

1. **The eta starter is not `create-dzql`.** `bun create dzql my-app` making an app with no dzql in
   it, on SQLite, is the confusion question 5 wrestles with. The starter is
   **`@blueshed/create-eta`**, run as `bun create @blueshed/eta my-app` (Bun resolves a scoped
   `create` to `@scope/create-<name>`). create-dzql retires with the whole-stack runtime, as Q11
   decided: deprecated on npm on Peter's word, its README pointing to the eta starter.
2. **paintbrush is a decision of its own, not a footnote.** "A new app starts on eta, paintbrush is
   side-stepped" chooses server-pushed pages over pages drawn in the browser as the way to start.
   paintbrush has the `evolve` skill (its references and their test) and canyou is on it. It is
   asked as its own question (below) before step 4, and the stories plan's paintbrush steps are
   dropped only once it is answered.
3. **A package is also tested against its siblings as published.** In a workspace dzql's tests run
   against delta's unreleased source, so a dzql release could depend on a delta change that is not
   on npm, and someone installing `dzql` with `@blueshed/delta@^1.0.0` would get a pair that never
   ran together. So: each package's CI has a second job that installs its siblings from npm at the
   lowest version its ranges allow and runs its gate; and the rule **release the sibling first**:
   a package whose change needs a sibling's unreleased change waits for that release, and its
   range moves up to it.
4. **CI is filtered per package from the first move.** dzql's job is 7 minutes with Postgres; eta's
   stories run in a browser. Each job runs when its folder, or a sibling it depends on, changes
   (`paths`), so a railroad PR does not pay for dzql's suite. Required checks are per package. A
   flaky browser test fails its own package's job, not every PR (paintbrush's slow-start fix,
   15 October, is the pattern for eta's).

And two smaller ones: **more sessions in one checkout** means worktrees become the habit for any
session that writes (two writers never in one checkout, as already practised); and **eta does not
hold up steps 0 to 2**: railroad and delta move as soon as the home is ready, eta when its session
has landed its work.

## What it is

`blueshed/dzql` renamed `blueshed/bluetools` (the name is free on GitHub; the old URL redirects),
holding the lineage as workspaces:

```
bluetools/
  packages/
    railroad/      @blueshed/railroad   the page's reactivity, and an eta island's
    delta/         @blueshed/delta      documents, the wire, the client, JSON and SQLite, the case suite, stories
    dzql/          dzql                 delta's compiled Postgres step
    eta/           @blueshed/eta        the server-pushed page, stories run, undo, the modeller
    create-eta/    @blueshed/create-eta `bun create @blueshed/eta my-app`: a new eta app, stories first
  package.json     "bluetools", private, workspaces packages/*
  CLAUDE.md        lean: the lineage, the layout, the one rule per package; each package keeps its own
  .github/         one CI (a job per package, filtered by paths; and each against its siblings as
                   published), one publish (by tag `<package>@x.y.z`)
  .claude/         /publish <package> <level>
```

**npm names do not change**, so nothing that installs them notices: canyou, debk, duckdown,
limakilo, medwyn, the websites, paintbrush (15 package.json files across Workshop). Each package
keeps its own version: railroad 0.16, delta 1.x, dzql 0.10 (or later: the slated work releases
first), eta 0.53 (published from now), and the eta starter, `@blueshed/create-eta`, on its own line.
create-dzql is not moved: it retires with dzql's whole-stack runtime (step 5 of the split plan).

**What it buys.** In one workspace each package uses its siblings' source: a delta change that
breaks dzql's cases (`tests/delta/`) or eta's stories is red in the same PR, not a release later.
No more peer ranges six minors wide (delta on railroad), no alignment round per release
(postgres-split-plan, *After each release*), one CI, one release command. A story can be told
against SQLite and dzql's Postgres in one run.

**eta is the page; railroad is its fallback.** A page is HTML pushed from the server and swapped
node by node; where client-side state would be destroyed by a render (a drag, a calendar, a map),
the piece is an island, a railroad component holding its document's ops (`src/island.ts`).
paintbrush, a whole page drawn by railroad, is side-stepped: it stays where it is, for canyou, and
is not the way an app starts.

## The moves, in order

Each move is one PR to bluetools, keeping the package's history. `git filter-repo` is not
installed; `brew install git-filter-repo`, then for each repo: a fresh clone, `git filter-repo
--to-subdirectory-filter packages/<name>`, and `git merge --allow-unrelated-histories` into
bluetools, so `git log packages/delta/src/core.ts` reaches back to its first commit. Old tags
(`v1.0.0`) stay on the old repos; new ones are `<package>@x.y.z`.

After each move the old repo is archived on GitHub with a README pointing to bluetools (Peter's
action, or on his word), and the local folder is removed once no session works in it.

### 0. The home (dzql, root files only)

- Rename the GitHub repo to bluetools; the local folder `~/Workshop/blueshed/dzql` to
  `~/Workshop/blueshed/bluetools`, once no session has it open.
- Root `package.json`: `"name": "bluetools"`, `workspaces: ["packages/*"]`.
- `.github/workflows/ci.yml`: a job per package, each run when its folder or a sibling it depends
  on changes (`paths`): dzql's as today (Postgres service); the others added by their move.
- `.github/workflows/publish.yml`: dzql's, generalised: a tag `<package>@x.y.z` publishes that
  package from `packages/<package>`, `npm publish --provenance` by trusted publishing.
- `.claude/commands/publish.md`: `/publish <package> <level>`, each package's gate and end-to-end
  check from its own `/publish` today.
- CLAUDE.md: the root lean (the lineage, the layout, how to run one package's gate); dzql's present
  CLAUDE.md moves to `packages/dzql/CLAUDE.md`.

- CI from the start: the per-package `paths` filter, and the job that runs a package's gate
  against its siblings as published (review, change 3).

**Waits on:** the slated development (above). On 16 October dzql's in-flight work was already
merged and released (0.10.0, main clean); what it waits for now is the rest of 2c, step 3 and step
5. **Release:** none.

### 1. railroad

Clean on main, no worktrees: the readiest. Its CI job: `bun check`, `bun run check:consumer`,
`bun test`, `bun test ./tests/webview.test.ts` (Chrome on CI, WebKit locally). Its `repository`
field gains `"directory": "packages/railroad"` (npm's provenance checks it against the repo).

**Waits on:** step 0; Peter moving `@blueshed/railroad`'s trusted publisher on npmjs.com to
`blueshed/bluetools`, `publish.yml` (account setting: his). **Release:** none of its own; the next
real change publishes from bluetools and proves the path (`npm publish --dry-run` in CI meanwhile).

### 2. delta

Its CI job is `bun run ci`. `prepare` copies railroad's skill from
`node_modules/@blueshed/railroad/.claude/skills/railroad`, which a workspace hoists to the root:
it reads `../railroad/.claude/skills/railroad` instead. dzql's `@blueshed/delta` (dev and peer,
`^1.0.0`) and delta's `@blueshed/railroad` resolve to their siblings.

**Waits on:** step 1 (railroad beside it); the `delta-migrate` worktree removed (merged in 0.14.0,
"can be removed" in the split plan); Peter moving `@blueshed/delta`'s trusted publisher.
**Release:** the stories' first steps (below) are its first from bluetools: **delta 1.1.0**.

### 3. eta, published as @blueshed/eta

`eta` on npm is someone else's (the embedded JS template engine), so `@blueshed/eta`. What changes:

- `package.json`: the name, `"private": false`, `files` (`src/` without tests; `examples/modeling`
  as the model page; `docs/dzql/modelling/stories.md`, the bento docs; the `eta-app` and `modelling` skills),
  and a `bin` (`eta dev | start | stories | cli | model | model:check`) in place of the scripts
  `create/eta.ts` writes into a project.
- `create/` goes: a project depends on `@blueshed/eta` instead of carrying an `eta/` folder, and
  `bun run eta:update` becomes `bun update @blueshed/eta`, with eta's CHANGELOG ("What to change"
  first) as today. What `create/setup.ts` does for a new project moves to the starter, `@blueshed/create-eta` (step 4).
- Imports in a project change from `eta/<module>` to `@blueshed/eta/<module>`: a breaking change,
  said in the CHANGELOG with what to change.
- eta gets CI for the first time (it has none): its job is `bun test --parallel` and
  `bun run stories:all`. It joins the required checks once it is green on CI's Chrome, not before.
- The examples (chat, wedding, ticker, leave, starter) stay in the package's folder, unpublished.

**Waits on:** the ETA plan session: main is 13 commits ahead of origin, and there are five agent
worktrees and a detached one (`delta-0-15-87ded1`). They land or close, and that session agrees the
move, before it starts; it may make the move itself. Steps 1 and 2 (its siblings in place).
**Release:** **@blueshed/eta 0.54.0**, its first on npm, on Peter's word (eta is released only on
his word).

### 4. @blueshed/create-eta, the way to start an app

*Revised 16 October: the starter is `@blueshed/create-eta`, not create-dzql (review, change 1).*
The postgres-split plan retires create-dzql's Vue, Pinia and whole-stack template in its step 5, and
Q11 stands: create-dzql is deprecated on npm when step 5 lands (on Peter's word), its README
pointing here. The way to start an eta app is a package named for what it makes.

**Waits also on** the paintbrush question (below): this step makes eta the way an app starts.

`bun create @blueshed/eta my-app` makes:

```
my-app/
  stories.ts       the first story, told by the git user's first name (eta's `teller`)
  src/             eta's starter: index.ts, page.ts, delta.ts (a createLocal, no schema yet), client/
  migrations/      empty, with its README
  .claude/skills/  eta-app, modelling (from @blueshed/eta), delta-doc, railroad (from theirs)
  CLAUDE.md, CHANGELOG.md (naming the eta it started from), todo.jsonl, .env (its model and the
  password the two who keep it share), .gitignore
  package.json     @blueshed/eta, @blueshed/delta, @blueshed/railroad; scripts that run `eta …`
```

then `bun install` and a first commit, as eta's `create/setup.ts` does today. **It starts on
SQLite** (storage path: json → sqlite → Postgres; the page stays the same as storage grows). dzql
is the step taken when servers share the data or people see only their own, documented in the
eta-app skill: the app's `delta.ts` registers dzql's backend on its `createLocal` in place of
delta's SQLite. One thing in eta ties it to SQLite still: the harness reads `delta_ledger` through
`bun:sqlite` (`src/harness.ts` `ledgerOf`, `src/db.ts`); reading it over the wire (`history`)
makes the dzql step work for stories too. That is eta's change, in its own time.

Its end-to-end check (replacing the old register-and-post check in CLAUDE.md and `/publish`): make
an app from the local packages linked, then `bun run stories` passes the starter's story, `bun
test` passes, `eta dev` serves the page.

**Waits on:** step 3 published, and the paintbrush question answered. dzql's step 5 is done
before the move (slated development, item 3). **Release:** **@blueshed/create-eta 0.1.0**, its
first, on Peter's word: it is outward-facing.

### 5. Those who follow

- **canyou-eta** (`"eta": "link:eta"`) and **debk** (`./vendor/eta-0.51.0.tgz`) move to
  `@blueshed/eta` and its imports.
- **paintbrush**: as the paintbrush question is answered (below). If eta is the way to start,
  paintbrush stays a repo of its own, not grown, canyou on it; if paintbrush stays a way to start,
  it moves in after eta, and its `evolve` references gain the eta step.
- Memory and docs that name the old paths (`repo-locations`, `eta-in-use`, `current-work.md`) are
  brought up to date as each move lands.

## The stories plan, reordered

`stories-plan.md`'s split stands (the document half in delta, the page half in eta); its order now
follows the moves:

| Stories step | Lands | With |
|---|---|---|
| 1. `@blueshed/delta/stories`: the words | delta, as it is today | before the move (slated development) |
| 2. `storyCases` / `tell` in `./testing`, proved on kanban and shared-state | delta | delta 1.1.0, before the move |
| 3. eta's `src/stories.ts` widens delta's; `from-stories` reads delta's types | eta | before the move, on eta's own release, on Peter's word |
| 4. Stories told against dzql's Postgres beside SQLite (delta's runner, dzql's `register`) | dzql | dzql's next release, before the move |
| 5. canyou's 46 stories in `stories.ts`, run by delta's runner | canyou | when canyou is picked up (it is on delta ^0.11) |

*Revised 16 October:* steps 1 to 4 need no monorepo (each uses its sibling's published version),
so they are part of the slated development and land before the move. paintbrush's steps (its
`stories.ts`, `tests/stories.test.ts`, its by-hand checker) wait on the paintbrush question: dropped
if a new app starts on eta, whose by-hand already covers an island through a story's `gesture`.

## Questions for Peter

1. **The order.** railroad, delta, eta, then the starter, by readiness (eta has the most in flight).
   Or eta first, so the create script comes soonest, waiting on the ETA plan session?
2. ~~**dzql's work in flight.**~~ *Settled 16 October: the move waits for the slated development
   (above), which takes dzql's 2c, step 3 and step 5 to done first.*
3. **Who moves eta.** The ETA plan session, which owns eta's main (recommended), or a session of its
   own once the ETA plan session has landed its work?
4. **eta's bin.** One command, `eta dev | stories | model …`, in place of the scripts a project
   carries today. Agree?
5. **The starter starts on SQLite**, with dzql as a later step. With the starter named
   `@blueshed/create-eta` (review, change 1) the name no longer promises Postgres. Or start on
   dzql's PGlite (Postgres in-process, no Docker), which needs eta's ledger read over the wire
   first?
6. **npm.** Trusted publishing for `@blueshed/railroad` and `@blueshed/delta` moved to bluetools,
   and `@blueshed/eta` set up there, on npmjs.com: yours to do, at move 1, 2 and 3.
7. **Archiving.** The old railroad, delta and eta repos archived on GitHub, each README pointing to
   bluetools, as each move lands?
8. *Answered 16 October: paintbrush stays a way to start. Peter's end-to-end test (The Shed,
   `paintbrush/evals/shed`) starts at paintbrush and evolves to dzql. Apps keep their stories
   (paintbrush todo #15).* **paintbrush** (review, change 2). Does a new app start on eta (pages pushed from the server,
   railroad for islands), with paintbrush kept for canyou and not grown? Or does paintbrush stay a
   way to start (pages drawn in the browser), moving into bluetools after eta, its `evolve`
   references gaining the eta step?
9. **The starter's name** (review, change 1). `@blueshed/create-eta` (`bun create @blueshed/eta
   my-app`), with create-dzql deprecated as Q11 decided?
