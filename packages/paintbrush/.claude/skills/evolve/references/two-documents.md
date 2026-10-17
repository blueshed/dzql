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
import { list } from "@blueshed/railroad";
import { joinPath, type DeltaOp } from "@blueshed/delta/core";
import { Plus, X } from "lucide";
import { Icon } from "../icon";
import { toast } from "../toast";
import { catalogue, order } from "./order";

export function OrderView() {
  const items = catalogue.data.map((c) => Object.values(c?.items ?? {}));
  const lines = order.data.map((o) => Object.values(o?.lines ?? {}));
  const item = (id: number) => catalogue.data.get()?.items[id];
  const total = () => lines.get().reduce((sum, l) => sum + (item(l.item)?.price ?? 0), 0);
  const change = (ops: DeltaOp[]) => order.send(ops).catch(() => toast("Not saved", "alert"));

  return (
    <>
      <h1>Order</h1>
      <ul class="catalogue">
        {list(items, (i) => i.id, (i$) => (
          <li>
            {i$.map((i) => `${i.name} ${i.price.toFixed(2)}`)}
            <button onclick={() => void change([{ op: "add", path: "/lines/-", value: { item: i$.peek().id } }])}>
              <Icon icon={Plus} label={`Add ${i$.peek().name}`} />
            </button>
          </li>
        ))}
      </ul>
      <ul class="order">
        {list(lines, (l) => l.id, (l$) => (
          <li>
            {() => item(l$.get().item)?.name ?? ""}
            <button onclick={() => void change([{ op: "remove", path: joinPath("lines", l$.peek().id) }])}>
              <Icon icon={X} label="Remove" />
            </button>
          </li>
        ))}
      </ul>
      <p class="total">{() => `Total ${total().toFixed(2)}`}</p>
    </>
  );
}
```

The reset takes a list's padding, so its bullets would hang outside the page: the lists are rows instead.

```css
// src/styles.css: after .toast.alert { background: var(--danger); }

.catalogue, .order { list-style: none; margin-bottom: 1rem; }
.catalogue li, .order li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.35rem 0;
  border-bottom: 1px solid var(--border-mid);
}
.total { font-weight: 600; }
```

```ts
// src/routes.ts: after import { statusApi } from "./resources/status/status-api";
import { orderDocs } from "./resources/order/order-api";
```

```ts
// src/routes.ts: after await messageDoc(ws, dataDir);
await orderDocs(ws, dataDir);
```

```tsx
// src/app.tsx: after import { StatusView } from "./resources/status/status-view";
import { OrderView } from "./resources/order/order-view";
```

```tsx
// src/app.tsx: before "*": () => (
"/order": () => <OrderView />,
```

Its story, and its test, as in [testing.md](testing.md); the page passes it on SQLite and Postgres too:

```ts
// stories.ts: after export const stories = {
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

const shown = (list: string) => `[...document.querySelectorAll(".${list} li")].map((li) => li.textContent.trim()).join(", ")`;
const total = (amount: string) => `document.querySelector(".total")?.textContent === "Total ${amount}"`;

test(`${stories.ordering.name} -- two windows order and remove`, async () => {
  await open();
  await view.evaluate(`location.hash = "#/order"`);
  await waitFor(`${shown("catalogue")} === "Tea 2.50, Cake 3.00"`); // the catalogue is drawn
  await withOtherWindow(async (other, waitForOther) => {
    await other.evaluate(`location.hash = "#/order"`);
    await waitForOther(total("0.00"));

    await view.click(".catalogue li:nth-child(1) button");
    await view.click(".catalogue li:nth-child(2) button");
    await waitForOther(`${shown("order")} === "Tea, Cake"`);
    await waitForOther(total("5.50"));

    await other.click(".order li:nth-child(1) button");
    await waitFor(`${shown("order")} === "Cake"`);
    await waitFor(total("3.00"));
  });
});
```
