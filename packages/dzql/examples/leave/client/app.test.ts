import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { press, urlFor, waitFor, webview } from "dzql/rendering/webview";
import { createServer } from "dzql/rendering/server";
import { app as example } from "../routes";

let server: Awaited<ReturnType<typeof createServer>>;

beforeAll(async () => {
  server = await createServer(example, 0);
});

afterAll(() => {
  server.stop(true);
});

describe("leave in a real browser", () => {
  test("the sign-in page posts as a plain form, the password never on the socket, and Ann is on the calendar", async () => {
    await using view = webview();
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
    await using view = webview();
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
    // Ask: the drawer shows the request it became; closed, the bar drags a week on
    await press(view, ".draft-drawer .tool.add");
    await waitFor(view, `[...document.querySelectorAll('.calendar-view .bar .sr-only')].some((s) => s.textContent === 'you, waiting, Wed 7 – Thu 8 Oct')`, (v) => v === true);
    await waitFor(view, `document.querySelector('.request-drawer')?.textContent ?? ''`, (v) => String(v).includes("Wed 7 – Thu 8 Oct"));
    await press(view, ".request-drawer .drawer-close");
    await waitFor(view, `document.querySelector('.request-drawer') === null`, (v) => v === true);
    // grabbed over its Wednesday, dropped on the next Wednesday: a week later
    await view.evaluate(`(() => {
      const bar = [...document.querySelectorAll('.calendar-view .bar.movable')].find((b) => b.textContent.includes('Wed 7'));
      const b = bar.getBoundingClientRect(), wed = __day(7).getBoundingClientRect();
      bar.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, button: 0, clientX: wed.left + wed.width / 2, clientY: b.top + b.height / 2 }));
      __point('pointermove', __day(14)); __point('pointerup', __day(14));
      return 1;
    })()`);
    await waitFor(view, `[...document.querySelectorAll('.calendar-view .bar .sr-only')].map((s) => s.textContent).join('|')`, (v) => String(v).includes("you, waiting, Wed 14 – Thu 15 Oct"));
    // a bar dragged is not a bar tapped: the click that ends the drag goes nowhere, and the next one opens its drawer
    await view.evaluate(`(() => { const s = window.eta.socket(), send = s.send.bind(s); window.__sends = 0; s.send = (d) => (window.__sends++, send(d)); })()`);
    const click = `(document.querySelector('.calendar-view .bar.movable').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })), window.__sends)`;
    expect([await view.evaluate<number>(click), await view.evaluate<number>(click)]).toEqual([0, 1]);
    // as it was, for the other tests: the move and the ask undone, which gives the draft back, then the draft cancelled
    for (let i = 0; i < 2; i++) await view.evaluate(`window.eta.socket().send(JSON.stringify({ doc: "ledger", ops: [{ op: "remove", path: "/latest" }] }))`);
    await waitFor(view, `[...document.querySelectorAll('.calendar-view .bar .sr-only')].some((s) => s.textContent === 'your draft, Wed 7 – Thu 8 Oct')`, (v) => v === true);
    await view.evaluate(`window.eta.socket().send(JSON.stringify({ doc: "session", ops: [{ op: "remove", path: "/draft" }] }))`);
    await waitFor(view, `[...document.querySelectorAll('.calendar-view .bar .sr-only')].some((s) => s.textContent.includes('Wed 7'))`, (v) => v === false);
  }, 20000);

  test("Ann reads every request as a list, drawn as she scrolls it, and opens one", async () => {
    await using view = webview({ height: 340 });
    await view.navigate(urlFor(view, server.url));
    await waitFor(view, `document.querySelector('form.sign-in') !== null`, (v) => v === true);
    await view.evaluate(`(() => { const f = document.querySelector('form.sign-in'); f.email.value = 'ann@leave.example'; f.password.value = 'ann-password'; f.requestSubmit(); return 1; })()`);
    await waitFor(view, `document.querySelector('.calendar-view .month') !== null`, (v) => v === true);
    await view.evaluate(`window.eta.socket().send(JSON.stringify({ doc: "session", ops: [{ op: "replace", path: "/page", value: "list" }] }))`);
    const rows = `[...document.querySelectorAll('#list .vitem .vrow')].map((r) => r.getAttribute('aria-posinset') + ' ' + r.getAttribute('aria-expanded'))`;
    await waitFor(view, rows, (v) => (v as string[]).length >= 4);
    await view.evaluate(`(document.querySelector('#list .vlist').scrollTop = 60, window.__painted = new Promise((done) => new MutationObserver(done).observe(document.querySelector('#list .vspace'), { childList: true })), 1)`);
    await view.evaluate(`window.__painted.then(() => true)`); // drawn again as it scrolled
    await press(view, '#list .vrow[aria-posinset="2"]');
    await waitFor(view, `document.querySelector('#list .vrow[aria-posinset="2"]').getAttribute('aria-expanded')`, (v) => v === "true");
  }, 15000);
});
