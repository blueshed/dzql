import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { urlFor, waitFor } from "../../../src/webview";
import { createServer } from "../../../src/server";
import { example } from "../index";

let server: ReturnType<typeof createServer>;

beforeAll(() => {
  server = createServer(example, 0);
});

afterAll(() => {
  server.stop(true);
});

describe("leave in a real browser", () => {
  test("the sign-in page posts as a plain form, the password never on the socket, and Ann is on the calendar", async () => {
    await using view = new Bun.WebView();
    await view.navigate(urlFor(view, server.url));
    await waitFor(view, `document.querySelector('form.sign-in') !== null`, (v) => v === true);
    await view.click("input[name=email]");
    await view.type("ann@leave.example");
    await view.click("input[name=password]");
    await view.type("ann-password");
    await view.evaluate(`document.querySelector('form.sign-in').requestSubmit()`);
    await waitFor(view, `document.querySelector('.calendar-view .month') !== null`, (v) => v === true);
    expect(await view.evaluate<string>(`document.querySelector('.calendar-view').textContent`)).toContain("Mon");
    // the new page's socket has carried no password: it went to /login alone
    expect(await view.evaluate<boolean>(`JSON.stringify(window.eta.docs()).includes("ann-password")`)).toBe(false);
  }, 15000);

  test("a drag across days is a draft, its drawer saying what it would mean; asked for, the bar drags to other days", async () => {
    await using view = new Bun.WebView();
    await view.navigate(urlFor(view, server.url));
    await waitFor(view, `document.querySelector('form.sign-in') !== null`, (v) => v === true);
    await view.evaluate(`(() => { const f = document.querySelector('form.sign-in'); f.email.value = 'ann@leave.example'; f.password.value = 'ann-password'; f.requestSubmit(); return 1; })()`);
    await waitFor(view, `document.querySelector('.calendar-view .month') !== null`, (v) => v === true);
    await view.evaluate(`window.eta.socket().send(JSON.stringify({ doc: "session", ops: [{ op: "replace", path: "/page", value: "2026-10" }] }))`);
    // the first month shown is October: the calendar shows three, so October's name alone does not prove the page moved
    await waitFor(view, `document.querySelector('.calendar-view .month')?.textContent.includes('October 2026')`, (v) => v === true);
    // a pointer, as a mouse moves it: down on one day, over another, up
    await view.evaluate(`(() => {
      window.__point = (type, el) => { const r = el.getBoundingClientRect(); const init = { bubbles: true, cancelable: true, pointerId: 1, button: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }; el.dispatchEvent(new PointerEvent(type, init)); };
      window.__day = (n) => [...document.querySelector('.calendar-view .month').querySelectorAll('.date')].find((d) => d.firstChild?.textContent === String(n));
      return 1;
    })()`);
    await view.evaluate(`(() => { __point('pointerdown', __day(7)); __point('pointermove', __day(8)); __point('pointerup', __day(8)); return 1; })()`);
    await waitFor(view, `document.querySelector('.draft-drawer')?.textContent ?? ''`, (v) => String(v).includes("2 working days"));
    expect(await view.evaluate<string>(`document.querySelector('.draft-drawer').textContent`)).toContain("Bo, waiting: 2 days of these");
    expect(await view.evaluate<number>(`document.querySelectorAll('.calendar-view .date.clash').length`)).toBe(2);
    // Ask, then drag the bar a week on
    await view.evaluate(`[...document.querySelectorAll('.draft-drawer button')].find((b) => b.textContent.trim() === 'Ask').click()`);
    await waitFor(view, `[...document.querySelectorAll('.calendar-view .bar .sr-only')].some((s) => s.textContent === 'you, waiting, Wed 7 – Thu 8 Oct')`, (v) => v === true);
    // grabbed over its Wednesday, dropped on the next Wednesday: a week later
    await view.evaluate(`(() => {
      const bar = [...document.querySelectorAll('.calendar-view .bar.movable')].find((b) => b.textContent.includes('Wed 7'));
      const b = bar.getBoundingClientRect(), wed = __day(7).getBoundingClientRect();
      bar.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, button: 0, clientX: wed.left + wed.width / 2, clientY: b.top + b.height / 2 }));
      __point('pointermove', __day(14)); __point('pointerup', __day(14));
      return 1;
    })()`);
    await waitFor(view, `[...document.querySelectorAll('.calendar-view .bar .sr-only')].map((s) => s.textContent).join('|')`, (v) => String(v).includes("you, waiting, Wed 14 – Thu 15 Oct"));
    // as it was, for the other tests: the move, the ask, the draft
    for (let i = 0; i < 3; i++) await view.evaluate(`window.eta.socket().send(JSON.stringify({ doc: "ledger", ops: [{ op: "remove", path: "/latest" }] }))`);
    await waitFor(view, `[...document.querySelectorAll('.calendar-view .bar .sr-only')].some((s) => s.textContent.includes('Wed 7'))`, (v) => v === false);
  }, 20000);
});
