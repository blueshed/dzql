# CLAUDE.md

The bluetools monorepo: railroad, delta, dzql (modelling, rendering and the Postgres step) and the
two starters, create-dzql (`bun create dzql`) and create-blueshed (`bun create blueshed`), as Bun
workspaces under `packages/`. Each starter holds its template, `template/`: the whole app a new one
is copied from, a workspace too (create-blueshed's is paintbrush, the starting website; create-dzql's
the starter). railroad, delta and dzql each have their own CLAUDE.md, CHANGELOG.md and todo.jsonl,
read when working in it; it is the authority for that package's contracts, gate and docs (dzql's
paths are written from this root). create-dzql is dzql's (released with it, one version, one
changelog). create-blueshed keeps its CHANGELOG.md, and its template, paintbrush, the CLAUDE.md and
todo.jsonl (the CLAUDE.md is a new app's too, its template notes marked). This file is only what is shared.

## What each document is for

This must be obvious, in every package (Peter, 19 October):

- **A README is for a person deciding whether to use it**: what it is, who it is for, the smallest
  example that shows it, and where to go next. Never a manual.
- **CLAUDE.md is your entry point**: what the package is for, which skill to load for which job,
  its rules, its gate. This file, then the package's own.
- **The skills, and their `reference/` pages, are the manual**: how to build with it, step by step.
  They ship with the package and are installed into an app.
- `docs/` goes deeper or keeps the record; CHANGELOG.md and todo.jsonl say what changed and what is
  open. Where two disagree, the code is right, then the skill; fix the other. `bun run affected`
  holds them to the code first: every link and every path a live doc names (`scripts/docs.ts`).

## Start light, grow into performance

`bun create blueshed` is paintbrush, the light one, for prototyping: railroad and delta, the page
drawn in the browser. `bun create dzql` is for performance: the thin client, with applets, its
documents compiled to Postgres. It is one path: a prototype grows into performance, its documents
delta's all along (the `evolve` skill takes its storage to Postgres).

## The layout

| Package | Depends on (in the workspace) | Fast, from the root | Slow (CI, a release) |
|---|---|---|---|
| `packages/railroad` | nothing | `bun run test:railroad` | `bun run test:railroad:slow`: the consumer type checks, the browser |
| `packages/delta` | railroad | `bun run test:delta` | `bun run test:delta:slow`: every law seed |
| `packages/dzql`, `packages/create-dzql` (its `template/`, the starter) | delta, railroad | `bun run test:dzql`, `bun run test:create-dzql` (the template's type check and tests, then a new app made and started) | `bun run test:dzql:slow`: Postgres in Docker, the rendering in a browser, the stories, the costs |
| `packages/create-blueshed` (its `template/`, paintbrush) | delta, railroad, dzql (the template's: `dzql/modelling`'s `story`) | `bun run test:create-blueshed` (its own, then the template's) | `bun run test:create-blueshed:slow`: the evolve skill applied |

- `bun install` runs at the root: one `bun.lock`, committed; CI installs with `--frozen-lockfile`.
  A sibling's version range resolves to its folder, so a change in railroad is what delta and dzql
  run against at once, with no release.
- **The gate is `bun run affected`** (`scripts/affected.ts`): each package a change touches, and
  each that depends on one, runs its fast tier (`test:fast`: a type check and the tests that need no
  browser and no Postgres server), well under a minute. Commit, push, go on: never wait for CI.
  The slow tier (`test:slow`: browsers, dzql's Postgres suite in Docker, dzql's stories and costs)
  runs in CI (`.github/workflows/ci.yml`: `bun scripts/affected.ts --slow`, the same graph, no path
  filters), and by `bun run affected --slow` before a release. A red CI is fixed at the next push.
  (CI is paused on Peter's word since 17 October: `ci.yml` runs only when started by hand, and its
  header says how to unpause it; until he says, the slow tier runs on his Mac. `Publish to npm`
  stays on, by his word on 19 October: it runs only on a release tag, through the package's own
  `test:fast` and `test:slow`.) Bun is pinned once, `packageManager` in the root `package.json`,
  which every workflow reads (`.github/actions/setup`).
  In every package `bun run test` is its fast tier; `test:slow` its slow one; dzql's Postgres suite
  in Docker is `test:pg`.
  A starter's template is part of its create package to `affected`: a file changed in either runs
  the package, whose tiers run the template's, and the template's dependencies are the package's
  (a change in dzql runs both starters).
- **What is going on** is `CHANGELOG.md` (what changed, across packages) and `todo.jsonl` (what is
  open across them) here, and each package's own pair beside its code: the changelog is where it
  has been, the ledger what is open now. Read both before starting, and keep them current together,
  as the work lands: what you find or leave open goes into `todo.jsonl`; what lands goes under
  `## [Unreleased]` (Keep a Changelog), breaking changes first, each with how to move across, and
  the item it settles becomes `fixed` (or `not fixed`, saying why) with a dated `note`. A release
  turns `[Unreleased]` into a version, and the settled items leave `todo.jsonl`. A line of
  `todo.jsonl` is one JSON object: `n`, `status` (open / fixed / not fixed), `severity`, `area`,
  `file`, `summary`, `detail`, and a dated `note` once worked on. Code comments cite only open items.
- Bun only, on the one the root package.json's `packageManager` names (CI reads it;
  `scripts/ranges.ts` holds each package's `@types/bun` to it, and each README's "or later" to its floor).

## The shape of a package

Every package is laid out one way, so one is read like another:

```
<package>/
  README.md CLAUDE.md CHANGELOG.md todo.jsonl package.json tsconfig.json
  src/        what ships: each public entry a file named in package.json's exports (files: src)
  tests/      what proves it, in folders after src/'s where there are many
  examples/   what runs, each with its README; src/ never imports them
  evals/      each shipped skill's evaluations (<skill>.json), and runs/, each run recorded
  .claude/skills/<name>/   the manual
```

A command is `src/cli.ts` (dzql's, three files, `src/cli/`); a starter's is `cli.ts`, beside the
`template/` it copies: the whole app a new one is, laid out as one, a workspace of its own
(`paintbrush`, `dzql-starter`) tested where it lives and published as it is. What a new app never
gets (what running the template makes, and what is about the template alone) is left out twice, by
the package's `files` as it packs and by `cli.ts` as it copies, each from one list. An app, as `bun create blueshed` and `bun create dzql` make it, is
`stories.ts`, `src/routes.ts`, `src/resources/<name>/` and `tests/`. Each package's CLAUDE.md says
only what is its own.

**A skill is tested as code is.** Code by its tests, deterministic, on every change; a skill by
its evaluations: a fresh session given only the skill, its work checked against what each
scenario expects. Every skill a package ships has them, `evals/<skill>.json`, a few scenarios
each aimed at a trap the skill exists to prevent (`scripts/docs.ts` fails the gate on a skill
without). The answer is a rate, not a pass, so a run is recorded (`evals/runs/<date>-<skill>.md`:
the model, each scenario's lines held or not) and a change is measured against the last. They run
when a skill changes in substance, and before its package is released (`/publish`).

**A package's examples are its skill's worked answers** (Peter, 20 October). Each is an app in the
one shape (routes and resources), with a README, run as written by its package's tests. Each
reference page says where its rules are shown working, in a line starting `Working:`: an example,
the test that runs the page as written, or `none` and why (`scripts/docs.ts` fails the gate on a
page without). A skill links an example on GitHub, since examples do not ship. Where an example
only looks right because a rule dodges a trap in the API, the API changes: an item for Peter, not
more words in the skill.

## Releasing

**The law of this repo: nothing is released without Peter's explicit say-so.** Never a version
bump, a tag, a pushed tag, a change to a workflow on GitHub (enabling one included) or a setting on
npm, unless Peter has said so in so many words for that release. We do not debug in npm or on
GitHub: if a publish run fails, stop and report it to Peter, with the run's URL and its error, and
change nothing there (no fix pushed to a tag, no tag moved or pushed again) until he says.

`/publish` (`.claude/commands/publish.md`, a row per package: its gate, its end-to-end check, the
skills it stamps): one round, the packages named, a tag `<package>@x.y.z` each, which `.github/workflows/publish.yml` publishes to npm. Only when Peter
asks. Each package keeps its own version (create-dzql dzql's; a template none: it is its starter's);
railroad, delta, dzql and create-blueshed their `CHANGELOG.md` (`## [Unreleased]` written as work
lands), and railroad, delta, dzql and create-blueshed's template their `todo.jsonl`.

## Working here

Work on `main`; no pull requests. Two sessions never write in one checkout: a second writer uses a
worktree. `.claude/hooks/session-start.sh` provisions the Claude Code web sandbox (Bun, `bun
install`, a headless Chromium for the browser tests); its comments say how.
