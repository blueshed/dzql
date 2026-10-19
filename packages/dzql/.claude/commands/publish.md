---
description: "Release a new version of dzql and create-dzql (patch | minor | major)."
argument-hint: "patch | minor | major"
---

# /publish: dzql's part

dzql's steps in the monorepo's release round. The root's `.claude/commands/publish.md`
runs steps 2 to 6 here for each package it releases, then makes one commit, a tag per package
(`dzql@x.y.z`) and one push for them all. Paths below are the root's. The bump level is
`$ARGUMENTS` (`patch`, `minor` or `major`).

| | |
|---|---|
| Packages | `dzql` (`packages/dzql`) and `create-dzql` (`packages/create-dzql`), one version for both |
| Published | npm, public, by `.github/workflows/publish.yml` on a pushed tag: `dzql@x.y.z`, `create-dzql@x.y.z` |
| Gate | `cd packages/dzql && bun check && bun run test:pg` (Docker; port 5433 free) |
| End to end | CLAUDE.md, *Testing the create-dzql Template*: a new app, linked to the local dzql, and its own tests |

Stop at the first failure without changing anything further. Releasing is not a step of a plan: it comes once every stage is done, on Peter's word. Running this
command is the authorisation to release -- carry it through to the end, the push included, without
asking again. Bun only (`bun check`, TypeScript 7, as the gate says), and never `npm publish` from here: CI does it.

## 1. Arguments

`$ARGUMENTS` must be exactly `patch`, `minor` or `major`; otherwise stop and print
`Usage: /publish patch|minor|major`.

## 2. Preflight

1. The branch is `main`: `git rev-parse --abbrev-ref HEAD`.
2. The working tree is clean: `git status --porcelain` prints nothing.
3. Not behind origin: `git fetch --quiet origin main`, then `git rev-list --count HEAD..origin/main`
   is `0`. Commits ahead of origin are fine -- they go out with the release in step 8.
4. `CHANGELOG.md` has a `## [Unreleased]` section with something under it. It is the record of
   what is shipping, written as the work landed; if it is missing or empty, stop and say so.
5. The two packages have the same `version`, and the template's `dzql` dependency
   (`packages/create-dzql/template/package.json`) is `^` it or the next version.

## 3. Gate

Run the gate command in the table. If it fails, stop -- no file has been edited yet.

## 4. End to end

`cd packages/create-dzql && bun run test:fast`: it makes a new app from the local template, with
the workspace's dzql and delta linked in for npm's, and checks it type-checks, passes its own
tests at 100% coverage (its stories included, on PGlite), and starts on delta's one server: the
page served and drawn over the socket, and `/health`. CLAUDE.md's *Testing the create-dzql
Template* is the same by hand. If any check fails, stop.

## 5. Bump

Parse `version` in `packages/dzql/package.json` as strict `x.y.z` (refuse anything else) and compute
the next: `patch` → `x.y.(z+1)`, `minor` → `x.(y+1).0`, `major` → `(x+1).0.0`. Write it to both
packages' `version`, and `^<new version>` to the template's `dzql` dependency, keeping the 2-space
indent and the trailing newline. Then `bun install`, so `bun.lock` names the new versions
(CI installs with `--frozen-lockfile`).

## 6. Promote the changelog and the ledger

In `CHANGELOG.md`, replace the line `## [Unreleased]` with `## [<new version>] - <today, YYYY-MM-DD>`,
and put a fresh, empty `## [Unreleased]` above it. In `todo.jsonl`, the settled items (`fixed`,
`not fixed`) leave; the open ones stay as they are.

## 7. Commit, tag, push

The root's `/publish` does it, for the whole round: one commit, the tag `dzql@<new version>`
beside the others, one push. The tag is what publishes (the root's `.github/workflows/publish.yml`).
