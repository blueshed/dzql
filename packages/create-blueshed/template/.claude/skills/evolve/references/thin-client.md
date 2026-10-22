# Draw the page on the server

When the page should be drawn where the documents are: many people at once, slow phones, documents too big to send whole, or applets (a railroad component) on a page the server draws. That is **dzql's thin client**, the shape `bun create dzql` makes (the `dzql-app` skill): the server draws each person's page from the documents it reads and sends only the parts that changed; the browser runs dzql's client, which morphs what it is sent and sends the write a control names. It follows [postgres.md](postgres.md), and needs every document in that one Postgres: the stories put that store back after each, and no other.

**What stays:** the documents' definitions, their paths and the history of migrations; the rows, in the same data folder (`DATA_PATH`, else `data/`), and the rows kept before; `startServer({ port, dev, dataDir })`, which opens the store as the server starts and closes it as it stops; the HTTP route (`/api/status`); the look; `stories.ts`, each story under its key, a few gaining a body on their own line; and the tests of a document (`documents.ts` says where they are held) and of the page in a browser (both pages are the bento's HTML): `site.test.ts`, `message.test.ts`, `order.test.ts`, `kitchen.test.ts` and the moves'.

**What is rewritten:** what draws the page. Each `<name>-view.tsx` (railroad) becomes `<name>-view.ts` (strings, dzql's `bento`), a handler that sent a change the write its control names (`write(doc, op, path)`); `app.tsx` becomes `page.ts`; each `<name>.ts`, the browser's handle on a document, becomes its resource on the server; the store (`store.ts`) serves every document in this process, not on the socket. The test of what the light page alone did (`app.test.ts`) becomes the thin page's, and `CLAUDE.md` and `README.md` become create-dzql's.

```sh
rm src/app.tsx src/resources/bento.tsx src/resources/toast.ts src/resources/status/status.ts src/resources/status/status-view.tsx src/resources/message/message-view.tsx src/resources/order/order-view.tsx
rm tests/bento.test.ts tests/bento-page.tsx tests/bento-page.html tests/app.test.ts
```

## The documents, and the store

The definitions are as they were; each `-api.ts` gains what the page reads (`read`, dzql's: the page is told of every document it read), and an implied document reads its defaults before its row is made, as it opens:

```ts
// src/resources/order/order-api.ts
/** Order: the catalogue, each order and the kitchen, kept by Postgres (../../store.ts): their definitions, and what the page reads of them. */
import { defineDoc, defineSchema } from "dzql/postgres";
import { read } from "dzql/rendering/documents";

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

const byId = <T extends { id: number }>(rows: Record<string, T>): T[] => Object.values(rows).sort((a, b) => a.id - b.id);

/** What the catalogue holds, as the page reads it. */
export const items = (): Item[] => byId(read<Catalogue>("catalogue:").items);

/** Order `id`'s lines, as the page reads them. */
export const lines = (id: string): Line[] => byId(read<Order>(`order:${id}`).lines);

/** Each open order, as the cook's cell reads them: its id, and the items on it. */
export function openOrders(): { id: number; items: number[] }[] {
  const { orders, lines } = read<Kitchen>("kitchen:");
  return byId(orders).map((o) => ({ id: o.id, items: byId(lines).filter((l) => l.orders_id === o.id).map((l) => l.item) })).filter((o) => o.items.length > 0);
}
```

```ts
// src/resources/message/message-api.ts
/** Message — a shared document, kept by Postgres beside the order (../../store.ts): its definitions as they were on the JSON file, the import changed. */
import { defineDoc, defineSchema } from "dzql/postgres";
import { read as readDoc } from "dzql/rendering/documents";

export type Message = { id: number; text: string };
/** What `message:1` holds: its one row. */
export type MessageDoc = { messages: Message };

export const schema = defineSchema({
  messages: { columns: { text: { type: "text", default: "Hello" } }, temporal: false },
});

// `implied`: `message:1` opens as Hello before anyone has written it, and its first save makes the row
export const docs = [defineDoc("message:", { root: "messages", include: [], implied: true })];

/** What the message says, as the page reads it. */
export const read = (): Message => readDoc<MessageDoc>("message:1").messages;
```

The store is [postgres.md](postgres.md)'s, every document in it, now served in this process, where the page is drawn. A new database takes the rows kept before in the data folder, the message's JSON file too:

```ts
// src/store.ts
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { exportTables as jsonRows, type Snapshot } from "@blueshed/delta/json";
import { exportTables as sqliteRows } from "@blueshed/delta/sqlite";
import { importTables, openStore, type Schema } from "dzql/postgres";
import { sessionRows } from "dzql/rendering/sessions";
import * as message from "./resources/message/message-api";
import * as order from "./resources/order/order-api";
import * as session from "./resources/session/session-api";
import { migrations } from "./resources/order/migrations";

// The store: Postgres, each document's reads and writes compiled from its definitions (dzql's
// `openStore`), served in this process, where the page is drawn. The server opens it as it starts,
// on the data folder (PGlite in its pg/, or DATABASE_URL's server), and closes it as it stops. The
// order's history of migrations makes its tables; a table no migration makes (the message's, the
// sessions') is made from the schema.

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

export const store = openStore({
  schema: [order.schema, message.schema, session.schema], // each resource's, kept as one
  migrations: { list: migrations, app: "order", schema: order.schema, imported: true }, // the rows come imported: SQLite's ups never run here
  // each document compiled; a new database takes the rows kept before, then the documents are served
  prepare: async (pool, { dataDir }) => {
    if ((await pool.query("SELECT 1 FROM items")).rowCount) return;
    for (const [schema, rows] of keptBefore(dataDir)) await importTables(pool, schema, rows);
  },
});

store.register(order.docs);
store.register(message.docs, { ledger: false }); // the message has no undo, as on the JSON file
store.register(session.docs, { ledger: false }); // a visit is nobody's doing

/** The sessions, a row each, named by the cookie a browser carries. */
export const sessions = sessionRows(store.delta, "sessions");
```

## The resources

A resource says which document a page is on, what may be written to it, and what follows. The page cannot read the browser's `localStorage`, so the session names your order in its place: a row the visit's cookie names, as dzql's `sessionRows` keeps it. Nobody signs in; it holds only the order:

```ts
// src/resources/session/session-api.ts
/** The session: a row each visit's cookie names (`sessions`, ../../store.ts), holding the order its first Add made. */
import { defineDoc, defineSchema } from "dzql/postgres";
import { read } from "dzql/rendering/documents";

export const schema = defineSchema({
  // `cookie`: the hash of the cookie that names the session, never in its document
  sessions: { columns: { order_id: "integer?", cookie: "text?" }, temporal: false }, // a visit is no history
});

export const docs = [
  defineDoc("session:", { root: "sessions", include: [], implied: true, columns: { sessions: ["order_id"] } }), // the visitor's own: their order
  defineDoc("visit:", { root: "sessions", scope: { cookie: ":cookie" }, include: [] }), // the session a cookie names, found by its hash
];

/** The order session `id`'s first Add made; undefined before it. */
export function orderOf(id: string): string | undefined {
  const order = read<{ sessions?: { order_id?: number | null } }>(`session:${id}`).sessions?.order_id;
  return order == null ? undefined : String(order);
}
```

```ts
// src/resources/session/session.ts
import type { Resource } from "dzql/rendering/resources/resource";

// The session: a row the visit's cookie names (./session-api.ts), holding the visitor's order. It
// says where a tab may stand -- the box, or the message's drawer over it -- and the kernel moves the
// tab that asked (the app's `address`), never the session. The order is the server's to write, as
// the first Add makes it (../order/order.ts), never the wire's.

/** The places a tab may stand: the box, and the box with the message's drawer open. */
const PLACES = ["", "?message"];

export const session: Resource = {
  docType: "session",
  perSession: true,
  ledger: false,
  under: "/sessions", // the wire's `/order_id` is the document's `/sessions/order_id`
  resolveDoc: (ws) => ws.data.sessionId,
  permit: (_ws, op) => op.op === "replace" && op.path === "/page",
  shape: (_ws, _id, ops) => ops.filter((op) => PLACES.includes(String(op.value))), // anywhere else: the tab stays where it is
};
```

```ts
// src/resources/message/message.ts
import type { Resource } from "dzql/rendering/resources/resource";
import { tell } from "dzql/rendering/refusal";

// The message's resource: anyone may change its text, and is told Saved once it has landed. What
// the schema does not take (a text that is not text), delta refuses, told as the light page told it.

/** The path a save writes, as the light page wrote it: the one message's text, its row by its id. */
export const TEXT = "/messages/1/text";

export const message: Resource = {
  docType: "message",
  ledger: false, // no undo, as on the JSON file
  resolveDoc: () => "1",
  permit: (_ws, op) => op.op === "replace" && op.path === TEXT,
  refused: "Not saved", // in place of delta's words
  afterWrite: (ws) => tell(ws.data.sessionId, { doc: "message", path: TEXT, said: "Saved" }),
};
```

```ts
// src/resources/order/order.ts
import { activeDocuments, serverWrite } from "dzql/rendering/documents";
import type { Resource } from "dzql/rendering/resources/resource";
import { orderOf } from "../session/session-api";

// The catalogue, read by everyone and written by nobody; every order's number (`orders:`), through
// which your first Add makes your order; your order, the one your session names, which you add a
// line to or take one off; and the kitchen, every open order, read by the cook's cell and written
// by nobody.

export const catalogue: Resource = {
  docType: "catalogue",
  resolveDoc: () => "",
};

export const kitchen: Resource = {
  docType: "kitchen",
  resolveDoc: () => "",
};

/** Your first Add: the server names your order (`add /orders/-` takes the next number), your session keeps it, and the line goes on it. */
export const orders: Resource = {
  docType: "orders",
  undoable: false, // the order stays your session's: Undo takes back the line
  resolveDoc: () => "",
  permit: (ws, op) => op.op === "add" && op.path === "/orders/-" && orderOf(ws.data.sessionId) === undefined,
  shape: (_ws, _id, ops) => ops.map((op) => ({ ...op, value: {} })), // the item is the line's, not the order's
  async afterWrite(ws, _id, ops, landed) {
    const { id } = landed[0]!.value as { id: number };
    await serverWrite(`session:${ws.data.sessionId}`, [{ op: "replace", path: "/sessions/order_id", value: id }]);
    const line = await activeDocuments()!.write(`order:${id}`, [{ op: "add", path: "/lines/-", value: ops[0]!.value }], { identity: ws.data.sessionId, cursor: ws.data.sessionId }); // yours: Undo takes it back
    if ("error" in line) throw new Error(`order:${id}: ${line.error.message}`);
  },
};

export const order: Resource = {
  docType: "order",
  resolveDoc: (ws) => orderOf(ws.data.sessionId), // none until your first Add
  permit: (_ws, op) => (op.op === "add" && op.path === "/lines/-") || (op.op === "remove" && /^\/lines\/\d+$/.test(op.path)),
};
```

## The page

The cells and the drawer, drawn as `bento.tsx` drew them: a handler (`on`) becomes a write (`write`), `go` the session's `/page`, a signal what `read` gives. The marks are lucide, by name:

```ts
// src/icons.ts
// The marks the app draws, by our names for them, and lucide's outlines behind each: lucide alone,
// never another set or an inline SVG. The kernel's `svg` does the drawing, and the bento asks for
// its own marks by these names (the trail's chevron, undo and redo, the pencil, the plus, the close).
import { ChevronRight, Pencil, Plus, Redo2, Save, Undo2, X } from "lucide";
import { svg, type IconNode } from "dzql/rendering/icons";

const ICONS = { "chevron-right": ChevronRight, undo: Undo2, redo: Redo2, pencil: Pencil, plus: Plus, x: X, save: Save } satisfies Record<string, IconNode>;

export type IconName = keyof typeof ICONS;

export const icon = (name: IconName, size = 16): string => svg(ICONS[name], { size, name });
```

```ts
// src/surfaces.ts
import { bento } from "dzql/rendering/bento";
import { icon } from "./icons";

/** The bento's surfaces, drawn with the app's marks, where a tab stands written to the session. */
export const surfaces = bento({ icon, session: "session", undo: true }); // Undo and Redo: the order is on the ledger
```

```ts
// src/resources/message/message-view.ts
import type { Address } from "dzql/rendering/bento";
import { esc, join, write } from "dzql/rendering/html";
import { toldAt } from "dzql/rendering/refusal";
import { surfaces } from "../../surfaces";
import { read } from "./message-api";
import { TEXT } from "./message";

const { cell, drawer, tool, go } = surfaces;

/** Where the message's drawer opens: over the box, by its address (`?message`). */
const OPEN = "?message";

/** The message on the box: what it says, and ✎ to change it in its drawer. */
export function messageCell(at: Address) {
  return cell({ name: "Message", span: 2, thing: { open: go(OPEN), chosen: at.what === "message" }, summary: read().text });
}

/** The message's drawer: the box it is typed in, and Save, which writes it; what the save was told, beside it. */
export function messageDrawer(sessionId: string): string {
  const body = join(
    `<form${write("message", "replace", TEXT)}>`,
    `<div class="prop"><label class="prop-name cap" for="message-text">Text</label><div class="prop-value"><textarea class="field" id="message-text" name="text" rows="6">\n${esc(read().text)}</textarea></div></div>`,
    toldAt(sessionId, "message", TEXT),
    `<div class="drawer-foot">${tool("Save", { kind: "add", icon: "save", write: "", submit: true })}</div>`,
    `</form>`,
    `<p class="help">Change the message and hit <strong>Save</strong>: every open page shows it.</p>`,
  );
  return drawer("message", "Message", body, go(""));
}
```

```ts
// src/resources/order/order-view.ts
import { rows } from "dzql/rendering/bento";
import { write } from "dzql/rendering/html";
import { surfaces } from "../../surfaces";
import { orderOf } from "../session/session-api";
import { items, lines, openOrders, type Item } from "./order-api";

const { cell, row, tool } = surfaces;
const money = (n: number) => n.toFixed(2);

/** The catalogue on the box: each item, its price, and Add, which puts a line on your order, made by your first Add. */
export function catalogueCell(sessionId: string) {
  const yours = orderOf(sessionId) !== undefined;
  const line = (i: Item) => (yours ? write("order", "add", "/lines/-", { item: i.id }) : write("orders", "add", "/orders/-", { item: i.id }));
  const add = (i: Item) => tool("Add", { icon: "plus", label: `Add ${i.name}`, write: line(i) });
  return cell({ name: "Catalogue", span: 2, body: rows(items().map((i) => row({ id: `i${i.id}`, what: i.name, state: money(i.price), act: add(i) })), "Nothing to order yet.", "catalogue-rows") });
}

/** The kitchen on the box, the cook's: each open order, and what is on it. */
export function kitchenCell() {
  const all = items();
  const named = (ids: number[]) => ids.map((id) => all.find((i) => i.id === id)?.name ?? "").join(", ");
  return cell({ name: "Kitchen", body: rows(openOrders().map((o) => row({ id: `k${o.id}`, what: `Order ${o.id}`, note: named(o.items) })), "No open orders.", "kitchen-rows") });
}

/** Your order on the box: each line named and priced from the catalogue, × to take it off, and the total. */
export function orderCell(sessionId: string) {
  const all = items();
  const item = (id: number) => all.find((i) => i.id === id);
  const id = orderOf(sessionId);
  const ls = id === undefined ? [] : lines(id);
  const total = ls.reduce((sum, l) => sum + (item(l.item)?.price ?? 0), 0);
  const remove = (id: number) => tool("Remove", { icon: "x", iconOnly: true, kind: "quiet", write: write("order", "remove", `/lines/${id}`) });
  const body = rows(ls.map((l) => row({ id: `l${l.id}`, what: item(l.item)?.name ?? "", state: money(item(l.item)?.price ?? 0), act: remove(l.id) })), "Nothing yet.", "order-rows") + row({ what: "Total", state: money(total), total: true });
  return cell({ name: "Your order", count: ls.length || null, body });
}
```

```ts
// src/resources/status/status-view.ts
import { surfaces } from "../../surfaces";

const { cell } = surfaces;

/**
 * The server's status on the box: whether the data is on a mounted volume, and its Bun. Drawn by
 * the server, from what holds while it runs: a page is drawn again on every change it reads, so
 * the uptime, which changes by itself, is the route's alone (/api/status).
 */
export function statusCell() {
  const said = process.env.DATA_PATH !== undefined ? "Your data is on a mounted volume: it survives redeploys." : "Your data is ephemeral: it resets on redeploy.";
  return cell({ name: "Status", body: `<div id="status"><p class="help">${said}</p><p class="meta">Bun ${Bun.version}</p></div>` });
}
```

```ts
// src/page.ts
import { layers, parseAddress } from "dzql/rendering/bento";
import { surfaces } from "./surfaces";
import { messageCell, messageDrawer } from "./resources/message/message-view";
import { catalogueCell, kitchenCell, orderCell } from "./resources/order/order-view";
import { statusCell } from "./resources/status/status-view";

// The page, drawn by the server for a session where one of its tabs stands (its address, the tab's
// URL): a bento box of each resource's cell, the message's drawer over it at `?message`. To add a
// resource to the page: its cell in `cells`, its drawer by its `what`.

const { boxPage, site } = surfaces;

/** The app's name, said once, in index.html. */
const name = (await Bun.file(`${import.meta.dir}/index.html`).text()).match(/<title>(.*)<\/title>/)![1]!;

export function render(sessionId: string, page: string): string {
  const at = parseAddress(page);
  const cells = [messageCell(at), statusCell(), catalogueCell(sessionId), orderCell(sessionId), kitchenCell()];
  const drawer = at.what === "message" ? messageDrawer(sessionId) : "";
  return site(page, layers(boxPage([{ label: name }], [], cells, undefined, { actions: [] }), drawer, ""));
}
```

The browser's script is dzql's client, loaded by `index.html` itself: no `main.ts`, until an applet needs one:

```html
// src/index.html: in place of <div id="app"></div>
<main id="app">Connecting&hellip;</main>
```

```html
// src/index.html: in place of <script type="module" src="./app.tsx"></script>
<script type="module" src="dzql/rendering/client/app"></script>
```

## The routes

The app is an `Example`, its store the one `appOf` opens as the server starts, on the data folder, and closes as it stops; its HTTP route beside it:

```ts
// src/routes.ts
import { run, serve } from "@blueshed/delta/serve";
import type { Example } from "dzql/rendering/example";
import { appOf, compose } from "dzql/rendering/server";
import homepage from "./index.html";
import { render } from "./page";
import { sessions, store } from "./store";
import { session } from "./resources/session/session";
import { message } from "./resources/message/message";
import { catalogue, kitchen, order, orders } from "./resources/order/order";
import { statusApi } from "./resources/status/status-api";

// The app is its routes and its resources. The server is delta's: `serve` puts these routes and
// the socket on Bun.serve (with /health), `run`, at the bottom, is the process around it. The page
// is drawn here, on the server (./page.ts), from the documents the resources look after, kept in
// Postgres (./store.ts); the browser runs dzql's client (./index.html loads it), which morphs what it is sent.

/** The page and its resources: one per document the page reads or writes, the session first. */
export const app: Example = {
  name: "app",
  index: homepage,
  delta: store.delta,
  store, // opened as a server starts, closed as it stops; the stories begin and end each story on it
  resources: [session, message, catalogue, orders, order, kitchen],
  render,
  session: sessions.of, // the session a visit's cookie names: a row, which keeps the visitor's order
  active: () => true, // nobody signs in: anyone may write
  address: { doc: "session", path: "/page" }, // a tab's URL is where it stands: the session says where it may (./resources/session/session.ts)
};

export async function startServer({ port = undefined as number | undefined, dev = undefined as boolean | undefined, dataDir = process.env.DATA_PATH ?? `${import.meta.dir}/../data`, model = process.argv.includes("--model") } = {}) {
  const status = statusApi();
  // in development (`bun dev`), the model's page beside the app at /model; production never registers it
  const modelling = model && (await (await import("dzql/model")).modelRoute());
  return serve(
    compose(
      await appOf(app, { dataDir }), // "/", every other path a screen, the socket "/ws", and the documents on it
      // What isn't communication is an HTTP route (see src/resources/)
      { routes: { "/api/status": { GET: status.get } } },
      modelling,
    ),
    { port, dev },
  );
}

// `bun dev`, `bun start`: the pid file (`bun run stop`), the signals, and `bun --hot` serving again
if (import.meta.main) await run(startServer);
```

`bun dev` serves the model's page beside the app, `bun run stories` tells the stories, and `bun install` brings the `dzql-app` skill, which the app grows with from here:

```json
// package.json: in place of "dev": "bun --hot src/routes.ts",
"dev": "bun --hot src/routes.ts --model",
```

```json
// package.json: after "model": "dzql model",
"stories": "ETA_EXAMPLE=./src bun node_modules/dzql/src/modelling/stories-run.ts",
```

```json
// package.json: in place of "prepare": "delta install-skills --skip bun-route,dzql-app"
"prepare": "delta install-skills --skip bun-route"
```

The app is now one `bun create dzql` makes, and says so: its `CLAUDE.md` and `README.md` are create-dzql's, under its own name:

````md
// CLAUDE.md: under its heading
An app on dzql: stories first, then the documents a person needs in front of them to act, then
the page the server draws from them. The skills say how, and `bun install` puts them in
`.claude/skills` (`delta install-skills`):

- **modelling**: while someone tells you the stories, there to answer: the model's page
  (`bun dev` serves it at `localhost:3000/model` beside the app, and prints a sign-in link for
  each keeper; `bun run model login <link>`, then `bun run model <verb>`).
- **dzql-app**: building or changing the app in `src/`: stories, documents, resources, the page.
  `node_modules/dzql/examples/cafe/` is an app built from its model, laid out as this one is: its
  README walks the path from the model to the app.
- **delta-doc**: the documents themselves: schema, storage, the ledger. **railroad**: an applet drawn with it.

## The shape

An app is routes and resources on both sides of the socket, joined by documents; entities (the
collections of delta's `defineSchema`) are behind them, on the server. Here the server draws every
page, so the routes and resources are the server's:

- `src/routes.ts` is the server: the app (its page, its socket, its resources) composed with any
  HTTP route and, in development, the model's page at `/model`, on delta's one server (`serve`,
  `run`). `bun dev` and `bun start` run it; never a `Bun.serve` of the app's own.
- `src/store.ts` is where the documents are kept: Postgres, through dzql's `openStore` -- a server
  at `DATABASE_URL`, else PGlite in the process, in the data folder's `pg/` (`DATA_PATH`, else
  `data/`; for a test, a scratch folder of its own, or memory: `DATA_PATH=:memory:` in
  `.env.test`). PGlite is for development and the tests; production sets `DATABASE_URL`. The server opens it as it starts and closes it as it stops (`appOf(app, {
  dataDir })`). Its schema (one, or each resource's: `openStore({ schema: [...] })`) takes the
  model's `tables` once `dzql model` has made `model/`, and the app's own beside them.
- `src/resources/<name>/` is one document: `<name>-api.ts` its document, registered with the store
  (`register`); `<name>.ts` its resource (who may write it, what a write becomes), listed in the app's
  `resources`; `<name>-view.ts` its part of the page, drawn by `src/page.ts`.
- An applet is the only client resource.
- In development people sign in by a link each, printed as the server starts (`signInLinks`, from
  `dzql/rendering/links`: a demo door, each link used once, shut under `NODE_ENV=production`), and
  sign out by the bento's `leave`. A production app signs people in its own way (the dzql-app
  skill's `signin.md`); no email and no password unless a story asks for them.

## Working here

- Start every feature with its story in `stories.ts`, watch `bun run stories` fail, build the
  least that makes it pass. A story with no body yet (`story(name)`) is unproven until it has one.
- Asked to build or change something, build it; never stop to wait for an answer. `CHANGELOG.md`
  and `todo.jsonl` are the project's memory between sessions: read both first. What lands goes
  under `## [Unreleased]`; a question, or what you leave open, goes into `todo.jsonl` (one JSON
  object a line: `n`, `status`, `summary`, `detail`, and a dated `note`) with the reading you took.
- The gate before a commit: `bun check`, `bun test`, `bun run stories`.
- Never edit dzql or delta in `node_modules`; move to a later one by bumping it in `package.json`.
````

````md
// README.md: under its heading
An app in the shape `bun create dzql` makes: [dzql](https://github.com/blueshed/dzql/tree/main/packages/dzql)
draws every page on the server and tells each one what changed, and
[delta](https://github.com/blueshed/dzql/tree/main/packages/delta) keeps the documents and serves
it, in Postgres: PGlite in the process, in the data folder (`DATA_PATH`, else `data/`), until
`DATABASE_URL` names a server. A new one begins as nothing but its page, waiting for its first story.

```sh
bun dev          # http://localhost:3000, and the model's page at /model, where the stories are told first
bun test         # the page is served and drawn, and every story passes
bun run stories  # each story in stories.ts, told against the app
bun run model    # the model's page alone, http://localhost:3001/model
bun run stop     # a server started in the background
```

## How it grows

- **Stories first.** `stories.ts` says who does what and who then sees it, each a sentence a
  customer could call true or false. Tell one, watch it fail, build the least that makes it pass.
- **Routes and resources.** `src/routes.ts` is the server: the app's page and socket, any HTTP
  route, and in development the model's page, on delta's one server (`@blueshed/delta/serve`: the
  page, the socket, `/health`), never a `Bun.serve` of its own. Each document is a resource in
  `src/resources/<name>/`: its document (`<name>-api.ts`), its rules (`<name>.ts`) and its part of
  the page (`<name>-view.ts`). The first story says which document a person needs in front of them
  to act.
- **The page** is `src/page.ts`, drawn by the server from each resource's view.
````

## The stories

A story people do on the page gains its body on its own line, under its key: who does it, from where, and who then sees it (dzql-app's `stories.md`). The harness tells it against the page the server draws, then undoes and redoes it. One it cannot tell (a restart, a move, what no page shows or no control sends) stays a sentence, told by its tests as before. Each keeps its words, but one: an unknown page opens on the box (`health`).

```ts
// stories.ts: in place of import { story, type Stories } from "dzql/modelling/stories";
import { goTo, story, type Stories, type Write } from "dzql/modelling/stories";

// Ann and Bob each have the page open, on the box; the catalogue is Tea (1) and Cake (2). Bob's
// first Add has made his order, with a Tea on it; Ann has none yet.
const save = (text: string): Write => ({ doc: "message", ops: [{ op: "replace", path: "/messages/1/text", value: text }] });
const first = (item: number): Write => ({ doc: "orders", ops: [{ op: "add", path: "/orders/-", value: { item } }] }); // makes your order
const add = (item: number): Write => ({ doc: "order", ops: [{ op: "add", path: "/lines/-", value: { item } }] }); // on the order you have
```

```ts
// stories.ts: in place of cast: {},
cast: { ann: [], bob: [first(1)] },
goTo: goTo("session"),
```

```ts
// stories.ts: in place of kitchen: story(
kitchen: story("The cook sees each open order: a line added to any order, or changed, reaches the kitchen.", { as: "bob", does: add(2), seen: ["ann", "bob"] }),
```

```ts
// stories.ts: in place of follows: story(
follows: story("Anyone who opens the page sees the message, and a change made anywhere else shows in it, with nothing to reload.", { as: "ann", from: "?message", does: save("Hi"), seen: { ann: "?message", bob: "" } }),
```

```ts
// stories.ts: in place of health: story(
health: story("The health check answers ok, and an unknown page opens on the box."),
```

## The tests

The tests of a document hold it where the page now reads it, in this process:

```ts
// tests/documents.ts
// A document as the page reads it, held by a test: dzql's `documentsOf`, over the app's documents
// in this process (the store's `delta`), where the page is drawn. Beside browser.ts, which tests the
// page itself.
import { documentsOf } from "dzql/rendering/test-socket";
import { store } from "../src/store";

/** A test's client of the app's documents, while `server` holds the store open: `open` one, send to it, `undo`, `close`. */
export const documents = (_server: { url: URL }) => documentsOf(store.delta);
```

Every story with a body is told by dzql's harness, against the page the server draws, on a store put back after each:

```ts
// tests/stories.test.ts: after import { untold } from "dzql/modelling/stories";
import { run } from "dzql/modelling/harness";
import { app } from "../src/routes";
```

```ts
// tests/stories.test.ts: after });

// Every story with a body is told by dzql's harness, against the page the server draws, on a store
// put back after each (`bun run stories` says each)
test("every story with a body passes", async () => {
  const report = await run(app, stories);
  expect(report.outcomes.filter((o) => o.failures.length > 0)).toEqual([]); // each that failed, and why
  expect(report.warnings ?? []).toEqual([]);
}, 60_000);
```

What this page alone does, in place of what the light one did:

```ts
// tests/app.test.ts
import { test, expect, afterAll, setDefaultTimeout } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { startServer } from "../src/routes";
import { browser } from "./browser";
import { stories } from "../stories";

// What this page alone does, drawn on the server: where you are is the URL, every path a screen
// the server draws. What any page of the app does is site.test.ts.

setDefaultTimeout(30_000);

const dataDir = mkdtempSync(`${tmpdir()}/app-`);
const server = await startServer({ port: 0, dev: false, dataDir });
const { view, open, waitFor, close } = browser(() => new URL("/nowhere", server.url));

afterAll(async () => {
  close();
  await server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

test(`${stories.stories.health.name} -- a page that is not one opens on the box`, async () => {
  expect((await fetch(new URL("/nowhere", server.url))).status).toBe(200); // every path is a screen: the page, and its socket says where
  await open();
  await waitFor(`document.querySelector("h1")?.textContent === document.title`);
  expect(await view.evaluate<string>(`document.querySelector("[data-page]").dataset.page`)).toBe("");
});
```

Working: `tests/evolve.ts` makes a new app from this template, applies this page (after two-documents.md, sqlite.md and postgres.md) and runs its type check and tests (`bun run test:evolve`).

- `bun run stories` says each story; `STORY_BY_HAND=1 bun run stories` does each with the page's own controls, in a browser the size of a phone.
- **What changed for the people using it**, each by where it is drawn: Saved and Not saved are said beside the box, not in a toast; an unknown page opens on the box, where it said Page not found; and the uptime is the status route's alone, since a page drawn again must be the same page.
- **Your order is your session's**, where the light page kept its number in `localStorage`, which a page drawn on the server cannot read. The first Add makes it through `orders:` and writes its number to the session; every Add after goes on it, and Undo takes back the line, never the order (`undoable: false`). Two windows of one browser share a session, so they share the order; another browser has its own. The story and its test are the light page's.
- **The session is a row** (`Example.session`, dzql's `sessionRows`), found by the hash of the cookie a browser carries; nobody signs in, and it holds only the order. Sign-in by link is dzql-app's `signin.md`; delta's `auth-link` ([auth.md](auth.md)) is for a page that is delta's client, not this one.
- **The store is the server's**, as it was on the light page: opened as it starts, on its data folder, and closed as it stops, so a test runs servers on folders of its own, and `bun dev`'s reload closes the last store before it opens the next (its ids carry on).
- From here the app grows with `dzql-app`, as its `CLAUDE.md` says; the other references here are the light page's.
