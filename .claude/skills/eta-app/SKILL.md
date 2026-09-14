---
name: eta-app
description: Use this skill before writing any code under examples/<name>/ — adding a new eta example app, or adding a document/concept/applet/migration/CLI verb to an existing one. Also use it before touching the Concept contract, migrate(), the applet registry, or the {doc,ops} wire protocol, since those are the seam a new example has to fit through. Reference.md has the full contracts and code excerpts.
---

# Building an example on eta

eta is a kernel (`src/`) plus examples (`examples/<name>/`). The kernel never
imports anything under `examples/`; an example is everything needed to turn
the kernel into a running app. Read `reference.md` in this skill for full
contracts and code excerpts — this file is the checklist.

**Read `reference.md`'s "Vocabulary" section before designing anything.**
There is no separate `views.ts`/view layer in eta — that architecture was
tried and removed. A `Concept` is model+view+controller for one domain idea
(a new `docType`, its own document, its own undo history); `render()`
returns the *whole* current screen, not a per-concept fragment; an applet
is only for a DOM element that needs client-side JS state to survive a
re-render (a typed filter, not "the view for X"). If your plan for a new
example has a `Renderer`, a `views/` directory, or one concept per screen
rather than per domain idea, stop and re-read that section first.

## Adding or extending an example

1. **`db.ts`** — import `db` from `../../src/db`, call
   `migrate(db, `${import.meta.dir}/migrations`, "<name>")`, re-export `db`.
   Every document module in this example imports `db` from here, never from
   `src/db` directly, so migrations are guaranteed to have run first.
2. **`migrations/*.sql`** — numbered `0001_`, `0002_`, ... applied in filename
   order, recorded under this example's own namespace (its `name`).
3. **`documents/<thing>.ts`** — `read(id)` returns the current shape;
   `patch(id, ops, sessionId, undoes?)` applies ops, builds their inverse, calls
   `record(prefixDoc(docType, id), applied, inverse, sessionId, undoes)`, returns
   `{version, applied}`. Pass the acting `sessionId` to `record()` (not the
   document `id` when writing shared documents like rooms) so undo attributes
   to that session. Validate values (blank, too long, etc.) inside `patch()`,
   not in the concept's `permit()` — one home for "is this value valid."
4. **`concepts/<thing>.ts`** — implement the `Concept` contract: `docType`,
   `resolveDoc`, `permit`, `write`, and optionally `render`/`replay`/
   `onOpen`/`onClose`. `write()` echoes via `ws.send(patchMessage(...))`;
   `replay()` is `write`'s twin for undo — same apply-then-echo path, but
   skips `permit()` since it's replaying an already-recorded inverse, not a
   fresh request.
5. **`applets/<name>.ts`** — only when a piece of UI needs live client-side
   state a plain form/button can't express (typing-to-filter, etc.). Call
   `registerApplet(name, {mount, update?})` from `src/applets`.
6. **`client/index.html` + `client/main.ts`** — `main.ts` imports this
   example's own applets first, then imports `src/client/app`. The kernel's
   client knows nothing about any specific applet.
7. **`index.ts`** — export `example: Example` = `{ name, concepts: [...],
   active(sessionId), index, routes? }`. This is the one thing the kernel
   needs to run the example.
8. **`cli.ts`** (optional) — export an `aliases` table of short verbs mapping
   to `{doc, ops}`. No database import here; it only builds wire ops.
9. **Tests** — one test file per document (`documents/<thing>.test.ts`), plus
   a `server.test.ts` that drives real writes and undo end-to-end over a
   websocket (this is also where chat covers its *concepts'* behavior --
   there's no separate `concepts/<thing>.test.ts` per concept). Add
   `client/app.test.ts` if the client has custom rendering/scroll behavior
   to verify, and `cli.test.ts` if `cli.ts` exists. Run `bun run test` (not
   bare `bun test --coverage` -- the `test` script sets `DB_PATH=:memory:`,
   which a bare invocation won't), aiming for 100% coverage. Verify every
   bug fix by reverting it, confirming the new test fails, then restoring it
   (see the project's `CLAUDE.md`).

Nothing above ever requires editing a file under `src/`. If a change seems to
need that, it's usually a sign the kernel is missing a seam (like `Example`
or `Concept.replay`) rather than that this example is special — check
`reference.md`'s "when it looks like you need to touch src/" section first.
