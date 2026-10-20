# Store documents in SQLite

When the JSON file is rewritten too often to keep up (it is saved whole after every change), or the schema must change on data people already have ([migrations.md](migrations.md)). The documents of [two-documents.md](two-documents.md) and the page stay as they are: `order-api.ts` takes its definitions from `@blueshed/delta/sqlite` in place of `@blueshed/delta/json`, a database in place of the file, and carries the file's rows across. The tables are made by the resource's history of migrations, from its first, `001-order`. Added here, as they would be on the JSON file: the kitchen, every open order, a third document over the same rows, and the cook's cell on the page that shows it; and undo, with Undo and Redo among the page's tools.

```ts
// src/resources/order/order-api.ts
/** Order: the catalogue, each order, and the kitchen, kept in SQLite (app.db in the data folder). */
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import type { WsServer } from "@blueshed/delta/server";
import { exportTables } from "@blueshed/delta/json";
import { defineDoc, defineSchema, importTables, migrate, registerDocs } from "@blueshed/delta/sqlite";
import { migrations } from "./migrations";

export type Item = { id: number; name: string; price: number };
export type Line = { id: number; item: number };
export type Catalogue = { items: Record<string, Item> };
export type Order = { lines: Record<string, Line> };
export type Orders = { orders: Record<string, { id: number }> };
/** What `kitchen:` holds: every order, and every line, each naming its order. */
export type Kitchen = { orders: Record<string, { id: number }>; lines: Record<string, Line & { orders_id: number }> };

export const schema = defineSchema({
  items: { columns: { name: "text", price: "real" } },
  orders: { columns: {} },
  lines: { parent: "orders", columns: { item: "integer" } },
});

export const docs = [
  defineDoc("catalogue:", { root: "items", include: [] }), // every item
  defineDoc("order:", { root: "orders", include: ["lines"], implied: true }), // order:1 is order 1 and its lines
  defineDoc("orders:", { root: "orders", include: [] }), // every order's number: a page takes the next for its own
  defineDoc("kitchen:", { root: "orders", include: ["lines"] }), // every order, and every line
];

export const catalogue = { tables: { items: [{ id: 1, name: "Tea", price: 2.5 }, { id: 2, name: "Cake", price: 3 }] } };

export async function orderDocs(ws: WsServer, dataDir: string) {
  mkdirSync(dataDir, { recursive: true }); // SQLite makes the file, not its folder
  const db = new Database(`${dataDir}/app.db`, { create: true });
  // the history makes the tables: each migration once, in order (a new database runs them all)
  await migrate(db, migrations, { app: "order", schema });
  // a new database takes the JSON file's rows, every order people made, or starts with the catalogue
  const file = `${dataDir}/order.json`;
  if (!db.query("SELECT 1 FROM items").get()) importTables(db, schema, existsSync(file) ? exportTables(file, schema) : catalogue);
  registerDocs(ws, db, schema, docs, [], { ledger: true }); // undo, redo and history
  return async () => db.close(); // for the server to close as it stops
}
```

The server closes the database as it stops, as it waited for the file:

```ts
// src/routes.ts: in place of closing.push((await orderDocs(ws, dataDir)).persisted);
closing.push(await orderDocs(ws, dataDir)); // the database closed once the server stops
```

The tables are the history's first migration. Never written by hand: `make` writes what the schema says beyond the migrations before it, so this one is every table:

```sh
bunx @blueshed/delta migrations make src/resources/order/order-api.ts --dir src/resources/order/migrations --name order
```

```ts
// src/resources/order/migrations/001-order.ts
// Made by `delta migrations make` from the definitions: what they say beyond the migrations before it.
import { createTable } from "@blueshed/delta/migrations";

export const changes = [
  createTable("items", { columns: { name: { type: "text" }, price: { type: "real" } }, temporal: true }),
  createTable("orders", { columns: {}, temporal: true }),
  createTable("lines", { columns: { item: { type: "integer" } }, parent: { collection: "orders", fk: "orders_id" }, temporal: true }),
];
```

Beside it, `make` writes the folder as one import, which a built app carries (it has no folder to read):

```ts
// src/resources/order/migrations/index.ts
// Made by `delta migrations make`: this folder's migrations, in order, as an import a bundle carries
// (`await migrate(db, migrations, ...)`). Never edited by hand: `make` writes it again.
import * as m001_order from "./001-order";

export const migrations = [
  { id: "001-order", ...m001_order },
];
```

The page and its test are as they were, and gain the kitchen, a document someone needs in front of them: the cook's cell, each open order and what is on it, named from the catalogue:

```ts
// src/resources/order/order.ts: in place of import type { Catalogue, Order, Orders } from "./order-api";
import type { Catalogue, Kitchen, Order, Orders } from "./order-api";
```

```ts
// src/resources/order/order.ts: after export const catalogue = openDoc<Catalogue>("catalogue:");
export const kitchen = openDoc<Kitchen>("kitchen:");
```

```tsx
// src/resources/order/order-view.tsx: in place of import { catalogue, order, yourOrder } from "./order";
import { catalogue, kitchen, order, yourOrder } from "./order";
```

```tsx
// src/resources/order/order-view.tsx: before /** Your order on the box
/** The kitchen on the box, the cook's: each open order, and what is on it. */
export function KitchenCell() {
  const open = kitchen.data.map((k) =>
    Object.values(k?.orders ?? {})
      .map((o) => ({ id: o.id, items: Object.values(k!.lines).filter((l) => l.orders_id === o.id).map((l) => l.item) }))
      .filter((o) => o.items.length > 0),
  );
  return cell({
    name: "Kitchen",
    body: rowsOf(open, (o) => o.id, (o$) => row({ what: () => `Order ${o$.get().id}`, note: () => o$.get().items.map((i) => item(i)?.name ?? "").join(", ") }), "No open orders."),
  });
}

```

Undo is the ledger's (`{ ledger: true }`, above), and a person presses it: the page's tools, given to the bento, beside its name:

```tsx
// src/app.tsx: in place of import { connectWs, WS } from "@blueshed/delta/client";
import { connectWs, redo, undo, WS } from "@blueshed/delta/client";
```

```tsx
// src/app.tsx: in place of const { boxPage } = bento();
const { boxPage } = bento({ undo: () => void undo(), redo: () => void redo() }); // this page's last change, taken back and put back
```

```tsx
// src/app.tsx: in place of import { CatalogueCell, OrderCell } from "./resources/order/order-view";
import { CatalogueCell, KitchenCell, OrderCell } from "./resources/order/order-view";
```

```tsx
// src/app.tsx: after OrderCell(),
KitchenCell(),
```

The kitchen and undo are stories of their own:

```ts
// stories.ts: after stories: {
  // The kitchen
  kitchen: story("The cook sees each open order: a line added to any order, or changed, reaches the kitchen."),
  undo: story("Undo takes back your last change, wherever it shows."),
```

Their test holds the documents from the test process, as a page reads them (`tests/documents.ts`), and then the page, where the cook reads them and Undo is pressed:

```ts
// tests/kitchen.test.ts
import { test, expect, afterAll, setDefaultTimeout } from "bun:test";
import type { DeltaOp } from "@blueshed/delta/core";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { startServer } from "../src/routes";
import type { Kitchen, Order } from "../src/resources/order/order-api";
import { stories } from "../stories";
import { browser } from "./browser";
import { documents } from "./documents";

setDefaultTimeout(30_000);

const dataDir = mkdtempSync(`${tmpdir()}/kitchen-`);
const server = await startServer({ port: 0, dev: false, dataDir });
const client = await documents(server);
const { view, open, waitFor, close } = browser(() => server.url);

afterAll(async () => {
  close();
  client.close();
  await server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

const kitchen = await client.open<Kitchen>("kitchen:");
const first = await client.open<Order>("order:1");
const second = await client.open<Order>("order:2");

const kitchenLines = () => Object.values(kitchen.value().lines).map((l) => [l.orders_id, l.item]);

async function until(done: () => boolean) {
  for (let i = 0; i < 100 && !done(); i++) await Bun.sleep(20);
  expect(done()).toBe(true);
}

test(`${stories.stories.kitchen.name} -- a line added to either of two orders`, async () => {
  await first.send([{ op: "add", path: "/lines/-", value: { item: 1 } }]);
  await second.send([{ op: "add", path: "/lines/-", value: { item: 2 } }]);
  await until(() => kitchenLines().length === 2);
  expect(kitchenLines()).toEqual([[1, 1], [2, 2]]);
});

test(`${stories.stories.undo.name} -- this client's last line goes from the kitchen and from its order`, async () => {
  await client.undo();
  await until(() => kitchenLines().length === 1);
  expect(kitchenLines()).toEqual([[1, 1]]);
  expect(second.value().lines).toEqual({});
});

test(`${stories.stories.kitchen.name} -- a line changed is told as the field that changed, not the row`, async () => {
  const told: DeltaOp[][] = [];
  const stop = kitchen.onOps((ops) => told.push(ops));
  const [line] = Object.values(first.value().lines);
  await first.send([{ op: "replace", path: `/lines/${line!.id}/item`, value: 2 }]);
  await until(() => kitchenLines()[0]![1] === 2);
  stop();
  expect(told).toEqual([[{ op: "replace", path: `/lines/${line!.id}/item`, value: 2 }]]);
});

// The cook's cell, as the page draws it: each open order, and what is on it; and your order's cell
const KITCHEN = `.cell[data-key="kitchen"]`;
const ORDER = `.cell[data-key="your-order"]`;
const orders = `[...document.querySelectorAll('${KITCHEN} .rows .row')].map((r) => r.querySelector(".what").textContent.trim() + ": " + r.querySelector(".note").textContent.trim()).join("; ")`;
const teas = (cell: string) => `(document.querySelector('${cell} .rows')?.textContent ?? "").split("Tea").length - 1`; // how many Teas a cell shows

test(`${stories.stories.kitchen.name} -- on the page, the cook's cell has each open order, and a line added to any order reaches it`, async () => {
  await open();
  await waitFor(`${orders} === "Order 1: Cake"`);
  await second.send([{ op: "add", path: "/lines/-", value: { item: 1 } }]);
  await waitFor(`${orders} === "Order 1: Cake; Order 2: Tea"`);
});

test(`${stories.stories.undo.name} -- Undo, pressed on the page, takes back the Tea it added, from your order and from the kitchen`, async () => {
  await waitFor(`${teas(ORDER)} === 0 && ${teas(KITCHEN)} === 1`); // order 2's Tea
  await view.click(`.cell[data-key="catalogue"] .rows > .row:nth-child(1) > .tool`); // a Tea on your order
  await waitFor(`${teas(ORDER)} === 1 && ${teas(KITCHEN)} === 2`);
  await view.click(`.page-tools [aria-label="Undo"]`);
  await waitFor(`${teas(ORDER)} === 0 && ${teas(KITCHEN)} === 1`); // gone from both, as a person sees them
});
```

What people ordered before the move is there after it:

```ts
// stories.ts: after stories: {
  // The move
  moved: story("The orders people made are still there after the app moves its documents to the next store."),
```

```ts
// tests/order-move.test.ts
import { test, expect, afterAll } from "bun:test";
import { importTables } from "@blueshed/delta/json";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { startServer } from "../src/routes";
import { schema, type Order } from "../src/resources/order/order-api";
import { stories } from "../stories";
import { documents } from "./documents";

const dataDir = mkdtempSync(`${tmpdir()}/order-move-`);
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

test(`${stories.stories.moved.name} -- from the JSON file to SQLite: order 1, a tea and a cake`, async () => {
  importTables(`${dataDir}/order.json`, schema, {
    tables: { items: [{ id: 1, name: "Tea", price: 2.5 }, { id: 2, name: "Cake", price: 3 }], orders: [{ id: 1 }], lines: [{ id: 1, orders_id: 1, item: 1 }, { id: 2, orders_id: 1, item: 2 }] },
  });
  const server = await startServer({ port: 0, dev: false, dataDir });
  const client = await documents(server);
  try {
    const order = await client.open<Order>("order:1");
    expect(Object.values(order.value().lines).map((l) => l.item)).toEqual([1, 2]);
  } finally {
    client.close();
    await server.stop(true);
  }
});
```

Working: `tests/evolve.ts` makes a new app from this template, applies this page (after two-documents.md) and runs its type check and tests (`bun run test:evolve`).

- How a change reaches each document holding its rows, and what the client is told: delta-doc's `reference/fanout.md`. A view draws from the document, never from what it was told.
- `{ ledger: true }` keeps each change with what undoes it: delta-doc's `reference/ledger.md`.
- Seed only an empty table.
- Every change to the tables is the next migration: change the schema, run `migrations make`, commit what it writes. A rename, a change of type or rows moved it leaves to you: [migrations.md](migrations.md). Started with the schema saying more than the history, `migrate` says so (its `drift`).

What the rows are, as the documents grow:

- **A line or a part is a row under its parent**, as an order's `lines` are: a set's dishes are `parts` rows with `parent: "items"`. Never a JSON column of ids, and never a link column on the other row: a document includes the rows, and each holder is told the one that arrives or leaves. **A part goes where its whole goes**: a line names the set, never its dishes, and the dishes come with it, so nothing can order one alone. Dishes kept as items of their own, tied to the set by a column, can each still be ordered alone: the page would be what holds the set together, not the server. Items that become parts of another move under it in a migration ([migrations.md](migrations.md)).
- **Rows that documents share move together.** When one document moves to SQLite, every document over the same rows moves with it, and so does every document whose rows another names (an id in a column, a ref): their rows are in one database from the start, and an id named in one is a row in the other. No document stays a JSON file while one on SQLite names its rows.
- **A fact from other rows is worked out, never stored.** How many of an item are on order comes from the lines; a column on the item, written beside each line, is a second copy every write must keep honest. A row has one parent, so the catalogue cannot include the lines: a recompute document reads both (`defineCustomDoc` with `watch: ["items", "lines"]` and a `LEFT JOIN`), told again on every write to either, and registered beside the others in `registerDocs`. delta-doc's `reference/custom-docs.md` has it whole. Its limit: a value someone may change (a due date extended), or one a rule gives that may change, is the row's own and is stored, set as the row is written; a migration fills it for the rows before.
- **"One at a time" is the schema's**: `unique: [{ columns: ["seat"], whereNull: ["paid"] }]` on the orders refuses a second open order at a seat, 409, on SQLite and Postgres alike; `unique: ["name"]` keeps names apart. `migrations make` writes it (`addUnique`). Never a trigger or an index written by hand beside the history.
