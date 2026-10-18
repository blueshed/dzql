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

## Peter's decisions not yet built

1. ~~Sign-in by link~~: done (above).
2. **Refusals on the page are the story's words only.** The guards' reason drops "(story N)"; keep
   the number for logs and the harness.
3. **Migrations while modelling:** rewrite the newest unreleased migration in place until it is
   committed, then start the next (six piled up in one afternoon in cafe-e).
4. **Documents that list all of them** (`menu:`, the floor) as well as one of them (`menu:1`): the
   model can say it, and the proof, the whose-copy advice and the types follow (cafe-d items 2, 7).

Earlier and still open: the `ref` field type (one row pointing at another, beside copied fields:
cafe-c/cafe-d item 10) -- Peter asked "are you describing fkeys?"; answered (a parent is
containment, a ref is association), no decision yet.

## The two problems Peter named, and what would solve them

Peter, on cafe-e's report: "How do the tools disagree with each other? This is a disaster and the
learning was large up front ... this is sloppy -- how can we improve our library if we do not pay
attention to the detail?"

**The tools disagree.** Each part re-implements the model's meaning:
- the checks (`examples/modeling/closure.ts`) said closed, and the generated proof
  (`src/modelling/definitions.ts`, `testsOf`) failed (a premise replaying a remove; a premise that
  needed its own setup);
- the guards (`src/modelling/guards.ts`) enforced a requirement on writes the checks never asked
  about, and refused what coverage called decided;
- the read-back (`examples/modeling/loader/told.ts`) compared roles with cast names and missed an
  own document the reference told the app to build;
- the harness's hidden-verb warning ignored the guards until today's `may`.
Each was fixed one at a time; nothing stops the next. The fix is structural: one reading of a
model (who writes what, on which document, presupposing what, reaching whom) that the checks, the
proof, the guards and the read-back all take, and a conformance test that holds them to each other:
for every model in a fixture set (the reviewer models, cafe-e's `model.json`, the cafe built as
the worked example), *checks closed* implies *the generated proof passes* implies *the guards let
each does story's write and refuse each cannot*. Run in dzql's fast tier.

**Too much to learn up front.** cafe-e's words: six checks, `holds … under`, `perSession`,
`toldAt`, addresses, `serverWrite`, and the step from model to app in prose with no worked example
(its item 3, the most time lost). Proposed: build the cafe from a model as a worked example in the
new layout (guards, the model's migrations beside the app's, the own document as the session, link
sign-in), make it the conformance fixture too, and have the skills point at it instead of prose;
then cut the skills to one path, each word introduced where it is first needed.

Bring the plan to Peter before building it: it changes API shape (one shared model reading) and
adds an example, both his to approve.

## How to check

- `bun run affected` (fast), `bun run affected --slow` (Postgres in Docker, browsers, stories,
  costs) from the root; dzql's `bun run test:eta` holds 100% coverage, functions included (a class
  never constructed fails it).
- A fresh app: `bun packages/create-dzql/index.ts my-app` in a scratch folder, link
  `node_modules` to this checkout's, then `bun check && bun test && bun dev`.
- A blank-agent run: a new cafe folder from `bun create dzql`, the prompt in cafe-e's style (the
  story told once, "decide the obvious, list the rest", build until the gate passes, write
  feedback.md), run by a session that has seen none of this.
