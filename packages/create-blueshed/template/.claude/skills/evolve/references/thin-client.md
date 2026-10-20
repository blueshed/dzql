# Draw the page on the server

When the page should be drawn where the documents are: many people at once, slow phones, documents too big to send whole, or applets (a railroad component) on a page the server draws. That is **dzql's thin client**, the shape `bun create dzql` makes (the `dzql-app` skill): the server draws each person's page from the documents it reads and sends only the parts that changed; the browser runs dzql's client, which morphs what it is sent and sends the write a control names. It follows [postgres.md](postgres.md), and needs every document in that one Postgres: the stories put that store back after each, and no other.

**What stays:** the documents' definitions (the order's schema, documents and history of migrations; the message's, its import now `dzql/postgres`), the rows, the HTTP route (`/api/status`), the look (`bento-plain.css` and `styles.css`), and what people see and do: the same box, the same cells, the same writes.

**What is rewritten, plainly: everything that draws or holds the page, the stories' form, and most of the tests.** Each `<name>.ts` was the browser's handle on a document and becomes its resource on the server; each `<name>-view.tsx` (railroad) becomes `<name>-view.ts` (strings, dzql's `bento`); `app.tsx` becomes `page.ts`; the store, opened by `startServer` for each server, is opened once as the app loads (`store.ts`); a story gains a body the harness tells; the browser tests become socket tests, since dzql's client is dzql's to test. A handler that sent a change becomes the write its control names (`write(doc, op, path)`): that part is the line-for-line swap the bento promised, and the HTML is the same. The rest is not.

What goes:

```sh
rm src/app.tsx src/resources/bento.tsx src/resources/toast.ts src/resources/status/status.ts src/resources/status/status-view.tsx src/resources/message/message-view.tsx src/resources/order/order-view.tsx
rm tests/browser.ts tests/bento.test.ts tests/bento-page.tsx tests/bento-page.html tests/kitchen.test.ts tests/order-pg.test.ts tests/order-pg-move.test.ts
```

## The documents, and the store

The definitions are as they were; what opened the store goes to `store.ts`, and each `-api.ts` gains what the page reads (`read`, dzql's: the page is told of every document it read):

```ts
// src/resources/order/order-api.ts
/** Order: the catalogue, each order and the kitchen, kept by Postgres (../../store.ts): their definitions, and what the page reads of them. */
import { defineDoc, defineSchema } from "dzql/postgres";
import { read } from "dzql/rendering/documents";

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

const byId = <T extends { id: number }>(rows: Record<string, T> | undefined): T[] => Object.values(rows ?? {}).sort((a, b) => Number(a.id) - Number(b.id));

/** What the catalogue holds, as the page reads it. */
export const items = (): Item[] => byId(read<Catalogue>("catalogue:").items);

/** Order `id`'s lines, as the page reads them: none before its first (the row not made yet). */
export const lines = (id: string): Line[] => byId(read<Order | undefined>(`order:${id}`)?.lines);
```

```ts
// src/resources/message/message-api.ts
/**
 * Message — a shared document. Every page that reads it is drawn again when anyone changes it.
 * Kept by Postgres beside the order (../../store.ts): its definitions are as they were on the JSON
 * file, the import changed.
 */
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

/** What the message says, as the page reads it: Hello before anyone has saved (the row not made yet, as storage holds it). */
export const read = (): Message => readDoc<MessageDoc | undefined>("message:1")?.messages ?? { id: 1, text: "Hello" };
```

The store is opened once, as the app loads, and serves the documents in this process, where the page is drawn. It takes the rows kept before as `orderDocs` did, the message's JSON file too:

```ts
// src/store.ts
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { exportTables as jsonRows, type Snapshot } from "@blueshed/delta/json";
import { exportTables as sqliteRows } from "@blueshed/delta/sqlite";
import { importTables, openStore, type Schema } from "dzql/postgres";
import * as message from "./resources/message/message-api";
import * as order from "./resources/order/order-api";
import { migrations } from "./resources/order/migrations";

// The store: Postgres, each document's reads and writes compiled from its definitions (dzql's
// `openStore`), served in this process, where the page is drawn: DATABASE_URL's server, else PGlite
// in PGLITE_DIR (`bun dev`'s data/pg), else in memory (the tests, the stories). The order's history
// of migrations makes its tables; a table no migration makes (the message's) is made from the schema.

export const { pool, delta, register, open, stories, close } = await openStore({
  schema: { tables: { ...order.schema.tables, ...message.schema.tables } },
  migrations: { list: migrations, app: "order", schema: order.schema },
});

register(order.docs);
register(message.docs, { ledger: false }); // the message has no undo, as on the JSON file

/** The rows the app kept in `dataDir` before: the orders (SQLite, else the JSON file; none, the catalogue), and the message (its JSON file). */
export function keptBefore(dataDir: string): [Schema, Snapshot][] {
  const kept = (file: string) => `${dataDir}/${file}`;
  let orders: Snapshot = order.catalogue;
  if (existsSync(kept("app.db"))) {
    const db = new Database(kept("app.db"), { readonly: true });
    try { orders = sqliteRows(db, order.schema); } finally { db.close(); }
  } else if (existsSync(kept("order.json"))) orders = jsonRows(kept("order.json"), order.schema);
  return [[order.schema, orders], ...(existsSync(kept("message.json")) ? [[message.schema, jsonRows(kept("message.json"), message.schema)] as [Schema, Snapshot]] : [])];
}

// Each document compiled; a new database takes the rows kept before in the data folder (DATA_PATH,
// else data/) -- a store in memory takes none but the catalogue -- then the documents are served
await open(async () => {
  if ((await pool.query("SELECT 1 FROM items")).rowCount) return;
  const kept = process.env.DATABASE_URL || process.env.PGLITE_DIR ? keptBefore(process.env.DATA_PATH ?? `${import.meta.dir}/../data`) : [[order.schema, order.catalogue] as [Schema, Snapshot]];
  for (const [schema, rows] of kept) await importTables(pool, schema, rows);
});
```

## The resources

A resource says which document a page is on, what may be written to it, and what follows. The session says where a tab may stand; nobody signs in, so the cookie is the session:

```ts
// src/resources/session/session.ts
import type { Resource } from "dzql/rendering/resources/resource";

// The session: nobody signs in, so the cookie is the session and no row is kept by it. It says
// where a tab may stand -- the box, or the message's drawer over it -- and the kernel moves the
// tab that asked (the app's `address`), never the session: nothing is written.

/** The places a tab may stand: the box, and the box with the message's drawer open. */
const PLACES = ["", "?message"];

export const session: Resource = {
  docType: "session",
  perSession: true,
  ledger: false,
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
// the schema does not take (a text that is not text), delta refuses.

/** The path a save writes: the one message's text. */
export const TEXT = "/messages/text";

export const message: Resource = {
  docType: "message",
  ledger: false, // no undo, as on the JSON file
  resolveDoc: () => "1",
  permit: (_ws, op) => op.op === "replace" && op.path === TEXT,
  afterWrite: (ws) => tell(ws.data.sessionId, { doc: "message", path: TEXT, said: "Saved" }),
};
```

```ts
// src/resources/order/order.ts
import type { Resource } from "dzql/rendering/resources/resource";

// The catalogue, read by everyone and written by nobody; and the order, which everyone adds a line
// to, or takes one off. Everyone is on order 1, as the light page was. The kitchen is read by no
// page yet: its document is served, and a page that reads it is told.

export const catalogue: Resource = {
  docType: "catalogue",
  resolveDoc: () => "",
};

export const order: Resource = {
  docType: "order",
  resolveDoc: () => "1",
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
export const surfaces = bento({ icon, session: "session" });
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
import { items, lines, type Item } from "./order-api";

const { cell, row, tool } = surfaces;
const money = (n: number) => n.toFixed(2);

/** The catalogue on the box: each item, its price, and Add, which puts a line on the order. */
export function catalogueCell() {
  const add = (i: Item) => tool("Add", { icon: "plus", label: `Add ${i.name}`, write: write("order", "add", "/lines/-", { item: i.id }) });
  return cell({ name: "Catalogue", span: 2, body: rows(items().map((i) => row({ id: `i${i.id}`, what: i.name, state: money(i.price), act: add(i) })), "Nothing to order yet.", "catalogue-rows") });
}

/** The order on the box: each line named and priced from the catalogue, × to take it off, and the total. */
export function orderCell() {
  const all = items();
  const item = (id: number) => all.find((i) => i.id === id);
  const ls = lines("1");
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
import { catalogueCell, orderCell } from "./resources/order/order-view";
import { statusCell } from "./resources/status/status-view";

// The page, drawn by the server for a session where one of its tabs stands (its address, the tab's
// URL): a bento box of each resource's cell, the message's drawer over it at `?message`. To add a
// resource to the page: its cell in `cells`, its drawer by its `what`.

const { boxPage, site } = surfaces;

/** The app's name, said once, in index.html. */
const name = (await Bun.file(`${import.meta.dir}/index.html`).text()).match(/<title>(.*)<\/title>/)![1]!;

export function render(sessionId: string, page: string): string {
  const at = parseAddress(page);
  const cells = [messageCell(at), statusCell(), catalogueCell(), orderCell()];
  const drawer = at.what === "message" ? messageDrawer(sessionId) : "";
  return site(page, layers(boxPage([{ label: name }], [], cells, undefined, { actions: [] }), drawer, ""));
}
```

The browser's script is dzql's client:

```ts
// src/main.ts
// The browser: no applets of its own, so dzql's client, which morphs the page the server draws.
import "dzql/rendering/client/app";
```

```html
// src/index.html: in place of <div id="app"></div>
<main id="app">Connecting&hellip;</main>
```

```html
// src/index.html: in place of <script type="module" src="./app.tsx"></script>
<script type="module" src="./main.ts"></script>
```

## The routes

The app is an `Example`, served with `appOf` and `compose` on delta's server, its HTTP route beside it:

```ts
// src/routes.ts
import { run, serve } from "@blueshed/delta/serve";
import type { Example } from "dzql/rendering/example";
import { appOf, compose } from "dzql/rendering/server";
import homepage from "./index.html";
import { render } from "./page";
import { close, delta, stories } from "./store";
import { session } from "./resources/session/session";
import { message } from "./resources/message/message";
import { catalogue, order } from "./resources/order/order";
import { statusApi } from "./resources/status/status-api";

// The app is its routes and its resources. The server is delta's: `serve` puts these routes and
// the socket on Bun.serve (with /health), `run`, at the bottom, is the process around it. The page
// is drawn here, on the server (./page.ts), from the documents the resources look after, kept in
// Postgres (./store.ts); the browser runs dzql's client (./main.ts), which morphs what it is sent.

/** The page and its resources: one per document the page reads or writes, the session first. */
export const app: Example = {
  name: "app",
  index: homepage,
  delta,
  resources: [session, message, catalogue, order],
  render,
  active: () => true, // nobody signs in: anyone may write
  address: { doc: "session", path: "/page" }, // a tab's URL is where it stands: the session says where it may (./resources/session/session.ts)
  store: stories, // the stories begin and end each story on the store
};

export async function startServer({ port = undefined as number | undefined, dev = undefined as boolean | undefined } = {}) {
  const status = statusApi();
  return serve(
    compose(
      appOf(app), // "/", every other path a screen, the socket "/ws", and the documents on it
      // What isn't communication is an HTTP route (see src/resources/); the store is closed once
      // the server stops when this is the process (`bun dev`, `bun start`), and a test's left open
      { routes: { "/api/status": { GET: status.get } }, close: import.meta.main ? [close] : [] },
    ),
    { port, dev },
  );
}

// `bun dev`, `bun start`: the pid file (`bun run stop`), the signals, and `bun --hot` serving again
if (import.meta.main) await run(startServer);
```

`bun dev` keeps Postgres in `data/pg`, `bun run stories` tells the stories, and `bun install` brings the `dzql-app` skill, which the app grows with from here:

```json
// package.json: in place of "dev": "bun --hot src/routes.ts",
"dev": "PGLITE_DIR=data/pg bun --hot src/routes.ts",
```

```json
// package.json: in place of "start": "NODE_ENV=production bun src/routes.ts",
"start": "NODE_ENV=production PGLITE_DIR=data/pg bun src/routes.ts",
```

```json
// package.json: after "model": "dzql model",
"stories": "ETA_EXAMPLE=./src bun node_modules/dzql/src/modelling/stories-run.ts",
```

```json
// package.json: in place of "prepare": "delta install-skills --skip bun-route,dzql-app"
"prepare": "delta install-skills --skip bun-route"
```

```ini
// .env.test
# bun test reads this: the tests keep the documents in memory, never where `bun dev` keeps them
PGLITE_DIR=
DATABASE_URL=
```

## The stories

A story people do on the page gains its body: who does it, from where, and who then sees it (dzql-app's `stories.md`). The harness tells it against the page the server draws, then undoes and redoes it. One it cannot tell (a restart, a move, what no page shows or no control sends) stays a sentence, told by a test named from it, as before; the record is renamed `unproven`, since `stories` is now the harness's:

```ts
// stories.ts
// What this app was asked to make true: each a sentence someone using it could call true or false.
// A story with a body -- who does what on the page, and who then sees it -- is told by dzql's
// harness, against the page the server draws (`bun run stories`, and tests/stories.test.ts). One
// with no body -- a restart, a move, what no page shows or no control sends -- is in `unproven`, told
// by a test named from it (`test(`${unproven.saves.name} -- ...`)`): tests/stories.test.ts fails
// one no test names. Earlier stories stay true; a story that changes is changed here, never
// dropped quietly.
import { goTo, story, type Stories, type Write } from "dzql/modelling/stories";

// Ann and Bob each have the page open, on the box; the catalogue is Tea (1) and Cake (2), and
// order 1 is everyone's. The first line ordered is line 1.
const save = (text: string): Write => ({ doc: "message", ops: [{ op: "replace", path: "/messages/text", value: text }] });
const add = (item: number): Write => ({ doc: "order", ops: [{ op: "add", path: "/lines/-", value: { item } }] });
const remove = (line: number): Write => ({ doc: "order", ops: [{ op: "remove", path: `/lines/${line}` }] });

/** The stories with no body yet, each told by a test named from it. */
export const unproven = {
  // Postgres
  carriesOn: story("After the server stops and starts again, an order carries on where it was."),
  // The move
  moved: story("The orders people made are still there after the app moves its documents to the next store."),
  // The kitchen
  kitchen: story("The kitchen sees every open order: a line added to any order, or changed, reaches it."),
  undo: story("Undo takes back your last change, wherever it shows."),
  // The message
  saves: story("Saving (the button) says Saved once the server has it, and the message is still there after a reload."),
  refused: story("A save the server does not take is refused, and the message stays as it was."),
  restarts: story("After the server restarts, the page has what changed meanwhile, and follows again."),
  // The server
  volume: story("The page says whether the data is on a mounted volume, never where it is."),
  health: story("The health check answers ok, and an unknown page opens on the box."),
};

export const stories: Stories = {
  cast: { ann: [], bob: [] },
  goTo: goTo("session"),
  stories: [
    // The order
    story("Someone ordering has the catalogue and their order on one page, with its total, and what one window orders shows in another.", { as: "ann", does: add(1), seen: ["ann", "bob"] }),
    story("What one window takes off the order goes from the other's too, and from its total.", { premise: { ann: [add(1), add(2)] }, as: "bob", does: remove(1), seen: ["ann", "bob"] }),
    // The message
    story("Anyone who opens the page sees the message, and a change made anywhere else shows in it, with nothing to reload.", { as: "ann", from: "?message", does: save("Hi"), seen: { ann: "?message", bob: "" } }),
  ],
  unproven: Object.values(unproven),
};
```

## The tests

```ts
// tests/stories.test.ts
import { expect, test } from "bun:test";
import { run } from "dzql/modelling/harness";
import { untold } from "dzql/modelling/stories";
import { app } from "../src/routes";
import { stories, unproven } from "../stories";

// Every story with a body is told by dzql's harness, against the page the server draws, on a store
// put back after each (`bun run stories` says each); every one without is told by a test named from
// it (`unproven.<key>.name`).

test("every story passes", async () => {
  const report = await run(app, stories);
  expect(report.outcomes.filter((o) => o.failures.length > 0)).toEqual([]); // each that failed, and why
  expect(report.warnings ?? []).toEqual([]);
}, 60_000);

test("every story with no body yet is told by a test named from it", async () => {
  const files = [...new Bun.Glob("*.test.ts").scanSync(import.meta.dir)].filter((f) => f !== "stories.test.ts");
  const sources = await Promise.all(files.map((f) => Bun.file(`${import.meta.dir}/${f}`).text()));
  expect(untold(unproven, sources)).toEqual([]);
});
```

A tab is a socket (dzql's `test-socket`): it writes as the page's controls do, and holds the page as the browser would:

```ts
// tests/message.test.ts
import { test, expect, afterAll } from "bun:test";
import { connect, expectMessage, heard, open, opened, pageOf, write } from "dzql/rendering/test-socket";
import { startServer } from "../src/routes";
import { delta } from "../src/store";
import { TEXT } from "../src/resources/message/message";
import { unproven } from "../stories";

// The message, as the page the server draws holds it: a socket of a session's tab (dzql's
// test-socket), writing as its controls do. What one person sees after another's save, and a save
// refused, are stories the harness tells (../stories.ts).

let server = await startServer({ port: 0, dev: false });

afterAll(() => server.stop(true));

/** A tab of session `id` opened at `at`, its first page drawn. */
async function tab(id: string, at?: string) {
  const ws = connect(server, id, at);
  await opened(ws);
  await expectMessage(ws, "render");
  return ws;
}

test(`${unproven.saves.name} -- Save says Saved beside the box once the server has it, and a reload has the message`, async () => {
  const ws = await tab("saver", "?message");
  expect(pageOf(ws)).toContain(`id="message-text"`);
  write(ws, "message", [{ op: "replace", path: TEXT, value: "typed and saved" }]);
  await heard(ws);
  expect(pageOf(ws)).toContain(`<p class="said" role="status">Saved</p>`);
  ws.close();
  const reload = await tab("saver", "?message");
  expect(pageOf(reload)).toContain("typed and saved</textarea>");
  reload.close();
});

test(`${unproven.refused.name} -- a text that is not text, which no page sends, is refused, and nothing changes`, async () => {
  const ws = await tab("refused", "?message");
  const before = pageOf(ws);
  write(ws, "message", [{ op: "replace", path: TEXT, value: 1 }]);
  expect((await expectMessage(ws, "refused")).reason).toBeUndefined(); // delta's 400: refused without a word
  await heard(ws);
  expect(pageOf(ws)).toBe(before);
  ws.close();
});

test(`${unproven.restarts.name} -- the server stopped, the message changed meanwhile, started again: the page has it, and follows again`, async () => {
  const port = server.port;
  await server.stop(true); // closes every page's socket
  await delta.call("delta", { doc: "message:1", ops: [{ op: "replace", path: TEXT, value: "changed while down" }] });
  server = await startServer({ port, dev: false });
  const ws = await open(server);
  expect(pageOf(ws)).toContain("changed while down");
  const other = await open(server);
  write(other, "message", [{ op: "replace", path: TEXT, value: "and after" }]);
  await heard(other);
  await heard(ws);
  expect(pageOf(ws)).toContain("and after");
  ws.close();
  other.close();
});
```

```ts
// tests/order.test.ts
import { test, expect, afterAll } from "bun:test";
import { heard, open, pageOf, write } from "dzql/rendering/test-socket";
import { startServer } from "../src/routes";
import { delta } from "../src/store";
import type { Line } from "../src/resources/order/order-api";
import { unproven } from "../stories";

// The kitchen, which no page reads yet, held by delta in this process (the store's `delta`); and
// Undo, as the page's own tool sends it. Ordering, and taking a line off, are stories the harness
// tells (../stories.ts).

const server = await startServer({ port: 0, dev: false });

afterAll(() => server.stop(true));

/** The kitchen's lines, as delta holds them: each order's number, and its item. */
async function kitchen(): Promise<[number, number][]> {
  const { result } = await delta.call("open", { doc: "kitchen:" });
  return Object.values((result.lines ?? {}) as Record<string, Line & { orders_id: number }>).map((l) => [Number(l.orders_id), Number(l.item)]);
}

/** The order's lines, as a page shows them. */
const shown = (page: string) => [...page.matchAll(/id="l\d+"><span class="words"><span class="what">(\w+)</g)].map(([, what]) => what);

test(`${unproven.kitchen.name} -- a line ordered on the page reaches the kitchen, and so does one changed`, async () => {
  const ws = await open(server);
  const before = (await kitchen()).length;
  write(ws, "order", [{ op: "add", path: "/lines/-", value: { item: 1 } }]);
  await heard(ws);
  const lines = await kitchen();
  expect(lines.length).toBe(before + 1);
  expect(lines.at(-1)).toEqual([1, 1]);

  // a line changed, as no page changes one yet: by delta, as the server
  const { result } = await delta.call("open", { doc: "order:1" });
  const last = Object.keys(result.lines).at(-1)!;
  await delta.call("delta", { doc: "order:1", ops: [{ op: "replace", path: `/lines/${last}/item`, value: 2 }] });
  expect((await kitchen()).at(-1)).toEqual([1, 2]);
  await heard(ws);
  expect(shown(pageOf(ws)).at(-1)).toBe("Cake");
  ws.close();
});

test(`${unproven.undo.name} -- Undo on the page takes the line back off the order, in the kitchen and on another page`, async () => {
  const [ann, bob] = [await open(server, "ann-undo"), await open(server, "bob-undo")];
  write(ann, "order", [{ op: "add", path: "/lines/-", value: { item: 2 } }]);
  await heard(ann);
  await heard(bob);
  const ordered = shown(pageOf(bob)).length;
  const inKitchen = (await kitchen()).length;
  expect(pageOf(ann)).toContain(`aria-label="Undo"`);
  write(ann, "ledger", [{ op: "remove", path: "/latest" }]); // what the page's Undo sends
  await heard(ann);
  await heard(bob);
  expect(shown(pageOf(bob)).length).toBe(ordered - 1);
  expect((await kitchen()).length).toBe(inKitchen - 1);
  ann.close();
  bob.close();
});
```

The store is opened once, as the app loads, so a server on a data folder of its own is a process of its own:

```ts
// tests/order-move.test.ts
import { test, expect, afterAll, setDefaultTimeout } from "bun:test";
import { Database } from "bun:sqlite";
import { importTables as jsonTables } from "@blueshed/delta/json";
import { fromFolder, importTables, migrate } from "@blueshed/delta/sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { heard, open, pageOf, write } from "dzql/rendering/test-socket";
import { keptBefore } from "../src/store";
import { schema } from "../src/resources/order/order-api";
import { schema as messageSchema } from "../src/resources/message/message-api";
import { unproven } from "../stories";

// Where the documents are kept, and what was kept before: a server is a process of its own here,
// since the store is opened once, as the app loads (../src/store.ts), on the folder it is told.

setDefaultTimeout(30_000);

const scratch = mkdtempSync(`${tmpdir()}/order-move-`);
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const TEA_AND_CAKE = [{ id: 1, name: "Tea", price: 2.5 }, { id: 2, name: "Cake", price: 3 }];

/** `src/routes.ts` run on `dataDir`, PGlite in its pg/: a server and its url, until `stop`. */
async function serving(dataDir: string) {
  const proc = Bun.spawn([process.execPath, "src/routes.ts"], {
    cwd: `${import.meta.dir}/..`,
    env: { ...process.env, PORT: "0", PID_FILE: `${dataDir}/.server.pid`, DATA_PATH: dataDir, PGLITE_DIR: `${dataDir}/pg` },
    stdout: "pipe",
  });
  let out = "";
  const reader = proc.stdout.getReader();
  while (!/Listening on (\S+)/.test(out)) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`The server exited:\n${out}`);
    out += new TextDecoder().decode(value);
  }
  reader.releaseLock();
  return { url: new URL(out.match(/Listening on (\S+)/)![1]!), stop: () => (proc.kill(), proc.exited) };
}

/** The order's lines, as a page shows them. */
const shown = (page: string) => [...page.matchAll(/id="l\d+"><span class="words"><span class="what">(\w+)</g)].map(([, what]) => what);

test(`${unproven.moved.name} -- what was kept before: SQLite's orders, else the JSON file's, else the catalogue; and the message`, async () => {
  const sqlite = mkdtempSync(`${scratch}/sqlite-`);
  const db = new Database(`${sqlite}/app.db`, { create: true });
  await migrate(db, await fromFolder(`${import.meta.dir}/../src/resources/order/migrations`), { app: "order", schema });
  importTables(db, schema, { tables: { items: TEA_AND_CAKE, orders: [{ id: 1 }], lines: [{ id: 1, orders_id: 1, item: 2 }] } });
  db.close();
  jsonTables(`${sqlite}/message.json`, messageSchema, { tables: { messages: [{ id: 1, text: "kept" }] } });
  const [[, orders], [, message]] = keptBefore(sqlite);
  expect(orders!.tables.lines).toMatchObject([{ id: 1, orders_id: 1, item: 2 }]);
  expect(message!.tables.messages).toEqual([{ id: 1, text: "kept" }]);

  const json = mkdtempSync(`${scratch}/json-`);
  jsonTables(`${json}/order.json`, schema, { tables: { items: TEA_AND_CAKE, orders: [{ id: 1 }], lines: [{ id: 1, orders_id: 1, item: 1 }] } });
  expect(keptBefore(json).map(([, rows]) => rows.tables.lines)).toEqual([[{ id: 1, orders_id: 1, item: 1 }]]);

  expect(keptBefore(mkdtempSync(`${scratch}/none-`))).toEqual([[schema, { tables: { items: TEA_AND_CAKE } }]]);
});

test(`${unproven.moved.name} -- from SQLite to Postgres, as the server starts: order 1, a cake`, async () => {
  const dataDir = mkdtempSync(`${scratch}/moved-`);
  const db = new Database(`${dataDir}/app.db`, { create: true });
  await migrate(db, await fromFolder(`${import.meta.dir}/../src/resources/order/migrations`), { app: "order", schema });
  importTables(db, schema, { tables: { items: TEA_AND_CAKE, orders: [{ id: 1 }], lines: [{ id: 1, orders_id: 1, item: 2 }] } });
  db.close();
  const server = await serving(dataDir);
  try {
    const ws = await open(server);
    expect(shown(pageOf(ws))).toEqual(["Cake"]);
    ws.close();
  } finally {
    await server.stop();
  }
});

test(`${unproven.carriesOn.name} -- started on a data folder not there yet, stopped and started again`, async () => {
  const dataDir = `${scratch}/new`; // not there yet, as on a new app's first start
  for (const [item, then] of [[1, ["Tea"]], [2, ["Tea", "Cake"]]] as const) {
    const server = await serving(dataDir);
    try {
      const ws = await open(server);
      write(ws, "order", [{ op: "add", path: "/lines/-", value: { item } }]);
      await heard(ws);
      expect(shown(pageOf(ws))).toEqual([...then]);
      expect([...pageOf(ws).matchAll(/id="l(\d+)"/g)].map(([, id]) => Number(id))).toEqual(then.map((_, i) => i + 1)); // closed cleanly: no ids skipped
      ws.close();
    } finally {
      await server.stop();
    }
  }
});
```

```ts
// tests/site.test.ts
import { test, expect, afterAll, setDefaultTimeout } from "bun:test";
import { $ } from "bun";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { connect, expectMessage, open, opened, pageOf } from "dzql/rendering/test-socket";
import { startServer } from "../src/routes";
import { unproven } from "../stories";

// Routes are tested with fetch, the page over a socket as a tab holds it (dzql's test-socket),
// entry points by spawning them. What one person does and another then sees, the stories tell
// (../stories.ts); each resource's own is in its file (message.test.ts, order.test.ts).

setDefaultTimeout(30_000);

// The data folder is a scratch one, never the project's real data/
const dataDir = mkdtempSync(`${tmpdir()}/site-`);
// Spawned servers use this pid file, away from a running dev server's
const pidFile = `${import.meta.dir}/out/.server.pid`;
// The real `stop` script from package.json (delta's `delta stop`), told that pid file
const stop = () => $`bun run stop`.cwd(`${import.meta.dir}/..`).env({ ...process.env, PID_FILE: pidFile }).text();

const server = await startServer({ port: 0, dev: false }); // random free port, no HMR

afterAll(async () => {
  await server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

const api = (path: string, init?: RequestInit) => fetch(new URL(path, server.url), init);

// Read a spawned server's output until a line matches
async function readUntil(proc: Bun.Subprocess<"ignore", "pipe">, pattern: RegExp) {
  const reader = proc.stdout.getReader();
  let out = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) throw new Error(`Server exited before saying ${pattern}:\n${out}`);
      out += new TextDecoder().decode(value);
      const match = out.match(pattern);
      if (match) return match;
    }
  } finally {
    reader.releaseLock();
  }
}

// Run a server process on a random port; resolve once it prints its URL
async function spawnServer(cmd: string[], env: Record<string, string> = {}) {
  const proc = Bun.spawn(cmd, {
    cwd: `${import.meta.dir}/..`,
    env: { ...process.env, PORT: "0", PID_FILE: pidFile, DATA_PATH: dataDir, ...env },
    stdout: "pipe",
  });
  const url = (await readUntil(proc, /Listening on (\S+)/))[1]!;
  return { proc, url };
}

// --- The routes ---

test(`${unproven.volume.name} -- GET /api/status answers what the server knows, but not where its data is`, async () => {
  const status = await (await api("/api/status")).json();
  expect(status).toEqual({ persistent: false, uptime: expect.any(Number), bun: Bun.version });

  process.env.DATA_PATH = dataDir; // what a Railway volume sets
  try {
    expect(((await (await api("/api/status")).json()) as { persistent: boolean }).persistent).toBe(true);
  } finally {
    delete process.env.DATA_PATH;
  }
});

test(`${unproven.health.name} -- healthcheck answers ok`, async () => {
  expect(await (await api("/health")).text()).toBe("ok");
});

// --- The page, as a tab holds it ---

test("home page loads: a box, its name the page's heading, the message and the status its cells", async () => {
  const html = await (await api("/")).text();
  expect(html).toContain(`<script type="module"`); // the shell, and dzql's client, which opens the socket
  const ws = await open(server);
  const page = pageOf(ws);
  const name = html.match(/<title>(.*)<\/title>/)![1]!;
  expect(page).toContain(`<h1>${name}</h1>`);
  expect([...page.matchAll(/class="cell[^"]*" data-key="([\w-]+)"/g)].map(([, key]) => key)).toEqual(expect.arrayContaining(["message", "status"])); // and whatever the app has grown
  ws.close();
});

test("the Save button has its lucide icon, hidden from screen readers", async () => {
  const ws = connect(server, undefined, "?message");
  await opened(ws);
  await expectMessage(ws, "render");
  expect(pageOf(ws)).toMatch(/<button type="submit" class="tool add"><svg class="icon icon-save"[^>]*aria-hidden="true">.*?<\/svg>Save<\/button>/);
  ws.close();
});

test(`${unproven.volume.name} -- the page says whether the data is on a mounted volume`, async () => {
  const ws = await open(server);
  expect(pageOf(ws)).toContain("Your data is ephemeral");
  ws.close();
  process.env.DATA_PATH = dataDir; // what a Railway volume sets
  try {
    const again = await open(server);
    expect(pageOf(again)).toContain("Your data is on a mounted volume");
    expect(pageOf(again)).not.toContain(dataDir);
    again.close();
  } finally {
    delete process.env.DATA_PATH;
  }
});

test(`${unproven.health.name} -- a page that is not one opens on the box`, async () => {
  expect((await api("/nowhere")).status).toBe(200); // every path is a screen: the shell, and the socket names where
  const ws = connect(server, undefined, "nowhere");
  await opened(ws);
  await expectMessage(ws, "render");
  expect(pageOf(ws)).toContain(`data-page=""`);
  ws.close();
});

// --- The entry point and the sandbox hook ---

test("routes.ts, run, starts the server on $PORT", async () => {
  const { proc, url } = await spawnServer([process.execPath, "src/routes.ts"]);
  try {
    expect((await fetch(new URL("/health", url))).status).toBe(200);
  } finally {
    proc.kill();
    await proc.exited;
  }
});

test("pid file: a second start is refused, stop stops the server", async () => {
  const { proc } = await spawnServer([process.execPath, "src/routes.ts"]);
  expect(Number(await Bun.file(pidFile).text())).toBe(proc.pid);

  const second = Bun.spawn([process.execPath, "src/routes.ts"], {
    cwd: `${import.meta.dir}/..`,
    env: { ...process.env, PORT: "0", PID_FILE: pidFile, DATA_PATH: dataDir },
    stderr: "pipe",
  });
  expect(await second.exited).toBe(1);
  expect(await new Response(second.stderr).text()).toContain("Already running");

  expect(await stop()).toContain(`stopped ${proc.pid}`);
  await proc.exited;
  expect(await Bun.file(pidFile).exists()).toBe(false);
  expect(await stop()).toContain("not running");
});

test("pid file: an empty file doesn't block start, and stop removes it", async () => {
  await Bun.write(pidFile, "");
  const { proc } = await spawnServer([process.execPath, "src/routes.ts"]);
  proc.kill();
  await proc.exited;
  expect(await Bun.file(pidFile).exists()).toBe(false); // removed on shutdown

  await Bun.write(pidFile, "");
  expect(await stop()).toContain("removed stale pid file");
});

test("the web sandbox hook does nothing anywhere else", async () => {
  const { CLAUDE_CODE_REMOTE: _, ...env } = process.env;
  const hook = Bun.spawn(["bash", `${import.meta.dir}/../.claude/hooks/session-start.sh`], {
    env: { ...env, CLAUDE_PROJECT_DIR: `${import.meta.dir}/..` },
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await hook.exited).toBe(0);
  expect(await new Response(hook.stdout).text()).toBe("");
});

test("in production the page is served from source, without HMR", async () => {
  const { proc, url } = await spawnServer([process.execPath, "src/routes.ts"], { NODE_ENV: "production" });
  try {
    const html = await (await fetch(url)).text();
    expect(html).toContain(`<main id="app">`);
    expect(html).not.toContain("data-bun-dev-server-script");
  } finally {
    proc.kill();
    await proc.exited;
  }
});

test("bun dev serves with hot reload, and a reload does not take its own pid file for another server", async () => {
  const { proc, url } = await spawnServer([process.execPath, "--hot", "src/routes.ts"], { PGLITE_DIR: `${dataDir}/pg` });
  try {
    expect(await (await fetch(url)).text()).toContain("data-bun-dev-server-script"); // hot reload in the page
    expect(Number(await Bun.file(pidFile).text())).toBe(proc.pid);

    // A save: the same text written again (a touch, which changes only the time, is not one to --hot)
    const source = Bun.file(`${import.meta.dir}/../src/routes.ts`);
    await Bun.write(source, await source.text());
    expect((await readUntil(proc, /Listening on (\S+)/))[1]).toBe(url); // routes.ts ran again, in the same process

    expect((await fetch(url)).status).toBe(200);
    expect(Number(await Bun.file(pidFile).text())).toBe(proc.pid);
  } finally {
    proc.kill();
    await proc.exited;
  }
});
```

Working: `tests/evolve.ts` makes a new app from this template, applies this page (after two-documents.md, sqlite.md and postgres.md) and runs its type check and tests (`bun run test:evolve`).

- `bun run stories` says each story; `STORY_BY_HAND=1 bun run stories` does each with the page's own controls, in a browser the size of a phone.
- **What changed for the people using it**, each by where it is drawn: Saved is said beside the box, not in a toast; a refusal delta makes (a text that is not text) is refused without a word, where the toast said Not saved; Cmd+Enter does not save (the box saves by its button); typing not yet saved is kept while the caret is in the box, and a save from elsewhere draws over it once it has left; the page has Undo and Redo (the server's box always draws them); an unknown page opens on the box, where it said Page not found; the uptime is the status route's alone, since a page drawn again must be the same page.
- **The session:** nobody signs in, so the cookie is the session and no row is kept by it (`Example.session` left out). Sign-in by link, a session kept as a row (`sessionRows`), is dzql-app's `signin.md`; delta's `auth-link` ([auth.md](auth.md)) is for a page that is delta's client, not this one.
- **The kitchen** is read by no page: the socket serves only what a page reads, so it is held from the test's process (the store's `delta`). A cook's cell would make it a story the harness tells.
- **The store is opened as the app loads**, once per process: a test file's server leaves it open for the next (bun test runs every file in one process), and `bun dev`'s closes it once it stops. Under `bun --hot` the store opens again as the module runs, before `run` closes the last one, so a folder is recovered as after a crash and skips the ids it set aside.
- An implied document whose row is not made yet (the message before its first save, order 1 before its first line) is read as nothing by the stories' fresh render, which reads storage: read it with `?.`, its defaults said again (`read()` in message-api.ts).
- From here the app grows with `dzql-app`; the other references here are the light page's. `CLAUDE.md` and `README.md` still describe the light page: say the thin one, as create-dzql's do.
