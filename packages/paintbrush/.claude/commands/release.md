---
description: "Release this app (patch | minor | major | X.Y.Z): check, test, close CHANGELOG.md and todo.jsonl, bump, commit, tag and push. With no argument, show where things stand."
argument-hint: "[patch | minor | major | X.Y.Z]"
---

# /release

A release turns `## [Unreleased]` into a version and takes the settled items out of `todo.jsonl`, so the changelog says where the project has been and the ledger only what is open. `$ARGUMENTS` is `patch`, `minor`, `major`, or an exact version (`0.5.0`); with nothing, change nothing and report (step 0). Anything else: stop and print `Usage: /release [patch|minor|major|X.Y.Z]`.

Running this is the authority to release, which includes the push. Carry it through without asking again. Stop at the first step that fails: nothing is changed before step 3, so there is nothing to undo.

## 0. No argument: where things stand

`git fetch`, then report: the version in `package.json` and the newest tag; the branch, whether the tree is clean, and how far it is ahead of or behind `origin`; how many entries `## [Unreleased]` has; how many items in `todo.jsonl` are open and how many are fixed; and the one thing to run next (`/release patch` when there are unreleased entries, nothing when there are none).

## 1. Check

1. There is a remote to push to (`git remote get-url origin`). None means the app has never been pushed: stop, and say to add one first (`gh repo create <owner>/<name> --source . --push`, private unless the user says otherwise).
2. On `main`, with a clean tree (`git status --porcelain` prints nothing), and not behind `origin/main` (`git fetch`, then `git rev-list --count HEAD..origin/main` is `0`).
3. `## [Unreleased]` in `CHANGELOG.md` has entries. None means nothing to release: stop and say so.
4. The pair agrees. Every `fixed` item in `todo.jsonl` has a changelog entry under `[Unreleased]` that settles it, and a dated `note` saying so; a `not fixed` item has a `note` saying why. Report any that don't, and stop: fix the record first.
5. Work out the new version: `package.json`'s `version` bumped by the argument, or the exact one given (it is written in step 4). Its tag `vX.Y.Z` must not exist (`git rev-parse -q --verify refs/tags/vX.Y.Z` prints nothing). If it does, stop and name the next free version: never reuse or move a tag.

## 2. Gate

`bun run typecheck`, then `bun test`, which fails below 100% coverage. Both pass, or stop.

## 3. Close the pair

- `CHANGELOG.md`: replace `## [Unreleased]` with `## [X.Y.Z] - YYYY-MM-DD` (today), and put a new, empty `## [Unreleased]` above it.
- `todo.jsonl`: remove the items with `status` `fixed` or `not fixed`. Their story is in the version's entry now, and git keeps the lines. What stays is what is open.

Edit both with the file tools, never inside a quoted shell argument.

## 4. Bump, commit, tag

```sh
bun pm version X.Y.Z --no-git-tag-version   # writes package.json only
git add package.json CHANGELOG.md todo.jsonl
git commit -m "X.Y.Z: what it does, in a line"
git tag vX.Y.Z
```

`--no-git-tag-version` matters: without it `bun pm version` refuses a tree with the changelog edit in it, and onto an existing tag it commits and then fails, leaving the commit behind.

## 5. Push

```sh
git push && git push origin vX.Y.Z
```

When the deploy builds from `main` (`.railway/railway.ts`, once applied), this push is the release going live: say so, and check `/health` on the live site once it has built. A pushed tag is never moved; if something is wrong, fix it on `main` and release the next patch.

## 6. Report

The version, the tag, the commit, how many changelog entries it carries and how many ledger items it closed, what is still open, and whether it is live.
