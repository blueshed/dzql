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

- Column types: `text`, `integer`, `real`, `boolean`, `json`, `timestamptz`; append `?` for
  nullable, or `{ type, default, nullable }`.
- A column neither nullable nor defaulted is **required**: an add without it is 400 `Required
  field missing`. Give it a default or make it nullable.
- `parent: "lists"` makes the key column `lists_id`; `cascadeOn: ["user_id"]` removes a row when
  the row its key names is removed (`writes.md`).
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
- **A line or a part is a row under its parent** (`lines` with `parent: "orders"`), never a
  JSON column of ids or a link column on the other row: a document includes its rows, and every
  holder is told each one that arrives or leaves. **A part goes where its whole goes**: a write
  names the whole (an order's line names the set, not its dishes), and its parts come with it.
  Rows of one kind tied by a column (`part_of`) are each still a whole of their own, so any
  write can take one alone; that a set is ordered together is then held by the page, not the
  server. Rows that become parts of another move under it (a migration's `up`, `migrations.md`).
- **A fact that comes from other rows is worked out, never stored**: whether a room is taken, from
  its open stays. A recompute document reads it (`custom-docs.md`); a column written beside each
  stay is a second copy the app must keep honest. Its limit: a value a person may change (a due
  date someone extends), or one from a rule that may change, is the row's own and is stored, set as
  the row is written; when the rule changes, a migration fills it for the rows before.

## Validating before a write

```ts
const errors = validateOps(schema, itemsDoc, [{ op: "add", path: "/items/-", value: { name: "a" } }], { doc: "items:" });
```

Give it the name (`{ doc }`) or `{ list, values }`, so it knows single or list mode; given
neither, a root field's replace is taken as single and a root row's add as list. It refuses
what the backend refuses as a mistake (400); a 404, a 409 or a value the column cannot cast is
the database's. The backend runs it on every write: `sqlite/validate.ts`.

