# A document that does not grow forever

Leave's `team:1` holds every request anyone has ever made: it is the first document you reach for,
and every write redraws each page that read it from all of it. Hiding what is done (`/hide`,
[bento.md](bento.md)) hides it on the page, not in the document. A cafe's `till:1` with every bill
ever is the same. Before a document's rows pile up, say what the page needs open, and hold only
that. How documents are declared is [documents.md](documents.md); the scope's syntax is delta's
(`delta-doc` skill, *`scope` syntax*).

## Today's, or one shift's: make the day the root

A single document is one root row and its children, by their parent keys
(`defineDoc("household:", { root: "households", include: ["guests", "asks", "claims"] })`, the
wedding's). So give the day, or the shift, a row, and hang what happens in it beneath it:

```ts
shifts: { table: "cafe_shifts", columns: { opened_at: "text", closed_at: "text?" }, temporal: false },
bills: { table: "cafe_bills", parent: "shifts", columns: { table_no: "integer", paid: "boolean" }, temporal: false },
orders: { table: "cafe_orders", parent: "bills", columns: { item: "text" }, temporal: false },

defineDoc("shift:", { root: "shifts", include: ["bills", "orders"] }), // shift:7 is its bills and their orders, nothing older
```

`resolveDoc` names the open shift (a query of the tables: which shift has no `closed_at`); a past
one is its own document, opened only by a page that asks for it. Name it by its row's id, not a
date: on Postgres an id is a number.

## What is open: a list scoped by a column

A scope that does not bind `id` is a list: every root row it admits.

```ts
defineDoc("bills-by:", { root: "bills", include: [], scope: { paid: ":id" } }), // bills-by:false
defineDoc("leave-from:", { root: "requests", include: [], scope: { ends: ">=:id" } }), // leave-from:2026-10-14, what is not over
```

- A list includes its collections **in full**: give it none, or every order ever comes with it.
- An add through it takes the scope's values (`paid: false`); a write that takes a row out of its
  scope through it is refused. Pay the bill through a document that holds it (`bill:<id>`, or the
  shift): it leaves `bills-by:false`, and every page that read that list is told.

## Or a window: when the past is what they came for

A conversation is read back in order, and its history is the point: keep the room whole and draw a
window of it by a keyset (chat's `/before`, [documents.md](documents.md)). Scope when what is done
is done for this page (a bill paid, a past shift, leave that is over); window when the person is
reading back through it. Neither loses anything: the rows are still in the tables, each in a
document a page opens when a story asks for it.
