import { test, expect, afterAll } from "bun:test";
import { importTables } from "@blueshed/delta/json";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { startServer } from "../src/routes";
import { schema, type Order } from "../src/resources/order/order-api";
import { stories } from "../stories";
import { documents } from "./documents";

const dataDir = mkdtempSync(`${tmpdir()}/order-move-`);
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

test(`${stories.stories.moved.name} -- from the JSON file to SQLite: order 1, a tea and a cake`, async () => {
  importTables(`${dataDir}/order.json`, schema, {
    tables: { items: [{ id: 1, name: "Tea", price: 2.5 }, { id: 2, name: "Cake", price: 3 }], orders: [{ id: 1 }], lines: [{ id: 1, orders_id: 1, item: 1 }, { id: 2, orders_id: 1, item: 2 }] },
  });
  const server = await startServer({ port: 0, dev: false, dataDir });
  const client = await documents(server);
  try {
    const order = await client.open<Order>("order:1");
    expect(Object.values(order.value().lines).map((l) => l.item)).toEqual([1, 2]);
  } finally {
    client.close();
    await server.stop(true);
  }
});
