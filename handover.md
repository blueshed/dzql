# Handover: dzql after the cafe runs (18 October 2026)

For the next session in this folder. Read this, then the root `CLAUDE.md`, `packages/dzql/CLAUDE.md`,
`CHANGELOG.md` and `todo.jsonl`. Project rules: work on `main`, no pull requests; never publish,
release or tag unless Peter asks; push only after the affected tiers pass locally (`bun run
affected --slow` on this Mac runs Postgres and the browsers); keep `CHANGELOG.md` and `todo.jsonl`
current; names, API shape and metaphors are Peter's to decide, mechanical choices yours.

## Where things are

- **This checkout** (`~/Workshop/blueshed/dzql`) is main at `d185f023` plus this handover. It is the
  one to work in.
- **`~/Workshop/modelling-session`** is a second clone made for today's modelling session. It is
  clean and pushed, and nothing links to it any more: retire it (ask Peter before deleting).
- **`~/Workshop/layout-proof`** is the routes-and-resources proof (a shared message, a status route,
  the model at `/model`), linked to this checkout's `node_modules`. It became the starter; keep it
  or drop it as Peter likes.
- **The cafe runs:** cafe-two, cafe-c, cafe-d (Gemini) and cafe-e (a blank Claude) are gone from
  `~/Workshop`. Their feedback is kept in `docs/dzql/feedback/` (cafe-d's and cafe-e's, cafe-e's
  decisions and its sign-in). cafe-e's whole repository is `~/Workshop/archive/cafe-e-2026-10-18.bundle`
  (`git clone` it); its `model.json` is a real model to test against.

## What changed today (all on main, all gates green)

In order: the cafe sessions' fixes (cookies per app, reloads keep sign-ins, the model a route
mounted only in development, link sign-in for the model's page, the checks never green on an empty
model); three rounds of feedback from blank agents (cafe-c, cafe-d by Gemini, cafe-e by Claude);
and the new starter: `bun create dzql` lays an app out as paintbrush does, `src/routes.ts` (the
server: the app, its HTTP routes, `modelRoute()` from `dzql/model` in development) and
`src/resources/<name>/` (`<name>-api.ts`, `<name>.ts`, `<name>-view.ts`). The packages'
`CHANGELOG.md` say each in full.

## Done since: sign-in by link everywhere

`dzql/rendering/links` (`signInLinks(key, sessions, people, at)`: `say(origin)` prints a link per
person as the server starts, `ways()` is each one's name and path for a home page, `route` is the
app's `"/in/:token"`). The model's page and its stories sign in through it; eta-app's
`reference/signin.md` leads with links (passwords a fallback), and first-app.md, stories.md, the
starter's `routes.ts` and the template's CLAUDE.md say the same. delta-doc's `auth.md` is left as
delta's own (for a page that is delta's client); signin.md says which is which. Next: decisions 2
to 4 below.

## Peter's decisions: built (18 October, evening; Peter: "don't wait for me, fix it all")

1. Sign-in by link (above).
2. A guard's refusal is the story's words alone; the number rides as `error.story`.
3. The newest migration is rewritten in place while git says it is not committed (`make`,
   `src/cli/model.ts`); outside a repository every step is its own.
4. A document can be a `list` (`menu:`): the page, `list <doc>`, the proof, the types, the advice.

Still open, Peter's to decide: the `ref` field type (one row pointing at another, beside copied
fields: cafe-c/cafe-d item 10); a parent is containment, a ref association.

## The two problems Peter named

Peter, on cafe-e's report: "How do the tools disagree with each other? ... how can we improve our
library if we do not pay attention to the detail?"

**The tools disagree: built.** `src/modelling/reading.ts` is one reading of a model, which the
checks, the heart, the definitions, the proof, the guards and the read-back take. The proof
(`model.test.ts`) makes every write through the guards as its story's teller and expects each
`cannot` refused in its words; `src/modelling/conformance.test.ts` runs `make` and that proof over
`src/modelling/fixtures/` (leave, cafe-e, menu) in the fast tier. A model that breaks one of them
is a fixture to add. It found four disagreements (dzql's CHANGELOG says which), each fixed.

**Too much to learn up front: the worked example is built.** `packages/dzql/examples/cafe/`
(its README walks it): the model told, made, built as routes and resources, 22 stories, read back
with no gaps, a conformance fixture; the eta-app and modelling skills and the template point at
it. Building it found three more disagreements, fixed: the read-back could not read the new
layout, a document held every field of an entity though the model named fewer (now `columns`),
and an app story of the app's own had no way to say so (`model: false`). Still open: cutting the
skills to one path, each word where first needed (todo #49), an editorial pass for Peter.
Worth running next: a blank-agent cafe run against the skills as they now stand.

## How to check

- `bun run affected` (fast), `bun run affected --slow` (Postgres in Docker, browsers, stories,
  costs) from the root; dzql's `bun run test:eta` holds 100% coverage, functions included (a class
  never constructed fails it).
- A fresh app: `bun packages/create-dzql/index.ts my-app` in a scratch folder, link
  `node_modules` to this checkout's, then `bun check && bun test && bun dev`.
- A blank-agent run: a new cafe folder from `bun create dzql`, the prompt in cafe-e's style (the
  story told once, "decide the obvious, list the rest", build until the gate passes, write
  feedback.md), run by a session that has seen none of this.
