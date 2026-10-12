# Growing the app: references

## Contents

- [A new document](#a-new-document): a second shared JSON document, made the way `message` is
- [Two documents on one page](#two-documents-on-one-page): the catalogue and an order
- [Store documents in SQLite](#store-documents-in-sqlite): when documents share rows, and for undo and history
- [Store in Postgres](#store-in-postgres): PGlite in this process, then a Postgres server
- [Serve what isn't communication](#serve-what-isnt-communication): HTTP routes, and files in S3
- [Build for production](#build-for-production): optional; the app runs from source

Each code block names its file on its first line, and is applied as it says: `// src/x.ts` is the whole file; `// src/x.ts: after <text>` or `// src/x.ts: before <text>` are lines to put after, or before, the first line holding that text, at its indent. `tests/evolve.ts` in the template proves every section that way: it makes a new app, applies the section's blocks and its `bun add` lines (and those of the sections it builds on), and runs `bun run typecheck` and `bun test` at 100%.

## A new document

Anything people share is a document from the start. `message` is one: `message-api.ts` registers it on the server, `message.ts` opens it in the page, `message-view.tsx` draws it and sends changes. A new one is the same three files. This one is a list of notes, which shows the other two verbs: `add` and `remove`.

- A document is never set in the page. `send` the change; it comes back to every window holding the document, this one included, and that is what draws it. Adding it locally as well draws it twice.
- A new row is `add /<collection>/-`: the server names it, and the name comes back in the path and as the row's `id`. Address a row by its id, never its position.
- Draw a collection with `list()`, keyed by id. Say "Not saved" when a `send` rejects.
- `registerDoc` applies any well-formed change. When only some make sense, refuse the others before delta applies them, as `message-api.ts` does: a throw with a `code` is delta's answer, and nothing changes.
- The page has one socket, provided in `src/app.tsx`; every document rides it, and it reconnects and reopens them by itself.

```ts
// src/resources/notes/notes-api.ts
/**
 * Notes — a shared document: a note anyone adds or takes away reaches every window holding it.
 * delta keeps it as notes.json in the data folder.
 */
import { registerDoc, type WsServer } from "@blueshed/delta/server";

export type Note = { id: string; text: string };
export type Notes = { notes: Record<string, Note> };

export function notesDoc(ws: WsServer, dataDir: string) {
  return registerDoc<Notes>(ws, "notes", { file: `${dataDir}/notes.json`, empty: { notes: {} } });
}
```

```ts
// src/resources/notes/notes.ts
import { openDoc } from "@blueshed/delta/client";
import type { Notes } from "./notes-api";

/** The notes document: read-only, it follows every change. Change it with `notes.send(ops)`. */
export const notes = openDoc<Notes>("notes");
```

```tsx
// src/resources/notes/notes-view.tsx
import { list, signal } from "@blueshed/railroad";
import { Plus, Trash2 } from "lucide";
import { Icon } from "../icon";
import { toast } from "../toast";
import { notes } from "./notes";

export function NotesView() {
  const text = signal("");
  const all = notes.data.map((d) => Object.values(d?.notes ?? {}));

  // Send, and let the change that comes back draw it
  const add = () =>
    notes.send([{ op: "add", path: "/notes/-", value: { text: text.peek() } }]).then(
      () => text.set(""),
      () => toast("Not saved", "alert"),
    );
  const remove = (id: string) => notes.send([{ op: "remove", path: `/notes/${id}` }]).catch(() => toast("Not saved", "alert"));

  return (
    <>
      <h1>Notes</h1>
      <ul class="notes">
        {list(all, (n) => n.id, (n$) => (
          <li>
            {n$.map((n) => n.text)}
            <button onclick={() => void remove(n$.peek().id)}>
              <Icon icon={Trash2} label="Remove" />
            </button>
          </li>
        ))}
      </ul>
      <input value={text} oninput={(e: Event) => text.set((e.currentTarget as HTMLInputElement).value)} />
      <div class="toolbar">
        <button class="primary" onclick={() => void add()}>
          <Icon icon={Plus} /> Add
        </button>
      </div>
    </>
  );
}
```

The server registers it on the app's socket, and the page gets a route:

```ts
// src/server.ts: after import { statusApi } from "./resources/status/status-api";
import { notesDoc } from "./resources/notes/notes-api";
```

```ts
// src/server.ts: after await messageDoc(ws, dataDir);
await notesDoc(ws, dataDir);
```

```tsx
// src/app.tsx: after import { StatusView } from "./resources/status/status-view";
import { NotesView } from "./resources/notes/notes-view";
```

```tsx
// src/app.tsx: before "*": () => (
"/notes": () => <NotesView />,
```

Tests, in a file of the document's own, as `tests/message.test.ts` has them. The page helpers are in `tests/browser.ts` (`refuseWrites` makes the server refuse what the page sends), and the Bun.WebView rules are at the top of `tests/site.test.ts`.

```ts
// tests/notes.test.ts
import { test, expect, afterAll, setDefaultTimeout } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { startServer } from "../src/server";
import { browser } from "./browser";

setDefaultTimeout(30_000); // first browser start can be slow

const dataDir = mkdtempSync(`${tmpdir()}/notes-`);
const server = await startServer({ port: 0, dev: false, dataDir });
const { view, open, waitFor, refuseWrites, withOtherWindow, close } = browser(() => server.url);

afterAll(async () => {
  close();
  await server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

const shown = `[...document.querySelectorAll(".notes li")].map((li) => li.textContent).join(", ")`;
const onNotes = `document.querySelector("h1")?.textContent === "Notes"`;

test("a note added in one window shows in another, and so does its removal", async () => {
  await open();
  await view.evaluate(`location.hash = "#/notes"`);
  await waitFor(onNotes);
  await withOtherWindow(async (other, waitForOther) => {
    await other.evaluate(`location.hash = "#/notes"`);
    await waitForOther(onNotes);

    await view.click("input");
    await view.type("first");
    await view.click("button.primary");
    await waitForOther(`${shown} === "first"`);
    await waitFor(`document.querySelector("input").value === ""`); // the box empties once it is saved

    await other.click(".notes li button");
    await waitFor(`${shown} === ""`);
  });
});

test("a note is kept: it is there after a reload", async () => {
  await open();
  await view.evaluate(`location.hash = "#/notes"`);
  await waitFor(onNotes);
  await view.click("input");
  await view.type("kept");
  await view.click("button.primary");
  await waitFor(`${shown} === "kept"`);

  await open();
  await view.evaluate(`location.hash = "#/notes"`);
  await waitFor(`${shown} === "kept"`);
});

test("a note the server refuses says Not saved, and stays in the box", async () => {
  await open();
  await view.evaluate(`location.hash = "#/notes"`);
  await waitFor(onNotes);
  await refuseWrites();
  await view.click("input");
  await view.type("refused");
  await view.click("button.primary");
  await waitFor(`document.querySelector(".toast.show.alert")?.textContent === "Not saved"`);
  expect(await view.evaluate<string>(`document.querySelector("input").value`)).toBe("refused");
});
```

## Two documents on one page

Design documents from the action: ask what someone needs in front of them to do it. To place an order you need the catalogue and your order: two documents on one page. The page opens both, draws both, and sends to the one it changes. Each is a JSON file of its own, which does a lot: until documents share rows, nothing more is needed.

```ts
// src/resources/order/order-api.ts
/**
 * Order — the page where someone orders. It needs two documents in front of them: the
 * catalogue to choose from, and their order. delta keeps each as a JSON file in the data folder.
 */
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

// What there is to choose from, and what has been chosen: both open while the page is
export const catalogue = openDoc<Catalogue>("catalogue");
export const order = openDoc<Order>("order");
```

The view reads the catalogue to name each line of the order and to price it, so a change to either redraws what depends on it:

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

  // Send, and let the change that comes back draw it
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

```ts
// src/server.ts: after import { statusApi } from "./resources/status/status-api";
import { orderDocs } from "./resources/order/order-api";
```

```ts
// src/server.ts: after await messageDoc(ws, dataDir);
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

```ts
// tests/order.test.ts
import { test, afterAll, setDefaultTimeout } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { startServer } from "../src/server";
import { browser } from "./browser";

setDefaultTimeout(30_000); // first browser start can be slow

const dataDir = mkdtempSync(`${tmpdir()}/order-`);
const server = await startServer({ port: 0, dev: false, dataDir });
const { view, open, waitFor, refuseWrites, withOtherWindow, close } = browser(() => server.url);

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
  await waitFor(`${shown("catalogue")} === "Tea 2.50, Cake 3.00"`);
  await waitFor(total("0.00"));
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

test("an item the server refuses says Not saved", async () => {
  await open();
  await view.evaluate(`location.hash = "#/order"`);
  await waitFor(`${shown("catalogue")} === "Tea 2.50, Cake 3.00"`);
  await refuseWrites();
  await view.click(".catalogue li:nth-child(1) button");
  await waitFor(`document.querySelector(".toast.show.alert")?.textContent === "Not saved"`);
  await waitFor(`${shown("order")} === "Cake"`);
});
```

## Store documents in SQLite

SQLite earns its place when documents share the same rows, as the catalogue and every order do, or when you want undo and history. The kitchen needs every open order: a third document over the rows each order has. The tables follow from the documents you already have: items from the catalogue, orders and their lines from an order. delta's SQLite backend keeps them in `app.db` in the data folder, and a change to a row reaches every document that holds it.

The page and its documents stay the same. Only `order-api.ts` changes, and the names the page opens: `catalogue:` is every item, `order:1` is order 1 and its lines. `{ ledger: true }` keeps every change with what undoes it: `undo`, `redo` and `history` come with it.

```ts
// src/resources/order/order-api.ts
/**
 * Order — the catalogue, each order, and the kitchen's view of every order, kept in SQLite.
 * The tables follow from the documents: items from the catalogue, orders and their lines from
 * an order. The kitchen is a third document over the same rows.
 */
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

// What there is to choose from, and what has been chosen: both open while the page is
export const catalogue = openDoc<Catalogue>("catalogue:");
export const order = openDoc<Order>("order:1");
```

The page's tests pass as they were. The kitchen's are new: a client in the test process holds the documents as a page does.

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

Over the socket, undo walks back what that connection wrote. delta-doc's reference has the rest: redo, history, a change named by its entry, and how the cursor works (*The ledger*).

## Store in Postgres

Postgres comes in when servers share the data, or people should see only their own. The schema and the documents carry over unchanged: delta runs the same documents on Postgres, first in this process with PGlite (Postgres compiled to WASM, its data in a directory), then on a server.

```sh
bun add @electric-sql/pglite
bun add -d @types/pg
```

`@types/pg` is for the typecheck only: delta ships TypeScript source, and its Postgres code names `pg`'s types.

The page and its documents stay the same, and so do their tests: only `orderDocs` changes, and where it imports from. PGlite keeps the rows in `pg/` in the data folder, and the documents are the listener's own (`types`), so every server has its own: a test's server keeps them in the test's data folder.

```ts
// src/resources/order/order-api.ts
/**
 * Order — the catalogue, each order, and the kitchen's view of every order, kept by Postgres
 * in this process (PGlite), in pg/ in the data folder. The schema and the documents are the
 * ones SQLite kept.
 */
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
  defineDoc("catalogue:", { root: "items", include: [] }), // every item
  defineDoc("order:", { root: "orders", include: ["lines"], implied: true }), // order:1 is order 1 and its lines
  defineDoc("kitchen:", { root: "orders", include: ["lines"] }), // every order, and every line
];

export const catalogue = { tables: { items: [{ id: 1, name: "Tea", price: 2.5 }, { id: 2, name: "Cake", price: 3 }] } };

export async function orderDocs(ws: WsServer, dataDir: string) {
  const pool = await openPglite(`${dataDir}/pg`); // one process owns the folder
  await applyFramework(pool); // delta's tables and stored functions
  await applySql(pool, generateSql(schema, docs)); // the app's tables
  if (!(await pool.query("SELECT 1 FROM items")).rowCount) await importTables(pool, schema, catalogue);
  // last: it answers 404 for a name it does not own
  return createDocListener(ws, pool, { types: docs.map((def) => docTypeFromDef(def, pool)), ledger: true });
}
```

The rows come across with `exportTables` from SQLite and `importTables` here. The order's page tests and the kitchen's now run on Postgres, undo included, as they are.

A Postgres server is the same with `new Pool({ connectionString })` from `pg` (`bun add pg`) in place of `openPglite`; its documents are told of every process's writes, so it is the step to more than one replica. Who may open what (`auth`, `owns`, row-level security) is in delta-doc's reference: *Quick start (Postgres backend)*, *Per-user list isolation* and *RLS*.

## Serve what isn't communication

HTTP routes serve what isn't communication: the health check, files, the server's status. `/health` is a route in `src/server.ts`. `status` is a resource of three files, like a document's, with a fetching store in place of `openDoc`: `status-api.ts` (the type and a handler that returns a `Response`), `status.ts` (a signal and a `load()` that fetches) and `status-view.tsx` (`load()` in the component body, a `failed` signal, and `when()` to draw once there is data). Copy it.

- Validate what a client sends, and answer 400 with `{ error }`. Test every route and method, a 400 included.
- The client imports the type with `import type`, so no server code reaches the browser.
- The view says when a load fails.

Files go in an S3 bucket through `Bun.s3`; never install an AWS SDK. It is configured from `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` (or their `AWS_` names), which Bun reads from `.env` or the environment when it starts, not from `process.env` later. On Railway they are a bucket's variables, named in `railway.ts` with `preserve()`. `startServer` takes the client as an option, so that tests can pass their own.

```ts
// src/resources/files/files-api.ts
import type { BunRequest, S3Client } from "bun";

export function filesApi(s3: S3Client) {
  return {
    // Answers a redirect to a presigned URL: the bytes come from the bucket, not this server
    get: async (req: BunRequest<"/api/files/:name">) => {
      const file = s3.file(req.params.name);
      if (!(await file.exists())) return Response.json({ error: "no such file" }, { status: 404 });
      return new Response(file);
    },

    put: async (req: BunRequest<"/api/files/:name">) => {
      await s3.write(req.params.name, await req.blob());
      return new Response(null, { status: 204 });
    },
  };
}
```

```ts
// src/server.ts: after import { statusApi } from "./resources/status/status-api";
import { filesApi } from "./resources/files/files-api";
```

```ts
// src/server.ts: after dataDir = process.env.DATA_PATH
s3 = Bun.s3,
```

```ts
// src/server.ts: after const status = statusApi();
const files = filesApi(s3);
```

```ts
// src/server.ts: after "/api/status": { GET: status.get },
"/api/files/:name": { GET: files.get, PUT: files.put },
```

Because of the redirect, the browser must be able to reach the bucket's endpoint. Tests need no real bucket: a stand-in of a few lines covers a write, `exists()` and a presigned read.

```ts
// tests/files.test.ts
import { test, expect, afterAll } from "bun:test";
import { S3Client } from "bun";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { startServer } from "../src/server";

// A stand-in bucket: PUT keeps an object, HEAD and GET answer it
const objects = new Map<string, Blob>();
const bucket = Bun.serve({
  port: 0,
  async fetch(req) {
    const key = new URL(req.url).pathname;
    if (req.method === "PUT") {
      objects.set(key, await req.blob());
      return new Response();
    }
    const object = objects.get(key);
    if (!object) return new Response(null, { status: 404 });
    return new Response(req.method === "HEAD" ? null : object, { headers: { "content-length": String(object.size) } });
  },
});
const s3 = new S3Client({ endpoint: bucket.url.href, bucket: "files", accessKeyId: "test", secretAccessKey: "test" });

const dataDir = mkdtempSync(`${tmpdir()}/files-`);
const server = await startServer({ port: 0, dev: false, dataDir, s3 });
afterAll(async () => {
  await server.stop(true);
  await bucket.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});
const api = (path: string, init?: RequestInit) => fetch(new URL(path, server.url), init);

test("a file is put in the bucket, and a GET redirects to it", async () => {
  expect((await api("/api/files/hello.txt", { method: "PUT", body: "hello, bucket" })).status).toBe(204);
  const res = await api("/api/files/hello.txt", { redirect: "manual" });
  expect(res.status).toBe(302);
  expect(await (await fetch(res.headers.get("location")!)).text()).toBe("hello, bucket");
});

test("a file that is not there is a 404", async () => {
  const res = await api("/api/files/nope.txt");
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "no such file" });
});
```

## Build for production

Optional. The app runs from source: `bun run start` serves `src/main.ts` with `NODE_ENV=production`, which turns hot reload off and bundles the page on its first request. Build only when a faster start or a single bundle is worth a step.

```jsonc
// package.json: after "scripts": {
"build": "bun build src/main.ts --target=bun --outdir=dist --production",
"serve:dist": "NODE_ENV=production bun --cwd dist main.js",
```

- `--production` matters: without it the built server runs with hot reload on.
- `dist/` is git-ignored. In `railway.ts`, `build: "bun install && bun run build"` and `start: "bun run serve:dist"`.

Test it by building, starting `main.js` in `dist/`, and checking the page has no hot reload:

```ts
// tests/build.test.ts
import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const root = `${import.meta.dir}/..`;

test("the build serves the page, without hot reload", async () => {
  expect(Bun.spawnSync([process.execPath, "run", "build"], { cwd: root }).exitCode).toBe(0);

  const dataDir = mkdtempSync(`${tmpdir()}/build-`);
  const proc = Bun.spawn([process.execPath, "main.js"], {
    cwd: `${root}/dist`,
    env: { ...process.env, NODE_ENV: "production", PORT: "0", PID_FILE: `${dataDir}/.server.pid`, DATA_PATH: dataDir },
    stdout: "pipe",
  });
  try {
    let out = "";
    for await (const chunk of proc.stdout) {
      out += new TextDecoder().decode(chunk);
      if (/Listening on \S+/.test(out)) break;
    }
    const html = await (await fetch(out.match(/Listening on (\S+)/)![1]!)).text();
    expect(html).toContain('<div id="app">');
    expect(html).not.toContain("data-bun-dev-server-script");
  } finally {
    proc.kill();
    await proc.exited;
    rmSync(dataDir, { recursive: true, force: true });
  }
});
```

eta, a step beyond this app where documents are drawn on the server and who may write what is stated as stories, is private and is not run or tested here.
