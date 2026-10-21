# Store in Postgres

When servers share the data, or people should see only their own. That step is **dzql**, delta's Postgres (the app has it already, for its stories; the database packages are added here): the schema, documents, history of migrations, page and tests carry over from [sqlite.md](sqlite.md). The step takes **every document the app has**, the message too: one left in its file would be one server's, and a save at one would never reach the other. The documents are kept in one store, `src/store.ts` (dzql's `openStore`), each resource's registered on it; the server opens it as it starts. A Postgres server when `DATABASE_URL` names one (what you deploy); else PGlite, Postgres in this process, keeps it in the data folder, for development and tests.

```sh
bun add pg @electric-sql/pglite
bun add -d @types/pg
```

The definitions are as they were; the imports change, and the store takes the place of `orderDocs` and `messageDoc`:

```ts
// src/resources/order/order-api.ts
/** Order: the catalogue, each order and the kitchen, kept by Postgres (../../store.ts). */
import { defineDoc, defineSchema } from "dzql/postgres";

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
  defineDoc("catalogue:", { root: "items", include: [] }),
  defineDoc("order:", { root: "orders", include: ["lines"], implied: true }),
  defineDoc("orders:", { root: "orders", include: [] }),
  defineDoc("kitchen:", { root: "orders", include: ["lines"] }),
];

export const catalogue = { tables: { items: [{ id: 1, name: "Tea", price: 2.5 }, { id: 2, name: "Cake", price: 3 }] } };
```

```ts
// src/resources/message/message-api.ts
/** Message — a shared document, kept by Postgres beside the order (../../store.ts): its definitions as they were on the JSON file, the import changed. */
import { defineDoc, defineSchema } from "dzql/postgres";

export type Message = { id: number; text: string };
/** What `message:1` holds: its one row. */
export type MessageDoc = { messages: Message };

export const schema = defineSchema({
  messages: { columns: { text: { type: "text", default: "Hello" } }, temporal: false },
});

// `implied`: `message:1` opens as Hello before anyone has written it, and its first save makes the row
export const docs = [defineDoc("message:", { root: "messages", include: [], implied: true })];
```

```ts
// src/store.ts
/**
 * Every document the app has, in one Postgres: DATABASE_URL's server, else PGlite in pg/ in the
 * data folder. Said here, opened by the server as it starts and closed as it stops (one process
 * owns a PGlite folder). The order's history makes its tables (a table no migration makes, the
 * message's, is made from its schema); a new database takes the rows kept before.
 */
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import type { WsServer } from "@blueshed/delta/server";
import { exportTables as jsonRows, type Snapshot } from "@blueshed/delta/json";
import { exportTables as sqliteRows } from "@blueshed/delta/sqlite";
import { importTables, openStore, type Schema } from "dzql/postgres";
import * as message from "./resources/message/message-api";
import * as order from "./resources/order/order-api";
import { migrations } from "./resources/order/migrations";

/** The rows the app kept in `dataDir` before: the orders (SQLite, else the JSON file; none, the catalogue), and the message (its JSON file). */
function keptBefore(dataDir = ""): [Schema, Snapshot][] {
  const kept = (file: string) => (existsSync(`${dataDir}/${file}`) ? `${dataDir}/${file}` : undefined);
  const [db, file, said] = [kept("app.db"), kept("order.json"), kept("message.json")];
  let orders: Snapshot = order.catalogue;
  if (db) {
    const sqlite = new Database(db, { readonly: true });
    try { orders = sqliteRows(sqlite, order.schema); } finally { sqlite.close(); }
  } else if (file) orders = jsonRows(file, order.schema);
  return [[order.schema, orders], ...(said ? [[message.schema, jsonRows(said, message.schema)] as [Schema, Snapshot]] : [])];
}

/** The store, its documents served on `ws`: each resource's registered on it. */
export function appStore(ws: WsServer) {
  const store = openStore({
    schema: [order.schema, message.schema], // each resource's, kept as one
    // the history that made the SQLite tables makes these; the rows come imported, so its ups (SQLite's) never run here
    migrations: { list: migrations, app: "order", schema: order.schema, imported: true },
    ws,
    // each document compiled; a new database takes the rows kept before, then the documents are served
    prepare: async (pool, { dataDir }) => {
      if ((await pool.query("SELECT 1 FROM items")).rowCount) return;
      for (const [schema, rows] of keptBefore(dataDir)) await importTables(pool, schema, rows);
    },
  });
  store.register(order.docs);
  store.register(message.docs, { ledger: false }); // the message has no undo, as on the JSON file
  return store;
}
```

The server opens the store as it starts, and closes it as it stops:

```ts
// src/routes.ts
import { createWs } from "@blueshed/delta/server";
import { run, serve } from "@blueshed/delta/serve";
import homepage from "./index.html";
import { statusApi } from "./resources/status/status-api";
import { appStore } from "./store";

// The app is its routes and its resources. The server is delta's: `serve` puts these routes and
// the socket on Bun.serve (with /health and a 404); `run`, at the bottom, is the process around it.
export async function startServer({
  port = undefined as number | undefined,
  dev = undefined as boolean | undefined,
  dataDir = process.env.DATA_PATH ?? `${import.meta.dir}/../data`,
} = {}) {
  const status = statusApi();

  // What a resource opens that must be closed (a database), closed once the server stops
  const closing: (() => Promise<void>)[] = [];

  // The documents, on one WebSocket, every one kept in Postgres (./store.ts)
  const ws = createWs();
  const store = appStore(ws);
  await store.open({ dataDir }); // DATABASE_URL's server, else PGlite in the data folder's pg/
  closing.push(store.close); // the listener, then the pool: closed cleanly, the next start opens the folder as it was left

  return serve(
    {
      ws,
      close: closing,
      routes: {
        "/": homepage,

        // What isn't communication is an HTTP route (see src/resources/)
        "/api/status": { GET: status.get },

        // Every document rides this socket (a literal key, so routes keep their typed params)
        "/ws": ws.upgrade,
      },
    },
    { port, dev },
  );
}

// `bun dev`, `bun start`: the pid file (`bun run stop`), the signals, and `bun --hot` serving again
if (import.meta.main) await run(startServer);
```

A server stopped and started again carries on where it was:

```ts
// stories.ts: after stories: {
  // Postgres
  carriesOn: story("After the server stops and starts again, an order carries on where it was."),
```

```ts
// tests/order-pg.test.ts
import { test, expect, afterAll } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { startServer } from "../src/routes";
import type { Order } from "../src/resources/order/order-api";
import { stories } from "../stories";
import { documents } from "./documents";

const scratch = mkdtempSync(`${tmpdir()}/order-pg-`);
const dataDir = `${scratch}/data`; // not there yet, as on a new app's first start
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

// A server on the data folder, a line added to order 1, and the server stopped: the ids of its lines
async function addLine(item: number) {
  const server = await startServer({ port: 0, dev: false, dataDir });
  const client = await documents(server);
  try {
    const order = await client.open<Order>("order:1");
    await order.send([{ op: "add", path: "/lines/-", value: { item } }]);
    return Object.values(order.value().lines).map((l) => l.id);
  } finally {
    client.close();
    await server.stop(true);
  }
}

test(`${stories.stories.carriesOn.name} -- started on a data folder not there yet, stopped and started again`, async () => {
  expect(existsSync(dataDir)).toBe(false);
  expect(await addLine(1)).toEqual([1]);
  expect(await addLine(2)).toEqual([1, 2]);
});
```

The orders kept in SQLite come across, as the JSON file's came to SQLite, and the message kept in its file comes with them:

```ts
// tests/order-pg-move.test.ts
import { test, expect, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { importTables as jsonImport } from "@blueshed/delta/json";
import { fromFolder, importTables, migrate } from "@blueshed/delta/sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { startServer } from "../src/routes";
import { schema as messageSchema, type MessageDoc } from "../src/resources/message/message-api";
import { schema, type Order } from "../src/resources/order/order-api";
import { stories } from "../stories";
import { documents } from "./documents";

const dataDir = mkdtempSync(`${tmpdir()}/order-pg-move-`);
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

test(`${stories.stories.moved.name} -- from SQLite to Postgres: order 1, a cake; and the message, from its file`, async () => {
  const db = new Database(`${dataDir}/app.db`, { create: true });
  await migrate(db, await fromFolder(`${import.meta.dir}/../src/resources/order/migrations`), { app: "order", schema });
  importTables(db, schema, { tables: { items: [{ id: 1, name: "Tea", price: 2.5 }, { id: 2, name: "Cake", price: 3 }], orders: [{ id: 1 }], lines: [{ id: 1, orders_id: 1, item: 2 }] } });
  db.close();
  jsonImport(`${dataDir}/message.json`, messageSchema, { tables: { messages: [{ id: 1, text: "Open at nine" }] } });
  const server = await startServer({ port: 0, dev: false, dataDir });
  const client = await documents(server);
  try {
    const order = await client.open<Order>("order:1");
    expect(Object.values(order.value().lines).map((l) => l.item)).toEqual([2]);
    const said = await client.open<MessageDoc>("message:1");
    expect(said.value().messages.text).toBe("Open at nine");
  } finally {
    client.close();
    await server.stop(true);
  }
});
```

Working: `tests/evolve.ts` makes a new app from this template, applies this page (after two-documents.md and sqlite.md) and runs its type check and tests (`bun run test:evolve`).

- `@types/pg` is for the typecheck only: dzql ships TypeScript source that names `pg`'s types.
- One process owns the folder: `startServer` runs the close pushed onto `closing` when it stops (and before `bun --hot` starts again).
- Unclosed, Postgres recovers the folder as after a crash and skips the 32 ids it set aside: the second line is 34, not 2.
- Each server's store serves its documents on its own socket: two servers in one process each answer for theirs.
- Rows come across with `exportTables` from where they were kept (SQLite, or the JSON file) and `importTables` here, so the story of the move to SQLite stays true.
- **Deploy a Postgres server, never PGlite** (it needs far more memory than a small server has): on Railway a Postgres service, its `DATABASE_URL` set on the app. One app to a database.
- **A document is rows, never a table of JSON.** Each document's rows become the tables its history makes; never a store of the app's own beside them (a table of JSON documents, writes through delta's internals).
- **The history moves with the app.** Its changes make Postgres's tables; the rows come imported, migrated already, so an `up` written on SQLite never runs here: `imported: true` on the history records each as run on a new database. Never edit one that has run to hold both backends. A migration written after the move is Postgres's SQL (`await tx.query(...)`), and runs as any other: [migrations.md](migrations.md).
- **Each resource keeps its history**, its own `app`: `migrations: [{ app: "people", list: peopleHistory, schema: people.schema, imported: true }, { app: "order", ... }]`, in the order their tables hang (the people first, then what names them).
- **Sign-in goes with it** ([auth.md](auth.md)): the people's rows and their history, and the links and sessions, in dzql's `postgresLinkStore` (`dzql/auth-link`). The store takes the gate: `openStore({ ..., auth, who: (p) => String(p.id) })`, delta's `DeltaAuth`, as `registerDocs` takes it. Then every document says who has it: a path in its `defineDoc`, or as it is registered, `store.register(docs, { shared: true })` for everyone signed in.
- **Who may open what is a path in the document**, `owns` in its `defineDoc`: a member's own orders, `member:` rooted at their membership, `owns: "@person"`; a team's, for its members, `team:` rooted at the team, `owns: "@id->members[teams_id=$].person"`; the kitchen, every order, for the cooks, a list whose path starts at a table: `owns: "staff[cook=true].person"`. A function on the name is for what no path can say, and a path almost always can: delta-doc's `reference/ownership.md` has each shape and the grammar. SQLite and Postgres answer a path alike, and a write that would take a row out of the writer's reach is refused, 403.
- **A custom document goes beside its resource's own**: `store.register(docs, { custom: [summary] })` (`defineCustomDoc`, delta-doc's `reference/custom-docs.md`); with `auth` it says `owns` or `shared` too.
- **What the server reads past the paths, it reads as the tables' owner**: `asOwner(store.pool, (db) => db.query(...))` from `dzql/postgres`. That is who is signed in (the sign-in's `personOf`) and the rows a custom document works out (its `recompute` is given the pool), never what is sent to someone as it is read. Never raise dzql's settings by hand.
- **Rows hang under what decides who sees them.** A document holds what its parent chain reaches, so for a team to see its members' orders the orders hang under the members (`orders: { parent: "members" }`) and the members under the team (`members: { parent: "teams", columns: { person: "integer" } }`): `team:` roots at the team and includes both. An order that only names its team in a column is out of the team document's reach, and a custom document written to gather it is the sign it hangs in the wrong place. Row-level security and the rest: dzql's Postgres docs (https://github.com/blueshed/dzql/tree/main/docs/postgres).
- A unique constraint (`unique` in the schema) is a unique index on Postgres too: two servers taking one seat's order at once, one is refused, 409. Never a trigger of your own beside the history.
- From a shell: `bunx dzql migrate <database> --app order --dir src/resources/order/migrations --status` says what of the history has run (the server's start runs it), `bunx dzql link <database> <person>` prints someone's sign-in link.
