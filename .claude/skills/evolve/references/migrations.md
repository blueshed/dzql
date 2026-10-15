# Change a schema that holds data

When a resource's schema changes on a database people have used. The schema is the contract: delta reads and writes only the columns it declares, and a database may hold more, never less. A column the schema adds needs no migration: `migrateSchema` adds it, with its default. A migration is for what a schema cannot say: a rename, a drop, data moved. Version two of the order from [sqlite.md](sqlite.md) counts an item: an order's lines of one item become one line with its `quantity`. The page and its tests are as they were (a line added is quantity 1).

The migrations are the resource's, in `migrations/` beside it, each `NNN-name.ts` exporting `up`:

```ts
// src/resources/order/migrations/001-one-line-per-item.ts
/** Version two counts an item: an order's lines of one item become its first line, with how many there were. */
import type { Database } from "bun:sqlite";

const first = "(SELECT min(id) FROM lines AS l WHERE l.orders_id = lines.orders_id AND l.item = lines.item)";

export function up(db: Database) {
  db.run("ALTER TABLE lines ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1"); // the column it fills: migrateSchema then finds it there
  db.run(`UPDATE lines SET quantity = (SELECT count(*) FROM lines AS l WHERE l.orders_id = lines.orders_id AND l.item = lines.item) WHERE id = ${first}`);
  db.run(`DELETE FROM lines WHERE id <> ${first}`);
}
```

The schema declares the column, and `orderDocs` runs the migrations before `createTables` and `migrateSchema`:

```ts
// src/resources/order/order-api.ts: in place of export type Line = { id: number; item: number };
export type Line = { id: number; item: number; quantity: number };
```

```ts
// src/resources/order/order-api.ts: in place of lines: { parent: "orders", columns: { item: "integer" } },
lines: { parent: "orders", columns: { item: "integer", quantity: { type: "integer", default: 1 } } },
```

```ts
// src/resources/order/order-api.ts: in place of import { createTables, defineDoc
import { createTables, defineDoc, defineSchema, fromFolder, importTables, migrate, migrateSchema, registerDocs } from "@blueshed/delta/sqlite";
```

```ts
// src/resources/order/order-api.ts: in place of export function orderDocs(
export async function orderDocs(ws: WsServer, dataDir: string) {
```

```ts
// src/resources/order/order-api.ts: in place of createTables(db, schema);
await migrate(db, await fromFolder(`${import.meta.dir}/migrations`), { app: "order", schema }); // first: what a schema cannot say
createTables(db, schema); // then what it declares
```

The test makes the database as version one left it, and starts version two on it:

```ts
// tests/order-migrate.test.ts
import { test, expect, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { connectWs, openDoc } from "@blueshed/delta/client";
import { createTables, defineSchema, fromFolder, importTables, migrationStatus } from "@blueshed/delta/sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { startServer } from "../src/server";
import { catalogue, schema, type Order } from "../src/resources/order/order-api";

const dataDir = mkdtempSync(`${tmpdir()}/order-migrate-`);
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

// The database as version one left it: order 1 has a line for each Tea, and one Cake
const one = defineSchema({
  items: { columns: { name: "text", price: "real" } },
  orders: { columns: {} },
  lines: { parent: "orders", columns: { item: "integer" } },
});
const old = new Database(`${dataDir}/app.db`, { create: true });
createTables(old, one);
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
  const migrations = await fromFolder(`${import.meta.dir}/../src/resources/order/migrations`);
  const status = await migrationStatus(db, migrations, { app: "order", schema });
  db.close();
  expect(status.ran.map((r) => r.id)).toEqual(["001-one-line-per-item"]);
  expect(status.pending).toEqual([]);
});
```

The kitchen's test, on a new data folder, shows the other side: a database new to the app records every migration and runs none, and `createTables` makes version two's tables.

- Order at start-up: `migrate`, then `createTables` and `migrateSchema`, before any document opens. A new database and an upgraded one end the same.
- Each migration runs once, in order, in its own transaction, recorded in `delta_migrations` under its `app` (here the resource's name). A failure rolls that one back and throws naming it.
- Never edit a migration that has run anywhere, nor rename its file: write the next one.
- A migration is for data that must be kept. Seed data is the seed's.
- Undo stops at a migration: what was written before it is not undoable. Expand and contract (two versions on one database), the helpers (`renameColumn`, `dropColumn`, `renameTable`) and `bunx @blueshed/delta migrate <database> --app order --dir src/resources/order/migrations --status`: delta-doc's `reference/migrations.md`.
- The JSON file has no migrations: it is for documents you can reset.
