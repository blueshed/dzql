import { test, expect, afterAll, setDefaultTimeout } from "bun:test";
import { browser } from "./browser";
import bentoPage from "./bento-page.html";

// src/resources/bento.tsx draws the bento in the browser: the same HTML as dzql's bento.ts, which
// draws it on the server, so one stylesheet draws both and a page can move from one to the other.
// bento-page.tsx draws every surface both ways from the same input; here each pair must read the
// same, and what the railroad side does when pressed is what its handler says.

setDefaultTimeout(30_000);

const fixture = Bun.serve({ port: 0, development: false, routes: { "/": bentoPage } });
const { view, waitFor, close } = browser(() => fixture.url);

afterAll(async () => {
  close();
  await fixture.stop(true);
});

const presses = () => view.evaluate<string[]>(`window.presses.splice(0)`);
const press = (selector: string) => view.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);

test("every surface is drawn by railroad as the server draws it: the same elements, classes and attributes, but for the writes", async () => {
  await view.navigate(fixture.url.href);
  await waitFor(`window.pairs?.length > 0`);
  const pairs = await view.evaluate<{ name: string; server: string; browser: string }[]>(`window.pairs`);
  expect(pairs.length).toBeGreaterThan(40);
  expect(pairs.filter((p) => p.browser !== p.server)).toEqual([]); // each that differs, with both
});

test("a press does what its handler says: a tool, a way back, a row, a row's own deed, a pin, a cell, the page's tools", async () => {
  await presses();
  await press(`[data-case="a tool"] .browser button`);
  await press(`[data-case="the trail"] .browser a`);
  await press(`[data-case="a row that taps"] .browser button.row`);
  await press(`[data-case="a row with a deed"] .browser button.what`);
  await press(`[data-case="a row with a deed"] .browser button.tool`);
  await press(`[data-case="a pin"] .browser button`);
  await press(`[data-case="a cell that opens"] .browser .cell`);
  for (const label of ["Undo", "Redo", "Sign out"]) await press(`[data-case="the page's tools"] .browser [aria-label="${label}"]`);
  expect(await presses()).toEqual(["send", "back", "d1", "d3", "add d3", "pin", "kitchen", "undo", "redo", "leave"]);
  expect(await view.evaluate<string>(`location.hash`)).toBe(""); // a way back is pressed, not followed
});

test("Escape presses the last thing that puts something away: a modal over a drawer goes first", async () => {
  await presses();
  await view.evaluate(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
  expect(await presses()).toEqual(["never mind"]); // the last modal's scrim on the page
});

test("adding asks for its fields and hands over what was typed; a field writes what it holds on its trigger", async () => {
  await presses();
  await view.evaluate(`(() => {
    const form = document.querySelector('[data-case="adding, in a modal"] .browser form');
    form.querySelector('[name=name]').value = "Scone";
    form.querySelector('[name=price]').value = "2";
    form.requestSubmit();
  })()`);
  expect(await presses()).toEqual([`added {"name":"Scone","price":"2","run":"food"}`]);
  await view.evaluate(`(() => {
    const name = document.querySelector('[data-case="a text field"] .browser input');
    name.focus(); name.value = "Flat white, large"; name.blur();
    const tick = document.querySelector('[data-case="a tick, in a row"] .browser input');
    tick.click();
  })()`);
  expect(await presses()).toEqual(["name", "out"]);
});

test("find opens its field and closes it, forgetting the eye", async () => {
  await presses();
  const find = `[data-case="find, closed"] .browser button`;
  expect(await view.evaluate<string>(`document.querySelector('${find}').getAttribute("aria-pressed")`)).toBe("false");
  await press(find);
  expect(await view.evaluate<string>(`document.querySelector('${find}').getAttribute("aria-pressed")`)).toBe("true");
  await press(find);
  expect(await view.evaluate<string>(`document.querySelector('${find}').getAttribute("aria-pressed")`)).toBe("false");
});

test("where you are is the URL: going there draws the page once, opening a drawer or a modal over it draws only that, and Back closes it", async () => {
  const text = (id: string) => view.evaluate<string | null>(`document.getElementById("${id}")?.textContent ?? null`);
  const inert = () => view.evaluate<boolean>(`document.querySelector("#live .ground").hasAttribute("inert")`);
  await view.evaluate(`window.go("menu")()`);
  expect(await view.evaluate<string>(`location.hash`)).toBe("#/menu");
  expect(await text("path")).toBe("menu");
  const drawn = await view.evaluate<number>(`window.drawn`);
  await view.evaluate(`window.go("menu", "dish", 2)()`);
  expect(await text("drawer")).toBe("2");
  expect(await text("here")).toBe(JSON.stringify({ path: "menu", what: "dish", which: "2" }));
  await view.evaluate(`window.go("menu", "new")()`);
  expect([await text("drawer"), await text("modal"), await inert()]).toEqual([null, "new", true]); // one open at a time; a modal holds the page behind it
  await view.evaluate(`history.back()`);
  await waitFor(`document.getElementById("drawer")?.textContent === "2"`);
  expect([await text("modal"), await inert()]).toEqual([null, false]);
  expect(await view.evaluate<number>(`window.drawn`)).toBe(drawn); // the page behind was never drawn again
  await view.evaluate(`window.go("")()`);
  expect(await text("path")).toBe("home");
});

test("a list that changes: a row comes and goes as its item does, and the note says when there are none", async () => {
  const rowsNow = () => view.evaluate<string>(`[...document.querySelectorAll("#live .rows .what")].map((e) => e.textContent).join(",") || document.querySelector("#live > .note")?.textContent`);
  expect(await rowsNow()).toBe("Flat white");
  await view.evaluate(`window.items.set([{ id: 1, name: "Flat white, large" }, { id: 2, name: "Cortado" }])`);
  expect(await rowsNow()).toBe("Flat white, large,Cortado");
  await view.evaluate(`window.items.set([])`);
  expect(await rowsNow()).toBe("Nothing yet.");
});
