---
description: "Release a new version of eta (patch | minor | major)."
argument-hint: "patch | minor | major"
---

# /publish

Releases eta: the gate, the version, the changelog, a tag. The bump level is `$ARGUMENTS`.

eta is not on npm. A release is a tag on GitHub, and what it is for is the projects made from eta:
`bun create blueshed/eta` takes `main` as it stands, and a project's changelog names the eta it
started from. A project moves to a later eta by reading eta's changelog from its version on and
carrying across what each breaking change says to do. So a release must leave three things true:
`main` passes the gate, the changelog says what shipped, and every breaking change says what an app
must change.

Running this command is the authorisation to release: carry it through to the push without asking
again. Stop at the first failure, changing nothing further. Bun only.

## 1. The bump

`$ARGUMENTS` is exactly `patch`, `minor` or `major`; otherwise stop with
`Usage: /publish patch|minor|major`. A release with a breaking change is at least `minor` (eta is
0.x).

## 2. Before anything is changed

1. On `main`, with nothing uncommitted (`git status --porcelain` prints nothing).
2. Not behind origin: `git fetch --quiet origin main`, then `git rev-list --count HEAD..origin/main`
   is `0`.
3. `CHANGELOG.md`'s `## [Unreleased]` has something under it, written as the work landed. Empty or
   missing: stop and say so.
4. Each entry under its `### Breaking` heading, if it has one, says what an app must change ("What
   to change: ..."). One that does not: stop and name it -- a project cannot carry it across.
5. `todo.jsonl` holds only what is open: an item the release settles was taken out when it landed.

## 3. The gate

```sh
bun check && bun test --parallel && bun run stories:all
```

`bun test` includes `create/setup.test.ts`, which makes a project from a copy of eta and runs that
project's own gate: a release that would give `bun create` a broken project fails here. If the gate
fails, stop: nothing has been edited.

## 4. The version

1. `package.json`'s `version` is strict `x.y.z`; compute the next (`patch` x.y.z+1, `minor`
   x.y+1.0, `major` x+1.0.0) and write it back, keeping the 2-space indent and the trailing newline.
2. Set `metadata.version` to it in `.claude/skills/eta-app/SKILL.md` and
   `.claude/skills/modelling/SKILL.md`, changing nothing else. (A skill's frontmatter allows only
   `name`, `description`, `license`, `compatibility`, `metadata` and `allowed-tools` at the top.)
3. In `CHANGELOG.md`, `## [Unreleased]` becomes `## [<version>] - <today, YYYY-MM-DD>`, with a
   fresh, empty `## [Unreleased]` above it.

## 5. Commit, tag, push

```sh
git add package.json CHANGELOG.md .claude/skills/eta-app/SKILL.md .claude/skills/modelling/SKILL.md
git commit -m "Release v<version>"
git tag -a v<version> -m "Release v<version>"
git push origin main --follow-tags
```

A refused push (not a fast-forward, auth, a hook): report the error exactly and stop. Never
`--force` or `--no-verify`: the commit and tag stay local for the person to decide.

## 6. Report

```
Released eta v<version>.

  commit   <short sha>
  tag      v<version>
  pushed   origin/main
```
