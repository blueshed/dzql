---
description: "Release a new version of @blueshed/delta (patch | minor | major)."
argument-hint: "patch | minor | major"
---

# /publish: delta's part

delta's steps in the monorepo's release round. The root's `.claude/commands/publish.md`
runs steps 2 to 6 here for each package it releases, then makes one commit, a tag per package
(`delta@x.y.z`) and one push for them all. Paths below are this package's folder's. The bump level is
`$ARGUMENTS` (`patch`, `minor` or `major`).

| | |
|---|---|
| Package | `@blueshed/delta` |
| Published | npm, public |
| Gate | `bun run ci` |
| Skills stamped with the version | `.claude/skills/delta-doc/SKILL.md` |

Stop at the first failure without changing anything further. Running this
command is the authorisation to release -- carry it through to the end, the push included, without
asking again. Bun only: never `npm` or `npx`, and never `npm publish` from here (CI does it).

## 1. Arguments

`$ARGUMENTS` must be exactly `patch`, `minor` or `major`; otherwise stop and print
`Usage: /publish patch|minor|major`.

## 2. Preflight

1. The branch is `main`: `git rev-parse --abbrev-ref HEAD`.
2. The working tree is clean: `git status --porcelain` prints nothing.
3. Not behind origin: `git fetch --quiet origin main`, then `git rev-list --count HEAD..origin/main`
   is `0`. Commits ahead of origin are fine -- they go out with the release in step 7.
4. `CHANGELOG.md` has a `## [Unreleased]` section with something under it. It is the record of
   what is shipping, written as the work landed; if it is missing or empty, stop and say so.

## 3. Gate

Run the gate command in the table. If it fails, stop -- no file has been edited yet.

## 4. Bump

Parse `.version` in `package.json` as strict `x.y.z` (refuse anything else) and compute the next:
`patch` → `x.y.(z+1)`, `minor` → `x.(y+1).0`, `major` → `(x+1).0.0`. Write it back, keeping the
2-space indent and the trailing newline.

## 5. Stamp

In each skill listed in the table, set the version under the frontmatter's `metadata:` map
(`metadata:` then `  version: x.y.z`) to the new version, inserting both lines after `name:` if
missing. A top-level `version:` line moves under `metadata:`: the Agent Skills spec allows only
`name`, `description`, `license`, `compatibility`, `metadata` and `allowed-tools` at the top, and
claude.ai and the Skills API refuse a skill with any other key. Change nothing else in the skill.

## 6. Promote the changelog

Replace the line `## [Unreleased]` with `## [<new version>] - <today, YYYY-MM-DD>`, and put a fresh,
empty `## [Unreleased]` above it.

## 7. Commit, tag, push

The root's `/publish` does it, for the whole round: one commit, the tag `delta@<new version>`
beside the others, one push. The tag is what publishes (the root's `.github/workflows/publish.yml`).
