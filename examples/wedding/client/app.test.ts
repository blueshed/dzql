import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServer } from "../../../src/server";
import * as boardDoc from "../documents/board";
import * as householdDoc from "../documents/household";
import { example } from "../index";

let server: ReturnType<typeof createServer>;
let code: string;

beforeAll(() => {
  server = createServer(example, 0);
  const email = `browser-${Date.now()}@example.com`;
  boardDoc.patch("DASH", [{ op: "add", path: "/households/-", value: { email, names: "Ada Test, Femi Test" } }], "setup");
  code = boardDoc.read("DASH")!.households.find((x) => x.email === email)!.code;
});

afterAll(() => {
  server.stop(true);
});

async function waitFor(view: Bun.WebView, script: string, predicate: (value: unknown) => boolean, timeout = 5000): Promise<unknown> {
  const start = Date.now();
  let last: unknown;
  while (Date.now() - start < timeout) {
    last = await view.evaluate(script);
    if (predicate(last)) return last;
    await Bun.sleep(50);
  }
  throw new Error(`Timed out waiting for \`${script}\`; last value: ${JSON.stringify(last)}`);
}

const CRUMBS = `document.querySelector('.crumbs')?.textContent ?? null`;

async function enter(view: Bun.WebView, who: string) {
  await view.navigate(server.url.toString());
  await waitFor(view, `document.querySelector('#code') !== null`, (v) => v === true);
  await view.click("#code");
  await view.type(who);
  await view.click("button.gold");
  await waitFor(view, CRUMBS, (v) => typeof v === "string" && v.includes(who.toUpperCase()));
}

describe("the wedding in a real browser", () => {
  test("a code opens the household; the photo applet mounts with the family; a tap on a figure opens the guest's drawer with the dress and menu applets", async () => {
    await using view = new Bun.WebView();
    await enter(view, code.toLowerCase());
    const names = await waitFor(view, `[...document.querySelectorAll('[data-applet="photo"] .print text')].map((t) => t.textContent)`, (v) => Array.isArray(v) && v.length === 2);
    expect(names).toEqual(["Ada", "Femi"]);

    const guest = householdDoc.read(code)!.guests[1]!;
    await view.evaluate(`document.querySelector('[data-applet="photo"] .slot[data-key="${guest.id}"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
    await waitFor(view, `document.querySelector('.guest-sheet .dress') !== null`, (v) => v === true);
    expect(await view.evaluate(`document.querySelector('.guest-sheet h2').textContent`)).toBe(guest.name);
    expect(await view.evaluate(`document.querySelector('.guest-sheet .menu') !== null`)).toBe(true);

    // touch the top: the dots appear (the applet's own state); a dot is a write, and the figure redraws from the render
    await view.evaluate(`document.querySelector('.callout-top').click()`);
    await waitFor(view, `document.querySelectorAll('.pop-top .dot').length`, (v) => v === 8);
    await view.evaluate(`document.querySelector('.pop-top .dot[data-value="#7FAE4E"]').click()`);
    await waitFor(view, `document.querySelector('.dress .torso')?.getAttribute('fill')`, (v) => v === "#7FAE4E");
    expect(householdDoc.read(code)!.guests[1]!.minifigure.top).toBe("#7FAE4E");
    // the open part survived the redraw
    expect(await view.evaluate(`document.querySelector('.pop-top') !== null`)).toBe(true);

    // a course opens (the menu's own state); a pill is a write; the head says what was chosen
    await view.evaluate(`document.querySelector('.menu-head[data-course="2"]').click()`);
    await waitFor(view, `document.querySelectorAll('.menu-row.open .choice').length`, (v) => v === 6);
    await view.evaluate(`document.querySelector('.choice[data-kind="dish"][data-id="5"]').click()`);
    await waitFor(view, `document.querySelector('.menu-row.open .chosen')?.textContent`, (v) => v === "Sea bass");
    expect(householdDoc.read(code)!.guests[1]!.choices["2"]).toEqual({ dish: 5, drink: null });
  });

  test("switching the guests from the photo to the list swaps the applet for rows, and back", async () => {
    await using view = new Bun.WebView();
    await enter(view, code);
    await waitFor(view, `document.querySelector('[data-applet="photo"] svg') !== null`, (v) => v === true);
    await view.evaluate(`document.querySelector('.cell-tools .seg-opt:not(.on)').click()`);
    await waitFor(view, `document.querySelectorAll('.cell.big .row-line.guest').length`, (v) => v === 2);
    expect(await view.evaluate(`document.querySelector('.cell.big svg.photo') === null`)).toBe(true);
    await view.evaluate(`document.querySelector('.cell-tools .seg-opt:not(.on)').click()`);
    await waitFor(view, `document.querySelector('.cell.big [data-applet="photo"] svg') !== null`, (v) => v === true);
  });

  test("the answer: the pencil opens the drawer, an option writes it, the bubble shows it, Undo takes it back", async () => {
    await using view = new Bun.WebView();
    await enter(view, code);
    await view.evaluate(`document.querySelector('.pencil-btn').click()`);
    await waitFor(view, `document.querySelectorAll('.answer-option').length`, (v) => v === 3);
    await view.evaluate(`document.querySelector('.answer-option[data-value="maybe"]').click()`);
    await waitFor(view, `document.querySelector('.bubble.ours .face-mark')?.classList.contains('maybe')`, (v) => v === true);
    await view.evaluate(`document.querySelector('.sheet-close').click()`);
    await waitFor(view, `document.querySelector('.sheet') === null`, (v) => v === true);
    await view.evaluate(`document.querySelector('[data-write*="ledger"]').click()`);
    await waitFor(view, `document.querySelector('.bubble.ours .face-mark')?.classList.contains('maybe')`, (v) => v === false);
  });

  test("leaving returns to the welcome, and the session survives a reload", async () => {
    await using view = new Bun.WebView();
    await enter(view, code);
    await view.reload();
    await waitFor(view, CRUMBS, (v) => typeof v === "string" && v.includes(code));
    await view.evaluate(`document.querySelector('[data-write*="/code"]').click()`);
    await waitFor(view, `document.querySelector('#code') !== null`, (v) => v === true);
  });
});
