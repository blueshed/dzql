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

| Package | npm | Gate (in its folder, `bun run` each, as `publish.yml` runs it) | End to end | Skills stamped | Also |
|---|---|---|---|---|---|
| `railroad` | `@blueshed/railroad` | `test:fast`, `test:slow` | -- | `railroad`, `bun-route` | |
| `delta` | `@blueshed/delta` | `test:fast`, `test:slow` | -- | `delta-doc` | |
| `dzql` | `dzql` and `create-dzql`, one version | `test:fast`, `test:slow` (Docker; port 5433 free) | `cd packages/create-dzql && bun run test:fast`: the template, the starter, type-checks and passes its tests where it lives; then a new app made from it, the workspace's packages linked in, type-checks, passes its own tests at 100% (its stories on PGlite) and starts | `modelling`, `dzql-app` | the template's `dzql` is `^<new>` |
| `create-blueshed` | `create-blueshed` | `test:fast` (its own, then its template's), `test:slow` (the template's: the evolve skill applied) | -- | -- | its `template/` is paintbrush, published inside it as it is, with no version of its own: an app made from it records "Started from create-blueshed <version>". `bun pm pack --dry-run` (or `npm pack --dry-run`, which `publish.yml` runs) lists nothing a new app never gets (`files` leaves out the template's `UNCOPIED`) |

## 1. Preflight, once

1. On `main`, the tree clean (`git status --porcelain` names nothing tracked), and not behind
   `origin/main` (`git fetch --quiet origin main`, then `git rev-list --count HEAD..origin/main`
   is `0`).
2. `bun install --frozen-lockfile` at the root.
3. Each package named has something under `## [Unreleased]` in its CHANGELOG (create-dzql's is
   dzql's); one that has nothing stops the round.
4. Each skill a package named ships, changed since its last recorded run (`git log` of
   `.claude/skills/<skill>/` against the newest `evals/runs/*-<skill>.md`), has been run again and
   the run recorded, every line held or the miss said in the CHANGELOG. One that has not stops the
   round: say which, and that running them is Peter's to start (they spend sessions).

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
   fresh, empty `## [Unreleased]` above it, and the settled items (`fixed`, `not fixed`) leave its
   `todo.jsonl`: the changelog keeps what they were. Then the table's *Also*.

The root's `todo.jsonl` (what is open across packages) is settled the same way, once a round: its
`fixed` and `not fixed` items leave it, the root CHANGELOG keeping what they were.

## 3. What depends on what was released

A sibling's range moves up to the version just made when it no longer includes it. Run `bun
scripts/ranges.ts` at the root: it names every range in the workspace (a package's dependencies,
dev dependencies and peers, and each starter's template) that leaves out its sibling's version now,
and each it names moves to `^<new version>` (a peer widened rather than narrowed: an app on the older
sibling still installs). Each move is a line under the dependent's new version in its CHANGELOG
(under `[Unreleased]` for a starter not in the round whose template's range moved). Then `bun install`
at the root, so `bun.lock` names the new versions, and `bun run affected` on the bumped tree, which
runs `ranges.ts` again.

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
