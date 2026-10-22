# Schema

`examples/kanban/resources/board/board-api.ts`: three tables in a parent chain, and the one document over them.

```ts
import { defineSchema, defineDoc } from "@blueshed/delta/sqlite";   // or ./json

export const schema = defineSchema({
  kanban_boards:  { columns: { owner_id: "integer", title: "text" }, temporal: false },
  kanban_columns: { columns: { owner_id: "integer", title: "text", position: "integer" },
                    parent: "kanban_boards", temporal: false },    // → kanban_boards_id
  kanban_cards:   { columns: { owner_id: "integer", title: "text", position: "integer" },
                    parent: "kanban_columns", temporal: false },   // → kanban_columns_id
});

export const docs = [
  defineDoc("board:", { root: "kanban_boards", include: ["kanban_columns", "kanban_cards"], scope: { id: ":id" } }),
];
```

The contract is `TableDef`, `ColumnDef`, `ColumnShorthand` and `DocDef` in `src/schema.ts`.

Working: [examples/kanban](https://github.com/blueshed/dzql/blob/main/packages/delta/examples/kanban/resources/board/board-api.ts), the tables above and
their parent keys (`resources/board/board-api.ts`);
[examples/lists](https://github.com/blueshed/dzql/blob/main/packages/delta/examples/lists/resources/lists/lists-api.ts), a list's members and items as
rows under it, and a column with a default (`done`), in `resources/lists/lists-api.ts`.

## Rules

- Column types: `text`, `integer`, `real`, `boolean`, `json`, `timestamptz`, `date`, `numeric`;
  append `?` for nullable, or `{ type, default, nullable }`.
- **A day with no instant is a `date`**: `"2026-10-20"` on the wire, as written, on every backend
  (an all-day booking, a birthday, the day a bill is paid). A write that is no day the calendar has, or a time,
  is 400 (`day must be a date, YYYY-MM-DD`). SQLite and the JSON file keep the text; Postgres a `DATE`.
- **Money and any exact decimal is a `numeric`**, a string on the wire (`"10.50"`), never `real`
  (`0.1 + 0.2`). A number on the wire is 400, so no float slips in, and so is text that is no
  decimal (`"1e3"`, `"NaN"`, `"+1"`, `".5"`). It is kept exactly and given back as Postgres's
  `NUMERIC` writes it, on every backend: no leading zeros, no sign on zero, the scale as written
  (`"007.50"` is `"7.50"`). SQLite keeps it as that text, and a scope compares it by value (as a
  number there: exact to 15 significant digits; Postgres compares exactly). It is not `unique`'s
  (`1.5` and `1.50` are one number, two texts): `defineSchema` throws. A required one defaults to `"0"`.
- **A time is a `timestamptz` column, never `text`.** A write gives ISO 8601 with a zone
  (`new Date().toISOString()`); what is no time is 400, and every backend gives it back in UTC
  (`2026-10-20T09:00:00+00:00`). The zone's rules: `scope.md`. A time only the server sets
  (when a row was written) is `default: "now"`: below.
- A column neither nullable nor defaulted is **required**: an add without it is 400 `Required
  field missing`. Give it a default or make it nullable.
- **A value a rule gives as the row is written is stored, set by the server**: a booking's last
  day two weeks from its first, an invoice's pay-by date thirty days from when it is raised.
  Declare the column, and let the document's `shape` (below) fill it on the add, never the page;
  its `accept` refuses one a client sends. A migration's `up` fills it for the rows before
  (`migrations.md`). Worked out on each read instead, it moves when the rule does.
- `parent: "lists"` makes the key column `lists_id`; `cascadeOn: ["user_id"]` removes a row when
  the row its key names is removed (`writes.md`).
- **A column that names a row of another collection** is `refs: { film: "films" }` (an integer
  column, the row's id; null names nothing). A write that leaves it naming a row not there is
  refused, **404**; removing a row a current row still names is refused, **409**, naming who
  names it (`Still named: films/1 is showings/4's film -- change or remove that first`). Asked
  when the write is done, so one write may take both away, in either order; a removal's cascade
  takes what it reaches. A version closed names nothing. It is the definitions' alone: no
  migration, and rows already kept are not asked. The cases are `refsCases`.
- `temporal` defaults to true (`valid_from` / `valid_to`, read with `open_at`); rows come back
  without those columns.
- Table names are lowercase snake_case on every backend: `{ prMixed: { table: "pr_mixed", … } }`;
  `"PrMixed"` throws. A keyword (`order`, `from`) is fine: names are quoted.
- A root row added through a list document is given its scope's equality values from the name
  (`scope.md`), so it need not repeat them.
- `unique: ["name"]` (or `[["hotel_id", "name"]]`, columns together) refuses a row that would share
  those values with another, **409**, on every backend; `{ columns: ["room"], whereNull:
  ["left"] }` holds it only among rows where `left` is null: a room in one open stay at a
  time. A table that keeps versions holds it among its current rows. A migration adds it with
  `addUnique` (`migrations.md`).
- **Two rows that may not hold the same time** (a room booked twice, a person on leave twice) is
  `noOverlap: [{ range: ["starts", "ends"], same: ["room_id"] }]`: two current rows with equal
  `same` columns whose ranges overlap are refused, **409**, on every backend, naming both
  (`Overlaps: bookings/3 and bookings/1, of the same room_id, both hold starts to ends at once --
  move or remove one first`). A range is half open, `[starts, ends)` (a meeting until ten leaves ten
  free), unless `bounds: "[]"` (leave from the 5th to the 9th holds the 9th); a null bound is open on
  that side; one that ends before it starts is 400. Its columns are times, dates or numbers (of one
  type); `same` is text, integer, boolean, date or the parent key, and may be left out (no two rows
  at all). Asked once the write is done, in its transaction, so a batch may swap two bookings in any
  order; a closed version holds nothing; a walk is held to it (a conflict). On Postgres it is an
  `EXCLUDE` constraint besides (`postgres.md`); it is the definitions' alone, no migration, so rows
  kept before it are asked only when next written there. The cases are `noOverlapCases`
  (`src/cases/planning.ts`). A rule that reads other stored rows (no cycle in a tree, a period
  closed) is none of these yet: a recompute document shows it.
- **A line or a part is a row under its parent** (`lines` with `parent: "orders"`), never a
  JSON column of ids or a link column on the other row: a document includes its rows, and every
  holder is told each one that arrives or leaves. **A part goes where its whole goes**: a write
  names the whole (an order's line names the set, not its dishes), and its parts come with it.
  Rows of one kind tied by a column (`part_of`) are each still a whole of their own, so any
  write can take one alone; that a set is ordered together is then held by the page, not the
  server. Rows that become parts of another move under it (a migration's `up`, `migrations.md`).
- **A fact that comes from other rows is worked out, never stored**: whether a room is taken, from
  its open stays. A recompute document reads it (`custom-docs.md`); a column written beside each
  stay is a second copy the app must keep honest. Its limit: a value a person may change (a stay's
  last night, which a guest extends), or one a rule gives as the row is written, is the row's own
  and is stored (above).

## Validating before a write

```ts
const errors = validateOps(schema, itemsDoc, [{ op: "add", path: "/items/-", value: { name: "a" } }], { doc: "items:" });
```

Give it the name (`{ doc }`) or `{ list, values }`, so it knows single or list mode; given
neither, a root field's replace is taken as single and a root row's add as list. It refuses
what the backend refuses as a mistake (400); a 404, a 409 or a value the column cannot cast is
the database's. The backend runs it on every write: `sqlite/validate.ts`.

## A document's own rule: `accept`

What the schema cannot say is the document's own rule, beside its definition: a text that must
not be blank, a field only some people write. Every backend asks it of each op of a write before
any is applied, given the document's name and who is writing (`who`, as they signed in):

```ts
defineDoc("menu:", {
  root: "dishes",
  include: [],
  accept: (op) => op.op !== "add" || String((op.value as { name?: unknown }).name ?? "").trim() !== "" || "A dish needs a name",
});
```

`true` takes the op; a reason refuses the whole write with 400 and that reason (`false`, in
delta's words), and nothing changes. An undo or a redo is not asked: it puts back what was
taken. It holds for every writer, a page's socket, `createLocal()` and the CLI alike, so a rule
never lives in a socket handler of the app's. The cases are `acceptCases` (`src/cases/writes.ts`).

## What the server makes of a write: `shape`

A value a rule gives as the row is written is the server's: the document's `shape` is asked of
each op of a write, after `accept` has taken it, with who is writing, and answers the op to apply
in its place. dzql's thin client has the same hook for a page's writes (`Resource.shape`); this
one holds for every writer.

```ts
const DAY = 86_400_000;
defineDoc("desk:", {
  root: "desks",
  include: ["bookings"],
  accept: (op) => !(op.path.endsWith("/ends") || (op.value as { ends?: unknown } | undefined)?.ends !== undefined) || "The desk sets when a booking ends",
  shape: (op) => op.op === "add" && op.path.startsWith("/bookings/")
    ? { ...op, value: { ...(op.value as object), ends: new Date(Date.now() + 14 * DAY).toISOString() } }
    : op,
});
```

What it answers is validated as any write is (a field the schema does not declare is 400), then
stored, told to every holder, answered and recorded: the ledger keeps what was applied. An undo or
a redo is never shaped. The cases are `shapeCases` (`src/cases/writes.ts`).

## A time only the server sets: `default: "now"`

When something happened (a message said, an order placed) is the server's to say, never the
page's clock. Give the `timestamptz` column `default: "now"` and leave it out of every write:

```ts
const schema = defineSchema({
  entries: { columns: { text: "text", at: { type: "timestamptz", default: "now" } } },
});
```

- A write that names it is refused, **400**, on every backend: `/entries/-/at: at is set by the
  server as the row is written (default: "now"): leave it out`. A walk (undo, redo) puts back the
  time the row had, and rows imported keep theirs.
- A row a write makes takes the server's time as it is written, every row of the write the same
  time, back in UTC to the millisecond; on SQLite, the JSON file and Postgres alike.
- A replace of the row whole that leaves it out keeps the row's own: it is when the row was made.
- An implied document's root shows none (`null`) until its first write makes the row.
- A migration that adds such a column gives each row already there the migration's time.
- `"now"` on any other type is refused by `defineSchema`. A time set later (when it ended) is a
  row of its own, added then, with its own `default: "now"`.

The cases are `serverTimeCases` (`src/cases/writes.ts`); the recipe's messages are timed so
(`recipe.md`). A day and an exact decimal: `columnTypeCases` (`src/cases/planning.ts`).

