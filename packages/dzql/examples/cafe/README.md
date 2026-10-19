# The cafe, from its model

The worked example: an app told as stories on the model's page, checked, made into its definitions,
guards, migrations and proof by `dzql model`, then built as routes and resources until every story
passes, then read back against the model. It is laid out as `bun create dzql` lays out an app (here
at the example's root, where a project has `src/`). Read it in this order.

**1. The model, as told: [model.json](model.json).** A manager, a cook and customers, in 13
stories. Each says what it writes (`add invoices.paid=false`) and what it presupposes
(`requires tables.seated=false`); a `cannot` story is a refusal. The documents each person needs in
front of them:

| Document | Root | Holds | Held by | |
|---|---|---|---|---|
| `floor` | tables | invoices, orders | manager, cook | a `list`: every table (`floor:`) |
| `menu` | items | | cook, customer | a `list`: the whole menu (`menu:`) |
| `table` | tables | invoices, orders | customer | one table (`table:1`) |
| `door` | tables, its `name` only | | customer | a `list`: the ways in |
| `visit` | visits | | | `own`: each person's, the app's session |

**2. The checks, and what they make: [model/](model/).** `dzql model check` (or `bun run
dev:cafe`, which runs it after every change) closes every check, then writes `types.ts` (delta's
definitions, a row type per table, a shape per document), `guards.ts` (each story's write and what
it presupposes, stood in front of the store), `migrations/` (the newest rewritten in place until
committed) and `model.test.ts`, the proof: each story's write made through the guards as its
teller and seen by everyone it tells, and each `cannot` refused in its own words.

**3. The store: [store.ts](store.ts).** Postgres, through dzql's `openStore`: PGlite in the process
(in memory unless `PGLITE_DIR` names a folder), or a server at `DATABASE_URL`. The model's migrations
first, then the app's own tables beside them (who the staff are; what a visit holds beyond the
model's `table`); at `open()` the cafe is seeded and the guards go on `delta`, before the listener.
A resource's `permit` then says only what its page sends; who may send it is the guards'. The
stories run on the same store (`Example.store`), put back after each.

**4. A resource for each document: [resources/](resources/).** Each folder is one document:
`<name>-api.ts` registers the model's definition and reads it for the page, with the pure rules a
write follows; `<name>.ts` is its `Resource`; `<name>-view.ts` its part of the page. The visit is a
`perSession` resource, found by its cookie through `cookie:` (the model already names a document
`visit`). A list's resource resolves to the empty id (`floor:`).

**5. The page and the routes: [page.ts](page.ts), [routes.ts](routes.ts).** The page is each
person's box of the parts their resources draw. The staff come in by a link each (`signInLinks`,
[links.ts](links.ts), printed as the server starts and shown on the door); a customer by the code
on their table (`/scan`). `bun run dev:cafe` serves it on :3006 with the model's page at `/model`.

**6. The stories: [stories.ts](stories.ts).** 22, in the wire's words, each naming the model story
it tells (`model: 6`); one that is the app's own, such as signing out, says `model: false`.
`ETA_EXAMPLE=cafe bun run stories` runs them.

**7. Read back: is the app the model as told?** `bun run model:check cafe --against-page <the
page's model as JSON>` matches every story by its number and every document by its name: no gaps.
dzql's `src/modelling/conformance.test.ts` holds all of this to each other on every change: the
checks close, the proof passes through the guards, and the read-back finds no gap.
