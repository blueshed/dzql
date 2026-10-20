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

test(`${stories.stories.ordering.name} -- two windows order and remove`, async () => {
  await open();
  await waitFor(`${shown(CATALOGUE)} === "Tea, Cake"`); // the catalogue is drawn
  await withOtherWindow(async (other, waitForOther) => {
    await waitForOther(total("0.00"));

    await view.click(`${CATALOGUE} .rows > .row:nth-child(1) > .tool`);
    await view.click(`${CATALOGUE} .rows > .row:nth-child(2) > .tool`);
    await waitForOther(`${shown(ORDER)} === "Tea, Cake"`);
    await waitForOther(total("5.50"));

    await other.click(`${ORDER} .rows > .row:nth-child(1) > .tool`);
    await waitFor(`${shown(ORDER)} === "Cake"`);
    await waitFor(total("3.00"));
  });
});
