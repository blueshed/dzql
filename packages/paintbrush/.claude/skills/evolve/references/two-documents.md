# Two documents on one page

To place an order you need the catalogue and your order: the page opens both, draws both, and sends to the one it changes. A JSON file each is enough until documents share rows ([sqlite.md](sqlite.md)).

```ts
// src/resources/order/order-api.ts
import { registerDoc, type WsServer } from "@blueshed/delta/server";

export type Item = { id: number; name: string; price: number };
export type Line = { id: string; item: number };
export type Catalogue = { items: Record<string, Item> };
export type Order = { lines: Record<string, Line> };

const items: Catalogue["items"] = {
  1: { id: 1, name: "Tea", price: 2.5 },
  2: { id: 2, name: "Cake", price: 3 },
};

export async function orderDocs(ws: WsServer, dataDir: string) {
  await registerDoc<Catalogue>(ws, "catalogue", { file: `${dataDir}/catalogue.json`, empty: { items } });
  await registerDoc<Order>(ws, "order", { file: `${dataDir}/order.json`, empty: { lines: {} } });
}
```

```ts
// src/resources/order/order.ts
import { openDoc } from "@blueshed/delta/client";
import type { Catalogue, Order } from "./order-api";

export const catalogue = openDoc<Catalogue>("catalogue");
export const order = openDoc<Order>("order");
```

The view names and prices each line from the catalogue, so a change to either redraws it:

```tsx
// src/resources/order/order-view.tsx
import { list } from "@blueshed/railroad";
import type { DeltaOp } from "@blueshed/delta/core";
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
            <button onclick={() => void change([{ op: "remove", path: `/lines/${l$.peek().id}` }])}>
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

Tested as in [testing.md](testing.md); the page passes it on SQLite and Postgres too:

```ts
// tests/order.test.ts
import { test, afterAll, setDefaultTimeout } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { startServer } from "../src/routes";
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

test("the page has the catalogue and the order, and what one window orders shows in another", async () => {
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
