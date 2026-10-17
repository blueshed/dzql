# Change a schema that holds data

When a resource's schema changes. Every change to the tables is the next migration in the resource's history, from the first table on ([sqlite.md](sqlite.md) made `001-order`). Change the schema, then `migrations make` writes what it says beyond the history: a table, a column added or dropped. What a diff cannot know, you add to the file it writes: a rename, a change of type, data moved (`up`). Version two of the order counts an item: an order's lines of one item become one line with its `quantity`. The page and its tests are as they were (a line added is quantity 1).

The schema declares the column:

```ts
// src/resources/order/order-api.ts: in place of export type Line = { id: number; item: number };
export type Line = { id: number; item: number; quantity: number };
```

```ts
// src/resources/order/order-api.ts: in place of lines: { parent: "orders", columns: { item: "integer" } },
lines: { parent: "orders", columns: { item: "integer", quantity: { type: "integer", default: 1 } } },
```

`make` writes the column, and you add the data it cannot know: the lines that become one. Its changes and its `up` run in one transaction, so they fail together:

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

// By hand: an order's lines of one item become its first line, with how many there were
const first = "(SELECT min(id) FROM lines AS l WHERE l.orders_id = lines.orders_id AND l.item = lines.item)";

export function up(db: Database) {
  db.run(`UPDATE lines SET quantity = (SELECT count(*) FROM lines AS l WHERE l.orders_id = lines.orders_id AND l.item = lines.item) WHERE id = ${first}`);
  db.run(`DELETE FROM lines WHERE id <> ${first}`);
}
```

The test makes the database as version one left it (its history, `001-order`, and the orders people made), and starts version two on it:

```ts
// tests/order-migrate.test.ts
import { test, expect, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { connectWs, openDoc } from "@blueshed/delta/client";
import { defineSchema, fromFolder, importTables, migrate, migrationStatus } from "@blueshed/delta/sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { startServer } from "../src/server";
import { catalogue, schema, type Order } from "../src/resources/order/order-api";

const dataDir = mkdtempSync(`${tmpdir()}/order-migrate-`);
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));
const history = await fromFolder(`${import.meta.dir}/../src/resources/order/migrations`);

// The database as version one left it: its history so far, and order 1 with a line for each Tea, and one Cake
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
    lines: [{ id: 1, orders_id: 1, item: 1 }, { id: 2, orders_id: 1, item: 1 }, { id: 3, orders_id: 1, item: 2 }],
  },
});
old.close();

// A server on the data folder, and order 1's lines as it holds them: [id, item, quantity]
async function orderLines() {
  const server = await startServer({ port: 0, dev: false, dataDir });
  const client = connectWs(new URL("/ws", server.url).href);
  try {
    const order = openDoc<Order>("order:1", client);
    await order.ready;
    return Object.values(order.data.peek()!.lines).map((l) => [l.id, l.item, l.quantity]);
  } finally {
    client.close();
    await server.stop(true);
  }
}

test("an order kept by version one comes through the upgrade: a line per item, with its quantity", async () => {
  expect(await orderLines()).toEqual([[1, 1, 2], [3, 2, 1]]);
});

test("a migration runs once: started again, the order is as it was and nothing is pending", async () => {
  expect(await orderLines()).toEqual([[1, 1, 2], [3, 2, 1]]);
  const db = new Database(`${dataDir}/app.db`);
  const status = await migrationStatus(db, history, { app: "order", schema });
  db.close();
  expect(status.ran.map((r) => r.id)).toEqual(["001-order", "002-quantity"]);
  expect(status.pending).toEqual([]);
});
```

The kitchen's test, on a new data folder, shows the other side: a new database runs the whole history, `001-order` then `002-quantity`, and ends as an upgraded one does.

- **Change the schema, then `make`.** Never write a migration's changes by hand, and never edit one that has run anywhere, nor rename its file: write the next one.
- **What `make` cannot know it says** as `// By hand:` lines: a column gone and one new (if it is a rename, make it `renameColumn`, or the values are lost), a changed type, a table's parent or versions. Data is an `up`, beside the changes.
- An `up` is the backend's SQL: on SQLite `db.run`, on Postgres (dzql) `await tx.query`. A history meant for both keeps its `up`s to the changes it can say, or names its backend.
- Each migration runs once, in order, in its own transaction, recorded in `delta_migrations` under its `app` (here the resource's name). A failure rolls that one back, changes and all, and throws naming it.
- Undo stops at a migration: what was written before it is not undoable. Expand and contract (two versions on one database), and `bunx @blueshed/delta migrate <database> --app order --dir src/resources/order/migrations --status`: delta-doc's `reference/migrations.md`.
- The JSON file has no migrations: it is for documents you can reset.
