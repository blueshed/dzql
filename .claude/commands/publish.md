---
description: "Release the packages Peter names, together, in one round (railroad, delta, dzql with create-dzql, create-blueshed). Only on his explicit word."
argument-hint: "<package> <patch|minor|major> [<package> <level> ...]"
---

# /publish

One release round for the monorepo: every package named in `$ARGUMENTS`, each with its level
(`railroad patch delta minor`). With no arguments, list each package's `## [Unreleased]` and stop:
Peter picks the round.

**Nothing is released without Peter's explicit say-so** (the root CLAUDE.md's *Releasing*). This
command, run on his word for this round, is that say-so: carry it through, the push included. Never
`npm publish` from here: the tags do it, in CI. If a publish run fails, stop and report it to Peter
(the run's URL, its error) and change nothing on GitHub or npm -- no fix pushed to a tag, no tag
moved or pushed again -- until he says.

## The packages

Released in this order, a sibling before what depends on it.

| Package | npm | Gate (in its folder) | End to end | Skills stamped | Also |
|---|---|---|---|---|---|
| `railroad` | `@blueshed/railroad` | `bun check && bun run check:consumer && bun test --coverage` | -- | `railroad`, `bun-route` | |
| `delta` | `@blueshed/delta` | `bun run test:slow` | -- | `delta-doc` | |
| `dzql` | `dzql` and `create-dzql`, one version | `bun check && bun run test:pg` (Docker; port 5433 free) | `cd packages/create-dzql && bun run test:fast`: a new app from the local template, the workspace's packages linked in, type-checks, passes its own tests at 100% (its stories on PGlite) and starts | -- | the template's `dzql` is `^<new>`; settled items leave `packages/dzql/todo.jsonl` |
| `create-blueshed` | `create-blueshed` | `bun run test:fast`, and paintbrush's `bun run test:slow` (the evolve skill applied) | -- | -- | it packs `packages/paintbrush` (`prepack`): paintbrush, never published itself, takes the same level -- its `version` bumped and its changelog promoted -- since an app made from it records "Started from paintbrush <version>" |

## 1. Preflight, once

1. On `main`, the tree clean (`git status --porcelain` names nothing tracked), and not behind
   `origin/main` (`git fetch --quiet origin main`, then `git rev-list --count HEAD..origin/main`
   is `0`).
2. `bun install --frozen-lockfile` at the root.
3. Each package named has something under `## [Unreleased]` in its CHANGELOG (create-blueshed's is
   paintbrush's); one that has nothing stops the round.

## 2. Each package, in the table's order

Stop at the first failure; nothing is committed until every package has passed.

1. **Gate**, then **end to end** where it has one, as the table says.
2. **Bump**: `version` in its `package.json` as strict `x.y.z` (refuse anything else); `patch` →
   `x.y.(z+1)`, `minor` → `x.(y+1).0`, `major` → `(x+1).0.0`; the 2-space indent and trailing
   newline kept. dzql's goes in create-dzql's too.
3. **Stamp** each skill the table names: the version under the frontmatter's `metadata:` map
   (`metadata:` then `  version: x.y.z`), both lines inserted after `name:` if missing. A top-level
   `version:` moves under `metadata:`: the Agent Skills spec allows only `name`, `description`,
   `license`, `compatibility`, `metadata` and `allowed-tools` at the top.
4. **Promote** its CHANGELOG: `## [Unreleased]` becomes `## [<new version>] - <YYYY-MM-DD>`, with a
   fresh, empty `## [Unreleased]` above it. Then the table's *Also*.

## 3. What depends on what was released

A sibling's range moves up to the version just made when it no longer includes it: delta's
`@blueshed/railroad` (peer and dev); dzql's `@blueshed/delta` (peer and dev) and
`@blueshed/railroad` (dev, and its optional peer widened); paintbrush's three; the create-dzql
template's `dzql`. Each move is a line under the dependent's new version in its CHANGELOG (under
`[Unreleased]` for paintbrush when create-blueshed is not in the round). Then `bun install` at the
root, so `bun.lock` names the new versions, and `bun run affected` on the bumped tree.

## 4. Commit, tag, push

```
git add -A packages bun.lock
git commit -m "Release <package> <version>, <package> <version>"
git tag -a <package>@<version> -m "<package> <version>"   # one per package; create-dzql beside dzql
git push origin main
git push origin refs/tags/<package>@<version>             # each tag on its own
```

Each tag on its own: GitHub makes no event for a tag pushed with more than three others, and
`--follow-tags` carries any older local tag with it. Each tag starts `.github/workflows/publish.yml`:
that package's gate, then `npm publish --provenance`. If a push is refused, report the exact error
and stop; never `--force` or `--no-verify`.

## 5. Confirm and report

`gh run list --workflow=publish.yml` until each tag's run is done, then `bun info <name> version`
for each (npm may take a few minutes to show a version it took). Report the commit, the tags and
the versions npm has. A failed run: its URL and error, to Peter, and stop.
