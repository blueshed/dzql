---
description: "Release the packages that have changed, together, in one round (railroad, delta, dzql and create-dzql)."
argument-hint: "<package> <patch|minor|major> [<package> <level> ...]"
---

# /publish

One release round for the monorepo: every package named in `$ARGUMENTS`, each with its level
(`railroad patch delta minor`). With no arguments, list each package's `## [Unreleased]` and stop:
the person picks the round. Releasing comes once every stage of a plan is done, on Peter's word.
Running this command is the authorisation to release: carry it through, the push included,
without asking again. Never `npm publish` from here: the tags do it, in CI.

Each package's own steps are in `packages/<package>/.claude/commands/publish.md` (its gate, its
end-to-end check, which skills it stamps). `dzql` releases `create-dzql` with it, one version.

## 1. Preflight, once

1. On `main`, the tree clean, and not behind `origin/main` (`git fetch --quiet origin main`, then
   `git rev-list --count HEAD..origin/main` is `0`).
2. `bun install --frozen-lockfile` at the root.

## 2. Each package's steps 2 to 6

For each package named, in the order railroad, delta, dzql (a sibling before what depends on it),
run its file's steps 2 to 6 in `packages/<package>`: preflight (its `[Unreleased]` has something
under it), gate, end to end where it has one, bump, stamp, promote. Stop at the first failure;
nothing is committed until every package has passed.

## 3. What depends on what was released

A sibling's range moves up to the version just made when it no longer includes it: delta's
`@blueshed/railroad` (peer and dev), dzql's `@blueshed/delta` (peer and dev) and
`@blueshed/railroad` (dev). Each such move is a line under the dependent's new version in its
CHANGELOG. Then `bun install` at the root, so `bun.lock` names the new versions.

## 4. Commit, tag, push

```
git add -A packages bun.lock
git commit -m "Release <package> <version>, <package> <version>"
git tag -a <package>@<version> -m "<package> <version>"     # one per package released, create-dzql with dzql
git push origin main
git push origin refs/tags/<package>@<version>    # each tag on its own
```

Push the commit, then each tag on its own (`git push origin refs/tags/<tag>`): GitHub makes no
event for a tag pushed with more than three others, and `--follow-tags` carries any older local
tag with it. Each tag starts `.github/workflows/publish.yml`: that package's gate, then `npm publish
--provenance`. If the push is refused, report the exact error and stop; never `--force` or
`--no-verify`. If a run fails, stop and report it to Peter (its URL and its error): never fix it on
GitHub or npm, never move or push a tag again, until he says.

## 5. Confirm and report

`gh run list --workflow=publish.yml` until each tag's run is green, then `bun info <name> version`
for each. Report the commit, the tags and the versions npm has; a failed run, with its URL.
