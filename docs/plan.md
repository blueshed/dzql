# The plan: what the toolset is, before what it adds

19 October. Peter: "we have no stated plan for entry points or what they mean,
what is being published where, what skills we need or how we are going to document. So we need to
start there before we continue to add features."

Then: "you do not need my decisions" -- go ahead and clean it up. No feature work until it is done.
The `ref` field type is built and parked on the local branch `ref-wip` (not pushed).

Each section is what existed on 19 October, then what was unclear. What is decided, and where each
step stands, is at the end.

## 1. Entry points: what someone types or imports

**To start an app** there are two commands for one idea:

| Command | Makes | Client |
|---|---|---|
| `bun create dzql` | the starter (`dzql/examples/starter`): routes, resources, the model's page in development | thin: the server draws the page (`dzql/rendering`) |
| `bun create blueshed` | paintbrush, copied: routes, resources, a railroad page | thick: the browser draws it |

**To import**, 37 entries:

| Package | Entries | Note |
|---|---|---|
| `@blueshed/railroad` | 9: `.`, signals, jsx, routes, shared, logger, webview, the JSX runtimes | each named |
| `@blueshed/delta` | 18: core, client, dom-ops, server, serve, sqlite, json, local, kinds, logger, auth, auth-link (+ client), migrations, paths, testing, backend | each named |
| `dzql` | 10, two of them wildcards: `dzql/rendering/*` and `dzql/modelling/*` open every file (36 files) | the cafe imports 17 different paths, among them `rendering/db`, `rendering/test-socket`, `rendering/json-patch` |

**To run**, three command lines and per-app scripts:

| CLI | Does |
|---|---|
| `delta` | open, watch, delta, call (a document from the terminal); migrate, migrations make; link; install-skills; stop |
| `dzql` | serve, model (and model check, site, guards, mcp); sql, init, migrate, link (Postgres) |
| an app's `bun run cli` (`dzql/rendering/cli.ts`) | login, inspect, watch, undo, redo, write, and the app's own verbs |

**Unclear:**
- Which `dzql` entries are the public API. With wildcards, every internal file is one, so nothing
  can be renamed without breaking someone, and the skills teach whatever path the examples happen to use.
- Two starters. Are they two products (thin and thick), or one starter with a choice?
- Commands that overlap: `delta migrate` and `dzql migrate`; `delta link` and `dzql link`; sign-in
  by link in `@blueshed/delta/auth-link`, `dzql/auth-link` and `dzql/rendering/links`.
- The model's page is an example (`examples/modeling`) that is also an entry point (`dzql/model`,
  `dzql model`), shipped inside `dzql`.
- The scripts: `test` means four different things across the packages (in dzql it starts Docker),
  and dzql lists its examples in four places.

## 2. What is published where

| Package | npm | Version (npm) | Since then on main |
|---|---|---|---|
| `@blueshed/railroad` | yes | 0.16.2 (11 Oct) | |
| `@blueshed/delta` | yes | 1.2.0 (16 Oct) | |
| `dzql` | yes | 0.13.0 (16 Oct) | a great deal (CHANGELOG `[Unreleased]`) |
| `create-dzql` | yes | 0.13.0 (16 Oct) | the starter's new layout |
| `create-blueshed` | yes | 0.3.0 (2 Oct) | |
| `paintbrush` | no (private; shipped as create-blueshed's template) | | `paintbrush` on npm is someone else's |

One repository, `blueshed/dzql`, tags `<package>@x.y.z`, published by GitHub Actions (paused since 17
October; the slow tier runs on the Mac). `dzql` ships two examples (`modeling`, `cafe`) and two
skills inside it.

**Unclear:**
- The repository is called `dzql` and holds five packages ("bluetools" in the README).
- `dzql` is unprefixed while the others are `@blueshed/`.
- Nothing has been released since 16 October, and a paintbrush app needs a dzql that npm doesn't
  have (todo #29).
- The old repositories (railroad, delta, eta, paintbrush, invoket) are not archived (#13), and npm's
  trusted publishing setup is unfinished (#14).
- What a release is for: each package on its own cadence, or the set together?

## 3. Skills

| Skill | Lives in | Ships with | For |
|---|---|---|---|
| `railroad`, `bun-route` | railroad | `@blueshed/railroad` | signals, JSX, routes; a route |
| `delta-doc` | delta | `@blueshed/delta` | documents, storage, the wire |
| `modelling` | dzql | `dzql` | taking the stories down on the model's page |
| `dzql-app` | dzql | `dzql` | building a server-drawn app |
| `evolve` | paintbrush | `create-blueshed`'s copy | growing a paintbrush app through stages |

`delta install-skills` copies every `@blueshed/*` skill, and those a project's `claudeSkills`
names, into `.claude/skills`.

**Unclear:**
- Nothing says which skill to load for what (#17, a router).
- `dzql-app` is named for a package that no longer exists (the suggestion was `dzql-app`).
- Two skills cover building an app, by client (`dzql-app`, `evolve`), with the documents in a third
  (`delta-doc`) and the stories in a fourth (`modelling`). Is that the set we want?
- How a skill stays true to the code. Today it's by hand, and the cafe runs found the drift.

## 4. Documentation

| Kind | Where |
|---|---|
| The vision, once | the root README, *How an app is made* |
| A package's own part | its README, CHANGELOG, CLAUDE.md (for an agent working on it), todo.jsonl |
| How to build | the skills (`.claude/skills/*/SKILL.md` and `reference/`) |
| Going deeper | `docs/<package>/` (guidance), beside `docs/history/` and the plans (the record) |
| Worked | `dzql/examples/cafe` (from a model), the older examples |
| What happened lately | `handover.md`, `docs/inventory.md`, `docs/dzql/feedback/` |

**Unclear:**
- Who each is for. A person using the toolset, an agent building an app, or someone working on
  the toolset read different things, and the same thing is said in several (`docs/dzql/rendering/first-app.md`
  and the dzql-app skill; `docs/stories.md` and both skills).
- Whether there is a site, or `llms.txt` (#19).

## Decided

1. **What the toolset is** (Peter): `bun create blueshed` is paintbrush, light, for prototyping:
   railroad and delta, the page drawn in the browser. `bun create dzql` is for performance: the
   thin client with applets, its documents compiled to Postgres. One path, not a choice made once:
   a prototype grows into performance, its documents delta's all along. *Done*: the root README
   and CLAUDE.md, each package's README, the dzql-app and evolve skills say so.
   *Open*: the evolve skill takes the storage to Postgres; moving the pages to the server (the
   thin client) is not yet written as a step of it. And `bun create dzql`'s starter and the cafe
   still keep their documents in SQLite.
2. **What each document is for** (Peter): a README is for a person deciding whether to use it;
   CLAUDE.md is Claude's entry point; the skills and their references are the manual. *Done*:
   stated in the root CLAUDE.md; delta's and dzql's CLAUDE.md open with it, as railroad's did;
   dzql's README is cut from a manual to what a person needs to decide, its examples still run as
   written; each README ends by pointing at the skills.
3. **The skills are named for what people install**: `eta-app` is `dzql-app`; what people read says
   dzql, not eta. Runtime names (`window.eta`, `.eta-session`, `ETA_URL`, `ETA_EXAMPLE`) are API and
   stay for now. *Done*.

## Doing next, in order

4. **dzql's public API**: named entries, no wildcards; what an app imports is listed, the rest is
   internal.
5. **The scripts**: `test` means the same in every package; dzql's examples are listed once.
6. **The skills checked against the code**: a test that every path and link a skill names exists.
7. **The docs by reader**: *Done* (19 October, Peter: "since our plans are in git"). `docs/` keeps
   what goes deeper: the plan, the stories, the thin client and its costs, the bento, Postgres,
   railroad's reasons, and the lineage. Finished plans, change requests, reviews, the inventory,
   eta's old changelog and the cafe feedback are in git's history; `first-app.md`, which repeated
   the skill, is the cafe now.
8. **A release**, on Peter's word: dzql and create-dzql first (todo #29), then create-blueshed.

Then features resume, `ref` first, each checked against this plan before it is built.
