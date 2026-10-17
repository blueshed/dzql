# Schema

`examples/kanban/schema.ts`: three tables in a parent chain, and the one document over them.

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
- `unique: ["name"]` (or `[["shed_id", "name"]]`, columns together) refuses a row that would share
  those values with another, **409**, on every backend; `{ columns: ["tool"], whereNull:
  ["returned"] }` holds it only among rows where `returned` is null: a tool on one open loan at a
  time. A table that keeps versions holds it among its current rows. A migration adds it with
  `addUnique` (`migrations.md`).
- **A line or a part is a row under its parent** (`lines` with `parent: "orders"`), never a
  JSON column of ids or a link column on the other row: a document includes its rows, and every
  holder is told each one that arrives or leaves. **A part goes where its whole goes**: a write
  names the whole (an order's line names the set, not its dishes), and its parts come with it.
  Rows of one kind tied by a column (`part_of`) are each still a whole of their own, so any
  write can take one alone; that a set is ordered together is then held by the page, not the
  server. Rows that become parts of another move under it (a migration's `up`, `migrations.md`).
- **A fact that comes from other rows is worked out, never stored**: whether a tool is out, from
  its open loans. A recompute document reads it (`custom-docs.md`); a column written beside each
  loan is a second copy the app must keep honest.

## Validating before a write

```ts
const errors = validateOps(schema, itemsDoc, [{ op: "add", path: "/items/-", value: { name: "a" } }], { doc: "items:" });
```

Give it the name (`{ doc }`) or `{ list, values }`, so it knows single or list mode; given
neither, a root field's replace is taken as single and a root row's add as list. It refuses
what the backend refuses as a mistake (400); a 404, a 409 or a value the column cannot cast is
the database's. The backend runs it on every write: `sqlite/validate.ts`.

