# Store documents in SQLite

When documents share rows, or for undo and history. The kitchen needs every open order: a third document over the rows of each order. The tables follow from the documents of [two-documents.md](two-documents.md); only `order-api.ts` changes, and the names the page opens.

```ts
// src/resources/order/order-api.ts
/** Order: the catalogue, each order, and the kitchen, kept in SQLite (app.db in the data folder). */
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import type { WsServer } from "@blueshed/delta/server";
import { createTables, defineDoc, defineSchema, importTables, registerDocs } from "@blueshed/delta/sqlite";

export type Item = { id: number; name: string; price: number };
export type Line = { id: number; item: number };
export type Catalogue = { items: Record<string, Item> };
export type Order = { lines: Record<string, Line> };

export const schema = defineSchema({
  items: { columns: { name: "text", price: "real" } },
  orders: { columns: {} },
  lines: { parent: "orders", columns: { item: "integer" } },
});

export const docs = [
  defineDoc("catalogue:", { root: "items", include: [] }), // every item
  defineDoc("order:", { root: "orders", include: ["lines"], implied: true }), // order:1 is order 1 and its lines
  defineDoc("kitchen:", { root: "orders", include: ["lines"] }), // every order, and every line
];

export const catalogue = { tables: { items: [{ id: 1, name: "Tea", price: 2.5 }, { id: 2, name: "Cake", price: 3 }] } };

export function orderDocs(ws: WsServer, dataDir: string) {
  mkdirSync(dataDir, { recursive: true }); // SQLite makes the file, not its folder
  const db = new Database(`${dataDir}/app.db`, { create: true });
  createTables(db, schema);
  if (!db.query("SELECT 1 FROM items").get()) importTables(db, schema, catalogue);
  registerDocs(ws, db, schema, docs, [], { ledger: true }); // undo, redo and history
}
```

```ts
// src/resources/order/order.ts
import { openDoc } from "@blueshed/delta/client";
import type { Catalogue, Order } from "./order-api";

export const catalogue = openDoc<Catalogue>("catalogue:");
export const order = openDoc<Order>("order:1");
```

The page's test passes as it was. The kitchen's holds the documents from a client in the test process:

```ts
// tests/kitchen.test.ts
import { test, expect, afterAll } from "bun:test";
import { connectWs, openDoc } from "@blueshed/delta/client";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { startServer } from "../src/server";
import type { Line, Order } from "../src/resources/order/order-api";

const dataDir = mkdtempSync(`${tmpdir()}/kitchen-`);
const server = await startServer({ port: 0, dev: false, dataDir });
const client = connectWs(new URL("/ws", server.url).href);

afterAll(async () => {
  client.close();
  await server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

const kitchen = openDoc<{ lines: Record<string, Line & { orders_id: number }> }>("kitchen:", client);
const first = openDoc<Order>("order:1", client);
const second = openDoc<Order>("order:2", client);
await Promise.all([kitchen.ready, first.ready, second.ready]);

const kitchenLines = () => Object.values(kitchen.data.peek()!.lines).map((l) => [l.orders_id, l.item]);

async function until(done: () => boolean) {
  for (let i = 0; i < 100 && !done(); i++) await Bun.sleep(20);
  expect(done()).toBe(true);
}

test("the kitchen holds every order: a line added to any order reaches it", async () => {
  await first.send([{ op: "add", path: "/lines/-", value: { item: 1 } }]);
  await second.send([{ op: "add", path: "/lines/-", value: { item: 2 } }]);
  await until(() => kitchenLines().length === 2);
  expect(kitchenLines()).toEqual([[1, 1], [2, 2]]);
});

test("undo takes back this client's last change, and every document holding it is told", async () => {
  await client.send({ action: "undo" });
  await until(() => kitchenLines().length === 1);
  expect(kitchenLines()).toEqual([[1, 1]]);
  expect(second.data.peek()!.lines).toEqual({});
});
```

- A change to a row reaches every document holding it.
- `{ ledger: true }` keeps each change with what undoes it. Over the socket, undo walks back what that connection wrote.
- Seed only an empty table.
- Redo, history, a change named by its entry, and the cursor: delta-doc's `reference/ledger.md`.
