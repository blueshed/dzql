import { describe, expect, test } from "bun:test";
import { app as chat } from "../../examples/chat/routes";
import { stories as chatStories } from "../../examples/chat/stories";
import type { Example } from "../../src/rendering/example";
import { sameWrite } from "../../src/modelling/by-hand";
import { run, stillOpen } from "../../src/modelling/harness";
import { createServer } from "../../src/rendering/server";
import { write } from "../../src/rendering/html";
import type { Stories, Story } from "../../src/modelling/stories";
import wrongPage from "./by-hand.test.html";

// The stories by hand: each told as the harness tells it, then done in a browser the size of a
// phone. A control the page draws can be there and still not be pressed; the harness without a
// browser cannot tell, and these say so by story name.

/** An example and its stories, by its folder under examples/. */
async function load(name: string): Promise<{ example: Example; stories: Stories }> {
  const { app: example } = await import(`../../examples/${name}/routes`);
  const { stories } = await import(`../../examples/${name}/stories`);
  return { example, stories };
}
/** The stories called `names`, whole names, so a story added that starts alike is never picked up; a name not there throws, naming it. */
function named(stories: Stories, ...names: string[]): Story[] {
  return names.map((name) => stories.stories.find((s) => s.name === name) ?? (() => { throw new Error(`no story called "${name}": renamed?`); })());
}
/** `stories` told among only the members `names`: each member walks every place it can get to, so a test casts no more than its stories need. */
const among = (stories: Stories, ...names: string[]): Stories => ({ ...stories, cast: Object.fromEntries(names.map((name) => [name, stories.cast[name]!])) });

const say = { doc: "room", ops: [{ op: "add" as const, path: "/messages/-", value: "hello" }] };
const hello: Story = { name: "Ada says hello", as: "ada", does: say, seen: ["ada", "bob"], untold: ["cy", "dee", "eve"] };
/** Chat, its page drawn otherwise: what `change` makes of the message form. */
const chatWith = (change: (html: string) => string): Example => ({ ...chat, render: (sessionId) => change(chat.render(sessionId)) });
const MESSAGE_FORM = /<form class="say"[^>]*data-write='\{"doc":"room"[^]*?<\/form>/;
/** Each story's failures, told among chat's cast, and with `byHand` done by hand too. */
const told = async (example: Example, stories: Story[], byHand = false) => (await run(example, { ...chatStories, stories }, undefined, { byHand })).outcomes.map((o) => o.failures);
/** leave, its calendar made wrong as `wrong` says (src/by-hand.test.entry.ts); "" is leave's own. */
const leaveWith = async (wrong: string): Promise<Example> => {
  const { example: leave } = await load("leave");
  return { ...leave, index: wrongPage, render: (sessionId) => leave.render(sessionId).replace('data-applet="calendar"', `data-applet="calendar" data-wrong="${wrong}"`) };
};

describe("the stories by hand", () => {
  test("a story a person can do passes by hand too: a form typed into and sent, a button pressed, a way pressed to where it is done", async () => {
    const report = await run(chat, chatStories, undefined, { byHand: true });
    expect(report.outcomes.map((o) => o.name)).toEqual(chatStories.stories.map((s) => s.name));
    expect(report.outcomes.flatMap((o) => o.failures)).toEqual([]);
    expect(report.byHand).toMatchObject({ stories: 11, presses: 11, applets: 0 });

    const { example: ticker, stories: told } = await load("ticker");
    const reading = (value: string) => ({ doc: "desk", ops: [{ op: "replace" as const, path: "/reading/board", value }] });
    const ann: Story[] = [
      ...named(told, "Ann watches Charlie Metals, and only her board grows", "Ann sets her clock to Tokyo, and only her clock's face changes"), // a modal's select; the city picker, an applet's
      { name: "Ann, reading her board as a list, reads it as sparklines again", as: "ann", from: "board @ reading.board=list", does: reading("sparkline"), seen: ["ann"] }, // after " @ ", pressed there
    ];
    const tickerReport = await run(ticker, { ...told, stories: ann }, undefined, { byHand: true });
    expect(tickerReport.outcomes.map((o) => o.failures)).toEqual([[], [], []]);
    expect(tickerReport.byHand!.applets).toBe(1);
  }, 60000);

  test("a control that is on the page and cannot be pressed passes without a browser, and fails by hand, by name", async () => {
    const covered = chatWith((html) => html.replace(MESSAGE_FORM, (form) => `<div style="position: relative">${form}<div id="veil" style="position: absolute; inset: 0"></div></div>`));
    expect(await told(covered, [hello])).toEqual([[]]);
    expect(await told(covered, [hello], true)).toEqual([["by hand, ada could not add /messages/- on room: the control for it is covered by div#veil"]]);

    const unseen = chatWith((html) => html.replace(MESSAGE_FORM, (form) => `<div style="display: none">${form}</div>`));
    expect(await told(unseen, [hello])).toEqual([[]]);
    expect(await told(unseen, [hello], true)).toEqual([["by hand, ada could not add /messages/- on room: the control for it is not to be seen"]]);

    // a field that writes, in no form that sends it: the client never does
    const loose = chatWith((html) => html.replace(MESSAGE_FORM, `<input name="text"${write("room", "add", "/messages/-")}>`));
    expect(await told(loose, [hello])).toEqual([[]]);
    expect(await told(loose, [hello], true)).toEqual([["by hand, ada could not add /messages/- on room: its field is in no form that sends it"]]);
  }, 60000);

  test("a form posted to a route by hand: typed into and sent, the browser following where it sends it, signed in or told why; one a person cannot reach fails by name", async () => {
    const { example: leave, stories: told } = await load("leave");
    const posts = named(told, "Bo signs in on another phone, and sees the team's calendar", "Someone types Bo's email with the wrong password, and is told the two do not match");
    const after = named(told, "Ann asks for her draft, and Mo and Bo see it waiting on the calendar, and she sees it waiting in her drawer").map((s) => ({ ...s, seen: { ann: "2026-10" } }) as Story); // a fresh browser after a post: not signed in as Bo by the route's cookie
    const report = await run(leave, { ...among(told, "visitor", "ann"), stories: [...posts, ...after] }, undefined, { byHand: true });
    expect(report.outcomes.map((o) => o.failures)).toEqual([[], [], []]);
    expect(report.byHand).toMatchObject({ stories: 3 });

    const wrong = (change: (html: string) => string): Example => ({ ...leave, render: (sessionId) => change(leave.render(sessionId)) });
    const unseen = wrong((html) => html.replace('<form class="sign-in"', '<form style="display: none" class="sign-in"'));
    const done = await run(unseen, { ...among(told, "visitor"), stories: posts }, undefined, { byHand: true });
    expect(done.outcomes.map((o) => o.failures)).toEqual([["by hand, visitor could not post to /login: a field of its form is not to be seen"], ["by hand, visitor could not post to /login: a field of its form is not to be seen"]]);
    const nameless = wrong((html) => html.replace('name="password"', 'name="secret"'));
    expect((await run(nameless, { ...among(told, "visitor"), stories: posts.slice(0, 1) }, undefined, { byHand: true })).outcomes[0]!.failures).toEqual(["by hand, visitor could not post to /login: its form has no field password"]);
    const buttonless = wrong((html) => html.replace('<button type="submit" class="tool">', '<button type="submit" class="tool" style="visibility: hidden">'));
    expect((await run(buttonless, { ...among(told, "visitor"), stories: posts.slice(0, 1) }, undefined, { byHand: true })).outcomes[0]!.failures).toEqual(["by hand, visitor could not post to /login: the button of its form is not to be seen"]);
  }, 60000);

  test("a press the client never hears sends nothing; a button in a disabled fieldset's first legend is pressed", async () => {
    const logout = { doc: "session", ops: [{ op: "remove" as const, path: "/name" }] };
    const going: Story = { name: "Ada logs out", as: "ada", does: logout, seen: ["ada", "bob"] };
    const off = write("session", "remove", "/name");
    const unheard = chatWith((html) => html.replace(off, ` onclick="event.stopPropagation()"${off}`));
    expect(await told(unheard, [going])).toEqual([[]]);
    expect(await told(unheard, [going], true)).toEqual([["by hand, ada could not remove /name on session: the page sent nothing when it was pressed"]]);

    // a button in a disabled fieldset's first legend is not disabled, as the browser has it (`:disabled`)
    const legend = chatWith((html) => html.replace(/<button[^>]*aria-label="Log out"[^]*?<\/button>/, (b) => `<fieldset disabled><legend>${b}</legend></fieldset>`));
    expect(await told(legend, [going], true)).toEqual([[]]);
  }, 60000);

  test("a tab that does not close is said, not waited on in silence: the server still holding its socket", async () => {
    const server = createServer(chat, 0);
    const cookie = crypto.randomUUID();
    const sessionId = await chat.session!(cookie); // the session the cookie names: a numbered row
    const url = new URL("/ws", server.url);
    url.protocol = "ws:";
    const tab = () =>
      new Promise<WebSocket>((resolve) => {
        // @ts-expect-error Bun's runtime-only `headers` option on WebSocket
        const ws: WebSocket = new WebSocket(url, { headers: { Cookie: `session_id=${cookie}` } });
        ws.addEventListener("open", () => resolve(ws), { once: true });
      });
    const [kept, closing] = [await tab(), await tab()];
    try {
      expect(await stillOpen(sessionId, 50)).toBe("the server still held 2 of its sockets after 50 ms");
      closing.close();
      expect(await stillOpen(sessionId)).toBeUndefined();
    } finally {
      kept.close();
      server.stop(true);
    }
  });

  test("what is folded in a <details> is opened first; a write the server refuses lands nothing by hand either", async () => {
    const folded = chatWith((html) => html.replace(MESSAGE_FORM, (form) => `<details><summary>Say something</summary>${form}</details>`));
    expect(await told(folded, [hello], true)).toEqual([[]]);

    const blank: Story = { name: "Dee enters a room with no name", as: "dee", does: { doc: "session", ops: [{ op: "replace", path: "/room", value: "  " }] }, seen: ["dee"] };
    expect((await told(chat, [blank], true))[0]).toContain("by hand, nothing landed: dee's write was refused");

    // a field that takes less than the story types sends what it took, which is not the story's write
    const short = chatWith((html) => html.replace('<input name="text"', '<input name="text" maxlength="3"'));
    expect(await told(short, [hello], true)).toEqual([['by hand, ada could not add /messages/- on room: the page sent add /messages/- "hel" on room']]);
  }, 60000);

  test("a way that cannot be pressed is left for another, and with none left it is said where the way stopped", async () => {
    const { example: ticker, stories: told } = await load("ticker");
    const watches = named(told, "Ann watches Charlie Metals, and only her board grows");
    const plus = write("desk", "replace", "/page", "board?new");
    const flat: Example = { ...ticker, render: (sessionId) => ticker.render(sessionId).replaceAll(plus, ` style="display: block; width: 0; height: 0; padding: 0; border: 0; overflow: hidden"${plus}`) };
    expect((await run(flat, { ...told, stories: watches })).outcomes[0]!.failures).toEqual([]);
    expect((await run(flat, { ...told, stories: watches }, undefined, { byHand: true })).outcomes[0]!.failures).toEqual(['by hand, ann could not get to "board?new": the way to "board?new" from "board": the control for it is of no size']);
  }, 60000);

  test("a story may say its gesture: leave's drags on its calendar are done by hand whenever they are told, and must send the story's write", async () => {
    const { example: leave, stories: told } = await load("leave");
    const across = named(told, "Ann drags across two days in Bo's week, and sees the clash before she asks")[0]!; // leave's other drags, a request's bar to a day, are `stories:all`'s

    // let go a day too far, and the page sends another draft; from nothing, nothing is dragged
    const tuesday = '.week[data-month="2026-10"][data-monday="2026-10-05"] > .date:nth-child(2)';
    const thursday = '.week[data-month="2026-10"][data-monday="2026-10-05"] > .date:nth-child(4)';
    const dragged = (from: string, to: string) => ({ ...across, gesture: { drag: [from, to] } }) as Story;
    const [astray, nowhere, offscreen] = [dragged(tuesday, thursday), dragged(".nowhere", thursday), dragged(tuesday, '.week[data-month="2026-12"][data-monday="2026-12-28"] > .date:nth-child(4)')];
    const report = await run(leave, { ...among(told, "ann"), stories: [across, astray, nowhere, offscreen] }); // without `byHand`: a story that says its gesture asks for a browser
    expect(report.outcomes.map((o) => o.failures)).toEqual([
      [],
      ['by hand, ann could not replace /draft on session: the page sent replace /draft {"starts":"2026-10-06","ends":"2026-10-08"} on session'],
      ["by hand, ann could not replace /draft on session: what it is dragged from is not on the page"],
      ["by hand, ann could not replace /draft on session: where it is dragged to is off the screen"],
    ]);
    expect(report.byHand).toMatchObject({ stories: 4, applets: 0 });
  }, 60000);

  test("a gesture's write is the one its events sent: a calendar that hears no pointer and writes by itself, late, fails; so does one that writes twice, or unasked before anything is pressed", async () => {
    const { stories: told } = await load("leave");
    const across = named(told, "Ann drags across two days in Bo's week, and sees the clash before she asks");
    const failures = async (wrong: string) => (await run(await leaveWith(wrong), { ...among(told, "ann"), stories: across })).outcomes[0]!.failures;
    expect(await failures("")).toEqual([]);
    for (const late of ["late-200", "late-1500"]) {
      const failed = await failures(late);
      expect(failed).toHaveLength(1);
      expect(failed[0]).toStartWith("by hand, ann could not");
    }
    expect(await failures("twice")).toEqual([`by hand, ann's page sent replace /draft {"starts":"2026-10-06","ends":"2026-10-07"} on session by itself, unasked`]);
    expect(await failures("unasked")).toEqual([`by hand, ann's page sent replace /draft {"starts":"2026-10-13","ends":"2026-10-14"} on session by itself, unasked`]);
  }, 60000);

  test("a gesture may be a press, a tap where it says; it is a press or a drag, on a story that writes from a page", async () => {
    const logout = { doc: "session", ops: [{ op: "remove" as const, path: "/name" }] };
    const going: Story = { name: "Ada logs out", as: "ada", does: logout, gesture: { press: 'button[aria-label="Log out"]' }, seen: ["ada", "bob"] };
    const undo: Story = { ...going, gesture: { press: 'button[aria-label="Undo"]' } };
    const nothing: Story = { ...going, gesture: { press: ".nowhere" } };
    const report = await run(chat, { ...chatStories, stories: [going, undo, nothing] });
    expect(report.outcomes.map((o) => o.failures)).toEqual([
      [],
      ["by hand, ada could not remove /name on session: the page sent remove /latest on ledger"],
      ["by hand, ada could not remove /name on session: the control for it is not on the page"],
    ]);
    expect(report.byHand).toMatchObject({ stories: 3, presses: 3 });

    const shaped = (gesture: unknown, more: object = {}) => ({ name: "Ada logs out, somehow", as: "ada", does: logout, seen: ["ada", "bob"], gesture, ...more }) as Story; // as a story file that is not type-checked says it
    const report2 = await run(chat, {
      ...chatStories,
      stories: [shaped({ drag: 'button[aria-label="Log out"]' }), shaped({ press: 1 }), shaped({ press: "a", drag: ["a", "b"] }), shaped({ press: "a" }, { offPage: true }), { name: "Eve cannot log Ada out", as: "eve", cannot: logout, gesture: { press: "a" } } as unknown as Story],
    });
    expect(report2.outcomes.map((o) => o.failures)).toEqual([
      ['a gesture is { press: selector } or { drag: [from, to] }: this one is {"drag":"button[aria-label=\\"Log out\\"]"}'],
      ['a gesture is { press: selector } or { drag: [from, to] }: this one is {"press":1}'],
      ['a gesture is { press: selector } or { drag: [from, to] }: this one is {"press":"a","drag":["a","b"]}'],
      ["a story from no page (offPage) has no gesture"],
      ["a cannot story takes no gesture"],
    ]);
    expect(report2.byHand).toBeUndefined(); // not told, and not done by hand
  }, 60000);

  test("a refusal whose write a control on the page sends is tried by hand: leave's days hidden by a stylesheet fail the story that types one", async () => {
    const { example: leave, stories: told } = await load("leave");
    const hidden: Example = { ...leave, render: (sessionId) => leave.render(sessionId).replaceAll('<form class="days"', '<form class="days" style="display: none"') };
    // Bo's weekend is asked for by the Ask button, which is to be seen: pressed, and refused, it passes
    const refusals = named(told, "Ann sets her draft's last day before its first, and is told so", "Bo asks for a draft that is only a weekend, and is told it has no working days");
    const report = await run(hidden, { ...among(told, "ann", "bo"), stories: refusals }, undefined, { byHand: true });
    expect(report.outcomes.map((o) => [o.name, o.failures])).toEqual([
      ["Ann sets her draft's last day before its first, and is told so", ["by hand, ann could not replace /draft/ends on session: the control for it is not to be seen"]],
      ["Bo asks for a draft that is only a weekend, and is told it has no working days", []],
    ]);
    expect(report.byHand).toMatchObject({ stories: 2 });

    // a symbol the Watch modal's select does not offer is one nobody can send from the page: its refusal is the wire's
    const { example: ticker, stories: watching } = await load("ticker");
    const unquoted = named(watching, "Ann cannot watch a symbol the market does not quote, and is told so");
    expect((await run(ticker, { ...watching, stories: unquoted }, undefined, { byHand: true })).outcomes[0]!.failures).toEqual([]);
    // and a refusal that lands, sent from the page, fails when it is told and by hand
    const hello: Story = { name: "Ada cannot say hello", as: "ada", cannot: say };
    expect((await run(chat, { ...chatStories, stories: [hello] }, undefined, { byHand: true })).outcomes[0]!.failures).toContain("by hand, ada's write landed, and should have been refused");
  }, 60000);

  test("a record the page sent with a key the story does not name is not its write, unless the key is blank: a calendar's half day fails", async () => {
    const { stories: told } = await load("leave");
    const across = named(told, "Ann drags across two days in Bo's week, and sees the clash before she asks");
    expect((await run(await leaveWith("half"), { ...among(told, "ann"), stories: across })).outcomes[0]!.failures).toEqual([
      'by hand, ann could not replace /draft on session: the page sent replace /draft {"starts":"2026-10-06","ends":"2026-10-07","half":true} on session',
    ]);
  }, 60000);

  test("what the page sent is the story's write: a value with its type, as the wire sends it, a record by its keys, a document by either name", () => {
    const add = (value: unknown) => ({ doc: "board", ops: [{ op: "add" as const, path: "/households/-", value }] });
    expect(sameWrite(add({ email: "a@b", plus_ones: 2 }), add({ email: "a@b", plus_ones: 2 }))).toBe(true);
    expect(sameWrite(add({ email: "a@b", plus_ones: "2" }), add({ email: "a@b", plus_ones: 2 }))).toBe(false); // a number field sends a number
    const paid = (value: unknown) => ({ doc: "till", ops: [{ op: "replace" as const, path: "/bills/1/paid", value }] });
    expect(sameWrite(paid(true), paid(true))).toBe(true);
    expect(sameWrite(paid("true"), paid(true))).toBe(false); // Mo's button sends true, not "true"
    expect(sameWrite(paid(null), paid(undefined))).toBe(false);
    expect(sameWrite(add({ email: "a@b", extra: null, paid: false }), add({ email: "a@b" }))).toBe(false); // a box unticked is no blank: it says no
    expect(sameWrite(add({ email: "a@b" }), add({ email: "a@b", plus_ones: 2 }))).toBe(false);
    expect(sameWrite(add({ email: "a@b", plus_ones: "2", half: true }), add({ email: "a@b", plus_ones: 2 }))).toBe(false); // a key the story does not name
    expect(sameWrite(add({ email: "a@b", names: "" }), add({ email: "a@b" }))).toBe(true); // but a field left blank (the wedding's invite)
    expect(sameWrite({ doc: "room:general", ops: say.ops }, say)).toBe(true);
    expect(sameWrite({ doc: "room:kitchen", ops: say.ops }, { doc: "room:general", ops: say.ops })).toBe(false);
    expect(sameWrite({ doc: "room", ops: [{ op: "add", path: "/messages/-", value: "hi" }] }, say)).toBe(false);
    expect(sameWrite({ doc: "session", ops: [{ op: "remove", path: "/name" }] }, { doc: "session", ops: [{ op: "remove", path: "/name" }, { op: "remove", path: "/room" }] })).toBe(false);
    const words = { doc: "household", ops: [{ op: "replace" as const, path: "/message", value: "Hi" }] };
    expect(sameWrite({ doc: "household", ops: [{ op: "test", path: "/message", value: "" }, ...words.ops] }, words)).toBe(true); // a field's test is the page's own
  });
});
