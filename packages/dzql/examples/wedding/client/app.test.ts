import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { press, urlFor, waitFor, webview } from "../../../src/webview";
import { createServer } from "../../../src/server";
import { asCouple, asHousehold, board, household } from "../setup";
import { example } from "../index";
import { crowd } from "../applets/photo";

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


/** The trail, in the head of the page: a household's and the couple's are each a window of its own. */
const CRUMBS = `document.querySelector('.cell.open .cell-head')?.textContent ?? null`;

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
  test("on a phone the reader may zoom: the viewport does not hold the scale, and no field is under 16px, which iOS would zoom into", async () => {
    await using view = webview({ width: 375, height: 740 });
    await view.navigate(urlFor(view, server.url));
    await waitFor(view, `document.querySelector('#code') !== null`, (v) => v === true);
    expect(await view.evaluate<string>(`document.querySelector('meta[name=viewport]').content`)).not.toMatch(/maximum-scale|user-scalable/);
    expect(await view.evaluate<string[]>(`[...document.querySelectorAll('input, select, textarea')].map((el) => el.name + ' ' + getComputedStyle(el).fontSize)`)).toEqual(["code 16px", "email 16px"]);
  });

  test("a code opens the household's photo, the family standing in it; a tap on a figure opens the guest's drawer with the dress and menu applets", async () => {
    await using view = webview();
    await enter(view, code.toLowerCase());
    // the page is the photo: the family stands in it, and a figure can be tapped
    const names = await waitFor(view, `[...document.querySelectorAll('#family-photo .print text')].map((t) => t.textContent)`, (v) => Array.isArray(v) && v.length === 2);
    expect(names).toEqual(["Ada", "Femi"]);

    const guest = (await household(code)).guests[1]!;
    await press(view, `[data-applet="photo"] .slot[data-key="${guest.id}"]`);
    await waitFor(view, `document.querySelector('.guest-drawer .dress') !== null`, (v) => v === true);
    expect(await view.evaluate<string>(`document.querySelector('.guest-drawer h2').textContent`)).toBe(guest.name);
    expect(await view.evaluate<boolean>(`document.querySelector('.guest-drawer .menu') !== null`)).toBe(true);

    // touch the top: the dots appear (the applet's own state); a dot is a write, and the figure redraws from the render
    await press(view, ".callout-top");
    await waitFor(view, `document.querySelectorAll('.pop-top .dot').length`, (v) => v === 8);
    await press(view, '.pop-top .dot[data-value="#7FAE4E"]');
    await waitFor(view, `document.querySelector('.dress .torso')?.getAttribute('fill')`, (v) => v === "#7FAE4E");
    expect((await household(code)).guests[1]!.minifigure.top).toBe("#7FAE4E");
    // the open part survived the redraw
    expect(await view.evaluate<boolean>(`document.querySelector('.pop-top') !== null`)).toBe(true);

    // a course opens (the menu's own state); a pill is a write; the head says what was chosen
    await press(view, '.menu-head[data-course="2"]');
    await waitFor(view, `document.querySelectorAll('.menu-row.open .choice').length`, (v) => v === 6);
    await press(view, '.choice[data-kind="dish"][data-id="5"]');
    await waitFor(view, `document.querySelector('.menu-row.open .chosen')?.textContent`, (v) => v === "Sea bass");
    expect((await household(code)).guests[1]!.choices["2"]).toEqual({ dish: 5, drink: null });
  });

  test("reading the page as a list swaps the photo for rows, and back", async () => {
    await using view = webview();
    await enter(view, code);
    await waitFor(view, `document.querySelector('#family-photo svg') !== null`, (v) => v === true);
    // the reading switch is a stack on the page's rail
    await press(view, '.rail [role="radio"][aria-label="List"]');
    await waitFor(view, `document.querySelectorAll('.cell.open .row').length`, (v) => v === 2);
    expect(await view.evaluate<boolean>(`document.querySelector('.cell.open svg.photo') === null`)).toBe(true);
    await press(view, '.rail [role="radio"][aria-label="Us"]');
    await waitFor(view, `document.querySelector('#family-photo svg') !== null`, (v) => v === true);
  });

  test("the page follows into the URL; the browser's back button sends the session there; reopening a link catches the session up to it", async () => {
    await using view = webview();
    await enter(view, code);
    expect(await view.evaluate<string>(`location.pathname`)).toBe("/");

    // reading the page another way is a session write, as always -- the URL follows it
    await press(view, '.rail [role="radio"][aria-label="List"]');
    await waitFor(view, `location.pathname`, (v) => v === "/list");
    await waitFor(view, `document.querySelector('.cell.open .rows') !== null`, (v) => v === true);

    // a drawer is part of the address: opening the gifts puts them in the URL, the back button puts
    // the drawer away and leaves the reading, and a link with one in opens it
    await press(view, '.rail [aria-label="Gifts"]');
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

  test("the photo of everyone watches its document: a look changed in another tab reaches it as a patch, drawn anew, its mount never rendered again", async () => {
    const email = `everyone-${Date.now()}@example.com`;
    await asCouple([{ op: "add", path: "/households/-", value: { email, names: "Gus Look" } }]);
    const theirs = (await board()).households.find((x) => x.email === email)!;
    await asHousehold(theirs.code, [{ op: "replace", path: "/answer", value: "yes" }]);
    const guest = (await household(theirs.code)).guests[0]!;
    await using view = webview();
    await enter(view, theirs.code.toLowerCase());
    await view.navigate(urlFor(view, server.url, "everyone"));
    await waitFor(view, `document.querySelector('#everyone-photo svg') !== null`, (v) => v === true);
    // where they stand: as a guest, or in their family's figure, as what the mount holds derives it
    const { photo } = crowd(JSON.parse(await view.evaluate<string>(`document.getElementById('everyone-photo').dataset.props`)));
    const slot = photo.entries.some((e) => e.key === String(guest.id)) ? guest.id : theirs.id;
    const top = `document.querySelector('#everyone-photo [data-slot="${slot}"] .torso')?.getAttribute('fill') ?? null`;
    expect(await view.evaluate<string>(top)).toBe(guest.minifigure.top);
    await view.evaluate(`(() => { const el = document.getElementById('everyone-photo'); el._probe = true; window.__props = el.dataset.props; })()`);

    await asHousehold(theirs.code, [{ op: "replace", path: `/guests/${guest.id}/minifigure/top`, value: "#7FAE4E" }]); // as their other tab would
    await waitFor(view, top, (v) => v === "#7FAE4E");
    expect(await view.evaluate<unknown>(`(() => { const el = document.getElementById('everyone-photo'); return [el._probe, el.dataset.props === window.__props]; })()`)).toEqual([true, true]);
  });

  test("beside a docked drawer the page is in reach: one tap goes from the gifts to the day, one to a guest; Escape puts the drawer away", async () => {
    await using view = webview({ width: 1280, height: 800 }); // wide enough that the drawer docks
    await enter(view, code);
    await waitFor(view, `document.querySelector('#family-photo svg') !== null`, (v) => v === true);
    await view.click('.rail [aria-label="Gifts"]');
    await waitFor(view, `document.querySelector('#gifts-drawer') !== null`, (v) => v === true);
    await Bun.sleep(300); // the rail steps aside for the drawer
    await view.click('.rail [aria-label="The day"]'); // a real click, where the tool stands: nothing lies over it
    await waitFor(view, `document.querySelector('#day-drawer') !== null`, (v) => v === true);
    const guest = (await household(code)).guests[0]!;
    // a figure never stands still (its attitude animates), so the tap is where it stands now
    const at = await view.evaluate<{ x: number; y: number }>(`(() => { const r = document.querySelector('#family-photo .slot[data-key="${guest.id}"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await view.click(at.x, at.y);
    await waitFor(view, `document.querySelector('.guest-drawer') !== null`, (v) => v === true);
    await view.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
    await waitFor(view, `document.querySelector('.drawer') === null`, (v) => v === true);
  }, 15000);

  test("the answer: the pencil opens the drawer, an option writes it, the bubble shows it, Undo takes it back", async () => {
    await using view = webview();
    await enter(view, code);
    await press(view, ".bubble.ours");
    await waitFor(view, `document.querySelectorAll('.answer-option').length`, (v) => v === 3);
    await press(view, `.answer-option[data-value='"maybe"']`);
    await waitFor(view, `document.querySelector('.bubble.ours .face-mark')?.classList.contains('maybe')`, (v) => v === true);
    await press(view, ".drawer-close");
    await waitFor(view, `document.querySelector('.drawer') === null`, (v) => v === true);
    await press(view, '[data-write*="ledger"]');
    await waitFor(view, `document.querySelector('.bubble.ours .face-mark')?.classList.contains('maybe')`, (v) => v === false);
  });

  for (const [where, width, height] of [["on a phone", 390, 760], ["at a desk", 1100, 720]] as const) {
    test(`Undo says what it took back beside the page's tools, ${where}, and over neither of them: Redo and Undo are pressed again`, async () => {
      await using view = webview({ width, height });
      await enter(view, code);
      await press(view, ".bubble.ours");
      await waitFor(view, `document.querySelectorAll('.answer-option').length`, (v) => v === 3);
      await press(view, `.answer-option[data-value='"no"']`);
      await waitFor(view, `document.querySelector('.bubble.ours .face-mark')?.classList.contains('no')`, (v) => v === true);
      await press(view, ".drawer-close");
      await waitFor(view, `document.querySelector('.drawer') === null`, (v) => v === true);
      const said = `document.querySelector('.undo-said')?.textContent ?? null`;
      // each pressed as a person does, which throws, naming it, if anything covers the button
      await press(view, 'button[aria-label="Undo"]');
      await waitFor(view, said, (v) => v === "Undone: your answer.");
      await press(view, 'button[aria-label="Redo"]');
      await waitFor(view, said, (v) => v === "Redone: your answer.");
      await press(view, 'button[aria-label="Undo"]');
      await waitFor(view, said, (v) => v === "Undone: your answer.");
    });
  }

  test("the couple's page is the photo of families: a tap on a family opens its drawer, and Escape puts it away", async () => {
    await using view = webview({ width: 1280, height: 800 });
    await view.navigate(urlFor(view, server.url));
    await waitFor(view, `document.querySelector('#code') !== null`, (v) => v === true);
    await view.scrollTo("#code");
    await view.click("#code");
    await view.type("NICK");
    await view.click("button.gold");
    await waitFor(view, `document.querySelector('#board-photo svg .slot[role="button"]') !== null`, (v) => v === true);
    // a figure never stands still, so the tap is where it stands now
    const at = await view.evaluate<{ x: number; y: number }>(`(() => { const r = document.querySelector('#board-photo .slot[role="button"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await view.click(at.x, at.y);
    await waitFor(view, `document.querySelector('.family-drawer') !== null`, (v) => v === true);
    expect(await view.evaluate<string>(`location.search`)).toMatch(/^\?family=\d+$/);
    await view.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
    await waitFor(view, `document.querySelector('.drawer') === null`, (v) => v === true);
  }, 15000);

  test("find's field opens beside its own tool, below the reading in the rail, not at the rail's top, and stays beside it when a drawer moves the rail", async () => {
    await using view = webview({ width: 1280, height: 800 });
    await enter(view, code.toLowerCase());
    await view.click(".rail .tool.find");
    await waitFor(view, `document.querySelector('.filter') !== null`, (v) => v === true);
    const BESIDE = `(() => { const t = document.querySelector('.rail .tool.find').getBoundingClientRect(), f = document.querySelector('.filter').getBoundingClientRect(); return { top: f.top - t.top, gap: t.left - f.right }; })()`;
    const expectBeside = (beside: { top: number; gap: number }) => {
      expect(Math.abs(beside.top)).toBeLessThan(2);
      expect(beside.gap).toBeGreaterThan(0);
      expect(beside.gap).toBeLessThan(24);
    };
    expectBeside(await view.evaluate(BESIDE));

    // a drawer docks at the right and the rail steps aside for it; the field goes with its tool
    await view.click('.rail .tool[aria-label="Gifts"]');
    await waitFor(view, `document.querySelector('.drawer') !== null`, (v) => v === true);
    await waitFor(view, `document.querySelector('.rail').getAnimations().length === 0`, (v) => v === true);
    expectBeside(await view.evaluate(BESIDE));
  }, 15000);

  test("find fades and lights the figures where they stand: the photo is not drawn again as find opens, looks and closes", async () => {
    await using view = webview({ width: 1280, height: 800 });
    await enter(view, code.toLowerCase());
    // the photo's element and its drawing, tagged: a redraw would leave them untagged
    const SAME = `(() => { const m = document.querySelector('#family-photo'), s = m.querySelector('svg'), same = m.__tag === 1 && s.__tag === 1; m.__tag = 1; s.__tag = 1; return same; })()`;
    await view.evaluate(SAME);

    await view.click(".rail .tool.find");
    await waitFor(view, `document.querySelector('.filter') !== null`, (v) => v === true);
    expect(await view.evaluate<boolean>(SAME)).toBe(true);

    await view.click(".filter input");
    await view.type("femi");
    await waitFor(view, `document.querySelector('#family-photo .slot.hushed') !== null`, (v) => v === true);
    expect(await view.evaluate<boolean>(SAME)).toBe(true);

    await view.click(".rail .tool.find");
    await waitFor(view, `document.querySelector('.filter') === null && document.querySelector('#family-photo .slot.hushed') === null`, (v) => v === true);
    expect(await view.evaluate<boolean>(SAME)).toBe(true);
  }, 15000);

  test("the rail's tools and find's bar keep the bento's heights; in a drawer a long state goes under its words and stays inside", async () => {
    await using view = webview({ width: 1280, height: 800 });
    await enter(view, code);
    await view.click(".rail .tool.find");
    await waitFor(view, `document.querySelector('.filter') !== null`, (v) => v === true);
    const heights = await view.evaluate<{ tools: number[]; bar: number; field: number; eye: number }>(`(() => {
      const h = (el) => Math.round(el.getBoundingClientRect().height);
      return { tools: [...document.querySelectorAll('.rail .tool')].map(h), bar: h(document.querySelector('.filter')), field: h(document.querySelector('.filter input')), eye: h(document.querySelector('.filter .tool')) };
    })()`);
    expect(new Set(heights.tools)).toEqual(new Set([32]));
    expect(heights).toMatchObject({ bar: 32, field: 24, eye: 26 });

    // two households give to the honeymoon fund: the couple's row says so at length
    const email = `giver-${Date.now()}@example.com`;
    await asCouple([{ op: "add", path: "/households/-", value: { email, names: "Gil Giver" } }]);
    const other = (await board()).households.find((x) => x.email === email)!.code;
    for (const who of [code, other]) await asHousehold(who, [{ op: "add", path: "/claims/-", value: 2 }]);
    await using couple = webview({ width: 1280, height: 800 });
    await couple.navigate(urlFor(couple, server.url, "?gifts"));
    await waitFor(couple, `document.querySelector('#code') !== null`, (v) => v === true);
    await couple.evaluate(`(() => { const i = document.querySelector('#code'); i.value = 'NICK'; i.form.requestSubmit(); })()`);
    await couple.navigate(urlFor(couple, server.url, "?gifts"));
    await waitFor(couple, `document.querySelector('#gifts-drawer #gift-2 .state')?.textContent ?? ""`, (v) => typeof v === "string" && v.includes(other));
    const fits = await couple.evaluate<{ words: number; inside: boolean }[]>(`(() => {
      const edge = document.querySelector('#gifts-drawer .drawer-body').getBoundingClientRect().right;
      return [...document.querySelectorAll('#gifts-drawer .row')].map((row) => ({ words: Math.round(row.querySelector('.words').getBoundingClientRect().width), inside: [...row.children].every((c) => c.getBoundingClientRect().right <= edge + 0.5) }));
    })()`);
    for (const row of fits) {
      expect(row.inside).toBe(true);
      expect(row.words).toBeGreaterThan(150);
    }
    for (const who of [code, other]) await asHousehold(who, [{ op: "remove", path: "/claims/2" }]); // the gifts as the other tests find them

    // a property's field, and a picture's button, are a field's and a word's 40px, not their text's height
    await couple.navigate(urlFor(couple, server.url, "?keep=gifts/1"));
    await waitFor(couple, `document.querySelector('.keep-drawer [data-applet="picture-field"] button') !== null`, (v) => v === true);
    const props = await couple.evaluate<number[]>(`[...document.querySelectorAll('.keep-drawer .prop-value > .field, .keep-drawer .pic-field button')].map((e) => Math.round(e.getBoundingClientRect().height))`);
    expect(props.length).toBe(4); // name, words, link, the picture's button
    expect(new Set(props)).toEqual(new Set([40]));
  }, 20000);

  test("editing a gift's fields in its drawer writes each as it is left, and does not reset", async () => {
    await using view = webview();
    // the couple's own code, not a household's: the keep drawers are theirs to edit
    await view.navigate(urlFor(view, server.url));
    await waitFor(view, `document.querySelector('#code') !== null`, (v) => v === true);
    await view.scrollTo("#code");
    await view.click("#code");
    await view.type("NICK");
    await view.click("button.gold");
    await waitFor(view, `document.querySelector('.bubble.couple') !== null`, (v) => v === true);

    await asCouple([{ op: "add", path: "/gifts/-", value: { name: "Toaster", description: "starter" } }]);
    const giftId = (await board()).gifts.at(-1)!.id;

    await view.evaluate(`window.eta.socket().send(JSON.stringify({ doc: "session", ops: [{ op: "replace", path: "/page", value: "?keep=gifts/${giftId}" }] }))`);
    await waitFor(view, `document.querySelector('.keep-drawer input[name=name]') !== null`, (v) => v === true);

    // each field is a form of its own (src/bento.ts field()), written as it is left: blanking the
    // name is a required field's write the server refuses (see documents/values.ts's `text`); the
    // description's is accepted, so exactly one of the two lands.
    await view.evaluate(`(() => {
      const name = document.querySelector('.keep-drawer input[name=name]');
      name.value = '';
      name.dispatchEvent(new Event('focusout', { bubbles: true }));
      const words = document.querySelector('.keep-drawer input[name=description]');
      words.value = 'a good one';
      words.dispatchEvent(new Event('focusout', { bubbles: true }));
    })()`);

    await waitFor(
      view,
      `window.eta.docs()['board:1']?.ops.some((op) => op.path === '/gifts/${giftId}/description' && op.value === 'a good one') ?? false`,
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

    await using view = webview();
    await view.navigate(urlFor(view, server.url));
    await waitFor(view, `document.querySelector('#code') !== null`, (v) => v === true);
    await view.scrollTo("#code");
    await view.click("#code");
    await view.type("NICK");
    await view.click("button.gold");
    await waitFor(view, `document.querySelector('.bubble.couple') !== null`, (v) => v === true);
    // the welcome is a "thing": its message lives in its own drawer now
    await press(view, ".bubble.couple");
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

    // the box says what was typed at once; the board, once the write has landed: waited for, not assumed
    await waitFor(view, `window.eta.inspect().lastSent?.doc`, (v) => v === "board");
    for (const end = performance.now() + 2000; (await board()).message !== "so happy for you both" && performance.now() < end; ) await Bun.sleep(20);
    expect((await board()).message).toBe("so happy for you both");
  });

  test("the answer's words are written as they are left, as every drawer's are; a choice of three stays inside the guest's drawer", async () => {
    await using view = webview({ width: 1280, height: 800 });
    await enter(view, code);
    const guest = (await household(code)).guests[0]!;
    await view.navigate(urlFor(view, server.url, `?guest=${guest.id}`));
    await waitFor(view, `document.querySelector('.guest-drawer .pick') !== null`, (v) => v === true);
    const past = await view.evaluate<number>(`(() => { const edge = document.querySelector('.guest-drawer .drawer-body').getBoundingClientRect().right; return Math.max(...[...document.querySelectorAll('.guest-drawer .pick .tool')].map((b) => b.getBoundingClientRect().right - edge)); })()`);
    expect(past).toBeLessThanOrEqual(0);

    await view.navigate(urlFor(view, server.url, "?answer"));
    await waitFor(view, `document.querySelector('.answer-drawer textarea') !== null`, (v) => v === true);
    expect(await view.evaluate<boolean>(`document.querySelector('.answer-drawer button[type="submit"]') === null`)).toBe(true); // no Save
    await view.evaluate(`(() => {
      const box = document.querySelector('.answer-drawer textarea');
      box.value = 'Ada is vegetarian.';
      box.dispatchEvent(new Event('focusout', { bubbles: true }));
    })()`);
    await waitFor(view, `document.querySelector('.bubble.ours .bubble-words').textContent`, (v) => v === "Ada is vegetarian."); // the bubble, drawn again from the write
    expect((await household(code)).message).toBe("Ada is vegetarian.");
    await asHousehold(code, [{ op: "replace", path: "/message", value: "" }]);
  }, 15000);

  test("leaving returns to the welcome, and the session survives a reload", async () => {
    await using view = webview();
    await enter(view, code);
    await view.reload();
    await waitFor(view, CRUMBS, (v) => typeof v === "string" && v.includes(code));
    await press(view, '[data-write*="/code"]');
    await waitFor(view, `document.querySelector('#code') !== null`, (v) => v === true);
  });
});
