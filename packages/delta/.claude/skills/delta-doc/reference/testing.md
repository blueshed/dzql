# Testing an app, and scripts

An app's own test is the recipe's (`recipe.md`, *Its test*): two people on a real server, one
writes, the other is told. It runs unchanged as the documents move from the JSON file to SQLite.

From `tests/local.test.ts`: the lightest harness, no socket and no mock. A test's database is
`:memory:`, thrown away, so `createTables` makes its tables; an app's are its migrations
(`migrations.md`).

```ts
function setup() {
  const db = new Database(":memory:");
  createTables(db, schema);
  const local = createLocal();
  const heard: { channel: string; data: any }[] = [];
  local.onPublish((channel, data) => heard.push({ channel, data }));
  const { evict } = registerDocs(local.server, db, schema, [room]);
  return { db, local, heard, evict };
}

test("opens, writes and hears the broadcast", async () => {
  const { local, heard } = setup();
  await local.call("delta", { doc: "room:a", ops: [{ op: "add", path: "/messages/m1", value: { text: "hi" } }] });
  expect(heard[0].channel).toBe("room:a");
});
```

Working: [examples/kanban](https://github.com/blueshed/dzql/blob/main/packages/delta/examples/kanban/run.ts)'s `run.ts`, a server on port 0 and
two clients in one process, each passed to `openDoc` and closed before the server stops;
[create-blueshed/template](https://github.com/blueshed/dzql/blob/main/packages/create-blueshed/template/tests/message.test.ts)'s `message.test.ts`, an app's own
test, its document held from Bun and its page in a browser, on a real server.

## Other harnesses

- **A real server**, as an app's test has: `serve({ ws, routes }, { port: 0 })`
  (`@blueshed/delta/serve`), then `connectWs(new URL("/ws", url).href.replace("http", "ws"))`
  (`tests/serve.test.ts`).
- **`@blueshed/delta/testing`** (`src/testing.ts`): `mockClient(data?)` (a socket-shaped client,
  what it was sent in `.sent`; `{ identity }` signed in, `{ local: true }` in-process),
  `sendAndAwait(ws, client, msg)`, `waitFor(predicate, { timeout, interval })`.
- `pointerVectors` and `walkVectors` (`src/pointer-vectors.json`, `src/walk-vectors.json`): the
  path grammar and the undo guard as data, for a parser of your own to run the same cases.

## Running delta's cases on another backend

`@blueshed/delta/testing` also ships the cases every delta backend answers alike, for a backend of
your own (dzql, for Postgres) to run unchanged. From `tests/writes.test.ts`:

```ts
const onSqlite: CaseBackend = async ({ schema, docs, seed }) => {
  const db = new Database(":memory:");
  createTables(db, schema);
  importTables(db, schema, seed);
  const ws = createWs();
  registerDocs(ws, db, schema, docs);
  return { ws, end: async () => db.close() };
};

describe("SQLite", () => {
  errorCodeCases(onSqlite);   // one error table: 400, 404, 409
  createRowCases(onSqlite);   // add /<coll>/- makes a row the server names
  writeScopeCases(onSqlite);  // a document writes only what it reads
});
```

- **The writes** (`src/cases/writes.ts`): a `CaseBackend` stands up an app (`roomsApp`,
  `tenantsApp`, `membershipsApp`) on a fresh store; every check reads through a fresh open.
- **The path** (`src/cases/path.ts`): one schema, its documents cut every way and its seed
  (`pathSchema`, `pathDocs`, `pathSeed`), each case ending on the law. A backend supplies a
  `PathBackend` and its own first reads for the custom documents (`inboxDoc`, `emailsDoc`,
  `guestsDoc`, `openSeatsDoc`, `menuCardDoc`; SQLite's are `sqliteInbox` and its kin), then calls
  `pathCases`, `drivenCases`, `registrationCases`, `serialCases`, `asItStoodCases`,
  `columnCases`, `documentCases` and `fanOutCases` (`tests/path-sqlite.test.ts`).
- **The law over generated writes** (`src/cases/law.ts`): `drive(seed, places)` sends the same
  random steps to each `Place` and compares them; put SQLite's (`onSqlite()`) first, so a new
  backend is always measured against it (`tests/law-driver.test.ts`). `lawSeeds` and `lawSteps`
  read `DELTA_LAW_SEED(S)` and `DELTA_LAW_STEPS`.
- **`owns`** (`ownsCases`) and **isolation** (`assertDocIsolation`): who may open a document, and
  nobody told what is not theirs (`tests/owns-sqlite.test.ts`, `tests/sqlite-isolation.test.ts`).
- **`owns` as a path** (`permissionCases`): a path that reaches the person, one that does not, a
  row never handed away (`tests/permissions-sqlite.test.ts`).
- **Migrations from empty** (`migrationCases`) and **link sign-in's store** (`linkStoreCases`):
  what every backend's `migrate` and `LinkStore` answer alike.

## Driving the client from Bun

- **Pass an absolute URL**: `connectWs("ws://localhost:3000/ws")`; outside a browser there is no
  page to resolve `/ws` against. No `location` shim needed; `wss://` stays `wss://`.
- **Several clients in one process**: each `connectWs` owns its documents, so pass the client:
  `openDoc<Board>("board:1", alice)`, `openDoc<Board>("board:1", bob)`.
- **Always `client.close()`** (idempotent) before stopping a server: otherwise it reconnects for
  ever and keeps the process alive.
- A script sending `delta` itself opens the document first (`wire.md`).

## Running an app against a delta checkout

Install a **packed tarball**, never `file:` or `bun link`: a linked checkout brings its own
railroad, so the page loads two, `doc.data` is a signal the app's railroad does not know, and the
page sits on "connecting…" with no error.

```sh
cd ../delta && bun pm pack && cd ../app && bun add ../delta/blueshed-delta-<version>.tgz
```

After an edit, pack again, then `bun remove @blueshed/delta && bun add <the .tgz>`: `bun.lock`
pins the first tarball by hash, so adding it again or `bun install --force` keeps the old
contents. Deleting `bun.lock` works too.
