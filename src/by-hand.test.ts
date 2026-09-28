import { describe, expect, test } from "bun:test";
import { example as chat } from "../examples/chat";
import { stories as chatStories } from "../examples/chat/stories";
import type { Example } from "./example";
import { sameWrite } from "./by-hand";
import { run, stillOpen } from "./harness";
import { createServer } from "./server";
import { write } from "./html";
import type { Story } from "./stories";
import wrongPage from "./by-hand.test.html";

// The stories by hand: each told as the harness tells it, then done in a browser the size of a
// phone. A control the page draws can be there and still not be pressed; the harness without a
// browser cannot tell, and these say so by story name.

const say = { doc: "room", ops: [{ op: "add" as const, path: "/messages/-", value: "hello" }] };
const hello: Story = { name: "Ada says hello", as: "ada", does: say, seen: ["ada", "bob"], untold: ["cy", "dee", "eve"] };
/** Chat, its page drawn otherwise: what `change` makes of the message form. */
const chatWith = (change: (html: string) => string): Example => ({ ...chat, render: (sessionId) => change(chat.render(sessionId)) });
const MESSAGE_FORM = /<form class="say"[^>]*data-write='\{"doc":"room"[^]*?<\/form>/;
const told = async (example: Example, stories: Story[]) => (await run(example, { ...chatStories, stories })).outcomes.map((o) => o.failures);
/** leave, its calendar made wrong as `wrong` says (src/by-hand.test.entry.ts); "" is leave's own. */
const leaveWith = async (wrong: string): Promise<Example> => {
  const { example: leave } = await import("../examples/leave/index");
  return { ...leave, index: wrongPage, render: (sessionId) => leave.render(sessionId).replace('data-applet="calendar"', `data-applet="calendar" data-wrong="${wrong}"`) };
};
const byHand = async (example: Example, stories: Story[]) => (await run(example, { ...chatStories, stories }, undefined, { byHand: true })).outcomes.map((o) => o.failures);

describe("the stories by hand", () => {
  test("a story a person can do passes by hand too: a form typed into and sent, a button pressed, a way pressed to where it is done", async () => {
    const report = await run(chat, chatStories, undefined, { byHand: true });
    expect(report.outcomes.flatMap((o) => o.failures)).toEqual([]);
    expect(report.byHand).toMatchObject({ stories: 8, presses: 8, applets: 0 });

    const { example: ticker } = await import("../examples/ticker/index");
    const { stories: told } = await import("../examples/ticker/stories");
    const reading = (value: string) => ({ doc: "desk", ops: [{ op: "replace" as const, path: "/reading/board", value }] });
    const ann: Story[] = [
      ...told.stories.filter((s) => s.name.startsWith("Ann watches Charlie Metals, and only") || s.name.startsWith("Ann sets her clock")), // a modal's select; the city picker, an applet's
      { name: "Ann, reading her board as a list, reads it as sparklines again", as: "ann", from: "board @ reading.board=list", does: reading("sparkline"), seen: ["ann"] }, // after " @ ", pressed there
    ];
    const tickerReport = await run(ticker, { ...told, stories: ann }, undefined, { byHand: true });
    expect(tickerReport.outcomes.map((o) => o.failures)).toEqual([[], [], []]);
    expect(tickerReport.byHand!.applets).toBe(1);
  }, 60000);

  test("a control that is on the page and cannot be pressed passes without a browser, and fails by hand, by name", async () => {
    const covered = chatWith((html) => html.replace(MESSAGE_FORM, (form) => `<div style="position: relative">${form}<div id="veil" style="position: absolute; inset: 0"></div></div>`));
    expect(await told(covered, [hello])).toEqual([[]]);
    expect(await byHand(covered, [hello])).toEqual([["by hand, ada could not add /messages/- on room: the control for it is covered by div#veil"]]);

    const unseen = chatWith((html) => html.replace(MESSAGE_FORM, (form) => `<div style="display: none">${form}</div>`));
    expect(await told(unseen, [hello])).toEqual([[]]);
    expect(await byHand(unseen, [hello])).toEqual([["by hand, ada could not add /messages/- on room: the control for it is not to be seen"]]);

    // a field that writes, in no form that sends it: the client never does
    const loose = chatWith((html) => html.replace(MESSAGE_FORM, `<input name="text"${write("room", "add", "/messages/-")}>`));
    expect(await told(loose, [hello])).toEqual([[]]);
    expect(await byHand(loose, [hello])).toEqual([["by hand, ada could not add /messages/- on room: its field is in no form that sends it"]]);
  }, 60000);

  test("a press the client never hears sends nothing; a button in a disabled fieldset's first legend is pressed", async () => {
    const logout = { doc: "session", ops: [{ op: "remove" as const, path: "/name" }] };
    const going: Story = { name: "Ada logs out", as: "ada", does: logout, seen: ["ada", "bob"] };
    const off = write("session", "remove", "/name");
    const unheard = chatWith((html) => html.replace(off, ` onclick="event.stopPropagation()"${off}`));
    expect(await told(unheard, [going])).toEqual([[]]);
    expect(await byHand(unheard, [going])).toEqual([["by hand, ada could not remove /name on session: the page sent nothing when it was pressed"]]);

    // a button in a disabled fieldset's first legend is not disabled, as the browser has it (`:disabled`)
    const legend = chatWith((html) => html.replace(/<button[^>]*aria-label="Log out"[^]*?<\/button>/, (b) => `<fieldset disabled><legend>${b}</legend></fieldset>`));
    expect(await byHand(legend, [going])).toEqual([[]]);
  }, 60000);

  test("a tab that does not close is said, not waited on in silence: the server still holding its socket", async () => {
    const server = createServer(chat, 0);
    const sessionId = crypto.randomUUID();
    const url = new URL("/ws", server.url);
    url.protocol = "ws:";
    const tab = () =>
      new Promise<WebSocket>((resolve) => {
        // @ts-expect-error Bun's runtime-only `headers` option on WebSocket
        const ws: WebSocket = new WebSocket(url, { headers: { Cookie: `session_id=${sessionId}` } });
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
    expect(await byHand(folded, [hello])).toEqual([[]]);

    const blank: Story = { name: "Dee enters a room with no name", as: "dee", does: { doc: "session", ops: [{ op: "replace", path: "/room", value: "  " }] }, seen: ["dee"] };
    expect((await byHand(chat, [blank]))[0]).toContain("by hand, nothing landed: dee's write was refused");

    // a field that takes less than the story types sends what it took, which is not the story's write
    const short = chatWith((html) => html.replace('<input name="text"', '<input name="text" maxlength="3"'));
    expect(await byHand(short, [hello])).toEqual([['by hand, ada could not add /messages/- on room: the page sent add /messages/- "hel" on room']]);
  }, 60000);

  test("a way that cannot be pressed is left for another, and with none left it is said where the way stopped", async () => {
    const { example: ticker } = await import("../examples/ticker/index");
    const { stories: told } = await import("../examples/ticker/stories");
    const watches = told.stories.filter((s) => s.name.startsWith("Ann watches Charlie Metals, and only"));
    const plus = write("desk", "replace", "/page", "board?new");
    const flat: Example = { ...ticker, render: (sessionId) => ticker.render(sessionId).replaceAll(plus, ` style="display: block; width: 0; height: 0; padding: 0; border: 0; overflow: hidden"${plus}`) };
    expect((await run(flat, { ...told, stories: watches })).outcomes[0]!.failures).toEqual([]);
    expect((await run(flat, { ...told, stories: watches }, undefined, { byHand: true })).outcomes[0]!.failures).toEqual(['by hand, ann could not get to "board?new": the way to "board?new" from "board": the control for it is of no size']);
  }, 60000);

  test("a story may say its gesture: leave's drags on its calendar are done by hand whenever they are told, and must send the story's write", async () => {
    const { example: leave } = await import("../examples/leave/index");
    const { stories: told } = await import("../examples/leave/stories");
    const drags = told.stories.filter((s) => s.gesture !== undefined);
    expect(drags.map((s) => s.name)).toEqual([
      "Ann drags across two days in Bo's week, and sees the clash before she asks",
      "Ann drags her day in November to the Friday after, and Mo and Bo see it move",
      "Mo moves the week he approved for himself, and the team sees it move",
    ]);
    const report = await run(leave, { ...told, stories: drags }); // without `byHand`: a story that says its gesture asks for a browser
    expect(report.outcomes.map((o) => o.failures)).toEqual([[], [], []]);
    expect(report.byHand).toMatchObject({ stories: 3, applets: 0 });

    // let go a day too far, and the page sends another draft; from nothing, nothing is dragged
    const tuesday = '.week[data-month="2026-10"][data-monday="2026-10-05"] > .date:nth-child(2)';
    const thursday = '.week[data-month="2026-10"][data-monday="2026-10-05"] > .date:nth-child(4)';
    const dragged = (from: string, to: string) => ({ ...drags[0]!, gesture: { drag: [from, to] } }) as Story;
    const [astray, nowhere, offscreen] = [dragged(tuesday, thursday), dragged(".nowhere", thursday), dragged(tuesday, '.week[data-month="2026-12"][data-monday="2026-12-28"] > .date:nth-child(4)')];
    expect((await run(leave, { ...told, stories: [astray, nowhere, offscreen] })).outcomes.map((o) => o.failures)).toEqual([
      ['by hand, ann could not replace /draft on team: the page sent replace /draft {"starts":"2026-10-06","ends":"2026-10-08"} on team'],
      ["by hand, ann could not replace /draft on team: what it is dragged from is not on the page"],
      ["by hand, ann could not replace /draft on team: where it is dragged to is off the screen"],
    ]);
  }, 60000);

  test("a gesture's write is the one its events sent: a calendar that hears no pointer and writes by itself, late, fails; so does one that writes twice, or unasked before anything is pressed", async () => {
    const { stories: told } = await import("../examples/leave/stories");
    const across = told.stories.filter((s) => s.name.startsWith("Ann drags across"));
    const failures = async (wrong: string) => (await run(await leaveWith(wrong), { ...told, stories: across })).outcomes[0]!.failures;
    expect(await failures("")).toEqual([]);
    for (const late of ["late-200", "late-1500"]) {
      const failed = await failures(late);
      expect(failed).toHaveLength(1);
      expect(failed[0]).toStartWith("by hand, ann could not");
    }
    expect(await failures("twice")).toEqual([`by hand, ann's page sent replace /draft {"starts":"2026-10-06","ends":"2026-10-07"} on team by itself, unasked`]);
    expect(await failures("unasked")).toEqual([`by hand, ann's page sent replace /draft {"starts":"2026-10-13","ends":"2026-10-14"} on team by itself, unasked`]);
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
    const { example: leave } = await import("../examples/leave/index");
    const { stories: told } = await import("../examples/leave/stories");
    const hidden: Example = { ...leave, render: (sessionId) => leave.render(sessionId).replaceAll('<form class="days"', '<form class="days" style="display: none"') };
    const report = await run(hidden, told, undefined, { byHand: true });
    expect(report.outcomes.filter((o) => o.failures.length > 0).map((o) => [o.name, o.failures])).toEqual([
      ["Ann sets her draft's last day before its first, and is told so", ["by hand, ann could not replace /draft/ends on team: the control for it is not to be seen"]],
    ]);

    // a symbol the Watch modal's select does not offer is one nobody can send from the page: its refusal is the wire's
    const { example: ticker } = await import("../examples/ticker/index");
    const { stories: watching } = await import("../examples/ticker/stories");
    const unquoted = watching.stories.filter((s) => s.name.startsWith("Ann cannot watch a symbol"));
    expect((await run(ticker, { ...watching, stories: unquoted }, undefined, { byHand: true })).outcomes[0]!.failures).toEqual([]);
    // and a refusal that lands, sent from the page, fails when it is told and by hand
    const hello: Story = { name: "Ada cannot say hello", as: "ada", cannot: say };
    expect((await run(chat, { ...chatStories, stories: [hello] }, undefined, { byHand: true })).outcomes[0]!.failures).toContain("by hand, ada's write landed, and should have been refused");
  }, 60000);

  test("a record the page sent with a key the story does not name is not its write, unless the key is blank: a calendar's half day fails", async () => {
    const { stories: told } = await import("../examples/leave/stories");
    const across = told.stories.filter((s) => s.name.startsWith("Ann drags across"));
    expect((await run(await leaveWith("half"), { ...told, stories: across })).outcomes[0]!.failures).toEqual([
      'by hand, ann could not replace /draft on team: the page sent replace /draft {"starts":"2026-10-06","ends":"2026-10-07","half":true} on team',
    ]);
  }, 60000);

  test("what the page sent is the story's write: a value as the wire sends a button's, a record by its keys, a document by either name", () => {
    const add = (value: unknown) => ({ doc: "board", ops: [{ op: "add" as const, path: "/households/-", value }] });
    expect(sameWrite(add({ email: "a@b", plus_ones: "2" }), add({ email: "a@b", plus_ones: 2 }))).toBe(true);
    expect(sameWrite(add({ email: "a@b" }), add({ email: "a@b", plus_ones: 2 }))).toBe(false);
    expect(sameWrite(add({ email: "a@b", plus_ones: "2", half: true }), add({ email: "a@b", plus_ones: 2 }))).toBe(false); // a key the story does not name
    expect(sameWrite(add({ email: "a@b", names: "" }), add({ email: "a@b" }))).toBe(true); // but a field left blank (the wedding's invite)
    expect(sameWrite({ doc: "room:general", ops: say.ops }, say)).toBe(true);
    expect(sameWrite({ doc: "room:kitchen", ops: say.ops }, { doc: "room:general", ops: say.ops })).toBe(false);
    expect(sameWrite({ doc: "room", ops: [{ op: "add", path: "/messages/-", value: "hi" }] }, say)).toBe(false);
    expect(sameWrite({ doc: "session", ops: [{ op: "remove", path: "/name" }] }, { doc: "session", ops: [{ op: "remove", path: "/name" }, { op: "remove", path: "/room" }] })).toBe(false);
  });
});
