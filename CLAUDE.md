# CLAUDE.md

The bluetools monorepo: railroad, delta, dzql (modelling, rendering and the Postgres step), create-dzql, paintbrush (the starting website) and create-blueshed (`bun create blueshed`, which copies paintbrush) as Bun workspaces under
`packages/`. railroad, delta, dzql and paintbrush each have their own CLAUDE.md, CHANGELOG.md and
todo.jsonl, read when working in it; it is the authority for that package's contracts, gate and docs
(dzql's paths are written from this root). The two starters have none: create-dzql is dzql's (released
with it, one version) and create-blueshed paintbrush's (a copy of it). This file is only what is shared.

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
| `packages/dzql`, `packages/create-dzql` | delta, railroad | `bun run test:dzql`, `bun run test:create-dzql` | `bun run test:dzql:slow`: Postgres in Docker, the rendering in a browser, the stories, the costs |
| `packages/paintbrush` | delta, railroad, dzql (`dzql/modelling`'s `story`) | `bun run test:paintbrush` | `bun run test:paintbrush:slow`: the evolve skill applied |
| `packages/create-blueshed` | paintbrush (it packs a copy) | `bun run test:create-blueshed` | none |

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
  A package that packs a sibling's folder (`prepack`: create-blueshed copies paintbrush) runs
  when that sibling changes.
- **What is going on** is `CHANGELOG.md` (what changed, across packages) and `todo.jsonl` (what is
  open across them) here; keep both current with every change, as each package keeps its own.
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
  evals/      the skills' evaluations, where a package has them
  .claude/skills/<name>/   the manual
```

A command is `src/cli.ts` (dzql's, three files, `src/cli/`); a starter's is `cli.ts`, beside the
`template/` it copies. An app, as `bun create blueshed` and `bun create dzql` make it, is
`stories.ts`, `src/routes.ts`, `src/resources/<name>/` and `tests/`. Each package's CLAUDE.md says
only what is its own.

## Releasing

**The law of this repo: nothing is released without Peter's explicit say-so.** Never a version
bump, a tag, a pushed tag, a change to a workflow on GitHub (enabling one included) or a setting on
npm, unless Peter has said so in so many words for that release. We do not debug in npm or on
GitHub: if a publish run fails, stop and report it to Peter, with the run's URL and its error, and
change nothing there (no fix pushed to a tag, no tag moved or pushed again) until he says.

`/publish` (`.claude/commands/publish.md`, a row per package: its gate, its end-to-end check, the
skills it stamps): one round, the packages named, a tag `<package>@x.y.z` each, which `.github/workflows/publish.yml` publishes to npm. Only when Peter
asks. Each package keeps its own version (create-dzql dzql's); railroad, delta, dzql and paintbrush
their `CHANGELOG.md` (`## [Unreleased]` written as work lands) and `todo.jsonl`.

## Working here

Work on `main`; no pull requests. Two sessions never write in one checkout: a second writer uses a
worktree. `.claude/hooks/session-start.sh` provisions the Claude Code web sandbox (Bun, `bun
install`, a headless Chromium for the browser tests); its comments say how.
