# A document that does not grow forever

Leave's `team:1` holds every request anyone has ever made: it is the first document you reach for,
and every write redraws each page that read it from all of it. Hiding what is done (`/hide`,
[bento.md](bento.md)) hides it on the page, not in the document. A cafe's `till:1` with every bill
ever is the same. Before a document's rows pile up, say what the page needs open, and hold only
that. How documents are declared is [documents.md](documents.md); the scope's syntax is delta's
(`delta-doc` skill, *`scope` syntax*).

Working: [examples/chat](https://github.com/blueshed/dzql/blob/main/packages/dzql/examples/chat/resources/room/room-api.ts), a list scoped by a column
(`room:general`, every message whose `room` it is: `resources/room/room-api.ts`), read back in a
window by a keyset (`/before`, `resources/session/session.ts`); and
[examples/cafe](https://github.com/blueshed/dzql/blob/main/packages/dzql/examples/cafe/resources/kitchen/kitchen-api.ts), a list of only what is open:
`kitchen:placed`, every order not yet placed, the model's `kitchen` scoped as the app registers it
(`resources/kitchen/kitchen-api.ts`). Placing an order at its table takes it out, and every page
that read it is told; paying for it changes nothing there. Today's, by date or as a root row,
none yet.

## Today's, or one shift's

Today's rows, flat, with nothing of the day's own to keep (a gym's check-ins), are a list scoped
by their date column, named by the date: `checkins:2026-03-02`, which `resolveDoc` works out
(`new Date().toISOString().slice(0, 10)`: the day in UTC, as leave's page takes today).

```ts
defineDoc("checkins:", { root: "checkins", include: [], scope: { day: ":id" } }), // checkins:2026-03-02, today's and nothing older
```

Make the day, or the shift, a root row of its own when what happens in it hangs beneath it (bills,
and their orders), when it keeps something of its own (opened, closed), or when it does not end at
midnight (a shift). A single document is one root row and its children, by their parent keys
(`defineDoc("household:", { root: "households", include: ["guests", "asks", "claims"] })`, the
wedding's):

```ts
shifts: { table: "cafe_shifts", columns: { opened_at: "text", closed_at: "text?" } },
bills: { table: "cafe_bills", parent: "shifts", columns: { table_no: "integer", paid: "boolean" } },
orders: { table: "cafe_orders", parent: "bills", columns: { item: "text" } },

defineDoc("shift:", { root: "shifts", include: ["bills", "orders"] }), // shift:7 is its bills and their orders, nothing older
```

`resolveDoc` names the open shift (a query of the tables: which shift has no `closed_at`), by its
row's id: a shift is not a date. A past one is its own document, opened only by a page that asks
for it.

## What is open: a list scoped by a column

A scope that does not bind `id` is a list: every root row it admits.

```ts
defineDoc("bills-by:", { root: "bills", include: [], scope: { paid: ":id" } }), // bills-by:false
defineDoc("leave-from:", { root: "requests", include: [], scope: { ends: ">=:id" } }), // leave-from:2026-10-14, what is not over

// the cafe's: the model says the list, the app what is open in it
register(docs.filter((d) => d.prefix === "kitchen:").map((d) => ({ ...d, scope: { status: "!=:id" } }))); // kitchen:placed
```

- A list includes only what hangs under the roots it admits: `bills-by:false` with `include:
  ["orders"]` (orders under bills) is the unpaid bills and their orders, never a paid bill's. With
  no condition it admits every root, so every order ever comes with it: scope it, or give it none.
- An add through it takes the scope's values (`paid: false`); a write that takes a row out of its
  scope through it is refused. Pay the bill through a document that holds it (`bill:<id>`, or the
  shift): it leaves `bills-by:false`, and every page that read that list is told.

## Or a window: when the past is what they came for

A conversation is read back in order, and its history is the point: keep the room whole and draw a
window of it by a keyset (chat's `/before`, [documents.md](documents.md)). Scope when what is done
is done for this page (a bill paid, a past shift, leave that is over); window when the person is
reading back through it. Neither loses anything: the rows are still in the tables, each in a
document a page opens when a story asks for it.
