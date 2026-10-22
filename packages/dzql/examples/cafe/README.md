# The cafe, from its model

The worked example: an app told as stories on the model's page, checked, made into its definitions,
guards, migrations and proof by `dzql model`, then built as routes and resources until every story
passes, then read back against the model. It is laid out as `bun create dzql` lays out an app (here
at the example's root, where a project has `src/`). Read it in this order.

**1. The model, as told: [model.json](model.json).** A manager, a cook and customers, in 14
stories. Each says what it writes (`add invoices.paid=false`) and what it presupposes
(`requires tables.seated=false`); a `cannot` story is a refusal. The documents each person needs in
front of them:

| Document | Root | Holds | Held by | |
|---|---|---|---|---|
| `floor` | tables | | manager | a `list`: every table, free or seated (`floor:`) |
| `kitchen` | orders | | manager, cook | a `list`, scoped by the app to what is open: the orders not yet placed (`kitchen:placed`) |
| `menu` | items | | manager, cook, customer | a `list`: the whole menu (`menu:`) |
| `table` | tables | invoices, orders | customer, manager | one table (`table:1`): the customer's, and the manager's to seat it and place an order there |
| `door` | tables, its `name` only | | customer, manager, cook | a `list`: the ways in, and the name each order's table goes by |
| `visit` | visits | | | `own`: each person's, the app's session |

No document the staff hold piles up: the floor is its tables, and the kitchen holds only what is
still to cook or to take (`scope: { status: "!=:id" }`, [resources/kitchen/kitchen-api.ts](resources/kitchen/kitchen-api.ts)), so
placing an order takes it out and every page that read it is told, and paying changes nothing
there. A table's invoices are its own document's.

An order names its dish (`dish: menu:/items`, kept as `dish_id`) and keeps its **surrogate** beside
it, the dish's name and price copied as it is ordered (`dish_name`, `dish_price`): while the dish
is on the menu the order shows the menu's, and once the cook takes it off, its own copy
(`orderOf`, [resources/kitchen/kitchen-api.ts](resources/kitchen/kitchen-api.ts)). So whoever holds the
orders holds the menu too. It names its table too (`table: door:/tables`, kept as `table_id`), as
a kitchen ticket does: the kitchen holds the orders alone, and says where each goes by the door's
names.

**2. The checks, and what they make: [model/](model/).** `dzql model check` (or `bun run
dev:cafe`, which runs it after every change) closes every check, then writes `types.ts` (delta's
definitions, a row type per table, a shape per document), `guards.ts` (each story's write and what
it presupposes, stood in front of the store), `migrations/` (the newest rewritten in place until
committed) and `model.test.ts`, the proof: each story's write made through the guards as its
teller and seen by everyone it tells, and each `cannot` refused in its own words.

**3. The store: [store.ts](store.ts).** Postgres, through dzql's `openStore`: PGlite in the process
(in the data folder's `pg/`: `DATA_PATH`, else `./data`; in memory for the tests), or a server at
`DATABASE_URL`. The model's migrations first, then the app's own tables beside them (who the staff
are; what a visit holds beyond the model's `table`); the guards go on `delta` as it loads, before
any listener, and the store is the app's `store`, which the server opens as it starts (the cafe
seeded, by `prepare`) and closes as it stops.
A resource's `permit` then says only what its page sends; who may send it is the guards'. The
stories run on the same store (`Example.store`), put back after each.

**4. A resource for each document: [resources/](resources/).** Each folder is one document:
`<name>-api.ts` registers the model's definition and reads it for the page, with the pure rules a
write follows; `<name>.ts` is its `Resource`; `<name>-view.ts` its part of the page. The visit is a
`perSession` resource, found by its cookie through `cookie:` (the model already names a document
`visit`). A list's resource resolves to the empty id (`floor:`), or to what its scope reads
(`kitchen:placed`).

**5. The page and the routes: [page.ts](page.ts), [routes.ts](routes.ts).** The page is each
person's box of the parts their resources draw. The staff come in by a link each (`signInLinks`,
[links.ts](links.ts), printed as the server starts and shown on the door), a demo door, shut in
production, where a cafe open for real signs its staff in its own way; a customer by the code on
their table (`/scan`). A visit lasts thirty days unused. Paying is never undone, and Undo changes
nothing on a paid invoice ([resources/table/table.ts](resources/table/table.ts)). `bun run
dev:cafe` serves it on :3006 with the model's page at `/model`.

**6. The stories: [stories.ts](stories.ts).** 25, in the wire's words, each naming the model story
it tells (`model: 6`); one that is the app's own, such as signing out, says `model: false`.
`ETA_EXAMPLE=cafe bun run stories` runs them.

**7. Read back: is the app the model as told?** `bun run model:check cafe --against-page <the
page's model as JSON>` matches every story by its number and every document by its name: no gaps.
dzql's `tests/modelling/conformance.test.ts` holds all of this to each other on every change: the
checks close, the proof passes through the guards, and the read-back finds no gap.
