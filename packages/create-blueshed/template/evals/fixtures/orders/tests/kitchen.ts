import { test, expect, afterAll, setDefaultTimeout } from "bun:test";
import type { DeltaOp } from "@blueshed/delta/core";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { startServer } from "../src/routes";
import type { Kitchen, Order } from "../src/resources/order/order-api";
import { stories } from "../stories";
import { browser } from "./browser";
import { documents } from "./documents";

setDefaultTimeout(30_000);

const dataDir = mkdtempSync(`${tmpdir()}/kitchen-`);
const server = await startServer({ port: 0, dev: false, dataDir });
const client = await documents(server);
const { view, open, waitFor, close } = browser(() => server.url);

afterAll(async () => {
  close();
  client.close();
  await server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

const kitchen = await client.open<Kitchen>("kitchen:");
const first = await client.open<Order>("order:1");
const second = await client.open<Order>("order:2");

const kitchenLines = () => Object.values(kitchen.value().lines).map((l) => [l.orders_id, l.item]);

async function until(done: () => boolean) {
  for (let i = 0; i < 100 && !done(); i++) await Bun.sleep(20);
  expect(done()).toBe(true);
}

test(`${stories.stories.kitchen.name} -- a line added to either of two orders`, async () => {
  await first.send([{ op: "add", path: "/lines/-", value: { item: 1 } }]);
  await second.send([{ op: "add", path: "/lines/-", value: { item: 2 } }]);
  await until(() => kitchenLines().length === 2);
  expect(kitchenLines()).toEqual([[1, 1], [2, 2]]);
});

test(`${stories.stories.undo.name} -- this client's last line goes from the kitchen and from its order`, async () => {
  await client.undo();
  await until(() => kitchenLines().length === 1);
  expect(kitchenLines()).toEqual([[1, 1]]);
  expect(second.value().lines).toEqual({});
});

test(`${stories.stories.kitchen.name} -- a line changed is told as the field that changed, not the row`, async () => {
  const told: DeltaOp[][] = [];
  const stop = kitchen.onOps((ops) => told.push(ops));
  const [line] = Object.values(first.value().lines);
  await first.send([{ op: "replace", path: `/lines/${line!.id}/item`, value: 2 }]);
  await until(() => kitchenLines()[0]![1] === 2);
  stop();
  expect(told).toEqual([[{ op: "replace", path: `/lines/${line!.id}/item`, value: 2 }]]);
});

// The cook's cell, as the page draws it: each open order, and what is on it
const KITCHEN = `.cell[data-key="kitchen"]`;
const orders = `[...document.querySelectorAll('${KITCHEN} .rows .row')].map((r) => r.querySelector(".what").textContent.trim() + ": " + r.querySelector(".note").textContent.trim()).join("; ")`;

test(`${stories.stories.kitchen.name} -- on the page, the cook's cell has each open order, and a line added to any order reaches it`, async () => {
  await open();
  await waitFor(`${orders} === "Order 1: Cake"`);
  await second.send([{ op: "add", path: "/lines/-", value: { item: 1 } }]);
  await waitFor(`${orders} === "Order 1: Cake; Order 2: Tea"`);
});

test(`${stories.stories.undo.name} -- Undo, pressed on the page, takes back the line it added, from the order and from the kitchen`, async () => {
  await view.click(`.cell[data-key="catalogue"] .rows > .row:nth-child(1) > .tool`); // a Tea on order 1
  await waitFor(`${orders} === "Order 1: Cake, Tea; Order 2: Tea"`);
  await view.click(`.page-tools [aria-label="Undo"]`);
  await waitFor(`${orders} === "Order 1: Cake; Order 2: Tea"`);
  expect(Object.values(first.value().lines).map((l) => l.item)).toEqual([2]);
});
