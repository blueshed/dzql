# CLAUDE.md

The bluetools monorepo: railroad, delta, dzql and create-dzql as Bun workspaces under
`packages/`. Each package has its own CLAUDE.md, read when working in it; it is the authority for
that package's contracts, gate and docs (dzql's paths are written from this root). This file is
only what is shared.

## The layout

| Package | Depends on (in the workspace) | Gate, run in its folder |
|---|---|---|
| `packages/railroad` | nothing | `bun check && bun run check:consumer && bun test --coverage` |
| `packages/delta` | railroad | `bun run ci` |
| `packages/dzql`, `packages/create-dzql` | delta, railroad | `bun check && bun test tests/delta tests/compile` (no Docker); `bun run test` with Docker |

- `bun install` runs at the root: one `bun.lock`, committed; CI installs with `--frozen-lockfile`.
  A sibling's version range resolves to its folder, so a change in railroad is what delta and dzql
  run against at once, with no release.
- **Test what changed.** Run the gate of the package you changed and of each package that depends
  on it (the table), not every package. CI does the same: `.github/workflows/<package>.yml` runs
  when its package or a sibling it depends on changes.
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
