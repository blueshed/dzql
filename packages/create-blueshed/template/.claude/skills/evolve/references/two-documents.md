# Two documents on one page

To place an order you need the catalogue and your order: the page opens both, draws both, and sends to the one it changes. The tables follow from the documents: items for the catalogue, an order and its lines for the order. One JSON file keeps them, and the same definitions run on SQLite ([sqlite.md](sqlite.md)) and Postgres.

```ts
// src/resources/order/order-api.ts
/** Order: the catalogue and each order, their rows kept by delta in order.json in the data folder. */
import { existsSync } from "node:fs";
import type { WsServer } from "@blueshed/delta/server";
import { defineDoc, defineSchema, importTables, registerDocs } from "@blueshed/delta/json";

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
];

export const catalogue = { tables: { items: [{ id: 1, name: "Tea", price: 2.5 }, { id: 2, name: "Cake", price: 3 }] } };

export function orderDocs(ws: WsServer, dataDir: string) {
  const file = `${dataDir}/order.json`;
  if (!existsSync(file)) importTables(file, schema, catalogue); // a new app starts with the catalogue
  return registerDocs(ws, file, schema, docs);
}
```

```ts
// src/resources/order/order.ts
import { openDoc } from "@blueshed/delta/client";
import type { Catalogue, Order } from "./order-api";

export const catalogue = openDoc<Catalogue>("catalogue:");
export const order = openDoc<Order>("order:1");
```

The view names and prices each line from the catalogue, so a change to either redraws it:

```tsx
// src/resources/order/order-view.tsx
import { joinPath, type DeltaOp } from "@blueshed/delta/core";
import { Plus, X } from "lucide";
import { bento, rowsOf } from "../bento";
import { toast } from "../toast";
import { catalogue, order } from "./order";

const { cell, row, tool } = bento();
const items = catalogue.data.map((c) => Object.values(c?.items ?? {}));
const lines = order.data.map((o) => Object.values(o?.lines ?? {}));
const item = (id: number) => catalogue.data.get()?.items[id];
const money = (n: number) => n.toFixed(2);
const change = (ops: DeltaOp[]) => order.send(ops).catch(() => toast("Not saved", "alert"));

/** The catalogue on the box: each item, its price, and Add, which puts a line on your order. */
export function CatalogueCell() {
  return cell({
    name: "Catalogue",
    span: 2,
    body: rowsOf(items, (i) => i.id, (i$) =>
      row({
        what: () => i$.get().name,
        state: () => money(i$.get().price),
        act: tool("Add", { icon: Plus, label: `Add ${i$.peek().name}`, on: () => void change([{ op: "add", path: "/lines/-", value: { item: i$.peek().id } }]) }),
      }), "Nothing to order yet."),
  });
}

/** Your order on the box: each line named and priced from the catalogue, × to take it off, and the total. */
export function OrderCell() {
  const total = () => lines.get().reduce((sum, l) => sum + (item(l.item)?.price ?? 0), 0);
  const body = (
    <>
      {rowsOf(lines, (l) => l.id, (l$) =>
        row({
          what: () => item(l$.get().item)?.name ?? "",
          state: () => money(item(l$.get().item)?.price ?? 0),
          act: tool("Remove", { icon: X, iconOnly: true, kind: "quiet", on: () => void change([{ op: "remove", path: joinPath("lines", l$.peek().id) }]) }),
        }), "Nothing yet.")}
      {row({ what: "Total", state: () => money(total()), total: true })}
    </>
  );
  return cell({ name: "Your order", count: () => lines.get().length || null, body });
}
```

```ts
// src/routes.ts: after import { statusApi } from "./resources/status/status-api";
import { orderDocs } from "./resources/order/order-api";
```

```ts
// src/routes.ts: after messageDoc(ws, dataDir)
await orderDocs(ws, dataDir);
```

Two cells on the box, side by side:

```tsx
// src/app.tsx: after import { StatusCell } from "./resources/status/status-view";
import { CatalogueCell, OrderCell } from "./resources/order/order-view";
```

```tsx
// src/app.tsx: after StatusCell(),
CatalogueCell(),
OrderCell(),
```

Its story, and its test, as in [testing.md](testing.md); the page passes it on SQLite and Postgres too:

```ts
// stories.ts: after stories: {
  // The order
  ordering: story("Someone ordering has the catalogue and their order on one page, with its total, and what one window orders shows in another."),
```

```ts
// tests/order.test.ts
import { test, afterAll, setDefaultTimeout } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { startServer } from "../src/routes";
import { stories } from "../stories";
import { browser } from "./browser";

setDefaultTimeout(30_000);

const dataDir = mkdtempSync(`${tmpdir()}/order-`);
const server = await startServer({ port: 0, dev: false, dataDir });
const { view, open, waitFor, withOtherWindow, close } = browser(() => server.url);

afterAll(async () => {
  close();
  await server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

const CATALOGUE = `.cell[data-key="catalogue"]`;
const ORDER = `.cell[data-key="your-order"]`;
const shown = (cell: string) => `[...document.querySelectorAll('${cell} .rows .what')].map((w) => w.textContent.trim()).join(", ")`;
const total = (amount: string) => `document.querySelector('${ORDER} .row.total .state')?.textContent === "${amount}"`;

test(`${stories.stories.ordering.name} -- two windows order and remove`, async () => {
  await open();
  await waitFor(`${shown(CATALOGUE)} === "Tea, Cake"`); // the catalogue is drawn
  await withOtherWindow(async (other, waitForOther) => {
    await waitForOther(total("0.00"));

    await view.click(`${CATALOGUE} .rows > .row:nth-child(1) > .tool`);
    await view.click(`${CATALOGUE} .rows > .row:nth-child(2) > .tool`);
    await waitForOther(`${shown(ORDER)} === "Tea, Cake"`);
    await waitForOther(total("5.50"));

    await other.click(`${ORDER} .rows > .row:nth-child(1) > .tool`);
    await waitFor(`${shown(ORDER)} === "Cake"`);
    await waitFor(total("3.00"));
  });
});
```

Working: `tests/evolve.ts` makes a new app from this template, applies this page and runs its type check and tests (`bun run test:evolve`).

- The kitchen (every order, a third document over the same rows) and undo need no move to SQLite: the JSON file holds both. [sqlite.md](sqlite.md) has them worked: the `kitchen:` document, the cook's cell, Undo and Redo on the page, and their test. Take those, and keep `@blueshed/delta/json`, turning on the ledger in its `registerDocs(ws, file, schema, docs, [], { ledger: true })`.
