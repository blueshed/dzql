import { test, afterAll, setDefaultTimeout } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { startServer } from "../src/routes";
import { stories } from "../stories";
import { browser } from "./browser";

setDefaultTimeout(30_000);

const dataDir = mkdtempSync(`${tmpdir()}/order-`);
const server = await startServer({ port: 0, dev: false, dataDir });
const { view, open, waitFor, withOtherWindow, close } = browser(() => server.url);

afterAll(async () => {
  close();
  await server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

const CATALOGUE = `.cell[data-key="catalogue"]`;
const ORDER = `.cell[data-key="your-order"]`;
const shown = (cell: string) => `[...document.querySelectorAll('${cell} .rows .what')].map((w) => w.textContent.trim()).join(", ")`;
const total = (amount: string) => `document.querySelector('${ORDER} .row.total .state')?.textContent === "${amount}"`;

test(`${stories.stories.ordering.name} -- your order: added to, there when you come back, and not another window's`, async () => {
  await open();
  await waitFor(`${shown(CATALOGUE)} === "Tea, Cake"`); // the catalogue is drawn
  await waitFor(total("0.00")); // no order yet

  await view.click(`${CATALOGUE} .rows > .row:nth-child(1) > .tool`); // the first Add makes your order
  await waitFor(`${shown(ORDER)} === "Tea"`);
  await view.click(`${CATALOGUE} .rows > .row:nth-child(2) > .tool`);
  await waitFor(`${shown(ORDER)} === "Tea, Cake"`);
  await waitFor(total("5.50"));

  await open(); // you come back: the page kept your order's number
  await waitFor(`${shown(ORDER)} === "Tea, Cake"`);

  await withOtherWindow(async (other, waitForOther) => {
    await waitForOther(`${shown(CATALOGUE)} === "Tea, Cake"`);
    await other.click(`${CATALOGUE} .rows > .row:nth-child(1) > .tool`); // someone else orders a Tea, on an order of their own
    await waitForOther(`${shown(ORDER)} === "Tea"`);
  });

  await view.click(`${ORDER} .rows > .row:nth-child(1) > .tool`); // × takes your Tea off
  await waitFor(`${shown(ORDER)} === "Cake"`); // and theirs never reached yours
  await waitFor(total("3.00"));
});
