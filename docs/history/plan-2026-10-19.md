# The plan: what the toolset is, before what it adds

19 October. Peter: "we have no stated plan for entry points or what they mean,
what is being published where, what skills we need or how we are going to document. So we need to
start there before we continue to add features."

Then: "you do not need my decisions" -- go ahead and clean it up. No feature work until it is done.
The `ref` field type was built and parked on the local branch `ref-wip` until this was done; it is on main now (19 October).

Each section is what existed on 19 October, then what was unclear. What is decided, and where each
step stands, is at the end.

## 1. Entry points: what someone types or imports

**To start an app** there are two commands for one idea:

| Command | Makes | Client |
|---|---|---|
| `bun create dzql` | the starter (`dzql/examples/starter`): routes, resources, the model's page in development | thin: the server draws the page (`dzql/rendering`) |
| `bun create blueshed` | paintbrush, copied: routes, resources, a railroad page | thick: the browser draws it |

**To import**, 37 entries:

| Package | Entries | Note |
|---|---|---|
| `@blueshed/railroad` | 9: `.`, signals, jsx, routes, shared, logger, webview, the JSX runtimes | each named |
| `@blueshed/delta` | 18: core, client, dom-ops, server, serve, sqlite, json, local, kinds, logger, auth, auth-link (+ client), migrations, paths, testing, backend | each named |
| `dzql` | 10, two of them wildcards: `dzql/rendering/*` and `dzql/modelling/*` open every file (36 files) | the cafe imports 17 different paths, among them `rendering/db`, `rendering/test-socket`, `rendering/json-patch` |

**To run**, three command lines and per-app scripts:

| CLI | Does |
|---|---|
| `delta` | open, watch, delta, call (a document from the terminal); migrate, migrations make; link; install-skills; stop |
| `dzql` | serve, model (and model check, site, guards, mcp); sql, init, migrate, link (Postgres) |
| an app's `bun run cli` (`dzql/rendering/cli.ts`) | login, inspect, watch, undo, redo, write, and the app's own verbs |

**Unclear:**
- Which `dzql` entries are the public API. With wildcards, every internal file is one, so nothing
  can be renamed without breaking someone, and the skills teach whatever path the examples happen to use.
- Two starters. Are they two products (thin and thick), or one starter with a choice?
- Commands that overlap: `delta migrate` and `dzql migrate`; `delta link` and `dzql link`; sign-in
  by link in `@blueshed/delta/auth-link`, `dzql/auth-link` and `dzql/rendering/links`.
- The model's page is an example (`examples/modeling`) that is also an entry point (`dzql/model`,
  `dzql model`), shipped inside `dzql`.
- The scripts: `test` means four different things across the packages (in dzql it starts Docker),
  and dzql lists its examples in four places.

## 2. What is published where

| Package | npm | Version (npm) | Since then on main |
|---|---|---|---|
| `@blueshed/railroad` | yes | 0.16.2 (11 Oct) | |
| `@blueshed/delta` | yes | 1.2.0 (16 Oct) | |
| `dzql` | yes | 0.13.0 (16 Oct) | a great deal (CHANGELOG `[Unreleased]`) |
| `create-dzql` | yes | 0.13.0 (16 Oct) | the starter's new layout |
| `create-blueshed` | yes | 0.3.0 (2 Oct) | |
| `paintbrush` | no (private; shipped as create-blueshed's template) | | `paintbrush` on npm is someone else's |

One repository, `blueshed/dzql`, tags `<package>@x.y.z`, published by GitHub Actions (paused since 17
October; the slow tier runs on the Mac). `dzql` ships two examples (`modeling`, `cafe`) and two
skills inside it.

**Unclear:**
- The repository is called `dzql` and holds five packages ("bluetools" in the README).
- `dzql` is unprefixed while the others are `@blueshed/`.
- Nothing has been released since 16 October, and a paintbrush app needs a dzql that npm doesn't
  have (todo #29).
- The old repositories (railroad, delta, eta, paintbrush, invoket) are not archived (#13), and npm's
  trusted publishing setup is unfinished (#14).
- What a release is for: each package on its own cadence, or the set together?

## 3. Skills

| Skill | Lives in | Ships with | For |
|---|---|---|---|
| `railroad`, `bun-route` | railroad | `@blueshed/railroad` | signals, JSX, routes; a route |
| `delta-doc` | delta | `@blueshed/delta` | documents, storage, the wire |
| `modelling` | dzql | `dzql` | taking the stories down on the model's page |
| `dzql-app` | dzql | `dzql` | building a server-drawn app |
| `evolve` | paintbrush | `create-blueshed`'s copy | growing a paintbrush app through stages |

`delta install-skills` copies every `@blueshed/*` skill, and those a project's `claudeSkills`
names, into `.claude/skills`.

**Unclear:**
- Nothing says which skill to load for what (#17, a router).
- `dzql-app` is named for a package that no longer exists (the suggestion was `dzql-app`).
- Two skills cover building an app, by client (`dzql-app`, `evolve`), with the documents in a third
  (`delta-doc`) and the stories in a fourth (`modelling`). Is that the set we want?
- How a skill stays true to the code. Today it's by hand, and the cafe runs found the drift.

## 4. Documentation

| Kind | Where |
|---|---|
| The vision, once | the root README, *How an app is made* |
| A package's own part | its README, CHANGELOG, CLAUDE.md (for an agent working on it), todo.jsonl |
| How to build | the skills (`.claude/skills/*/SKILL.md` and `reference/`) |
| Going deeper | `docs/<package>/` (guidance), beside `docs/history/` and the plans (the record) |
| Worked | `dzql/examples/cafe` (from a model), the older examples |
| What happened lately | `handover.md`, `docs/inventory.md`, `docs/dzql/feedback/` |

**Unclear:**
- Who each is for. A person using the toolset, an agent building an app, or someone working on
  the toolset read different things, and the same thing is said in several (`docs/dzql/rendering/first-app.md`
  and the dzql-app skill; `docs/stories.md` and both skills).
- Whether there is a site, or `llms.txt` (#19).

## Decided

1. **What the toolset is** (Peter): `bun create blueshed` is paintbrush, light, for prototyping:
   railroad and delta, the page drawn in the browser. `bun create dzql` is for performance: the
   thin client with applets, its documents compiled to Postgres. One path, not a choice made once:
   a prototype grows into performance, its documents delta's all along. *Done*: the root README
   and CLAUDE.md, each package's README, the dzql-app and evolve skills say so.
   *Open*: the evolve skill takes the storage to Postgres; moving the pages to the server (the
   thin client) is not yet written as a step of it, though since 19 October both clients draw one
   page, the bento in the plain look (`client-plan.md`), so that step is a handler turned into a
   write. *Done* (19 October): `bun create dzql`'s starter and the cafe keep their documents in
   Postgres -- PGlite in the process, or a server at `DATABASE_URL` -- through dzql's `openStore`.
2. **What each document is for** (Peter): a README is for a person deciding whether to use it;
   CLAUDE.md is Claude's entry point; the skills and their references are the manual. *Done*:
   stated in the root CLAUDE.md; delta's and dzql's CLAUDE.md open with it, as railroad's did;
   dzql's README is cut from a manual to what a person needs to decide, its examples still run as
   written; each README ends by pointing at the skills.
3. **The skills are named for what people install**: `eta-app` is `dzql-app`; what people read says
   dzql, not eta. Runtime names (`window.eta`, `.eta-session`, `ETA_URL`, `ETA_EXAMPLE`) are API and
   stay for now. *Done*.

## Doing next, in order

4. **dzql's public API**: *Done*. `exports` names 41 modules, no wildcards; eleven are dzql's own.
   `tests/readme/exports.test.ts` holds it. The overlaps were layers, not duplicates: `delta migrate`
   takes a JSON file or SQLite and hands a Postgres URL to `dzql migrate` (one command per store);
   sign-in by link is delta's protocol (`@blueshed/delta/auth-link`), its Postgres store
   (`dzql/auth-link`), and the thin client's links (`dzql/rendering/links`).
5. **The scripts**: *Done*. In every package `bun run test` is its fast tier and `test:slow` its slow
   one; dzql's Docker suite is `test:pg`; delta's `ci` is its `test:slow` (every law seed). dzql's
   examples are read from the folder once (`scripts/examples.ts`) by the test runs, the stories and
   the fast tier.
6. **The skills checked against the code**: *Done*. `scripts/docs.ts`, run first by `bun run
   affected` whatever changed: every link and every path a live README, CLAUDE.md, skill or doc
   names exists (a project's `src/` against the two starters). It found eight that did not, fixed.
   dzql's `tests/readme/exports.test.ts` holds every `dzql/...` import named to an export.
7. **The docs by reader**: *Done* (19 October, Peter: "since our plans are in git"). `docs/` keeps
   what goes deeper: the plan, the stories, the thin client and its costs, the bento, Postgres,
   railroad's reasons, and the lineage. Finished plans, change requests, reviews, the inventory,
   eta's old changelog and the cafe feedback are in git's history; `first-app.md`, which repeated
   the skill, is the cafe now.
8. **A release**: *Done* (19 October, on Peter's word): railroad 0.17.0, delta 1.3.0, dzql and
   create-dzql 0.14.0, create-blueshed 0.4.0, published from this repository by `publish.yml`.

Then features resume, `ref` first, each checked against this plan before it is built. *`ref`: done* (19 October): a field that names a row of a list document by its path (`dish:menu:/items`), checked, guarded and proved on every store, over tables that keep their history so it never dangles; dzql's CHANGELOG has it.

## The shape of each package (planned and done 19 October; the root CLAUDE.md says it now, *The shape of a package*)

Peter: "look at the shape of each package and determine the best and easiest to understand,
adopt and adapt each to use it." The three libraries were shaped three ways: railroad's code loose
at its root with tests beside it; delta's in `src/` with every test in `tests/`; dzql's in
`src/<part>/` with 26 tests beside the code, more in `tests/` and more in `readme/`. delta's is the
easiest to say in a line, so every library takes it:

```
<package>/
  README.md CLAUDE.md CHANGELOG.md todo.jsonl package.json tsconfig.json
  src/        what ships: each public entry a file, named in package.json's exports
  src/cli.ts  the command, where the package has one
  tests/      what proves it, in folders after src/'s where there are many
  examples/   what runs, each with its README; never imported by src/
  evals/      the skills' evaluations, where a package has them
  .claude/skills/<name>/   the manual
```

The rule each step holds: `src/` is what ships and nothing else does, so `files` in package.json
is `src` and the skills (and README, CHANGELOG, LICENSE); every public name in `exports` stays
the same, so no consumer notices. The review's findings about layout are folded in before step 1.

One package a step, in dependency order; each ends with `bun run affected` green (the docs check
catches every path a doc names), its CHANGELOG under `[Unreleased]`, its CLAUDE.md's layout section
said again, and a commit pushed. No release.

1. **railroad**: the loose `*.ts` at its root move to `src/` (index, signals, jsx, jsx-runtime,
   jsx-dev-runtime, routes, shared, logger, webview); `*.test.ts(x)` and `happy-dom.setup.ts` to
   `tests/`; `exports` and `files` point at `src/`; `bunfig.toml`'s preload and tsconfig's excludes
   follow. delta's and paintbrush's imports are by package name, so nothing outside moves.
2. **delta**: `cli.ts` to `src/cli.ts` (`bin`, `files`, CLAUDE.md's *Where the contracts live*);
   otherwise it is the shape already.
3. **dzql**: the 26 tests in `src/` move to `tests/<part>/` (modelling, rendering, postgres);
   `readme/` (the tests that hold the docs and the exports) to `tests/readme/`; `scripts/eta.ts`,
   `fast-eta.ts` and the `test:eta` scripts named for what they do now; `docs/delta`, `docs/eta`
   and stray `src/modelling/.model-*` folders (empty, left by tests) removed, and the test that
   leaves them fixed. **The model's page and its checks ship from `examples/modeling/`**: `dzql
   model` imports `examples/modeling/closure.ts`, `src/modelling/reading.ts` names it, and `files`
   publishes `examples/modeling` and `examples/cafe`. What ships moves into `src/modelling/` (the
   checks, the page's server), and `examples/modeling/` keeps only what is an example, or goes;
   `files` drops the examples. The bin is `src/cli.ts`.
4. **The starters**: create-dzql's `index.ts` becomes `cli.ts`, as create-blueshed's is; both
   copy a template the same way (`template/`, packed by `prepack`), and their READMEs and tests
   say it alike.
5. **paintbrush and dzql's starter**: paintbrush is an app, and its shape is the app's
   (`src/routes.ts`, `src/resources/<name>/`, `stories.ts`, `tests/`); `examples/starter` (what
   `bun create dzql` makes) takes it wherever the two still differ, so a prototype and a
   performance app look alike from the first day.
6. **The root**: CLAUDE.md's layout table and docs/plan.md say the shape once; each package's
   CLAUDE.md links there rather than repeating it.

## The DRY/YAGNI/KISS review (19 October), in the order it is done

A read-only review of every package against a75acb01; each finding checked against the code. Done
in this order, each a commit with the gate green; an item done is struck through here.

**First, what is broken today:**

1. *Done (19 October).* `scripts/affected.ts` splits dzql's fast tier in two, wrongly: `src/cli/` goes to the Postgres
   half though only modelling's tests exercise it, and `src/postgres/` never runs cafe or the
   starter. The split goes (`test:fast:eta`, `test:fast:pg`, the bunfig's coverage excludes, the
   names of empty `docs/eta`, `docs/delta`): dzql's whole fast tier is 26 s.
2. *Done (19 October).* Importing `dzql/modelling` makes a `db.sqlite` in the folder (`rendering/db.ts` opens it as it
   loads; `harness.ts` imports it). It opens in `sqliteStore()`; `hear`, `applyOp` and `HtmlOp` move
   to where rendering keeps them, so rendering no longer imports modelling; the workaround in
   `stories-run.ts` goes.
3. *Done (19 October).* `dzql serve` fails in every app `bun create dzql` makes (it imports `index.ts`), and nothing runs
   it: it goes.
4. *Done (19 October).* A new paintbrush app keeps the name "paintbrush", a `bun-create` entry to a file setup deleted,
   a `test:slow` that fails, and a `tsconfig` naming a missing folder; the scaffolding of `bun create
   blueshed/paintbrush` (the commit retries and their tests) goes. (The review called paintbrush's
   `.github/ci.yml` dead; it is a new app's CI, and stays.)

**Then the shape (above), which takes in:** dzql's model checks and page move out of `examples/`
into `src/modelling/`, and the 1,656-line copy of hjeli's checks under
`examples/modeling/loader/model/` goes (`model:check` runs `closureOf`); exports nothing imports
(`dzql/modelling/definitions`, `dzql/rendering/cli`, dzql/postgres's re-export of delta's auth);
eta's names and old paths in comments; the test configs said twice; the stale half of this file.

**Then what is said twice in code**, each to one place:

- the compiler's per-document dispatcher, written seven times, with three ways of an empty `CASE`
  (one `prefixDispatch` helper); `lit` and `WHOLE` defined twice;
- `validateOps`, a third copy of delta's write rules that nothing calls (delta gives the rules
  from `./backend`, or it goes);
- the stories harness restating the client's rules for controls, three times (one walk, by-hand's
  page script built from `form-value`); then `harness.ts` split by job;
- dzql's copies of delta's sites-bbox example and test helper (delta's `./testing` gives them);
- the server message typed five ways, the undo write built four ways, the session cookie read four
  ways (one `ServerMessage`, `walked`, `sessionFrom`);
- railroad's two browser-testing manuals (`webview.ts`'s header is the one); its realtime page,
  which restates delta's and dzql's; delta's server header and eval teaching `Bun.serve`; delta's
  CLAUDE.md file map;
- `/publish`'s hand list of sibling ranges (what `scripts/ranges.ts` reports) and its three
  statements of the gate (each row: `bun run test:slow`);
- skills installed two ways (paintbrush's by `prepare`, as create-dzql's), and the evolve test's
  template copy made as `create-blueshed` makes it.

**On Peter's word only (GitHub):** the workflows' path filters are a hand copy of the dependency
graph and have drifted; while CI is paused they become one workflow running `bun scripts/affected.ts
--slow`. `publish.yml` releases create-dzql through dzql's Postgres gate and never runs
create-dzql's own test.

**Open, to decide:** the cafe copies an item's name and price into each order rather than naming
the dish (dzql todo); `docs/client-plan.md` is finished but for one item, an evolve step that moves
a page to the server, which goes into paintbrush's `todo.jsonl` before the file goes.
