# Store in Postgres

When servers share the data, or people should see only their own. That step is **dzql**, delta's Postgres: the schema, documents, history of migrations, page and tests carry over from [sqlite.md](sqlite.md); `orderDocs` and its imports change. A resource still on SQLite (the people of [auth.md](auth.md)) stays there: each resource moves when it needs to. A Postgres server when `DATABASE_URL` names one (what you deploy); else PGlite, Postgres in this process, keeps it in the data folder, for development and tests.

```sh
bun add dzql
bun add pg
bun add -d @types/pg
```

```ts
// src/resources/order/order-api.ts
/** Order: the catalogue, each order and the kitchen, kept by Postgres: DATABASE_URL's server, else PGlite in pg/ in the data folder. */
import { mkdirSync } from "node:fs";
import { Pool } from "pg";
import type { WsServer } from "@blueshed/delta/server";
import { openPglite } from "dzql/pglite";
import { applyFramework, applySql, createDocListener, defineDoc, defineSchema, docTypeFromDef, fromFolder, generateSql, importTables, migrate } from "dzql/postgres";

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
  const url = process.env.DATABASE_URL;
  if (!url) mkdirSync(dataDir, { recursive: true }); // PGlite makes pg/, not the folder it is in
  const pool = url ? new Pool({ connectionString: url }) : await openPglite(`${dataDir}/pg`); // one process owns a PGlite folder
  // the same history as on SQLite makes the tables: a migration's changes are the same on every backend
  await migrate(pool, await fromFolder(`${import.meta.dir}/migrations`), { app: "order", schema });
  await applyFramework(pool); // delta's own tables and functions
  await applySql(pool, generateSql(schema, docs)); // each document's reads and writes compiled
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
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { startServer } from "../src/server";
import type { Order } from "../src/resources/order/order-api";

const scratch = mkdtempSync(`${tmpdir()}/order-pg-`);
const dataDir = `${scratch}/data`; // not there yet, as on a new app's first start
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

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

test("started on a data folder not there yet, stopped and started again, the order carries on where it was", async () => {
  expect(existsSync(dataDir)).toBe(false);
  expect(await addLine(1)).toEqual([1]);
  expect(await addLine(2)).toEqual([1, 2]);
});
```

- `@types/pg` is for the typecheck only: dzql ships TypeScript source that names `pg`'s types.
- One process owns the folder: `startServer` runs the close pushed onto `closing` when it stops (and before `bun --hot` starts again).
- Unclosed, Postgres recovers the folder as after a crash and skips the 32 ids it set aside: the second line is 34, not 2.
- Each server registers its own documents with its listener (`types`): two servers in one process each answer for theirs.
- Rows come across with `exportTables` from SQLite and `importTables` here.
- **Deploy a Postgres server, never PGlite**: PGlite is Postgres compiled to WebAssembly, and needs far more memory than a small server has. On Railway, a Postgres service, its `DATABASE_URL` set on the app. Its documents hear every process's writes: the step to more than one replica.
- **One app to a database**: `generateSql` writes one app's documents. Two apps on one server each have a database of their own.
- **The history moves with the app**: the migrations that made the SQLite tables make Postgres's. An `up` is the backend's SQL (`await tx.query(...)` here): [migrations.md](migrations.md).
- Who may open what (`auth`, `owns`, row-level security): delta-doc's `reference/ownership.md` (per-user isolation), and dzql's `docs/delta/postgres.md` and `docs/delta/rls.md`.
- Sign-in, with no passwords: [auth.md](auth.md); on Postgres its links and sessions are dzql's (`postgresLinkStore` from `dzql/auth-link`).
- From a shell: `bunx dzql migrate <database> --app order --dir src/resources/order/migrations` runs the history, `bunx dzql link <database> <person>` prints someone's sign-in link.
