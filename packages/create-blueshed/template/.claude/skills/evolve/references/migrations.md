# Change a schema that holds data

When a resource's schema changes. Every change to the tables is the next migration in the resource's history, from the first table on ([sqlite.md](sqlite.md) made `001-order`). Change the schema, then `migrations make` writes what it says beyond the history: a table, a column added or dropped. What a diff cannot know, you add to the file it writes: a rename, a change of type, data moved (`up`). Version two of the order counts an item: an order's lines of one item become one line with its `quantity`. The documents and their tests are as they were (a line added is quantity 1); the page counts on the line.

The schema declares the column:

```ts
// src/resources/order/order-api.ts: in place of export type Line = { id: number; item: number };
export type Line = { id: number; item: number; quantity: number };
```

```ts
// src/resources/order/order-api.ts: in place of lines: { parent: "orders", columns: { item: "integer" } },
lines: { parent: "orders", columns: { item: "integer", quantity: { type: "integer", default: 1 } } },
```

`make` writes the column, and you add the data it cannot know: the lines that become one. Its changes and its `up` run in one transaction, so they fail together. The lines are temporal: a line taken off keeps its row, closed (`valid_to` set). So the `up` counts only live lines (`current_lines`), and closes the lines it folds, as delta closes a row:

```sh
bunx @blueshed/delta migrations make src/resources/order/order-api.ts --dir src/resources/order/migrations --name quantity
```

```ts
// src/resources/order/migrations/002-quantity.ts
// Made by `delta migrations make` from the definitions: what they say beyond the migrations before it.
import { addColumn } from "@blueshed/delta/migrations";
import type { Database } from "bun:sqlite";

export const changes = [
  addColumn("lines", "quantity", { type: "integer", default: 1 }),
];

// By hand: an order's live lines of one item become its first, with how many there were; the others are closed, so their history stays
const first = "(SELECT min(id) FROM current_lines AS l WHERE l.orders_id = lines.orders_id AND l.item = lines.item)";

export function up(db: Database) {
  db.run(`UPDATE lines SET quantity = (SELECT count(*) FROM current_lines AS l WHERE l.orders_id = lines.orders_id AND l.item = lines.item) WHERE valid_to IS NULL AND id = ${first}`);
  db.run(`UPDATE lines SET valid_to = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE valid_to IS NULL AND id <> ${first}`);
}
```

`make` writes `index.ts` again, with the new migration in it:

```ts
// src/resources/order/migrations/index.ts
// Made by `delta migrations make`: this folder's migrations, in order, as an import a bundle carries
// (`await migrate(db, migrations, ...)`). Never edited by hand: `make` writes it again.
import * as m001_order from "./001-order";
import * as m002_quantity from "./002-quantity";

export const migrations = [
  { id: "001-order", ...m001_order },
  { id: "002-quantity", ...m002_quantity },
];
```

A row an `up` adds takes its id from `nextId`, the collection's serial, never from `_delta_sequences`: `export async function up(db: Database, { nextId }: MigrationTools) { const id = await nextId("items"); db.run("INSERT INTO items (id, name, price, valid_from) VALUES (?, 'Scone', 2, datetime('now'))", [id]); }`. Rows that become parts of another (the toast and tea that become a breakfast's) move under it in an `up`: each inserted as a part with the whole's id as its parent key, and removed from where it was, so nothing can name it alone; a line that named one names the whole. Find a row by its id, never its name.

The page counts on the line: Add puts one more on the item's line, or a line for it, and × takes one off, the line going with the last. Each line says how many, in your order and in the kitchen:

```tsx
// src/resources/order/order-view.tsx: after import { catalogue, kitchen, order, yourOrder } from "./order";
import type { Line } from "./order-api";
```

```tsx
// src/resources/order/order-view.tsx: after const money = (n: number) => n.toFixed(2);
const named = (l: Line) => `${item(l.item)?.name ?? ""}${l.quantity > 1 ? ` ×${l.quantity}` : ""}`; // Tea, or Tea ×2
```

```tsx
// src/resources/order/order-view.tsx: after const change = (ops: DeltaOp[])
/** Add: one more on the item's line, or a line for it. */
const add = (id: number) => {
  const line = lines.peek().find((l) => l.item === id);
  return change(line ? [{ op: "replace", path: joinPath("lines", line.id, "quantity"), value: line.quantity + 1 }] : [{ op: "add", path: "/lines/-", value: { item: id } }]);
};
/** ×: one fewer, and the line goes with the last. */
const takeOne = (l: Line) => change(l.quantity > 1 ? [{ op: "replace", path: joinPath("lines", l.id, "quantity"), value: l.quantity - 1 }] : [{ op: "remove", path: joinPath("lines", l.id) }]);
```

```tsx
// src/resources/order/order-view.tsx: in place of act: tool("Add", { icon: Plus,
act: tool("Add", { icon: Plus, label: `Add ${i$.peek().name}`, on: () => void add(i$.peek().id) }),
```

```tsx
// src/resources/order/order-view.tsx: in place of .map((o) => ({ id: o.id, items:
.map((o) => ({ id: o.id, items: Object.values(k!.lines).filter((l) => l.orders_id === o.id) }))
```

```tsx
// src/resources/order/order-view.tsx: in place of body: rowsOf(open, (o) => o.id,
body: rowsOf(open, (o) => o.id, (o$) => row({ what: () => `Order ${o$.get().id}`, note: () => o$.get().items.map(named).join(", ") }), "No open orders."),
```

```tsx
// src/resources/order/order-view.tsx: in place of const total = () =>
const total = () => lines.get().reduce((sum, l) => sum + (item(l.item)?.price ?? 0) * l.quantity, 0);
```

```tsx
// src/resources/order/order-view.tsx: in place of what: () => item(l$.get().item)?.name ?? "",
what: () => named(l$.get()),
```

```tsx
// src/resources/order/order-view.tsx: in place of state: () => money(item(l$.get().item)?.price ?? 0),
state: () => money((item(l$.get().item)?.price ?? 0) * l$.get().quantity),
```

```tsx
// src/resources/order/order-view.tsx: in place of act: tool("Remove", { icon: X,
act: tool("Remove", { icon: X, iconOnly: true, kind: "quiet", on: () => void takeOne(l$.peek()) }),
```

A quantity read on the page and written back is right for a document one person writes, as their order is. A count several people change at once is rows, a row each, never a number read and written back: delta keeps its three verbs on purpose.

Its stories:

```ts
// stories.ts: after stories: {
  // The upgrade
  upgrade: story("Orders made before an upgrade are there after it, a line per item with how many."),
  counted: story("Two of an item on an order are one line with how many, and × takes one off."),
```

The test makes the database as version one left it (its history, `001-order`, and the orders people made, a Tea taken off among them), and starts version two on it:

```ts
// tests/order-migrate.test.ts
import { test, expect, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { defineSchema, fromFolder, importTables, migrate, migrationStatus } from "@blueshed/delta/sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { startServer } from "../src/routes";
import { catalogue, schema, type Order } from "../src/resources/order/order-api";
import { stories } from "../stories";
import { documents } from "./documents";

const dataDir = mkdtempSync(`${tmpdir()}/order-migrate-`);
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));
const history = await fromFolder(`${import.meta.dir}/../src/resources/order/migrations`);

// The database as version one left it: its history so far, and order 1 with a line for each Tea, one Cake, and a Tea taken off (closed)
const one = defineSchema({
  items: { columns: { name: "text", price: "real" } },
  orders: { columns: {} },
  lines: { parent: "orders", columns: { item: "integer" } },
});
const old = new Database(`${dataDir}/app.db`, { create: true });
await migrate(old, history.slice(0, 1), { app: "order" });
importTables(old, one, {
  tables: {
    ...catalogue.tables,
    orders: [{ id: 1 }],
    lines: [
      { id: 1, orders_id: 1, item: 1 }, { id: 2, orders_id: 1, item: 1 }, { id: 3, orders_id: 1, item: 2 },
      { id: 4, orders_id: 1, item: 1, valid_from: "2026-10-01T10:00:00Z", valid_to: "2026-10-01T10:05:00Z" },
    ],
  },
});
old.close();

// A server on the data folder, and order 1's lines as it holds them: [id, item, quantity]
async function orderLines() {
  const server = await startServer({ port: 0, dev: false, dataDir });
  const client = await documents(server);
  try {
    const order = await client.open<Order>("order:1");
    return Object.values(order.value().lines).map((l) => [l.id, l.item, l.quantity]);
  } finally {
    client.close();
    await server.stop(true);
  }
}

test(`${stories.stories.upgrade.name} -- an order kept by version one, started on version two: its live lines counted, the others closed, not deleted`, async () => {
  expect(await orderLines()).toEqual([[1, 1, 2], [3, 2, 1]]); // the Tea taken off is not counted back on
  const db = new Database(`${dataDir}/app.db`);
  const rows = db.query("SELECT id, valid_to IS NULL FROM lines ORDER BY id").values();
  db.close();
  expect(rows).toEqual([[1, 1], [2, 0], [3, 1], [4, 0]]); // every line's history kept
});

test(`${stories.stories.upgrade.name} -- a migration runs once: started again, the order is as it was and nothing is pending`, async () => {
  expect(await orderLines()).toEqual([[1, 1, 2], [3, 2, 1]]);
  const db = new Database(`${dataDir}/app.db`);
  const status = await migrationStatus(db, history, { app: "order", schema });
  db.close();
  expect(status.ran.map((r) => r.id)).toEqual(["001-order", "002-quantity"]);
  expect(status.pending).toEqual([]);
});
```

The page, as a person counts:

```ts
// tests/order-count.test.ts
import { test, afterAll, setDefaultTimeout } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { startServer } from "../src/routes";
import { stories } from "../stories";
import { browser } from "./browser";

setDefaultTimeout(30_000);

const dataDir = mkdtempSync(`${tmpdir()}/order-count-`);
const server = await startServer({ port: 0, dev: false, dataDir });
const { view, open, waitFor, close } = browser(() => server.url);

afterAll(async () => {
  close();
  await server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

const TEA = `.cell[data-key="catalogue"] .rows > .row:nth-child(1) > .tool`;
const ORDER = `.cell[data-key="your-order"]`;
const shown = `[...document.querySelectorAll('${ORDER} .rows .what')].map((w) => w.textContent.trim()).join(", ")`;
const total = (amount: string) => `document.querySelector('${ORDER} .row.total .state')?.textContent === "${amount}"`;
const kitchen = `(document.querySelector('.cell[data-key="kitchen"] .rows')?.textContent ?? "")`;

test(`${stories.stories.counted.name} -- Add counts on the item's line, the kitchen sees how many, and × takes one off`, async () => {
  await open();
  await view.click(TEA);
  await waitFor(`${shown} === "Tea"`);
  await view.click(TEA);
  await waitFor(`${shown} === "Tea ×2"`); // one line, two Teas
  await waitFor(total("5.00"));
  await waitFor(`${kitchen}.includes("Tea ×2")`);

  await view.click(`${ORDER} .rows > .row:nth-child(1) > .tool`);
  await waitFor(`${shown} === "Tea"`);
  await view.click(`${ORDER} .rows > .row:nth-child(1) > .tool`); // the last goes with its line
  await waitFor(total("0.00"));
});
```

The kitchen's test, on a new data folder, shows the other side: a new database runs the whole history, `001-order` then `002-quantity`, and ends as an upgraded one does.

Working: `tests/evolve.ts` makes a new app from this template, applies this page (after two-documents.md and sqlite.md) and runs its type check and tests (`bun run test:evolve`).

- **An `up` on a temporal table reads and writes only live versions** (`current_<table>`, or `valid_to IS NULL`) and closes a row rather than deleting it: the closed versions are its history.
- **Change the schema, then `make`.** Never write a migration's changes by hand, and never edit one that has run anywhere, nor rename its file: write the next one.
- What `make` cannot know it says as `// By hand:` lines (a rename, a changed type); data is an `up`, the backend's SQL.
- **An `up` is the SQL of the backend it was written on.** When the app moves to Postgres, the new database is made by the history's changes and takes the rows migrated already (`importTables`), so an `up` written for SQLite never runs there: the history says `imported: true` ([postgres.md](postgres.md), "The history moves with the app"). The next `up` is Postgres's. Never edit one that has run to hold both. How a history runs (once, in order, each in its own transaction, under its `app`), where undo stops, expand and contract, and `bunx @blueshed/delta migrate ... --status`: delta-doc's `reference/migrations.md`.
- The JSON file has no migrations: it is for documents you can reset.
