# Scope: what a document's name selects

From `src/cases/path.ts`: one table, a document per wedding and one per highest price.

```ts
defineDoc("fo-slots-of:", { root: "slots", include: [], scope: { weddings_id: ":wedding" } });
defineDoc("fo-slots-upto:", { root: "slots", include: [], scope: { price: "<=:max" } });
// "fo-slots-of:5" → every slot whose weddings_id is 5, keyed by id (list mode);
// an add /slots/- through it takes weddings_id 5 from the name, never from the value
```

One rule on every backend: `resolveScope` (`src/server/scope.ts`), for SQLite and the JSON
file; dzql answers the same cases on Postgres.

Working: [examples/lists](https://github.com/blueshed/dzql/blob/main/packages/delta/examples/lists/resources/lists/lists-api.ts), `mine:<person>`, a list
by its scope (`{ person: ":id" }`: every membership of that person), in
`resources/lists/lists-api.ts`; [examples/kanban](https://github.com/blueshed/dzql/blob/main/packages/delta/examples/kanban/resources/board/board-api.ts)'s
`board:<id>`, a single one (`{ id: ":id" }`, `resources/board/board-api.ts`); a viewport, two
conditions on each axis, and a window of time named by two instants: `rangeScopeCases`
(`src/cases/planning.ts`), run on every backend.

## The values

`scope` maps a root column to a value read from the name, after the prefix, split on `:`.

- `":id"` (or plain `"id"`: the colon is optional, a plain value is a param, never a literal):
  `col = <param>`. `"=:name"` is the same, explicit.
- `"<=:end"`, `>=`, `<`, `>`, `!=`: a range. `"like:prefix"`: starts with, any case.
- `"at:when"`: the time the document is read at, not a condition (below).
- **Several conditions on one column** are a list of them, each holding: a map's viewport is
  `scope: { lat: [">=:south", "<=:north"], lng: [">=:west", "<=:east"] }`, a window of time
  `{ starts: [">=:from", "<:until"] }`. The single string stays as it is; an `at:` is never in a list.
- `id` takes position 1; other names follow alphabetically, wherever they are said.
  `venue-at:42:2026-06-16` has `id=42` and the second; the viewport above is
  `sites-in:<east>:<north>:<south>:<west>` (`sites-in:3:52:45:-1`). An empty value sets no condition.
- **A write through it is held to every condition** (you may write what you may read): a row
  outside one is not there to it (404); an add or a replace that would land outside one is 404
  (`-- the add is not one <name> holds`, `-- the write would take it out of <name>`) and undone.
- Keys must be real columns of the root (`id`, its parent key, its columns): `"items.id"`
  throws at registration.

## Single or list

- A scope that binds `id`, or no scope and a non-empty id, is **single**: one root row and its
  children. The rest of the scope must hold too (`guest:1:a@x` is household 1 only while its
  email is `a@x`, else 404). Omit `scope` for a plain `WHERE id = <id>`.
- Anything else is **list**: every root row the conditions admit, keyed by id, and of each
  included collection the rows that hang under those roots (through its parent chain, as a single
  document's do), never a row under a root the list does not admit. `items:` is every item;
  `by-status:active` over `{ status: ":id" }` is every active row (`:id` names the param, not the
  row); `fo-menu-like:So` over courses, with their drinks, is the courses whose name starts "So"
  and only their drinks (`src/cases/path/fanout.ts`, "a scoped list holds what hangs under the
  roots it admits"). An included collection that hangs from no root row (no parent, or a chain that
  ends short of the root) comes whole.
- **A list is told as it reads**: a row added, written or removed under a root it admits reaches
  it, one under another root does not; a root written into its conditions arrives with the rows
  under it, and one written out of them leaves with them.
- **A list writes only within its scope**: an add gets the equality values and must meet the
  rest (else 404); a replace that would take a root row out of scope is 404 and undone; a row
  under a root it does not admit is not there to it (404), and one is added or moved only under a
  root it admits. A single document's root is held to its scope the same way.

## How values are read

As the column takes them, on every backend: a boolean's `true`/`yes`/`on`/`1`; an integer's
`05` is 5; a `json` column's value is the JSON it names; `text` stays as written; an id is a
whole number. A `timestamptz` is a date, `YYYY-MM-DD` (the instant midnight UTC begins it), or
**an instant in ISO 8601's basic format**, since a name's `:` splits the extended one: a date, `T`,
hours and minutes, perhaps seconds and a fraction, and a zone, always (`Z`, `±hh` or `±hhmm`):
`20261020T0800Z`, `20261020T080000+0100`, `20261020T080000.5Z`. Anything else is 400 (`starts must
be a date, YYYY-MM-DD, or an instant, 20261020T0800Z, not "20261020T0800"`); an `at:` takes either too. A `date` is a day, `YYYY-MM-DD`, compared by the calendar; a `numeric` a decimal (`3.50`),
compared by value, so `pay-over:10` admits `"950.00"` and not `"3.5"`, and `pay-of:3.50` is `"3.5"`'s.
A value the column cannot take (`seats-kept:maybe`) is 400.

## Gotchas

- Write times as ISO 8601 with a zone: a stored time without one is UTC. Only what Postgres's
  `timestamptz` holds, on every backend: a zone up to ±15:59, a year from 0001. Anything else
  written is 400.
- **`at:` reads the past**: a temporal table as it stood, the others as they are now. Such a
  document takes no writes (403). It is told only what its time does not keep; a future date reads as now.
- Do not put tenant-sensitive identifiers in a prefix (`tenant-42:`): error messages name
  prefixes.
