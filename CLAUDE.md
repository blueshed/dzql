# CLAUDE.md

The bluetools monorepo: railroad, delta, dzql (with eta's modelling and rendering), create-dzql, paintbrush (the starting website) and create-blueshed (`bun create blueshed`, which copies paintbrush) as Bun workspaces under
`packages/`. Each package has its own CLAUDE.md, read when working in it; it is the authority for
that package's contracts, gate and docs (dzql's paths are written from this root). This file is
only what is shared.

## The layout

| Package | Depends on (in the workspace) | Fast, from the root | Slow (CI, a release) |
|---|---|---|---|
| `packages/railroad` | nothing | `bun run test:railroad` | `bun run test:railroad:slow`: the consumer type checks, the browser |
| `packages/delta` | railroad | `bun run test:delta` | none: its whole suite is fast |
| `packages/dzql`, `packages/create-dzql` | delta, railroad | `bun run test:dzql` | `bun run test:dzql:slow`: Postgres in Docker, eta in a browser, the stories, the costs |
| `packages/paintbrush` | delta, railroad | `bun run test:paintbrush` | `bun run test:paintbrush:slow`: the evolve skill applied |

- `bun install` runs at the root: one `bun.lock`, committed; CI installs with `--frozen-lockfile`.
  A sibling's version range resolves to its folder, so a change in railroad is what delta and dzql
  run against at once, with no release.
- **The gate is `bun run affected`** (`scripts/affected.ts`): each package a change touches, and
  each that depends on one, runs its fast tier (`test:fast`: a type check and the tests that need no
  browser and no Postgres server), well under a minute. Commit, push, go on: never wait for CI.
  The slow tier (`test:slow`: browsers, dzql's Postgres suite in Docker, eta's stories and costs)
  runs in CI, path-filtered the same way (`.github/workflows/<package>.yml`), and by
  `bun run affected --slow` before a release. A red CI is fixed at the next push.
- **What is going on** is `CHANGELOG.md` (what changed, across packages) and `todo.jsonl` (what is
  open across them) here; keep both current with every change, as each package keeps its own.
- Bun only, pinned in CI to 1.4.3.

## Releasing

`/publish` (`.claude/commands/publish.md`): one round, the packages named, a tag
`<package>@x.y.z` each, which `.github/workflows/publish.yml` publishes to npm. Only when Peter
asks. Each package keeps its own version, its `CHANGELOG.md` (`## [Unreleased]` written as work
lands) and its `todo.jsonl`.

## Working here

Work on `main`; no pull requests. Two sessions never write in one checkout: a second writer uses a
worktree. `.claude/hooks/session-start.sh` provisions the Claude Code web sandbox (Bun, `bun
install`, a headless Chromium for the browser tests); its comments say how.
