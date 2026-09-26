import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { urlFor, waitFor } from "../../../src/webview";
import { createServer } from "../../../src/server";
import { asCouple, board, household } from "../setup";
import { example } from "../index";

let server: ReturnType<typeof createServer>;
let code: string;

beforeAll(async () => {
  server = createServer(example, 0);
  const email = `browser-${Date.now()}@example.com`;
  await asCouple([{ op: "add", path: "/households/-", value: { email, names: "Ada Test, Femi Test" } }]);
  code = (await board()).households.find((x) => x.email === email)!.code;
});

afterAll(() => {
  server.stop(true);
});


/** The trail: above the couple's box, or in the head of the household's page, which is a window of its own. */
const CRUMBS = `(document.querySelector('.crumbs') ?? document.querySelector('.cell.open .cell-head'))?.textContent ?? null`;

async function enter(view: Bun.WebView, who: string) {
  await view.navigate(urlFor(view, server.url));
  await waitFor(view, `document.querySelector('#code') !== null`, (v) => v === true);
  // the welcome's own message can push the code box below the default viewport's fold
  await view.scrollTo("#code");
  await view.click("#code");
  await view.type(who);
  await view.click("button.gold");
  await waitFor(view, CRUMBS, (v) => typeof v === "string" && v.includes(who.toUpperCase()));
}

describe("the wedding in a real browser", () => {
  test("a code opens the household's photo, the family standing in it; a tap on a figure opens the guest's drawer with the dress and menu applets", async () => {
    await using view = new Bun.WebView();
    await enter(view, code.toLowerCase());
    // the page is the photo: the family stands in it, and a figure can be tapped
    const names = await waitFor(view, `[...document.querySelectorAll('#family-photo .print text')].map((t) => t.textContent)`, (v) => Array.isArray(v) && v.length === 2);
    expect(names).toEqual(["Ada", "Femi"]);

    const guest = (await household(code)).guests[1]!;
    await view.evaluate(`document.querySelector('[data-applet="photo"] .slot[data-key="${guest.id}"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
    await waitFor(view, `document.querySelector('.guest-drawer .dress') !== null`, (v) => v === true);
    expect(await view.evaluate<string>(`document.querySelector('.guest-drawer h2').textContent`)).toBe(guest.name);
    expect(await view.evaluate<boolean>(`document.querySelector('.guest-drawer .menu') !== null`)).toBe(true);

    // touch the top: the dots appear (the applet's own state); a dot is a write, and the figure redraws from the render
    await view.evaluate(`document.querySelector('.callout-top').click()`);
    await waitFor(view, `document.querySelectorAll('.pop-top .dot').length`, (v) => v === 8);
    await view.evaluate(`document.querySelector('.pop-top .dot[data-value="#7FAE4E"]').click()`);
    await waitFor(view, `document.querySelector('.dress .torso')?.getAttribute('fill')`, (v) => v === "#7FAE4E");
    expect((await household(code)).guests[1]!.minifigure.top).toBe("#7FAE4E");
    // the open part survived the redraw
    expect(await view.evaluate<boolean>(`document.querySelector('.pop-top') !== null`)).toBe(true);

    // a course opens (the menu's own state); a pill is a write; the head says what was chosen
    await view.evaluate(`document.querySelector('.menu-head[data-course="2"]').click()`);
    await waitFor(view, `document.querySelectorAll('.menu-row.open .choice').length`, (v) => v === 6);
    await view.evaluate(`document.querySelector('.choice[data-kind="dish"][data-id="5"]').click()`);
    await waitFor(view, `document.querySelector('.menu-row.open .chosen')?.textContent`, (v) => v === "Sea bass");
    expect((await household(code)).guests[1]!.choices["2"]).toEqual({ dish: 5, drink: null });
  });

  test("reading the page as a list swaps the photo for rows, and back", async () => {
    await using view = new Bun.WebView();
    await enter(view, code);
    await waitFor(view, `document.querySelector('#family-photo svg') !== null`, (v) => v === true);
    // the reading switch is a stack on the page's rail
    await view.evaluate(`document.querySelector('.rail [role="radio"][aria-label="List"]').click()`);
    await waitFor(view, `document.querySelectorAll('.cell.open .row').length`, (v) => v === 2);
    expect(await view.evaluate<boolean>(`document.querySelector('.cell.open svg.photo') === null`)).toBe(true);
    await view.evaluate(`document.querySelector('.rail [role="radio"][aria-label="Us"]').click()`);
    await waitFor(view, `document.querySelector('#family-photo svg') !== null`, (v) => v === true);
  });

  test("the page follows into the URL; the browser's back button sends the session there; reopening a link catches the session up to it", async () => {
    await using view = new Bun.WebView();
    await enter(view, code);
    expect(await view.evaluate<string>(`location.pathname`)).toBe("/");

    // reading the page another way is a session write, as always -- the URL follows it
    await view.evaluate(`document.querySelector('.rail [role="radio"][aria-label="List"]').click()`);
    await waitFor(view, `location.pathname`, (v) => v === "/list");
    await waitFor(view, `document.querySelector('.cell.open .rows') !== null`, (v) => v === true);

    // a drawer is part of the address: opening the gifts puts them in the URL, the back button puts
    // the drawer away and leaves the reading, and a link with one in opens it
    await view.evaluate(`document.querySelector('.rail [aria-label="Gifts"]').click()`);
    await waitFor(view, `location.search`, (v) => v === "?gifts");
    await waitFor(view, `document.querySelector('#gifts-drawer') !== null`, (v) => v === true);
    await view.evaluate(`history.back()`);
    await waitFor(view, `document.querySelector('#gifts-drawer') === null`, (v) => v === true);
    expect(await view.evaluate<string>(`location.pathname + location.search`)).toBe("/list");

    // the browser's own back button: a popstate, not a click in the page -- the session follows
    // the URL back, rather than the URL being the only thing that moved (the photo is back, the
    // rows gone, which the URL alone could not have done)
    await view.evaluate(`history.back()`);
    await waitFor(view, `location.pathname`, (v) => v === "/");
    await waitFor(view, `document.querySelector('#family-photo') !== null && document.querySelector('.cell.open .rows') === null`, (v) => v === true);

    // reopening a link to a page while already signed in (the session cookie survives, same as a
    // reload): the URL is what was actually asked for, so the session catches up to it, rather
    // than a fresh render of the session's still-current page snapping the URL back to "/"
    await view.navigate(urlFor(view, server.url, "everyone"));
    await waitFor(view, `location.pathname`, (v) => v === "/everyone");
    await waitFor(view, `document.querySelector('#everyone-photo') !== null`, (v) => v === true);

    // and a link with a drawer in it opens the drawer
    await view.navigate(urlFor(view, server.url, "list?stay"));
    await waitFor(view, `document.querySelector('#stay-drawer') !== null`, (v) => v === true);
  }, 20000);

  test("the answer: the pencil opens the drawer, an option writes it, the bubble shows it, Undo takes it back", async () => {
    await using view = new Bun.WebView();
    await enter(view, code);
    await view.evaluate(`document.querySelector('.bubble.ours').click()`);
    await waitFor(view, `document.querySelectorAll('.answer-option').length`, (v) => v === 3);
    await view.evaluate(`document.querySelector('.answer-option[data-value="maybe"]').click()`);
    await waitFor(view, `document.querySelector('.bubble.ours .face-mark')?.classList.contains('maybe')`, (v) => v === true);
    await view.evaluate(`document.querySelector('.drawer-close').click()`);
    await waitFor(view, `document.querySelector('.drawer') === null`, (v) => v === true);
    await view.evaluate(`document.querySelector('[data-write*="ledger"]').click()`);
    await waitFor(view, `document.querySelector('.bubble.ours .face-mark')?.classList.contains('maybe')`, (v) => v === false);
  });

  test("editing a gift's fields in its drawer writes on blur, batches fields changed together, and does not reset", async () => {
    await using view = new Bun.WebView();
    // the couple's own code, not a household's: the keep drawers are theirs to edit
    await view.navigate(urlFor(view, server.url));
    await waitFor(view, `document.querySelector('#code') !== null`, (v) => v === true);
    await view.scrollTo("#code");
    await view.click("#code");
    await view.type("DASH");
    await view.click("button.gold");
    await waitFor(view, `document.querySelector('.bubble.couple') !== null`, (v) => v === true);

    await asCouple([{ op: "add", path: "/gifts/-", value: { name: "Toaster", description: "starter" } }]);
    const giftId = (await board()).gifts.at(-1)!.id;

    await view.evaluate(`window.eta.socket().send(JSON.stringify({ doc: "session", ops: [{ op: "replace", path: "/page", value: "gifts?keep=gifts/${giftId}" }] }))`);
    await waitFor(view, `document.querySelector('.keep-drawer input[name=name]') !== null`, (v) => v === true);

    // change two fields of the same editing form before either loses focus, then trigger just one:
    // the write must carry both, not only the field whose event fired. Blanking the name is a
    // required field's write the server refuses (see documents/values.ts's `text`); the
    // description's is accepted, so exactly one of the two lands.
    await view.evaluate(`(() => {
      const form = document.querySelector('.keep-drawer form');
      form.querySelector('input[name=name]').value = '';
      form.querySelector('input[name=description]').value = 'a good one';
      form.querySelector('input[name=description]').dispatchEvent(new Event('focusout', { bubbles: true }));
    })()`);

    await waitFor(
      view,
      `window.eta.docs()['board:1']?.ops.some((op) => op.path === '/gifts/${giftId}' && op.value?.description === 'a good one') ?? false`,
      (v) => v === true,
    );
    const g = (await board()).gifts.find((x) => x.id === giftId)!;
    expect(g.name).toBe("Toaster"); // the refused op never applied
    expect(g.description).toBe("a good one");

    // the drawer does not reset on the echo of an editing write, unlike a creating form: the
    // render that follows the description's write must not also snap the *refused* name edit
    // back to the server's old value -- it stays blank, the refusal handed back as is.
    expect(await view.evaluate<string>(`document.querySelector('.keep-drawer input[name=name]').value`)).toBe("");
    expect(await view.evaluate<string>(`document.querySelector('.keep-drawer input[name=description]').value`)).toBe("a good one");
  });

  test("the welcome's message textarea writes on blur too, comparing against its rendered content, not an input's value attribute", async () => {
    await asCouple([{ op: "replace", path: "/message", value: "can't wait" }]);

    await using view = new Bun.WebView();
    await view.navigate(urlFor(view, server.url));
    await waitFor(view, `document.querySelector('#code') !== null`, (v) => v === true);
    await view.scrollTo("#code");
    await view.click("#code");
    await view.type("DASH");
    await view.click("button.gold");
    await waitFor(view, `document.querySelector('.bubble.couple') !== null`, (v) => v === true);
    // the welcome is a "thing" (rule 15): its message lives in its own drawer now
    await view.evaluate(`document.querySelector('.bubble.couple').click()`);
    await waitFor(view, `document.querySelector('.welcome-drawer textarea') !== null`, (v) => v === true);

    // blurring without changing the textarea must send nothing at all: the comparison has to be
    // against what was actually rendered (defaultValue), not an attribute a <textarea> doesn't
    // even have -- checked on the client's own record of what it sent, since the server's
    // no-op-if-unchanged guard would otherwise hide a spurious send from the document itself.
    await view.evaluate(`document.querySelector('.welcome-drawer textarea').dispatchEvent(new Event('focusout', { bubbles: true }))`);
    await Bun.sleep(200);
    // lastSent is still the code-entry's session write from login above -- nothing for "board" followed it
    expect(await view.evaluate<string>(`window.eta.inspect().lastSent?.doc`)).toBe("session");
    expect((await board()).message).toBe("can't wait");

    await view.evaluate(`(() => {
      const box = document.querySelector('.welcome-drawer textarea');
      box.value = 'so happy for you both';
      box.dispatchEvent(new Event('focusout', { bubbles: true }));
    })()`);

    await waitFor(view, `document.querySelector('.welcome-drawer textarea').value`, (v) => v === "so happy for you both");
    expect((await board()).message).toBe("so happy for you both");
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
