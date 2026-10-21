# Two documents on one page

To place an order you need the catalogue and your order: the page opens both, draws both, and sends to the one it changes. The tables follow from the documents: items for the catalogue, an order and its lines for the order. One JSON file keeps them, and the same definitions run on SQLite ([sqlite.md](sqlite.md)) and Postgres.

Your order is your own. Nobody signs in yet, so the page keeps its order's number (in `localStorage`) and comes back to it; your first Add takes the next number from the server. The number keeps orders apart, not private: once people sign in ([auth.md](auth.md)), an order is theirs by who they are, and `owns` keeps it theirs.

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
export type Orders = { orders: Record<string, { id: number }> };

export const schema = defineSchema({
  items: { columns: { name: "text", price: "real" } },
  orders: { columns: {} },
  lines: { parent: "orders", columns: { item: "integer" } },
});

export const docs = [
  defineDoc("catalogue:", { root: "items", include: [] }), // every item
  defineDoc("order:", { root: "orders", include: ["lines"], implied: true }), // order:1 is order 1 and its lines
  defineDoc("orders:", { root: "orders", include: [] }), // every order's number: a page takes the next for its own
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
import { openDoc, type Doc } from "@blueshed/delta/client";
import { signal } from "@blueshed/railroad";
import type { Catalogue, Order, Orders } from "./order-api";

export const catalogue = openDoc<Catalogue>("catalogue:");

// Your order: this page keeps its number, so you come back to it. Until your first Add there is none.
const kept = localStorage.getItem("order");
export const order = signal<Doc<Order> | null>(kept ? openDoc<Order>(`order:${kept}`) : null);

let making: Promise<Doc<Order>> | undefined;

/** Your order, made by your first Add: the server names it (`add /orders/-` takes the next number), and the page keeps it. */
export function yourOrder(): Promise<Doc<Order>> {
  const open = order.peek();
  if (open) return Promise.resolve(open);
  making ??= (async () => {
    const orders = openDoc<Orders>("orders:");
    try {
      await orders.ready;
      const ack = await orders.send([{ op: "add", path: "/orders/-", value: {} }], { inverse: true });
      const { id } = ack.ops[0].value as { id: number };
      localStorage.setItem("order", String(id));
      const doc = openDoc<Order>(`order:${id}`);
      await doc.ready;
      order.set(doc);
      return doc;
    } finally {
      orders.close();
      making = undefined;
    }
  })();
  return making;
}
```

The view names and prices each line from the catalogue, so a change to either redraws it. Every change goes to your order, made first if there is none:

```tsx
// src/resources/order/order-view.tsx
import { joinPath, type DeltaOp } from "@blueshed/delta/core";
import { computed } from "@blueshed/railroad";
import { Plus, X } from "lucide";
import { bento, rowsOf } from "../bento";
import { toast } from "../toast";
import { catalogue, order, yourOrder } from "./order";

const { cell, row, tool } = bento();
const items = catalogue.data.map((c) => Object.values(c?.items ?? {}));
const lines = computed(() => Object.values(order.get()?.data.get()?.lines ?? {}));
const item = (id: number) => catalogue.data.get()?.items[id];
const money = (n: number) => n.toFixed(2);
const change = (ops: DeltaOp[]) => yourOrder().then((o) => o.send(ops)).catch(() => toast("Not saved", "alert"));

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
closing.push((await orderDocs(ws, dataDir)).persisted); // its last change in the file before the server is done
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
  ordering: story("Someone ordering has the catalogue and an order of their own on one page, with its total, and finds it again when they come back."),
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

test(`${stories.stories.ordering.name} -- your order: added to, there when you come back, and not another browser's`, async () => {
  await open();
  await waitFor(`${shown(CATALOGUE)} === "Tea, Cake"`); // the catalogue is drawn
  await waitFor(total("0.00")); // no order yet

  await view.click(`${CATALOGUE} .rows > .row:nth-child(1) > .tool`); // the first Add makes your order
  await waitFor(`${shown(ORDER)} === "Tea"`);
  await view.click(`${CATALOGUE} .rows > .row:nth-child(2) > .tool`);
  await waitFor(`${shown(ORDER)} === "Tea, Cake"`);
  await waitFor(total("5.50"));

  await open(); // you come back: the page kept your order's number
  await waitFor(`${shown(ORDER)} === "Tea, Cake"`);

  await withOtherWindow(async (other, waitForOther) => {
    await waitForOther(`${shown(CATALOGUE)} === "Tea, Cake"`);
    await other.click(`${CATALOGUE} .rows > .row:nth-child(1) > .tool`); // someone else orders a Tea, on an order of their own
    await waitForOther(`${shown(ORDER)} === "Tea"`);
  });

  await view.click(`${ORDER} .rows > .row:nth-child(1) > .tool`); // × takes your Tea off
  await waitFor(`${shown(ORDER)} === "Cake"`); // and theirs never reached yours
  await waitFor(total("3.00"));
});
```

Working: `tests/evolve.ts` makes a new app from this template, applies this page and runs its type check and tests (`bun run test:evolve`).

- The kitchen (every order, a third document over the same rows) and undo need no move to SQLite: the JSON file holds both. [sqlite.md](sqlite.md) has them worked: the `kitchen:` document, the cook's cell, Undo and Redo on the page, and their test. Take those, and keep `@blueshed/delta/json`, turning on the ledger in its `registerDocs(ws, file, schema, docs, [], { ledger: true })`.
