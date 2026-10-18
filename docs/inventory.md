# What dzql and eta had, and what works now

18 October. Peter: "you have broken my project, removed features and left me with a fraction of the
functionality", and "dzql should be a superset of hjeli". This lists every feature of the three
sources, how it was checked, and where it stands on dzql main (78020f7), with three-offers applied
(d2efc919), and on this branch.

**How it was checked.** By running each, in a cloud container with Postgres 16 and Chromium:

| Source | Commit | What ran | Result |
|---|---|---|---|
| eta, before its move | 62c2d36 | `bun test --parallel` (738 tests) | 725 pass, 13 fail: browser timeouts and EMFILE from the container, not the code |
| eta | 62c2d36 | `model:check` on chat, ticker, wedding, leave, modeling | output kept for the comparison below |
| dzql, before the merge | 3611d0c | `bun test` on Postgres 16 | 4558 pass, 0 fail |
| hjeli | c9b90f5 | `hjeli audit data/wedding-planner` | all six predicates green |
| dzql with three-offers | d2efc919 | `model:check` on the five examples; `costs --check` | `model:check` is the same as eta's, line for line, apart from the rename to resources and numbered ids. `costs --check` passes |

Easy (Simple) and rights' `derive-ux.ts` live only on Peter's Mac. The cloud can't reach them, so
they are listed at the end for the Mac session to fill in.

**Legend.** **Works** means it ran and passed. **Moved** means the same code is in dzql under a new
path. **Restored here** means it is put back on this branch. **Missing** means it is not in dzql
today. **Peter's call** means it was removed on his word.

## eta (62c2d36)

| Feature | Before | Today (main / three-offers) | This branch |
|---|---|---|---|
| Rendering: server-drawn pages, parts, morph, applets, island, bento | `src/` | **Moved** to `src/rendering`; `dzql serve` added (three-offers) | same |
| Stories format, harness over real sockets, by hand in a browser | `src/stories.ts`, `harness.ts`, `by-hand.ts` | **Moved** to `src/modelling`. Harness tests 71 to 73, examples keep their stories | same |
| Costs (`costs --check`, a page's byte budget) | `src/costs.ts` | **Works** | **Works** with the registers part |
| The model's page: live, three columns, CLI verbs, `show`, undo | `examples/modeling` | **Moved**, line counts equal | plus hjeli's six registers, and `writes`/`requires` on a story |
| `model:check` (documents from a run, permit, who is told) | `examples/modeling/loader` | **Works**, same output as eta | plus reachability over the schema, the dead actor, session rows made by the visit |
| `model:load`, `--against <hjeli model>`, `--against-page` | loader | **Moved** | same |
| hjeli's predicates over the stories | 6 from 2c49c7a (24 Sep); 4 from 3b60ade (12 Oct) | 4 (`loader/report.ts`) | **Restored here**, all six on the told model |
| eta CLI: inspect, watch, undo, redo, write | `src/cli.ts` | **Moved**, same usage | same |
| Undo, redo and history through delta's ledger | kernel | **Moved**; tests kept | same |
| The session-id guard, where the cookie is the session | `resources/audience.ts` | **Missing**, since 7707774 and narrowed by 2ac7100 | **Restored here**, with tests that fail without it |
| `bun create blueshed/eta` and `bun run eta:update` (prints what changed since) | `create/eta.ts`, `create/update.ts` | Replaced by `bun create dzql` and npm `dzql`. The "what changed since" print is **missing** | not restored |
| The session-hook test | `src/session-start.test.ts` | **Missing** (8d277a9) | not restored |
| 48 open todo items | `todo.jsonl` | Filed as history (55ed7f1), in no live list | not restored |
| Retired before the move, 13 Oct, in Peter's repo: the static modeller page (states, sequences, use cases, classes, checklist), the UML session, the bento mock-up | 8ceaaa7, 78f5f5c, b8ad60b | **Missing**; still in git | not restored; Peter's to ask for |

## dzql (3611d0c)

| Feature | Today | Note |
|---|---|---|
| The Postgres compile: `generateSql`, `dzql sql`, framework SQL, listener, migrate, link, auth-jwt, auth-link, `dzql/pglite` | **Moved**. Every file is there, the CLI is the same, plus `serve`, `model` and `model export` | Base suite: 4558 pass |
| Compiler probe matrices (resolve 28 to 13 inputs, root 17 to 8, snapshots halved) | Cut in 1028465 | **Peter's call** (CI design, 17 Oct) |
| The listener's own PGlite tests in CI ("hears each entry once", "reads what it missed") | CI skips the file (`--path-ignore-patterns`) and the fast tier doesn't run it | **Missing**. The design merged the files but didn't decide to stop running these tests |
| Examples held to 100% coverage | Dropped (1028465, acb93b3) | **Peter's call** |
| The `create-dzql` Postgres starter (people, posts, sign-in) | Deleted (aec3ae1) | **Peter's call** ("Yes, on SQLite") |
| A new `create-dzql` app held to 100%, with its create test telling stories | Dropped (aec3ae1) | **Missing** |
| TypeScript 5.9 check | Dropped (1a18a50) | **Peter's call** |

## hjeli (c9b90f5), against "dzql should be a superset of hjeli"

| hjeli | dzql today | This branch |
|---|---|---|
| Six predicates after every change | 4, only by `model:check` on a built app; the page ran none | **Restored here**: all six on the page, in `show` and in `dzql model audit` (`examples/modeling/closure.ts`) |
| `audit` exits 1 until green | none | **Restored here**: `dzql model audit [model.sqlite]` |
| Story writes `{entity, op, path, to}` and `requires` | the page has `touches` only | **Restored here**: `writes` and `requires`, so precondition closure's row and state tiers are asked |
| Documents derived from the writes: the agent proposes ops to close each gap | the skill only asks and rewords | **Restored here** in the modelling skill (step 5: lead, close by adding). The page itself proposes nothing |
| Actors with `auth_claim` and `established_by`; documents with params | none on the page | **Missing** |
| Field `owner`, `fk`, `grant`, `reach`, `gate`; temporal entities | none on the page; `dzql model export` writes no `owns` | **Missing**. Authorization closure today is "you may write what you may read" over `held_by` |
| Actions with guards (`state`, `exists`, `is_member`, `byOther`) and a generated, guarded write layer (`operations.ts`) | dzql compiles delta's writes with `owns` as permission; no guards | **Missing** |
| `export ts` (types.ts) | `dzql model export` writes defineSchema/defineDoc (three-offers) | same |
| `export sql` (init_db, with RLS) | `dzql sql model.ts` compiles Postgres, with permission from `owns` | same; RLS needs ownership in the model (above) |
| `export supabase`, `export epsilon` | none | **Missing**; whether they are still wanted is Peter's call |
| `export site` (the model read back for a customer) | none | **Missing** |
| The observatory: lozenges and six registers | the page's three columns | registers across the top; no lozenge layout |
| MCP server over the model verbs | none | **Missing** |
| `install` (skills into a project) | delta's `install-skills`; a create-blueshed app gets modelling but not eta-app, which the modelling skill points to | the pointer is still **missing** |

What 3b60ade guarded against: reachability and subscription closure "passed by construction" over
documents the modeller had invented, one per actor per page. Here they run over the documents as
told on the page, and over the app's real schema in `model:check`, so they can fail. Both have tests
that open each gap.

## Skills (hjeli, eta, dzql, create-blueshed)

From reading each skill whole:
- hjeli's skill made the agent lead: "propose the next ops that close them".
- It ran the predicates after every mutation, and a red one was closed by adding.
- It designed from the write backward.
- It gated building on a green `audit`.
- eta's modelling skill (13 Oct) kept writing the stories and asking for documents, and dropped the
  rest. dzql's skill was eta's.

This branch puts the loop back in `packages/dzql/.claude/skills/modelling` (steps 4 to 6, and the
registers table in its reference).

Still missing:
- hjeli's structured guards.
- The green gate before export.
- A create-blueshed app is not pointed from modelling to anything it has installed (setup skips
  eta-app).

## Easy (Simple) and rights: not reachable from the cloud

The Mac session reads these and sends a spec of each. As reported from
`~/Workshop/docs/history/easy-hjeli-pictures.md`:
- Easy's `doctor` found orphaned references.
- Easy kept per-actor can/denied checklists, with "confirmed" flags for API and UX.
- Easy kept coverage: each method held its permission and what it publishes.
- rights' `derive-ux.ts` checked playability: can each person take their turn.

dzql's does/cannot stories cover part of can/denied. None of the rest is in dzql.

## Branch commits, on three-offers (d2efc919)

- 824356a: the session-id guard, where the cookie is the session.
- 8905555: hjeli's six registers on the told model, `writes` and `requires`, `dzql model audit`,
  `model:check` reachability and the dead actor, the skill's loop.

Tests on this branch:
- `examples/modeling`: 97 pass.
- `src/rendering/server.test.ts`: 46 pass.
- `bun check` is clean.
- `costs --check` passes.
