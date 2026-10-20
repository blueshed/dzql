# The orders fixture

Scenario 4 of `../../evolve.json` starts here: the order app as the evolve skill's `two-documents.md` and `sqlite.md` leave it, with people's orders in its database.

- `app/` is what those two pages change in a new app: `stories.ts`, `src/routes.ts`, `src/app.tsx` and `src/resources/order/`. The scenario copies it over a new app.
- `tests/` holds the pages' three tests, stored without `.test` so the template's own `bun test` leaves them. The scenario copies each to `tests/<name>.test.ts`.
- `app/data/app.db` is the database as that version left it: `001-order` run, and three orders. Order 1 has two Teas and a Cake, order 2 three Cakes and a Tea, and order 3 a Tea, and a Tea taken off (its row closed, `valid_to` set). The closed row is the trap: a migration that counts every version of a line counts it back on.

When the two pages change, make the fixture again from them:

1. Make a new app, apply `two-documents.md` then `sqlite.md` to it (as `tests/evolve.ts` does), and copy the files above into `app/` and `tests/`.
2. In that app, write the orders through the documents, as people make them, with this script (`make-db.ts` at its root, then `bun make-db.ts`):

```ts
import { joinPath } from "@blueshed/delta/core";
import { rmSync } from "node:fs";
import { startServer } from "./src/routes";
import type { Order } from "./src/resources/order/order-api";
import { documents } from "./tests/documents";

const dataDir = `${import.meta.dir}/data`;
rmSync(dataDir, { recursive: true, force: true });
const server = await startServer({ port: 0, dev: false, dataDir });
const client = await documents(server);
const add = (item: number) => ({ op: "add" as const, path: "/lines/-", value: { item } });
const TEA = 1, CAKE = 2;

const one = await client.open<Order>("order:1");
for (const item of [TEA, TEA, CAKE]) await one.send([add(item)]); // two Teas and a Cake
const two = await client.open<Order>("order:2");
for (const item of [CAKE, CAKE, CAKE, TEA]) await two.send([add(item)]); // three Cakes and a Tea
const three = await client.open<Order>("order:3");
for (const item of [TEA, TEA]) await three.send([add(item)]); // a Tea, and a Tea taken off
const [, last] = Object.values(three.value().lines);
await three.send([{ op: "remove", path: joinPath("lines", last!.id) }]);

client.close();
await server.stop(true);
```

3. Fold the write-ahead log into the file, so the database is the one file: `sqlite3 data/app.db "PRAGMA wal_checkpoint(TRUNCATE)" "PRAGMA journal_mode=DELETE"`, then remove `data/app.db-shm`. Copy `data/app.db` to `app/data/app.db`.
