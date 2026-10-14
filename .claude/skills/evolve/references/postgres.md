# Store in Postgres

When servers share the data, or people should see only their own. The schema, documents, page and tests carry over from [sqlite.md](sqlite.md): only `orderDocs` changes, and its imports. First PGlite (Postgres in this process), then a server.

```sh
bun add @electric-sql/pglite
bun add -d @types/pg
```

```ts
// src/resources/order/order-api.ts
/** Order: the catalogue, each order and the kitchen, kept by PGlite in pg/ in the data folder. */
import type { WsServer } from "@blueshed/delta/server";
import { openPglite } from "@blueshed/delta/pglite";
import { applyFramework, applySql, createDocListener, defineDoc, defineSchema, docTypeFromDef, generateSql, importTables } from "@blueshed/delta/postgres";

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
  defineDoc("catalogue:", { root: "items", include: [] }),
  defineDoc("order:", { root: "orders", include: ["lines"], implied: true }),
  defineDoc("kitchen:", { root: "orders", include: ["lines"] }),
];

export const catalogue = { tables: { items: [{ id: 1, name: "Tea", price: 2.5 }, { id: 2, name: "Cake", price: 3 }] } };

// Answers what closes it: the server calls that when it stops
export async function orderDocs(ws: WsServer, dataDir: string) {
  const pool = await openPglite(`${dataDir}/pg`); // one process owns the folder
  await applyFramework(pool); // delta's tables and stored functions
  await applySql(pool, generateSql(schema, docs)); // the app's tables
  if (!(await pool.query("SELECT 1 FROM items")).rowCount) await importTables(pool, schema, catalogue);
  // last: it answers 404 for a name it does not own
  const listener = await createDocListener(ws, pool, { types: docs.map((def) => docTypeFromDef(def, pool)), ledger: true });
  return async () => {
    await listener.destroy();
    await pool.end(); // closed cleanly, the next start opens the folder as it was left
  };
}
```

```ts
// src/server.ts: in place of await orderDocs(ws, dataDir);
closing.push(await orderDocs(ws, dataDir));
```

A server stopped and started again carries on where it was:

```ts
// tests/order-pg.test.ts
import { test, expect, afterAll } from "bun:test";
import { connectWs, openDoc } from "@blueshed/delta/client";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { startServer } from "../src/server";
import type { Order } from "../src/resources/order/order-api";

const dataDir = mkdtempSync(`${tmpdir()}/order-pg-`);
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

// A server on the data folder, a line added to order 1, and the server stopped: the ids of its lines
async function addLine(item: number) {
  const server = await startServer({ port: 0, dev: false, dataDir });
  const client = connectWs(new URL("/ws", server.url).href);
  try {
    const order = openDoc<Order>("order:1", client);
    await order.ready;
    await order.send([{ op: "add", path: "/lines/-", value: { item } }]);
    return Object.values(order.data.peek()!.lines).map((l) => l.id);
  } finally {
    client.close();
    await server.stop(true);
  }
}

test("stopped and started again on the same folder, the order carries on where it was", async () => {
  expect(await addLine(1)).toEqual([1]);
  expect(await addLine(2)).toEqual([1, 2]);
});
```

- `@types/pg` is for the typecheck only: delta ships TypeScript source that names `pg`'s types.
- One process owns the folder: `startServer` runs the close pushed onto `closing` when it stops (and before `bun --hot` starts again).
- Unclosed, Postgres recovers the folder as after a crash and skips the 32 ids it set aside: the second line is 34, not 2.
- The documents are the listener's own (`types`): every server has its own.
- Rows come across with `exportTables` from SQLite and `importTables` here.
- A server: `new Pool({ connectionString })` from `pg` (`bun add pg`) in place of `openPglite`. Its documents hear every process's writes: the step to more than one replica.
- Who may open what (`auth`, `owns`, row-level security): delta-doc's reference, *Quick start (Postgres backend)*, *Doc patterns* (per-user isolation) and *RLS with `app.user_id`*.
