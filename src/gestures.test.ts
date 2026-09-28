import { describe, expect, test } from "bun:test";
import { example as chat } from "../examples/chat";
import { stories as chatStories } from "../examples/chat/stories";
import type { Example } from "./example";
import { sameWrite } from "./gestures";
import { run } from "./harness";
import { write } from "./html";
import type { Story } from "./stories";

// The stories by hand: each told as the harness tells it, then done in a browser the size of a
// phone. A control the page draws can be there and still not be pressed; the harness without a
// browser cannot tell, and these say so by story name.

const say = { doc: "room", ops: [{ op: "add" as const, path: "/messages/-", value: "hello" }] };
const hello: Story = { name: "Ada says hello", as: "ada", does: say, seen: ["ada", "bob"], untold: ["cy", "dee", "eve"] };
/** Chat, its page drawn otherwise: what `change` makes of the message form. */
const chatWith = (change: (html: string) => string): Example => ({ ...chat, render: (sessionId) => change(chat.render(sessionId)) });
const MESSAGE_FORM = /<form class="say"[^>]*data-write='\{"doc":"room"[^]*?<\/form>/;
const told = async (example: Example, stories: Story[]) => (await run(example, { ...chatStories, stories })).outcomes.map((o) => o.failures);
const byHand = async (example: Example, stories: Story[]) => (await run(example, { ...chatStories, stories }, undefined, { gestures: true })).outcomes.map((o) => o.failures);

describe("the stories by hand", () => {
  test("a story a person can do passes by hand too: a form typed into and sent, a button pressed, a way pressed to where it is done", async () => {
    const report = await run(chat, chatStories, undefined, { gestures: true });
    expect(report.outcomes.flatMap((o) => o.failures)).toEqual([]);
    expect(report.byHand).toMatchObject({ stories: 7, presses: 7, applets: 0 });

    const { example: ticker } = await import("../examples/ticker/index");
    const { stories: told } = await import("../examples/ticker/stories");
    const reading = (value: string) => ({ doc: "desk", ops: [{ op: "replace" as const, path: "/reading/board", value }] });
    const ann: Story[] = [
      ...told.stories.filter((s) => s.name.startsWith("Ann watches Charlie Metals, and only") || s.name.startsWith("Ann sets her clock")), // a modal's select; the city picker, an applet's
      { name: "Ann, reading her board as a list, reads it as sparklines again", as: "ann", from: "board @ reading.board=list", does: reading("sparkline"), seen: ["ann"] }, // after " @ ", pressed there
    ];
    const tickerReport = await run(ticker, { ...told, stories: ann }, undefined, { gestures: true });
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

  test("a press the client never hears sends nothing, and one that never holds still is never pressed", async () => {
    const logout = { doc: "session", ops: [{ op: "remove" as const, path: "/name" }] };
    const going: Story = { name: "Ada logs out", as: "ada", does: logout, seen: ["ada", "bob"] };
    const off = write("session", "remove", "/name");
    const unheard = chatWith((html) => html.replace(off, ` onclick="event.stopPropagation()"${off}`));
    expect(await told(unheard, [going])).toEqual([[]]);
    expect(await byHand(unheard, [going])).toEqual([["by hand, ada could not remove /name on session: the page sent nothing when it was pressed"]]);

    const restless = chatWith((html) => `<style>@keyframes restless { from { translate: 0 } to { translate: 40px } }</style>${html.replace(off, ` style="animation: restless 0.2s linear infinite"${off}`)}`);
    expect(await byHand(restless, [going])).toEqual([["by hand, ada could not remove /name on session: the control for it is never still"]]);
  }, 60000);

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
    expect((await run(flat, { ...told, stories: watches }, undefined, { gestures: true })).outcomes[0]!.failures).toEqual(['by hand, ann could not get to "board?new": the way to "board?new" from "board": the control for it is of no size']);
  }, 60000);

  test("what the page sent is the story's write: a value as the wire sends a button's, a record by its keys, a document by either name", () => {
    const add = (value: unknown) => ({ doc: "board", ops: [{ op: "add" as const, path: "/households/-", value }] });
    expect(sameWrite(add({ email: "a@b", plus_ones: "2" }), add({ email: "a@b", plus_ones: 2 }))).toBe(true);
    expect(sameWrite(add({ email: "a@b" }), add({ email: "a@b", plus_ones: 2 }))).toBe(false);
    expect(sameWrite({ doc: "room:general", ops: say.ops }, say)).toBe(true);
    expect(sameWrite({ doc: "room:kitchen", ops: say.ops }, { doc: "room:general", ops: say.ops })).toBe(false);
    expect(sameWrite({ doc: "room", ops: [{ op: "add", path: "/messages/-", value: "hi" }] }, say)).toBe(false);
    expect(sameWrite({ doc: "session", ops: [{ op: "remove", path: "/name" }] }, { doc: "session", ops: [{ op: "remove", path: "/name" }, { op: "remove", path: "/room" }] })).toBe(false);
  });
});
