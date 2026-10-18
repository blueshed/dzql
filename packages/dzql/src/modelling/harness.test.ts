import { describe, expect, setSystemTime, spyOn, test } from "bun:test";
import type { PatchOp } from "../rendering/json-patch";
import { createLocal } from "@blueshed/delta/local";
import { registerMemory } from "@blueshed/delta/kinds";
import { defineDoc, registerDocs } from "@blueshed/delta/sqlite";
import { example } from "../../examples/chat";
import { db, schema } from "../../examples/chat/delta";
import { stories } from "../../examples/chat/stories";
import type { Resource } from "../rendering/resources/resource";
import { read } from "../rendering/documents";
import { appletProps, appletWrites, write } from "../rendering/html";
import type { Example } from "../rendering/example";
import { size } from "./costs";
import { anyOne, controlsOn, goesTo, hear, holding, holds, largest, MOST_PROPS, offers, pathsIn, placeOf, print, propsCost, retake, run, takersOn, taking, unheld, unversioned, valueAt, writesOn, type Outcome, type Report, type Trace, type Wire } from "./harness";
import { comparable, diff, drawParts, part, splitTag } from "../rendering/parts";
import { post, story, untold, type Stories, type Story } from "./stories";
import { serverWrite } from "../rendering/documents";
import { refuse, tell, toldAt } from "../rendering/refusal";

/** An example and its stories, by its folder under examples/. */
async function load(name: string): Promise<{ example: Example; stories: Stories }> {
  const { example } = await import(`../../examples/${name}/index`);
  const { stories } = await import(`../../examples/${name}/stories`);
  return { example, stories };
}
/** `stories` told among only the members `names`: each member walks every place it can get to, so a test casts no more than its stories need. */
const among = (stories: Stories, ...names: string[]): Stories => ({ ...stories, cast: Object.fromEntries(names.map((name) => [name, stories.cast[name]!])) });
/** Chat's write that says `text` in a room. */
const say = (text: string) => ({ doc: "room", ops: [{ op: "add" as const, path: "/messages/-", value: text }] });
/** Chat's write that puts a session in `room`. */
const enter = (room: string) => ({ doc: "session", ops: [{ op: "replace" as const, path: "/room", value: room }] });
/** The ticker's write that puts a desk on `page`. */
const desk = (page: string) => ({ doc: "desk", ops: [{ op: "replace" as const, path: "/page", value: page }] });
/** What the types refuse, as a story file that is not type-checked says it. */
const misshapen = (story: object) => story as Story;
/** Every failure of `told`, told among `of`'s cast (chat's, unless it says). */
const failuresOf = async (broken: Example, told: Story[], of: Stories = stories): Promise<string[]> => (await run(broken, { ...of, stories: told })).outcomes.flatMap((o) => o.failures);

// The harness against chat's own stories: one outcome per story, named as the story is, and the
// cast's setup shared by all. What each story finds is the example's business (a failing story is
// a finding, not a broken harness); this checks the harness reports honestly. Every one of chat's
// stories, by name, is run in src/by-hand.test.ts, by hand too.
describe("stories harness", () => {
  describe("a story's cost on the wire", () => {
    const pick = (start: string) => stories.stories.find((s) => s.name.startsWith(start))!;
    const [hello, take, close] = [{ ...pick("Ada says hello"), budget: undefined }, pick("Nobody can take"), pick("Bob closes his tab")]; // hello's own budget aside: each test says its own
    /** What a budget says of each page handed more than it, on each step of a story: its write (or refusal, or tab closing), then its undo, then its redo. */
    const failing = (o: Outcome, whose: string, budget: number, step = "write") =>
      (["handed", "undo", "redo"] as const).flatMap((phase) =>
        (o.wire![phase] ?? []).filter((h) => h.bytes > budget).map((h) => `${h.member}'s page was handed ${h.bytes.toLocaleString("en")} bytes on the ${phase === "handed" ? step : phase}, more than the ${whose} budget of ${budget.toLocaleString("en")}: the most, ${h.most.part}, ${size(h.most.bytes)}`),
      );

    test("an observer is told each write as the wire carried it: who heard what, and what the ledger took; and each member's page is handed what the story's own step sent it, as the page takes it and as it crossed the wire, beside the write's own size, with its biggest part named", async () => {
      const traces: Trace[] = [];
      const report = await run(example, { cast: stories.cast, stories: [hello, take, close] }, (t) => traces.push(t));
      expect(report.failed).toBe(0);
      expect(traces.map((t) => `${t.story.slice(0, 14)}|${t.phase}|${t.as}`)).toEqual([
        "Ada says hello|does|ada",
        "Ada says hello|undo|ada",
        "Ada says hello|redo|ada",
        "Nobody can tak|cannot|ada",
        "Bob closes his|closesTab|bob",
      ]);
      const heard = (t: Trace, who: string) => t.heard.find((h) => h.member === who)?.messages;
      const [does, , , refused, closed] = traces as [Trace, Trace, Trace, Trace, Trace];
      // the ledger holds the write as the room shaped it, a message, and its inverse takes it away
      const [entry] = does.ledger;
      expect(entry!.ops[0]).toMatchObject({ op: "add", value: { name: "Ada", text: "hello" } });
      expect(entry!.inverse[0]).toMatchObject({ op: "remove", path: entry!.ops[0]!.path });
      expect(heard(does, "bob")!.length).toBeGreaterThan(0); // in the room: told
      expect(heard(does, "cy")).toEqual([]); // in the kitchen: nothing
      expect(refused.ledger).toEqual([]);
      expect(heard(refused, "bob")).toEqual([]);
      expect(closed.write).toBeUndefined();
      expect(heard(closed, "bob")).toBeUndefined(); // gone: only who is still looking is heard
      expect(heard(closed, "ada")!.length).toBeGreaterThan(0);
      // what each page read as the step was taken: the documents in front of them
      const holds = (t: Trace, who: string) => t.holds.find((h) => h.member === who)?.docs;
      expect(holds(does, "bob")).toEqual(expect.arrayContaining(["room:general", "here:general"]));
      expect(holds(does, "cy")).toContain("room:kitchen");
      expect(holds(does, "cy")).not.toContain("room:general");
      expect(holds(closed, "bob")).toBeUndefined(); // closing: only who is still looking
      expect(holds(closed, "ada")).toContain("room:general");
      // what each step handed each page
      const [said, refusal, closing] = report.outcomes.map((o) => o.wire!) as [Wire, Wire, Wire];
      expect(said.write).toBe(Buffer.byteLength(JSON.stringify(hello.does)));
      expect(said.handed.map((h) => h.member)).toEqual(["ada", "bob"]); // cy, in the kitchen, and dee and eve, in no room, are handed nothing
      expect(said.handed.map((h) => h.most.part)).toEqual(["messages", "messages"]); // the new message, beside the last: a part of the messages
      expect([said.undo, said.redo].map((phase) => phase!.map((h) => h.member))).toEqual([["ada", "bob"], ["ada", "bob"]]); // an undo and a redo are writes too, to the same pages
      expect(refusal.write).toBe(Buffer.byteLength(JSON.stringify(take.cannot)));
      expect(refusal.handed.map((h) => h.member)).toEqual(["ada"]); // told no
      expect(refusal.handed[0]!.most.part).toBe("refused"); // and nothing more: the page she holds is the page still
      expect(refusal.handed[0]!.bytes).toBeLessThan(40); // its write's id, no page
      expect(closing.write).toBeUndefined(); // a tab closing writes nothing
      expect(closing.handed.map((h) => h.member)).toEqual(["ada"]);
      expect([refusal.undo, refusal.redo, closing.undo, closing.redo]).toEqual([undefined, undefined, undefined, undefined]); // nothing to undo
      for (const h of [...said.handed, ...said.undo!, ...said.redo!, ...refusal.handed, ...closing.handed]) {
        expect(h.sent).toBeGreaterThan(0);
        expect(h.most.bytes).toBeGreaterThan(0);
        expect(h.most.bytes).toBeLessThanOrEqual(h.bytes);
      }
    }, 30000);

    test("a budget fails a story that hands any one page more bytes than it, on its write, its undo or its redo, by name and with its biggest part: the story's own budget, or else the example's", async () => {
      const report = await run(example, {
        cast: stories.cast,
        budget: 64, // the example's: less than a message
        stories: [hello, { ...hello, name: "Ada says hello, within its own budget", budget: 100_000 }, { ...close, budget: 1 }],
      });
      const [over, within, closed] = report.outcomes as [Outcome, Outcome, Outcome];
      expect(over.failures).toEqual(failing(over, "example's", 64));
      expect(over.failures.map((f) => f.replace(/ was handed [\d,]+ bytes/, "").split(",")[0])).toEqual(["write", "write", "undo", "undo", "redo", "redo"].map((step, i) => `${i % 2 ? "bob" : "ada"}'s page on the ${step}`));
      expect(within.failures).toEqual([]);
      expect(closed.failures).toEqual(failing(closed, "story's", 1, "tab closing"));
      expect(closed.failures).toHaveLength(1);
    }, 30000);

    test("an undo is held to the budget as the write is: Dee's attic, taken back, hands her more than it did", async () => {
      const report = await run(example, { cast: stories.cast, budget: 4096, stories: [pick("Dee names a room nobody has made")] });
      const [attic] = report.outcomes as [Outcome];
      expect(attic.wire!.handed.every((h) => h.bytes <= 4096)).toBe(true); // the write is within it
      expect(attic.failures).toEqual(failing(attic, "example's", 4096));
      expect(attic.failures).toHaveLength(1);
      expect(attic.failures[0]).toStartWith("dee's page was handed 4,3");
      expect(attic.failures[0]).toContain(" bytes on the undo, more than the example's budget of 4,096: the most, ");
    }, 30000);

    test("a budget is a whole number of bytes: any other, a story's or the example's, is said, and the story is not run", async () => {
      const report = await run(example, { cast: stories.cast, stories: [{ ...hello, budget: "2 KB" as unknown as number }, { ...take, budget: 0 }] });
      expect(report.outcomes.map((o) => o.failures)).toEqual([['a budget is a whole number of bytes: this one is "2 KB"'], ["a budget is a whole number of bytes: this one is 0"]]);
      expect(report.outcomes.map((o) => o.wire)).toEqual([undefined, undefined]);
      const byExample = await run(example, { cast: stories.cast, budget: 1.5, stories: [hello, { ...close, budget: 4096 }] });
      expect(byExample.outcomes.map((o) => o.failures)).toEqual([["the example's budget is a whole number of bytes: this one is 1.5"], []]); // a story's own stands in its place
    }, 30000);

    test("a story with no body yet is unproven, never failed: the harness tells the others and names it, and the report counts it", async () => {
      const report = await run(example, { ...stories, stories: stories.stories.slice(0, 1), unproven: [story("Ada pins a message, and everyone in the room sees it pinned")] });
      expect(report).toMatchObject({ passed: 1, failed: 0, unproven: ["Ada pins a message, and everyone in the room sees it pinned"] });
      const lines: string[] = [];
      const log = spyOn(console, "log").mockImplementation((line: string) => void lines.push(line));
      try {
        print({ outcomes: [], passed: 0, failed: 0, unproven: ["Ada pins a message"] });
      } finally {
        log.mockRestore();
      }
      expect(lines).toEqual(["  ?   Ada pins a message\n        unproven: no body yet, so the harness cannot tell it (a test of the app does)", "\n0 passed, 0 failed, 1 unproven"]);
    }, 30000);

    test("untold names each story no test source names as .<key>: a story cannot be renamed or dropped away from its test unseen", () => {
      const named = { saves: story("Saving says Saved"), follows: story("A change elsewhere shows here") };
      expect(untold(named, ["test(stories.saves.name, () => {})"])).toEqual(["A change elsewhere shows here"]);
      expect(untold(named, ["test(stories.saves.name, ...)", "test(stories.follows.name, ...)"])).toEqual([]);
      expect(untold(named, ["stories.savesAll"])).toEqual(["Saving says Saved", "A change elsewhere shows here"]);
    });

    test("printed with `wire`, under each story: the write's size once, then each member handed anything, the bytes, as they crossed the wire, and the biggest part, and what its undo and redo handed them; or that nobody was", () => {
      const lines: string[] = [];
      const log = spyOn(console, "log").mockImplementation((line: string) => void lines.push(line));
      const handed = (member: string, bytes: number, sent: number, part: string, most: number) => ({ member, bytes, sent, most: { part, bytes: most } });
      const report: Report = {
        outcomes: [
          {
            name: "Ann votes",
            failures: [],
            wire: {
              write: 146,
              handed: [handed("ann", 8001, 1229, "day-2026-11-10", 7373), handed("bo", 812, 400, "votes patch", 300)],
              undo: [handed("ann", 7990, 1220, "day-2026-11-10", 7360), handed("bo", 800, 390, "votes patch", 290), handed("cy", 90, 80, "votes patch", 90)],
              redo: [handed("ann", 8001, 1229, "day-2026-11-10", 7373), handed("bo", 812, 400, "votes patch", 300)],
            },
          },
          { name: "Bravo ticks", failures: [], wire: { write: 76, handed: [handed("bo", 354, 275, "ticker:market patch", 181)], undo: [] } }, // a fact: its undo hands nothing, and there is no redo
          { name: "Ann closes her tab", failures: ["nothing landed"], wire: { handed: [] } },
          { name: "a ghost", failures: ["no one in the cast is called ghost"] },
        ],
        passed: 2,
        failed: 2,
      };
      try {
        print(report, { wire: true });
        print(report);
      } finally {
        log.mockRestore();
      }
      expect(lines).toEqual([
        " ok   Ann votes",
        "        a 146-byte write handed",
        `          ann 8,001 bytes (${size(1229)} on the wire): day-2026-11-10 ${size(7373)}; undo 7,990, redo 8,001`,
        `          bo  812 bytes (${size(400)} on the wire): votes patch ${size(300)}; undo 800, redo 812`,
        "          cy  nothing; undo 90, redo 0",
        " ok   Bravo ticks",
        "        a 76-byte write handed",
        `          bo 354 bytes (${size(275)} on the wire): ticker:market patch ${size(181)}; undo 0`,
        "FAIL  Ann closes her tab",
        "        nothing landed",
        "        a tab closing handed nothing",
        "FAIL  a ghost",
        "        no one in the cast is called ghost",
        "\n2 passed, 2 failed",
        // without `wire`, the stories alone
        " ok   Ann votes",
        " ok   Bravo ticks",
        "FAIL  Ann closes her tab",
        "        nothing landed",
        "FAIL  a ghost",
        "        no one in the cast is called ghost",
        "\n2 passed, 2 failed",
      ]);
    });

    test("the biggest part of what a page was handed: a part a render in parts carries, by its key, or a whole page, a document's patch, or a message of another kind", () => {
      const render = (ops: object[]) => JSON.stringify({ type: "render", ops });
      const html = '<li data-eta-part="m&quot;2" id="m2">hello there</li>';
      const [replace, remove] = [{ op: "replace", target: '[data-eta-part="m\\"2"]', html }, { op: "remove", target: '[data-eta-part="messages"] [data-eta-part="m\\"1"]' }];
      expect(largest([render([replace, remove])])).toEqual({ part: 'm"2', bytes: Buffer.byteLength(JSON.stringify(replace)) });
      expect(largest([render([remove])])).toEqual({ part: 'm"1', bytes: Buffer.byteLength(JSON.stringify(remove)) });
      const page = JSON.stringify({ type: "render", html: "<main>…</main>", wire: 1 });
      const patch = JSON.stringify({ type: "patch", doc: "room:general", ops: [{ op: "add", path: "/messages/-", value: "a long enough message" }] });
      expect(largest([page, patch])).toEqual({ part: "room:general patch", bytes: Buffer.byteLength(patch) });
      expect(largest([patch, page])).toEqual({ part: "room:general patch", bytes: Buffer.byteLength(patch) });
      const whole = JSON.stringify({ type: "render", html: "<main>".padEnd(200, ".") });
      expect(largest([whole, patch])).toEqual({ part: "the whole page", bytes: Buffer.byteLength(whole) });
      const refusal = JSON.stringify({ type: "refused", id: 3, reason: "no" });
      expect(largest([refusal])).toEqual({ part: "refused", bytes: Buffer.byteLength(refusal) });
    });
  });

  test("a story by nobody in the cast, or seen by nobody who could, is a failure, not a crash", async () => {
    process.env.STORY_DIFF = "1"; // the excerpt under a failure is for the builder; make sure it prints
    const report = await run(example, {
      cast: stories.cast,
      stories: [
        { name: "a ghost speaks", as: "ghost", does: { doc: "room", ops: [] }, seen: {} },
        { name: "Ada says hello and Eve, who is nowhere, sees it", as: "ada", does: say("hi"), seen: { eve: "" }, untold: ["cy"] },
        // a refusal that is false: Ada may speak, so her page changes, and the excerpt says where
        { name: "Ada cannot say hello", as: "ada", cannot: say("hi") },
        // a refusal told as saying why, where chat's says nothing
        { name: "Eve, with no name, is told she needs one", as: "eve", cannot: enter("general"), told: "You need a name first." },
      ],
    });
    delete process.env.STORY_DIFF;
    expect(report.failed).toBe(4);
    expect(report.outcomes[3]!.failures).toEqual(['refused, but eve was not told "You need a name first."']);
    expect(report.outcomes[2]!.failures.join("\n")).toMatch(/refused, but: ada's page differs\n\s+expected …/);
    expect(report.outcomes[0]!.failures[0]).toContain("ghost");
    expect(report.outcomes[1]!.failures).toContain('eve did not see it on "": eve\'s page read session; the write was to room:general');
  }, 30000);

  test("a story is one kind, with only its own keys: one that mixes them fails by name and is not run, so no half of it is dropped", async () => {
    const [hi, general] = [say("hi"), enter("general")];
    const report = await run(example, {
      cast: stories.cast,
      stories: [
        misshapen({ name: "Bob says hi and closes his tab", as: "bob", does: hi, closesTab: true, seen: ["ada"] }),
        misshapen({ name: "Eve cannot go into general, and closes her tab", as: "eve", cannot: general, closesTab: true, seen: ["ada"] }),
        misshapen({ name: "Bob closes his tab from general", as: "bob", closesTab: true, from: "general", seen: ["ada"] }),
        misshapen({ name: "Bob does not close his tab", as: "bob", closesTab: false, seen: ["ada"] }),
        misshapen({ name: "Bob is somewhere", as: "bob", seen: ["ada"] }),
        misshapen({ name: "Eve cannot go into general, and Ada sees nothing", as: "eve", cannot: general, seen: ["ada"], untold: ["ada"] }),
        misshapen({ name: "Ada says hi, told something, by an old name", as: "ada", does: hi, seen: ["ada", "bob"], told: "hi", unseen: ["cy"] }),
        { name: "Ada says hi, with nothing left undefined counted, telling the model's story 3", as: "ada", does: hi, from: undefined, seen: ["ada", "bob"], untold: ["cy"], model: 3 },
      ],
    });
    expect(report.outcomes.map((o) => o.failures)).toEqual([
      ["a story is one of does, cannot or closesTab, and this one has does and closesTab"],
      ["a story is one of does, cannot or closesTab, and this one has cannot and closesTab"],
      ["a closesTab story takes no from"],
      ["closesTab is true, or left out: this one is false"],
      ["a story is one of does, cannot or closesTab, and this one has none"],
      ["a cannot story takes no seen", "a cannot story takes no untold"],
      ["a does story takes no told", "a does story takes no unseen"],
      [],
    ]);
  }, 30000);

  test("a story names everyone who sees its change: someone left out whose page changes fails it, by name", async () => {
    const report = await run(example, {
      cast: stories.cast,
      stories: [{ name: "Ada says hello, and only Ada sees it", as: "ada", does: say("hello"), seen: ["ada"] }],
    });
    expect(report.outcomes[0]!.failures.map((f) => f.split("\n")[0])).toEqual(["bob noticed, and should not have"]);
  }, 30000);

  test("a story is done from the author's page: no control for it fails, so does a write that lands nothing, and so does a button offered that is always refused", async () => {
    const report = await run(example, {
      cast: stories.cast,
      stories: [
        // Dee is choosing a room: nowhere on her page to say anything, and nothing to say it in
        { name: "Dee speaks before she is in a room", as: "dee", does: say("hi"), seen: ["dee"] },
        // the form is there; a blank name is refused, so nothing lands
        { name: "Dee enters a room with no name", as: "dee", does: enter("  "), seen: ["dee"] },
        // a button on Dee's page sends exactly this: a story that calls it refused says so
        { name: "Dee cannot go into general", as: "dee", cannot: enter("general") },
      ],
    });
    const first = (i: number) => report.outcomes[i]!.failures.map((f) => f.split("\n")[0]);
    expect(first(0)).toContain("dee has no control on their page for add /messages/- on room");
    expect(first(0)).toContain("nothing landed: dee's write was refused, as dee's page did not read room: it read session, lobby:all");
    expect(first(1)).not.toContain("dee has no control on their page for replace /room on session");
    expect(first(1)).toContain("nothing landed: dee's write was refused by session's shape");
    expect(first(2)).toContain("dee's page offers this, and it is refused without a word: a control that always fails");
  }, 30000);

  test("a story's premise is its own: made before it, as each member it names, rolled back with it; one whose write changes nothing is not told", async () => {
    const [hello, general] = [say("hello"), enter("general")];
    const report = await run(example, {
      cast: stories.cast,
      stories: [
        { name: "Cy, back in general, sees Ada say hello", as: "ada", premise: { cy: [general] }, does: hello, seen: ["ada", "bob", "cy"], untold: ["dee", "eve"] },
        { name: "Cy, in the kitchen again, is told nothing of it", as: "ada", does: hello, seen: ["ada", "bob"], untold: ["cy"] },
        { name: "Eve, with no name, is in general first", as: "ada", premise: { eve: [general] }, does: hello, seen: ["ada", "bob"] },
        { name: "A ghost is in general first", as: "ada", premise: { ghost: [general] }, does: hello, seen: ["ada", "bob"] },
        { name: "Dee goes into general twice", as: "ada", premise: { dee: [general, general] }, does: hello, seen: ["ada", "bob", "dee"] },
      ],
    });
    expect(report.outcomes.map((o) => o.failures)).toEqual([
      [],
      [],
      ["the premise did not hold: eve's write to session changed nothing"], // refused, as it is: a refusal and a write already so look the same from the wire
      ["the premise names ghost, and no one in the cast is called that"],
      ["the premise did not hold: dee's write to session changed nothing"], // already so
    ]);
  }, 30000);

  test("a tab closing is a story: who is still looking must see it, the author cannot, and a close that changes nothing is said", async () => {
    const report = await run(example, {
      cast: stories.cast,
      stories: [
        // the kitchen empties, and leaves Dee's list of rooms; Cy is not there to see it
        { name: "Cy closes her tab, and sees the kitchen go", as: "cy", closesTab: true, seen: ["cy", "dee"] },
        { name: "Eve closes her tab before she has a name", as: "eve", closesTab: true, seen: [] },
      ],
    });
    expect(report.outcomes.map((o) => o.failures)).toEqual([["cy closed their tab: they are not there to see it"], ["nothing landed: closing eve's tab changed nothing"]]);
  }, 30000);

  test("controls: a button sends its own value, a field or a form any, an applet only what it says it writes", () => {
    const page = [
      `<button data-write='{"doc":"room","op":"replace","path":"/name"}' data-value='"Tess &amp; Tom"'>x</button>`,
      `<button data-write='{"doc":"ledger","op":"remove","path":"/latest"}'>undo</button>`,
      `<button data-write='{"doc":"household","op":"replace","path":"/answer"}' data-value='"maybe"' disabled>maybe</button>`,
      `<input data-write='{"doc":"household","op":"replace","path":"/message"}' disabled>`,
      `<form data-write='{"doc":"room","op":"add","path":"/messages/-"}'></form>`,
      `<div class="site" data-page="gifts?new=gifts" data-page-write='{"doc":"session","op":"replace","path":"/page"}'></div>`,
      `<div data-applet="clock" data-doc="clock" data-props="{}"></div>`, // on a document, and saying nothing: it offers nothing
      `<div data-applet="city-picker" data-doc="clock"${appletWrites(["clock", "replace", "/tz"])} data-props="{}"></div>`,
      `<div data-applet="dress"${appletWrites(["household", "replace", "/guests/2/minifigure/top"])}></div>`,
      `<div data-applet="calendar"${appletWrites(["session", "replace", "/draft"], ["team", "replace", "/requests/*/starts"])}></div>`,
    ].join("");
    const cs = controlsOn(page);
    const any = (doc: string, op: PatchOp) => cs.some((c) => offers(c, doc, op));
    expect(any("room", { op: "replace", path: "/name", value: "Tess & Tom" })).toBe(true);
    expect(any("room", { op: "replace", path: "/name", value: "Bo" })).toBe(false);
    expect(any("ledger", { op: "remove", path: "/latest" })).toBe(true);
    expect(any("ledger", { op: "remove", path: "/latest", value: "x" })).toBe(false);
    expect(any("household", { op: "replace", path: "/answer", value: "maybe" })).toBe(false); // drawn disabled: the browser sends nothing
    expect(any("household", { op: "replace", path: "/message", value: "hi" })).toBe(false);
    expect(any("room:general", { op: "add", path: "/messages/-", value: "anything" })).toBe(true);
    expect(any("session", { op: "replace", path: "/page", value: "day" })).toBe(false); // the page's address is the URL bar's and the back button's, not a control on the page
    expect(any("clock", { op: "replace", path: "/tz", value: "Asia/Tokyo" })).toBe(true); // the picker says so
    expect(any("clock", { op: "replace", path: "/face", value: "round" })).toBe(false); // the clock on the document says nothing
    expect(any("household", { op: "replace", path: "/guests/2/minifigure/top", value: "#fff" })).toBe(true);
    expect(any("household", { op: "replace", path: "/guests/3/minifigure/top", value: "#fff" })).toBe(false);
    expect(any("household", { op: "remove", path: "/guests/2/minifigure/top" })).toBe(false); // another op
    expect(any("household", { op: "replace", path: "/guests/2/minifigure", value: {} })).toBe(false); // above what it names
    expect(any("household", { op: "replace", path: "/guests/2/minifigure/top/shade", value: "#fff" })).toBe(false); // below it
    expect(any("session", { op: "replace", path: "/draft", value: {} })).toBe(true); // one of several it says it writes
    expect(any("team", { op: "replace", path: "/requests/2/starts", value: "2026-11-20" })).toBe(true); // `*`: any one segment
    expect(any("team", { op: "replace", path: "/requests/2/status", value: "approved" })).toBe(false); // not the applet's: its drawer's
    expect(any("team", { op: "remove", path: "/requests/2" })).toBe(false);
    expect(any("watchlist", { op: "add", path: "/symbols/-", value: "X" })).toBe(false);
    expect(placeOf(page)).toBe("gifts?new=gifts");
    expect(placeOf("<p>no address</p>")).toBeUndefined();
  });

  test("Mo marks the bill paid with a button, and the till receives true, not \"true\": a button offers its value with its type", () => {
    const paid = (value: unknown): PatchOp => ({ op: "replace", path: "/bills/1/paid", value });
    const offered = (drawn: unknown, sent: unknown) => controlsOn(`<button${write("till", "replace", "/bills/1/paid", drawn)}>Paid</button>`).some((c) => offers(c, "till:1", paid(sent)));
    expect(offered(true, true)).toBe(true);
    expect(offered(true, "true")).toBe(false); // the story's text is not what the button sends
    expect(offered("true", true)).toBe(false); // nor is a button drawn with text the story's true
    expect(offered(3, 3)).toBe(true);
    expect(offered(3, "3")).toBe(false);
    expect(offered(null, null)).toBe(true);
    expect(offered("", "")).toBe(true);
    expect(offered({ by: "Mo" }, { by: "Mo" })).toBe(true);
    // a hand-drawn data-value that is not JSON offers nothing, and says so
    const misdeclared: string[] = [];
    expect(controlsOn(`<button data-write='{"doc":"till","op":"replace","path":"/bills/1/paid"}' data-value="yes">Paid</button>`, misdeclared)).toEqual([]);
    expect(misdeclared).toEqual(['a data-value must be JSON: button says yes']);
  });

  test("a cast signs in through the example's own sign-in route; one that cannot is said, not run as a visitor", async () => {
    const { example: leave, stories: told } = await load("leave");
    const first = told.stories.slice(0, 1); // signed in, it passes with the rest of leave's (below, under October's clock)
    const wrong = { ...told, stories: first, signIn: (name: string) => (name === "visitor" ? undefined : { path: "/login", form: { email: `${name}@leave.example`, password: "not-it" } }) };
    // each story fails, saying so, and the run goes no further (cafe-e's feedback: it was a stack trace)
    const report = await run(leave, wrong);
    expect(report.outcomes.map((o) => o.failures)).toEqual([["ann could not sign in at /login: 303"]]);
    expect(report.failed).toBe(1);
  }, 30000);

  describe("a post to a route", () => {
    /** leave, with two routes of a test's own: one that renames the team, and one that is closed. */
    const leaveWithRoutes = async (): Promise<Example> => {
      const { example: leave } = await load("leave");
      const rename = async (req: Request) => {
        await serverWrite("team:1", [{ op: "replace", path: "/teams/name", value: String((await req.formData()).get("name")) }]);
        return new Response(null, { status: 303, headers: { Location: "/" } });
      };
      return { ...leave, routes: { ...leave.routes, "/rename": rename, "/closed": () => new Response("Closed for the holidays.", { status: 403 }) } };
    };
    const rename = post("/rename", { name: "The workshop" });

    test("is posted as the browser posts it, its 303 followed to the page it lands on, and who was told what checked as for a write: the route's writes are told from delta's stream", async () => {
      const leave = await leaveWithRoutes();
      const { stories: told } = await load("leave");
      const traces: Trace[] = [];
      const report = await run(leave, {
        ...told,
        stories: [
          ...told.stories.filter((s) => s.name.startsWith("Bo signs in on another phone") || s.name.startsWith("Someone types Bo's email")),
          { name: "Mo follows a link that renames the team, and everyone in it sees the new name", as: "mo", does: rename, offPage: true, seen: ["ann", "bo", "mo"], untold: ["visitor"] },
          { name: "Mo renames the team, and nobody is said to see it", as: "mo", does: rename, offPage: true, seen: ["mo"] },
          { name: "The visitor signs in with the wrong password", as: "visitor", does: post("/login", { email: "bo@leave.example", password: "not-it" }), seen: ["visitor"] },
          { name: "Ann posts to the sign-in her page does not show", as: "ann", does: post("/login", { email: "bo@leave.example", password: "bo-password" }), seen: ["ann"] },
          { name: "Bo cannot sign in, but does", as: "visitor", cannot: post("/login", { email: "bo@leave.example", password: "bo-password" }) },
          { name: "Bo is told something else", as: "visitor", cannot: post("/login", { email: "bo@leave.example", password: "not-it" }), told: "Try again." },
          { name: "Nobody gets in while it is closed", as: "visitor", cannot: post("/closed"), told: "Closed for the holidays." },
        ],
      }, (t) => traces.push(t));
      expect(report.outcomes.map((o) => o.failures.map((f) => f.split("\n")[0]))).toEqual([
        [],
        [],
        [],
        ["ann noticed, and should not have", "bo noticed, and should not have"],
        ['nothing landed: the route refused visitor\'s post to /login: "That email and password do not match."', "visitor did not see it: visitor's page read session"], // what they were told is not the page
        ["ann has no form on their page that posts to /login"], // and Bo's calendar is hers now
        ["refused, but it landed: the route answered visitor's post to /login with 303, and told them nothing", "refused, but: visitor's page differs"],
        ['refused, but visitor was not told "Try again.": they were told "That email and password do not match."'],
        [],
      ]);
      // the route's change, told to everyone who holds the team, and in the ledger as the server's: nothing to undo
      const renamed = traces.filter((t) => t.story.startsWith("Mo follows a link"));
      expect(renamed.map((t) => t.phase)).toEqual(["does"]);
      expect(renamed[0]!.write).toEqual(rename);
      const patched = (member: string) => renamed[0]!.heard.find((h) => h.member === member)!.messages.filter((m) => m.type === "patch" && m.doc === "team:1").length;
      expect([patched("ann"), patched("bo"), patched("mo"), patched("visitor")]).toEqual([1, 1, 1, 0]);
      expect(renamed[0]!.ledger).toMatchObject([{ doc: "team:1", undoable: 0 }]);
    }, 60000);

    test("a post takes no undo, redo or gesture, and is a route's path and a form of strings", async () => {
      const { example: leave, stories: told } = await load("leave");
      const report = await run(leave, {
        ...among(told, "visitor"),
        stories: [
          misshapen({ name: "Bo signs in, undone", as: "visitor", does: post("/login"), seen: ["visitor"], undone: "Undone." }),
          misshapen({ name: "Bo signs in, by a press", as: "visitor", does: post("/login"), seen: ["visitor"], gesture: { press: "button" } }),
          misshapen({ name: "Bo signs in nowhere", as: "visitor", cannot: { path: "login", form: { n: 1 } } }),
        ],
      });
      const shape = "a post takes no undone, redone or gesture: a route writes as the server, and its form is posted as it is drawn";
      expect(report.outcomes.map((o) => o.failures)).toEqual([
        [shape.replace("undone, redone or gesture", "undone")],
        [shape.replace("undone, redone or gesture", "gesture")],
        ['a post is a route\'s path and a form of strings: this one is {"path":"login","form":{"n":1}}'],
      ]);
    }, 30000);

    test("a form that posts to a route is a control on the page, unless the browser sends nothing from it", () => {
      const page = `<form method="post" action="/login"><input name="email"></form><form method="POST" action="/join/abc"></form><form method="get" action="/search"></form><form method="post" action="/x" data-write='{"doc":"room","op":"add","path":"/messages/-"}'></form><div hidden><form method="post" action="/hidden"></form></div>`;
      expect(controlsOn(page).filter((c) => c.op === "post").map((c) => c.path)).toEqual(["/login", "/join/abc"]);
    });
  });

  test("a control the browser will not press is none: behind something inert, in a disabled fieldset, or hidden", () => {
    const b = (value: string) => `<button${write("room", "replace", "/name", value)}>${value}</button>`;
    const page = [
      `<div class="ground" inert><section>${b("behind a modal")}<div data-applet="x"${appletWrites(["room", "replace", "/draft"])}></div></section></div>`,
      b("open"),
      `<fieldset disabled>${b("in a disabled fieldset")}<input${write("room", "replace", "/topic")}></fieldset>`,
      `<fieldset>${b("in a fieldset")}</fieldset>`,
      `<div hidden><p>${b("hidden")}</p></div>`,
      `<br><input hidden${write("room", "replace", "/hidden")}><img src="x.png"><p>${b("after void tags")}</p>`,
    ].join("");
    expect(controlsOn(page).map((c) => c.value ?? c.path)).toEqual(["open", "in a fieldset", "after void tags"]);
  });

  test("what is hidden ends where HTML says it does, end tag or none; a disabled fieldset's first legend is not disabled; a template is never drawn", () => {
    const b = (value: string) => `<button${write("room", "replace", "/name", value)}>${value}</button>`;
    const page = [
      `<div><p hidden>gone<p>${b("after a hidden p")}<div>${b("after a p a div closes")}</div></div>`,
      `<ul><li hidden>gone<li>${b("after a hidden li")}<li hidden><ul><li>${b("in a list in a hidden li")}</ul><li>${b("after its list")}</ul>`,
      `<dl><dt hidden>gone<dd>${b("after a hidden dt")}</dl>`,
      `<table><tr hidden><td>${b("in a hidden row")}<tr><td>${b("in the next row")}<td hidden>${b("in a hidden cell")}<td>${b("in the next cell")}</table>`,
      `<table><tbody hidden><tr><td>${b("in a hidden body")}<tbody><tr><td>${b("in the next body")}</table>`,
      `<select><option hidden>x<option>y</select>`,
      `<fieldset disabled><legend>${b("in its first legend")}</legend>${b("in the fieldset")}<legend>${b("in a second legend")}</legend><div><legend>${b("in a legend it does not hold")}</legend></div></fieldset>`,
      `<template>${b("in a template")}</template>`,
      b("at the end"),
    ].join("");
    expect(controlsOn(page).map((c) => c.value ?? c.path)).toEqual(["after a hidden p", "after a p a div closes", "after a hidden li", "after its list", "after a hidden dt", "in the next row", "in the next cell", "in the next body", "in its first legend", "at the end"]);
  });

  test("a story from a modal is done in the modal: the page behind it, inert, offers nothing", async () => {
    const { example: ticker, stories: told } = await load("ticker");
    const report = await run(ticker, { ...told, stories: [{ name: "Ann, asked about Alpha, opens Bravo's drawer behind the question", as: "ann", from: "market?confirm=ALPH", does: desk("market?symbol=BRVO"), seen: ["ann"] }] });
    expect(report.outcomes[0]!.failures).toEqual(["ann has no control on their page for replace /page on desk"]);
  }, 30000);

  test("a story stands where it stands whatever the day: leave's, under October's clock, where the month they name is this one", async () => {
    const { example: leave, stories: told } = await load("leave");
    // a story from each month the stories name: this one, the next, and the one after
    const months = told.stories.filter((s) => ["Ann cannot move Bo's week", "Ann cannot approve her own day off", "Ann cannot move days Mo has already approved"].includes(s.name));
    expect(months.map((s) => s.from)).toEqual(["2026-11?request=2", "2026-10", "2026-12?request=3"]);
    setSystemTime(new Date("2026-10-15T12:00:00Z"));
    try {
      const report = await run(leave, { ...among(told, "ann"), stories: months });
      expect(report.outcomes.flatMap((o) => o.failures)).toEqual([]);
    } finally {
      setSystemTime();
    }
  }, 60000);

  test("an applet on a document offers only what its mount says it writes: a drawer that lost its picker fails the story, though the clock's face reads the same document", async () => {
    const { example: ticker, stories: told } = await load("ticker");
    const tokyo = told.stories.filter((s) => s.name.startsWith("Ann sets her clock to Tokyo"));
    expect((await run(ticker, { ...told, stories: tokyo })).outcomes[0]!.failures).toEqual([]);
    const pickerless: Example = { ...ticker, render: (sessionId) => ticker.render(sessionId).replace(/<div id="city"[^]*?<\/datalist><\/div>/, "") };
    expect((await run(pickerless, { ...told, stories: tokyo })).outcomes[0]!.failures).toEqual(["ann has no control on their page for replace /tz on clock"]);
  }, 30000);

  test("an applet offers only what its mount says it writes: a drawer that lost its control fails its story, whatever applet is beside it", async () => {
    const { example: leave, stories: told } = await load("leave");
    const approve = write("team", "replace", "/requests/1/status", "approved");
    const lost: Example = { ...leave, render: (sessionId) => leave.render(sessionId).replace(approve, "") };
    const report = await run(lost, { ...among(told, "mo"), stories: told.stories.filter((s) => s.name.startsWith("Mo approves")) });
    expect(report.outcomes.flatMap((o) => o.failures)).toContain("mo has no control on their page for replace /requests/1/status on team");
  }, 30000);

  test("after the deadline the Okafors are offered nothing to answer or choose with: live answer buttons fail the refusal, and a choice the menu cannot make has no control", async () => {
    const { example: wedding, stories: told } = await load("wedding");
    const closed = told.stories.find((s) => s.name.startsWith("Once the deadline"))!;
    const maybe = write("household", "replace", "/answer", "maybe");
    const live: Example = { ...wedding, render: (sessionId) => wedding.render(sessionId).replace(`${maybe} disabled`, maybe) };
    expect((await run(live, { ...told, stories: [closed] })).outcomes[0]!.failures).toEqual(["okafors's page offers this, and it is refused without a word: a control that always fails"]);
    const bass = { name: "After the deadline, Femi picks the sea bass", as: "okafors", premise: closed.premise, from: "list?guest=2", does: { doc: "household", ops: [{ op: "replace" as const, path: "/guests/2/choices/2/dish", value: 5 }] }, seen: { okafors: "list" } };
    const failures = (await run(wedding, { ...told, stories: [bass] })).outcomes[0]!.failures;
    expect(failures).toContain("okafors has no control on their page for replace /guests/2/choices/2/dish on household");
  }, 30000);

  test("an applet declaration that is not [doc, op, path] fails the story that meets it, by name, and the run goes on", async () => {
    const misdeclared: string[] = [];
    const page = [
      `<div data-applet="old"${(appletWrites as (...w: unknown[]) => string)(["team", "/draft"])}></div>`, // the form before ops
      `<div data-applet="single" data-writes='{"doc":"team","path":"/draft"}'></div>`,
      `<div data-applet="broken" data-writes='[{"doc":"team",'></div>`,
      `<div data-applet="relative"${appletWrites(["team", "replace", "draft"])}></div>`,
      `<div data-applet="good"${appletWrites(["team", "replace", "/draft"])}></div>`,
    ].join("");
    expect(controlsOn(page, misdeclared)).toEqual([{ doc: "team", op: "replace", path: "/draft", free: true, pattern: true }]);
    expect(misdeclared).toEqual([
      'applet declaration must be [doc, op, path]: old says {"doc":"team","op":"/draft"}',
      'applet declaration must be [doc, op, path]: single says {"doc":"team","path":"/draft"}',
      'applet declaration must be [doc, op, path]: broken says [{"doc":"team",',
      'applet declaration must be [doc, op, path]: relative says {"doc":"team","op":"replace","path":"draft"}',
    ]);

    const { example: leave, stories: told } = await load("leave");
    const stale: Example = { ...leave, render: (sessionId) => leave.render(sessionId).replace(/data-writes='[^']*'/, `data-writes='{"doc":"team","path":"/draft"}'`) };
    const report = await run(stale, { ...among(told, "ann"), stories: told.stories.filter((s) => s.name.startsWith("Ann drags across") || s.name.startsWith("Ann cannot move Bo's week")) });
    expect(report.outcomes.map((o) => o.failures.filter((f) => f.startsWith("applet declaration")))).toEqual([
      ['applet declaration must be [doc, op, path]: calendar says {"doc":"team","path":"/draft"}'],
      ['applet declaration must be [doc, op, path]: calendar says {"doc":"team","path":"/draft"}'],
    ]);
  }, 30000);

  // Delivery, not only pages: chat broken on purpose, three ways its own stories could not see.
  const only = (prefix: string): Story[] => stories.stories.filter((s) => s.name.startsWith(prefix));
  const withRoom = (f: (room: Resource) => Resource): Example => ({ ...example, resources: example.resources.map((c) => (c.docType === "room" ? f(c) : c)) });

  test("someone the story says is untold, told of the document all the same, fails it: a page that reads what it does not show", async () => {
    const leaky: Example = { ...example, render: (sessionId) => (read("room:general"), example.render(sessionId)) };
    const failures = await failuresOf(leaky, only("Ada says hello"));
    expect(failures).toContain("after the story, cy was told of room:general, and should not have been: cy's page read room:general, session, here:kitchen, room:kitchen");
    expect(failures).toContain("after undo, eve was told of room:general, and should not have been: eve's page read room:general, session");
    expect(failures).toContain("after redo, dee was told of room:general, and should not have been: dee's page read room:general, session, lobby:all");
  }, 30000);

  test("a tab closing the server does not tell fails its story: nobody still looking sees it", async () => {
    const deaf: Example = { ...example, resources: example.resources.map((c) => ({ ...c, onClose: undefined })) };
    const failures = await failuresOf(deaf, only("Bob closes his tab"));
    expect(failures).toEqual(["nothing landed: closing bob's tab changed nothing", "ada did not see it: ada's page read session, here:general, room:general"]);
  }, 30000);

  test("the fresh render is read from storage: a copy that drifted from the tables fails the story, by name", async () => {
    // the tables changed behind delta's back: each message said brings in one nobody said, and the
    // copy every page is drawn from never hears of it -- so the pages agree with the copy. (Not the
    // said message itself: delta reads back each row it writes, as it is kept, and tells that.)
    db.run("CREATE TEMP TRIGGER drift AFTER INSERT ON chat_messages BEGIN INSERT OR REPLACE INTO chat_messages (id, room, name, text, sent_at) VALUES (NEW.id + 1000000, NEW.room, NEW.name, 'not what was said', NEW.sent_at); END");
    try {
      const failures = await failuresOf(example, only("Ada says hello"));
      expect(failures).toContain("after the story, ada's open page is not what a fresh render shows");
      expect(failures).toContain("after the story, bob's open page is not what a fresh render shows");
      expect(failures).toContain("after redo, ada's open page is not what a fresh render shows");
    } finally {
      db.run("DROP TRIGGER drift");
    }
  }, 30000);

  test("a row the tables lost fails the story too: a document they do not hold is drawn as nothing", async () => {
    const { example: ticker } = await load("ticker");
    // the ticker's own story, told here: Ann's desk says she is on her board
    const watch = { doc: "watchlist", ops: [{ op: "add" as const, path: "/symbols/-", value: "CHRL" }] };
    const watches = { cast: { ann: [desk("board")] }, goTo: desk, stories: [{ name: "Ann, on her board, watches Charlie Metals", as: "ann", from: "board?new", does: watch, seen: { ann: "board" } }] };
    expect((await run(ticker, watches)).failed).toBe(0);
    // The market's row is lost when Ann watches: her open page keeps the market, the tables do not.
    // (Not her desk, the row she writes: delta reads back each row it writes, and a row it cannot
    // find refuses the write. The market is a row her write does not touch, so nobody is told.)
    db.run("CREATE TEMP TRIGGER lost AFTER UPDATE OF symbols ON ticker_desks BEGIN DELETE FROM ticker_markets; END");
    try {
      const failures = (await run(ticker, watches)).outcomes.flatMap((o) => o.failures);
      expect(failures).toContain("after the story, ann's open page is not what a fresh render shows");
    } finally {
      db.run("DROP TRIGGER lost");
    }
  }, 30000);

  test("a refusal that is really the server failing fails the story, though its writer is answered", async () => {
    const throwing = withRoom((room) => ({ ...room, permit: () => { throw new Error("a permit that throws"); } }));
    expect((await failuresOf(throwing, only("Nobody can take"))).some((f) => f.startsWith("the server failed") && f.endsWith("a permit that throws"))).toBe(true);

    // the page drawn after it cannot be: the refusal is answered all the same, and the failure is the server's
    let refusing = false;
    const unanswered: Example = {
      ...withRoom((room) => ({ ...room, permit: (ws, op, id) => ((refusing = true), room.permit!(ws, op, id)) })),
      render: (sessionId) => {
        if (refusing) throw new Error(`the page cannot be drawn${(refusing = false) || ""}`);
        return example.render(sessionId);
      },
    };
    const failures = await failuresOf(unanswered, only("Nobody can take"));
    expect(failures.filter((f) => f.includes("not answered"))).toEqual([]);
    expect(failures).toContain("the server failed drawing a page: the page cannot be drawn");
  }, 30000);

  test("a story's write is answered as its own: a refused write says why, a refusal that says another reason is caught, and one that lands is no refusal", async () => {
    const takeBack = { doc: "room", ops: [{ op: "remove" as const, path: "/messages/any" }] };
    // chat's room, saying why it refuses -- where its page draws no reason at all
    const saying = withRoom((room) => ({
      ...room,
      permit: (ws, op, id) => {
        if (op.op === "remove") throw refuse("Messages are kept.");
        if (op.value === "hi") throw refuse("Not now.");
        return room.permit!(ws, op, id);
      },
    }));
    const report = await run(saying, {
      ...stories,
      stories: [
        { name: "Ada says hi", as: "ada", does: say("hi"), seen: ["ada", "bob"] },
        { name: "Ada cannot take a message back, told one thing", as: "ada", cannot: takeBack, told: "Nobody takes a message back." },
        { name: "Ada cannot take a message back, told why, where her page does not say it", as: "ada", cannot: takeBack, told: "Messages are kept." },
        { name: "Ada cannot say hello", as: "ada", cannot: say("hello") },
      ],
    });
    const first = (i: number) => report.outcomes[i]!.failures.map((f) => f.split("\n")[0]);
    expect(first(0)).toContain('nothing landed: ada\'s write was refused by room\'s permit: "Not now."');
    expect(first(1)).toEqual(['refused, but ada was not told "Nobody takes a message back.": they were told "Messages are kept."']);
    expect(first(2)).toEqual(['refused and told "Messages are kept.", but ada\'s page does not show it']);
    expect(first(3)).toContain("refused, but it landed: ada's write was echoed back to them");
  }, 30000);

  test("a write that is not on the ledger fails, unless its resource keeps it off; a resource that says so and is on it fails too", async () => {
    // chat's documents left off the ledger by mistake: no undo could ever work
    const bare = createLocal();
    registerDocs(bare.server, db, schema, [defineDoc("session:", { root: "sessions", include: [], implied: true, columns: { sessions: ["name", "room", "before"] } }), defineDoc("room:", { root: "messages", scope: { room: ":room" }, include: [] })], []);
    registerMemory(bare.server, { prefix: "here:", empty: () => ({ people: {} }) });
    registerMemory(bare.server, { prefix: "lobby:", empty: () => ({ rooms: {} }) });
    const forgot = await failuresOf({ ...example, delta: bare }, only("Ada says hello"));
    expect(forgot).toContain("the server failed writing room:general: delta recorded no ledger entry: register it with { ledger: true }, or say its resource keeps it off the ledger (ledger: false)");
    expect(forgot.some((f) => f.startsWith("the server failed writing session: delta recorded no ledger entry"))).toBe(true); // a session's own, named by type

    const lying = await failuresOf(withRoom((room) => ({ ...room, ledger: false })), only("Ada says hello"));
    expect(lying).toContain("the server failed writing room:general: its resource keeps it off the ledger (ledger: false), yet delta recorded the write");
  }, 30000);

  // What happened, said to its author (src/refusal.ts): chat telling Ada her message is sent,
  // beside the form, and what Undo took back, or Redo put back, over the page where Undo is.
  const saying = (at = { doc: "ledger", path: "/latest" }): Example => ({
    ...withRoom((room) => ({
      ...room,
      afterWrite: (ws) => tell(ws.data.sessionId, { doc: "room", path: "/messages/-", said: "Sent." }),
      afterWalk: (ws, _id, { way, ops, inverse }) => {
        const { text } = (way === "undo" ? inverse : ops)[0]!.value as { text: string };
        return tell(ws.data.sessionId, { ...at, said: `${way === "undo" ? "Undone" : "Redone"}: “${text}”.` });
      },
    })),
    render: (sessionId) => example.render(sessionId) + part("told", `<div>${toldAt(sessionId, "room", "/messages/-")}</div>`), // a part of its own, so what it says goes alone
  });

  const hello = (name: string, undone?: string): Story => ({ name, as: "ada", does: say("hello"), seen: ["ada", "bob"], untold: ["cy", "dee", "eve"], undone });

  test("what a write, its undo and its redo say to their author is theirs: the pages are compared without it, and a story says what Undo says", async () => {
    const report = await run(saying(), {
      ...stories,
      stories: [
        hello("Ada says hello"),
        hello("Ada says hello, and Undo says it took it back", "Undone: “hello”."),
        hello("Ada says hello, and Undo says something else", "Undone: hi."),
        // what the premise's write said is the premise's: the refusal after it says nothing
        { ...only("Nobody can take")[0]!, premise: { ada: [say("first")] } },
      ],
    });
    expect(report.outcomes.map((o) => o.failures)).toEqual([[], [], ['after undo, ada was not told "Undone: hi.": they were told "Undone: “hello”."'], []]);
  }, 30000);

  test("what Undo says must be said and shown: a story's words the undo never says fail it, and so does a line the page does not draw, or an undo that never comes", async () => {
    const undone = hello("Ada says hello, and Undo says so", "Undone: “hello”.");
    expect(await failuresOf(example, [undone])).toEqual(['after undo, ada was not told "Undone: “hello”."']);
    expect(await failuresOf(saying({ doc: "room", path: "/nowhere" }), [undone])).toEqual([
      'after undo, ada was told "Undone: “hello”.", and their page does not show it',
      'after redo, ada was told "Redone: “hello”.", and their page does not show it',
    ]);
    const logout = { doc: "session", ops: [{ op: "remove" as const, path: "/name" }] };
    expect(await failuresOf(example, [{ name: "Ada logs out, and Undo says so", as: "ada", does: logout, seen: ["ada", "bob"], undone: "Undone: Ada." }])).toEqual(['no undo follows to tell ada "Undone: Ada."']);
  }, 30000);

  // The wedding, broken on purpose, where what its author is told could stand in for what they
  // should see, or say what it should not.
  describe("what an author is told stands in for nothing, says its own words, and is of its own moment", async () => {
    const { example: wedding, stories: vows } = await load("wedding");
    const visit = await import("../../examples/wedding/documents/session");
    const named = (start: string): Story => vows.stories.find((s) => s.name.startsWith(start))!;
    const withHousehold = (f: (household: Resource) => Partial<Resource>, from: Example = wedding): Example => ({ ...from, resources: from.resources.map((c) => (c.docType === "household" ? { ...c, ...f(c) } : c)) });
    const maybe = named("The Okafors say maybe");

    test("a line told to the author is no change of theirs: a write their own page does not show fails, whatever it says", async () => {
      const femi: Story = { name: "Femi's top turns green, and the photo everyone watches changes", as: "okafors", from: "?guest=2", does: { doc: "household", ops: [{ op: "replace", path: "/guests/2/minifigure/top", value: "#7FAE4E" }] }, seen: { okafors: "", couple: "", benToo: "everyone" } };
      // the Okafors' own page never shows Femi's top green
      const blind: Example = {
        ...wedding,
        render: (sessionId) => {
          const page = wedding.render(sessionId);
          return visit.read(sessionId).code === "OKAFOR" ? page.replaceAll("#7FAE4E", "#1E3F8F") : page;
        },
      };
      expect(await failuresOf(blind, [femi], vows)).toContain('okafors did not see it on "": okafors\'s page read session, household:1, wedding:1, everyone:1; the write was to household:1, board:1, everyone:1');
      const saved = withHousehold((h) => ({ afterWrite: async (ws, id, ops, landed) => (await h.afterWrite!(ws, id, ops, landed), tell(ws.data.sessionId, { doc: "ledger", path: "/latest", said: "Saved." })) }), blind);
      expect(await failuresOf(saved, [femi], vows)).toContain('okafors did not see it on "": okafors\'s page read session, household:1, wedding:1, everyone:1; the write was to household:1, board:1, everyone:1');
    }, 30000);

    test("what the author is told must be on their page in its own words: a line drawn saying something else fails", async () => {
      // every line the wedding's own pages draw says "No.", whatever it was told
      const garbled: Example = { ...wedding, render: (sessionId) => wedding.render(sessionId).replace(/(<p class="(?:refused|said)" role="(?:alert|status)">)[^<]*/g, "$1No.") };
      expect(await failuresOf(garbled, [named("A stranger types a code nobody has")], vows)).toEqual(["refused and told \"That code was not recognised.\", but stranger's page does not show it"]);
      // and chat's, where it says what Undo took back beside its form
      const beside = saying({ doc: "room", path: "/messages/-" });
      const ok: Example = { ...beside, render: (sessionId) => beside.render(sessionId).replace(/(role="status">)[^<]*/, "$1OK.") };
      expect(await failuresOf(ok, [hello("Ada says hello, and Undo says so", "Undone: “hello”.")])).toEqual([
        'after the story, ada was told "Sent.", and their page does not show it',
        'after undo, ada was told "Undone: “hello”.", and their page does not show it',
        'after redo, ada was told "Redone: “hello”.", and their page does not show it',
      ]);
    }, 30000);

    test("what a walk says is its own: after the redo, what the undo said is stale, and so after the undo is what the write said", async () => {
      // the redo says what the undo did: "Undone: your answer.", still up after the redo
      const stale = withHousehold((h) => ({ afterWalk: (ws, id, walk) => h.afterWalk!(ws, id, { ...walk, way: "undo" }) }));
      expect(await failuresOf(stale, [maybe], vows)).toEqual(['after redo, okafors is still told "Undone: your answer.", what the undo told them']);
      // the undo says what the write did
      const saved = withHousehold((h) => ({ afterWrite: (ws) => tell(ws.data.sessionId, { doc: "ledger", path: "/latest", said: "Saved." }), afterWalk: (ws, _id, walk) => (walk.way === "undo" ? tell(ws.data.sessionId, { doc: "ledger", path: "/latest", said: "Saved." }) : h.afterWalk!(ws, _id, walk)) }));
      expect(await failuresOf(saved, [{ ...maybe, undone: undefined }], vows)).toEqual(['after undo, okafors is still told "Saved.", what the write told them']);
    }, 30000);

    test("a story says what the redo says too: its words, said and shown, or no redo to say them", async () => {
      const redoing = (name: string, redone: string) => ({ ...maybe, name, redone }) as Story;
      const report = await run(wedding, { ...vows, stories: [redoing(maybe.name, "Redone: your answer."), redoing("…and Redo says something else", "Redone: nothing.")] });
      expect(report.outcomes.map((o) => o.failures)).toEqual([[], ['after redo, okafors was not told "Redone: nothing.": they were told "Redone: your answer."']]);
      // chat's Eve: the undo takes her name back, and with it her tab's right to redo
      const eve = { ...only("Eve gives her name")[0]!, redone: "Redone: Eve." } as Story;
      expect(await failuresOf(example, [eve])).toEqual(['no redo follows to tell eve "Redone: Eve."']);
    }, 30000);
  });

  test("an applet may name the only values a control of it sends: a tap that goes somewhere offers only there, and the values of one write go together", () => {
    const page = `<div data-applet="photo"${appletWrites(["desk", "replace", "/page", "?guest=2"], ["desk", "replace", "/page", "?guest=3"])}></div>`;
    const tap = (value: string) => controlsOn(page).some((c) => offers(c, "desk", { op: "replace", path: "/page", value }));
    expect(tap("?guest=2")).toBe(true);
    expect(tap("?guest=3")).toBe(true);
    expect(tap("?guest=4")).toBe(false); // only the values it names
    const wrong: string[] = [];
    expect(controlsOn(`<div data-applet="x" data-writes='[{"doc":"desk","op":"replace","path":"/page","values":[{"to":1}]}]'></div>`, wrong)).toEqual([]); // a value is a string, a number or a boolean
    expect(controlsOn(`<div data-applet="x" data-writes='[{"doc":"desk","op":"replace","path":"/page","values":[]}]'></div>`, wrong)).toEqual([]); // and a list of none is no list
    expect(wrong).toHaveLength(2);
    // every page that shows the applet is sent its declaration, so it says each write once
    expect(appletWrites(["desk", "replace", "/page", "?guest=1"], ["desk", "replace", "/page", "?guest=2"], ["desk", "replace", "/page"], ["desk", "add", "/page", 3])).toBe(
      ` data-writes='[{"doc":"desk","op":"replace","path":"/page","values":["?guest=1","?guest=2"]},{"doc":"desk","op":"replace","path":"/page"},{"doc":"desk","op":"add","path":"/page","values":[3]}]'`,
    );
  });

  // Where a person can go: the harness puts people anywhere by a session write of its own, so
  // a story could stand where no control leads. The ticker, with controls taken off its pages.
  describe("a story stands only where a control leads", async () => {
    const { example: ticker, stories: told } = await load("ticker");
    const deskButton = (page: string) => write("desk", "replace", "/page", page);
    const without = (...controls: string[]): Example => ({ ...ticker, render: (sessionId) => controls.reduce((html, c) => html.replaceAll(c, ""), ticker.render(sessionId)) });
    const named = (prefix: string): Story[] => told.stories.filter((s) => s.name.startsWith(prefix));

    test("everywhere: after the stories, every place each of the cast can get to from where it starts, with what each page there offers", async () => {
      const offered = new Map<string, string[]>();
      await run(ticker, { ...told, stories: [] }, undefined, { everywhere: (member, place, controls) => member === "ann" && offered.set(place, controls.map((c) => `${c.op} ${c.path}`)) });
      expect(offered.get("board?new")).toContain("add /symbols/-"); // no story stood there: a control leads there, and what it offers is known
      // a place no control leads to is not walked
      const walked: string[] = [];
      await run(without(deskButton("board?new")), { ...told, stories: [] }, undefined, { everywhere: (member, place) => member === "ann" && walked.push(place) });
      expect(walked).not.toContain("board?new");
      expect(walked.length).toBeGreaterThan(0);
    }, 30000);

    test("a story whose from no page offers a way to fails by name, though the harness can put its author there", async () => {
      const report = await run(without(deskButton("board?new")), { ...told, stories: named("Ann watches Charlie Metals, and only her board grows") });
      expect(report.outcomes[0]!.failures).toEqual(['no control leads ann to "board?new", where the story has them act']);
      expect((await run(ticker, { ...told, stories: named("Ann watches Charlie Metals, and only her board grows") })).failed).toBe(0);
    }, 30000);

    test("so does a place a seen puts someone, and what a place holds after \" @ \" must be sent from the page there", async () => {
      const report = await run(without(deskButton("market?symbol=BRVO"), write("desk", "replace", "/reading/board", "list")), { ...told, stories: named("Bravo ticks") });
      expect(report.outcomes.map((o) => o.failures)).toEqual([
        [],
        ['no control leads ann to "board @ reading.board=list", where the story has them see it: nothing on their page at "board" sends replace /reading/board'],
        ['no control leads ann to "market?symbol=BRVO", where the story has them see it'],
      ]);
    }, 30000);

    test("a place named with \" @ \" is stood on, so what its page sends is asked, though no other place is wanted past it", async () => {
      // told alone, Ann's board is only the end of her way from where the cast left her
      const alone = named("Bravo ticks; Ann, reading her board as a list");
      expect((await run(ticker, { ...told, stories: alone })).outcomes[0]!.failures).toEqual([]);
      expect((await run(without(write("desk", "replace", "/reading/board", "list")), { ...told, stories: alone })).outcomes[0]!.failures).toEqual([
        'no control leads ann to "board @ reading.board=list", where the story has them see it: nothing on their page at "board" sends replace /reading/board',
      ]);
    }, 30000);

    test("a way through a place no story stands on is walked, and one a page never offers is not a way at all", async () => {
      // Ann stands only where the cast put her; the way to Alpha's modal is through the market and Alpha's drawer
      const drops = named("Ann drops Alpha");
      expect((await run(ticker, { ...told, stories: drops })).outcomes[0]!.failures).toEqual([]);
      expect((await run(without(deskButton("market")), { ...told, stories: drops })).outcomes[0]!.failures).toEqual(['no control leads ann to "market?confirm=ALPH", where the story has them act']);
    }, 30000);
  });

  test("where a person can go is judged from where the story starts: a place another story's write opened is not one this story can reach", async () => {
    const { example: wedding, stories: told } = await load("wedding");
    // Ben has no plus-one, so nothing on his page opens the plus; the couple giving him one draws it there, for that story alone
    const plus: Story = { name: "Ben, with no plus-one, cannot name one from the plus", as: "ben", from: "?new=guests", cannot: { doc: "household", ops: [{ op: "add", path: "/guests/-", value: "Someone Else" }] } };
    const letBen: Story = { name: "The couple let Ben bring one more, and he may name them himself", as: "couple", from: "?family=2", does: { doc: "board", ops: [{ op: "replace", path: "/households/2/plus_ones", value: 1 }] }, seen: { couple: "?family=2", ben: "", benToo: "" } };
    const unreached = ['no control leads ben to "?new=guests", where the story has them act'];
    for (const order of [[plus], [letBen, plus], [plus, letBen]]) {
      const report = await run(wedding, { ...told, stories: order });
      expect(report.outcomes.find((o) => o.name === plus.name)!.failures).toEqual(unreached);
    }
    // and its own premise is where it starts: given the plus-one, Ben can open the plus
    const given = { ...plus, name: "Ben, given a plus-one, can open the plus", premise: { couple: [{ doc: "board", ops: [{ op: "replace" as const, path: "/households/2/plus_ones", value: 1 }] }] } };
    expect((await run(wedding, { ...told, stories: [given] })).outcomes[0]!.failures.filter((f) => f.startsWith("no control leads"))).toEqual([]);
  }, 60000);

  test("a control goes where goTo makes exactly its write: a button's own value, or the one an applet names; nothing that takes any value goes anywhere", () => {
    const page = [
      `<button${write("desk", "replace", "/page", "market")}>market</button>`,
      `<button${write("desk", "replace", "/reading/board", "list")}>list</button>`,
      `<div data-page="" data-page-write='{"doc":"desk","op":"replace","path":"/page"}'></div>`,
      `<form${write("desk", "replace", "/page")}><input name="to"></form>`,
      `<div data-applet="photo"${appletWrites(["desk", "replace", "/page", "?guest=2"], ["desk", "replace", "/page"])}></div>`,
    ].join("");
    expect(controlsOn(page).map((c) => goesTo(c, desk))).toEqual(["market", undefined, undefined, "?guest=2", undefined]); // the page's own address is none
  });

  test("an applet's `*` is any one member, never the end of a list: an append is named as one", () => {
    const party = (path: string) => ({ doc: "trip:1", op: "add", path, free: true, pattern: true as const });
    const join = { op: "add" as const, path: "/events/44/party/-", value: "ann" };
    expect(offers(party("/events/*/party/*"), "trip:1", join)).toBe(false); // the drawer's "I'm in", not the applet's
    expect(offers(party("/events/*/party/*"), "trip:1", { ...join, path: "/events/44/party/7" })).toBe(true);
    expect(offers(party("/events/*/party/-"), "trip:1", join)).toBe(true);
  });

  test("a select leads to each option it can choose, a radio to its value, and a goTo of several ops wherever it sets the address", () => {
    const select = `<form data-write-on="change"><select${write("desk", "replace", "/page")}><option value="market">Market</option><option value="attic" disabled>Attic</option><optgroup label="more" disabled><option value="cellar">Cellar</option></optgroup><option> the  clock </option><option>board</select></form>`;
    expect(controlsOn(select).map((c) => goesTo(c, desk))).toEqual(["market", "the clock", "board"]); // what is disabled chooses nothing
    const sends = (page: string, value: string) => controlsOn(page).some((c) => offers(c, "desk", { op: "replace", path: "/page", value }));
    expect(sends(select, "market")).toBe(true);
    expect(sends(select, "attic")).toBe(false); // a select sends only what it can choose
    expect(sends(`<select multiple${write("desk", "replace", "/page")}><option value="market"></select>`, "market")).toBe(false); // several at once is no one value: the client never sends it
    expect(controlsOn(`<select disabled${write("desk", "replace", "/page")}><option value="market"></select>`)).toEqual([]);
    const radios = `<input type="radio" name="p" value="market"${write("desk", "replace", "/page")}><input type="radio" name="p"${write("desk", "replace", "/page")}>`;
    expect(controlsOn(radios).map((c) => goesTo(c, desk))).toEqual(["market", "on"]);
    expect(sends(radios, "board")).toBe(false);
    // going somewhere also puts find away: a button that sets the address still leads there
    const clearing = (page: string) => ({ doc: "desk", ops: [{ op: "replace" as const, path: "/page", value: page }, { op: "remove" as const, path: "/filter" }] });
    expect(controlsOn(`<button${write("desk", "replace", "/page", "market")}>m</button><button${write("desk", "remove", "/filter")}>f</button>`).map((c) => goesTo(c, clearing))).toEqual(["market", undefined]);
  });

  test("an applet that follows its document's patches is compared without its props; any other element keeps them", () => {
    const board = `<div id="board" data-applet="board" data-doc="ticker" data-props="{&quot;price&quot;:1}"></div>`;
    const photo = `<div id="photo" data-applet="photo" data-props="{&quot;n&quot;:2}"></div>`;
    expect(comparable(board + photo)).toBe(`<div id="board" data-applet="board" data-doc="ticker"></div>` + photo);
  });
});

describe("propsCost: what a render sends in props, which the harness says and does not fail on", () => {
  // a strip's stops, past what props should carry
  const stops = Object.fromEntries(Array.from({ length: 150 }, (_, i) => [String(i), { title: `stop ${i}`, day: i % 9 }]));
  const sized = (props: unknown) => size(Buffer.byteLength(JSON.stringify(props)));
  const strip = (props: unknown, watch?: { doc: string; under?: string }, more = "") => `<div id="s" data-applet="strip"${more}${appletProps(props, watch)}>paint</div>`;
  const whole = (html: string) => ({ type: "render", html });

  test("a mount whose own props pass MOST_PROPS, however it is sent; one that watches its document is weighed without it", () => {
    expect(Buffer.byteLength(JSON.stringify({ me: "ann", stops }))).toBeGreaterThan(MOST_PROPS);
    expect(propsCost("ann", "", whole(`<main>${strip({ me: "ann", stops })}</main>`))).toEqual([
      { kind: "big", applet: "strip", says: `ann was sent the strip applet's props, ${sized({ me: "ann", stops })}, which go again whenever they change: let it watch the document they come from (appletProps(props, { doc })), and keep them to what it shows, and for whom` },
    ]);
    expect(propsCost("ann", "", whole(strip({ me: "ann", trip: { stops } }, { doc: "trip:1", under: "/trip" })))).toEqual([]);
    expect(propsCost("ann", "", whole(strip({ me: "ann", stops, trip: {} }, { doc: "trip:1", under: "/trip" })))).toEqual([
      { kind: "big", applet: "strip", says: `ann was sent the strip applet's props, ${sized({ me: "ann", stops })} beside the document it watches, which go again whenever they change: keep them to what it shows, and for whom` },
    ]);
    expect(propsCost("ann", "", { type: "patch", doc: "trip:1" })).toEqual([]);
  });

  test("in parts, a mount sent with the very props the page had: with its tag, drawn again for its inside, or in a part drawn again around it", () => {
    const small = { me: "ann" };
    const watching = { doc: "trip:1", under: "/trip" };
    const page = `<main><section data-eta-part="day"><h2>Day 1</h2>${part("s", strip({ ...small, trip: { a: 1 } }, watching))}</section></main>`;
    const again = (how: string) => [{ kind: "again" as const, applet: "strip", says: `ann was sent the strip applet's props again, as they were, ${how}` }];
    const tagged = splitTag(part("s", strip({ ...small, trip: { a: 2 } }, watching, ` class="open"`)))[0];
    expect(propsCost("ann", page, { type: "render", ops: [{ op: "tag", target: '[data-eta-part="s"]', html: tagged }] })).toEqual(again("with its tag, for something else on it: keep that beside its mount"));
    expect(propsCost("ann", page, { type: "render", ops: [{ op: "replace", target: '[data-eta-part="s"]', html: part("s", strip({ ...small, trip: { a: 2 } }, watching)) }] })).toEqual(
      again("drawn again for what the server paints inside it, which the applet paints over: let it watch the document it paints from"),
    );
    const day = `<section data-eta-part="day"><h2>Day one</h2>${part("s", strip({ ...small, trip: { a: 2 } }, watching))}</section>`;
    expect(propsCost("ann", page, { type: "render", ops: [{ op: "replace", target: '[data-eta-part="day"]', html: day }] })).toEqual(
      again(`in a part drawn again around it ([data-eta-part="day"]) for something else in it: make what changed there a part of its own`),
    );
    // props that changed, a mount new to the page, and a row taken out, cost nothing
    const moved = part("s", strip({ me: "bo", trip: { a: 1 } }, watching));
    expect(propsCost("ann", page, { type: "render", ops: [{ op: "replace", target: '[data-eta-part="s"]', html: moved }, { op: "after", target: '[data-eta-part="s"]', html: `<div id="t" data-applet="strip"${appletProps(small)}></div>` }, { op: "remove", target: '[data-eta-part="x"]' }] })).toEqual([]);
  });

  test("a run says each cost once for each applet, in the first story that sent it, and the report prints it after the stories", async () => {
    const { example: ticker, stories: told } = await load("ticker");
    const ticks = told.stories.filter((s) => s.name.startsWith("Bravo ticks while Ann has its drawer open"));
    const report = await run(ticker, { ...told, stories: [...ticks, ...ticks] });
    expect(report.failed).toBe(0);
    const props = report.warnings!.filter((w) => w.says.includes("props")); // what a write no story tells finds is another test's
    // told twice, said once: the board and the clock sent again as the cast stands where the story says, the spark with the drawer each tick
    expect(props.map((w) => [w.story, /was sent the (\S+) applet's props again/.exec(w.says)?.[1]])).toEqual(["board", "clock", "spark"].map((applet) => [ticks[0]!.name, applet]));
    const said: string[] = [];
    const log = spyOn(console, "log").mockImplementation((line: string) => void said.push(line));
    try {
      print({ ...report, warnings: props });
      print({ ...report, warnings: props.slice(0, 1) });
    } finally {
      log.mockRestore();
    }
    expect(said).toContain(`warn  ${ticks[0]!.name}\n        ${props[2]!.says}`);
    expect(said.filter((line) => line.includes("passed"))).toEqual(["\n2 passed, 0 failed, 3 warnings", "\n2 passed, 0 failed, 1 warning"]);
  }, 30000);
});

describe("a hidden verb: a write the server takes that no story tells and no page offers", () => {
  const withOwn = (docType: string, f: (c: Resource) => Partial<Resource>): Example => ({ ...example, resources: example.resources.map((c) => (c.docType === docType ? { ...c, ...f(c) } : c)) });

  test("A resource that permits a write no story tells and no page offers is named by `bun run stories`", async () => {
    // chat's own: every write its permits take, a story tells or a page offers
    expect((await run(example, stories)).warnings).toBeUndefined();
    // a room that takes a message back over the wire: Ada's refusal tells it, so it is not hidden from her; from anyone else it is
    const loose = withOwn("room", (room) => ({ permit: (ws, op, id) => op.op === "remove" || room.permit!(ws, op, id), shape: (ws, id, ops) => [...ops.filter((op) => op.op === "remove"), ...room.shape!(ws, id, ops)] }));
    const report = await run(loose, stories);
    expect(report.failed).toBe(0);
    const says = (doc: string) => report.warnings!.filter((w) => w.story === `${doc}: a write no story tells and no page offers`).map((w) => w.says);
    expect(says("room:general")).toEqual(["ada, bob and dee may remove the document, remove /messages, remove /messages/-", "bob and dee may remove /messages/any"]);
    expect(says("room:kitchen")).toEqual(["cy may remove the document, remove /messages, remove /messages/-, remove /messages/any"]); // each room as its readers met it
    // what stands in front of the store (the model's guards, `may`) refusing them, they are not hidden: no page's permit is asked alone (cafe-d's feedback)
    let guarding = true;
    example.delta.server.on("may", (msg, _client, respond) => {
      if (guarding && String(msg.doc).startsWith("room:") && (msg.ops as { op: string }[]).some((op) => op.op === "remove")) respond({ error: { code: 403, message: "Only the story's teller." } });
    });
    try {
      expect((await run(loose, stories)).warnings).toBeUndefined();
    } finally {
      guarding = false;
    }
    // a permit that refuses by throwing refuses, as on the wire: chat's shape would take an add to a name as its replace
    const throwing = withOwn("session", (session) => ({ permit: (ws, op, id) => (op.op === "add" ? (() => { throw refuse("No."); })() : session.permit!(ws, op, id)) }));
    expect((await run(throwing, stories)).warnings).toBeUndefined();
    // and what it says is printed after the stories, as the props' cost is
    const said: string[] = [];
    const log = spyOn(console, "log").mockImplementation((line: string) => void said.push(line));
    try {
      print({ ...report, warnings: report.warnings!.slice(1, 2) });
    } finally {
      log.mockRestore();
    }
    expect(said).toContain("warn  room:general: a write no story tells and no page offers\n        bob and dee may remove /messages/any");
  }, 30000);

  test("a member of a collection is any one -- an id, or a key of rows of the same fields -- never the end of a list, and a record's fields are their own", () => {
    const doc = { quotes: { ALPH: { price: 1 }, BRVO: { price: 2 } }, guests: [{ name: "Ada" }], me: { name: "Ada", room: { id: 1 } }, "a/b~": 3 };
    expect(anyOne("/quotes/ALPH/price", doc)).toBe("/quotes/*/price");
    expect(anyOne("/guests/0/name", doc)).toBe("/guests/*/name");
    expect(anyOne("/guests/-", doc)).toBe("/guests/-");
    expect(anyOne("/me/room/id", doc)).toBe("/me/room/id");
    expect(anyOne("/nowhere/12", doc)).toBe("/nowhere/*"); // past the document, an id is still any one
    expect(anyOne("", doc)).toBe("");
    // a list document is its one table, its rows by number: the table is itself, each row any one (wrong before: the table read as a row)
    const list = { messages: { "1": { text: "hi" }, "2": { text: "yo" } } };
    expect(anyOne("/messages/2/text", list)).toBe("/messages/*/text");
    expect(anyOne("/messages", { messages: {} })).toBe("/messages");
    // every path, escaped as a pointer is, and what is at each: an array's end holds its first member's shape
    expect(pathsIn(doc)).toEqual(["", "/quotes", "/quotes/ALPH", "/quotes/ALPH/price", "/quotes/BRVO", "/quotes/BRVO/price", "/guests", "/guests/0", "/guests/0/name", "/guests/-", "/me", "/me/name", "/me/room", "/me/room/id", "/a~1b~0"]);
    expect(valueAt(doc, "/a~1b~0")).toBe(3);
    expect(valueAt(doc, "/guests/-")).toEqual({ name: "Ada" });
    expect(valueAt(doc, "/me/name/first")).toBeUndefined();
  });
});

describe("hear: a member's page, kept as the client keeps it", () => {
  const page = `<main><div data-eta-part="site" class="site" data-page="a"><ul data-eta-part="list"><li data-eta-part="r1">one</li></ul></div></main>`;

  test("a whole render replaces it; a tag is swapped as text, exactly as a fresh render reads", () => {
    expect(hear("old", { type: "render", html: page })).toBe(page);
    expect(hear(page, { type: "render", ops: [{ op: "tag", target: '[data-eta-part="site"]', html: `<div data-eta-part="site" class="site locked" data-page='b'>` }] })).toBe(
      `<main><div data-eta-part="site" class="site locked" data-page='b'><ul data-eta-part="list"><li data-eta-part="r1">one</li></ul></div></main>`,
    );
  });

  test("rows go in beside a neighbour and come out; a tag for a part the page no longer has changes nothing", () => {
    const two = hear(page, { type: "render", ops: [{ op: "after", target: '[data-eta-part="r1"]', html: `<li data-eta-part="r2">two</li>` }, { op: "before", target: '[data-eta-part="r1"]', html: `<li data-eta-part="r0">zero</li>` }] });
    expect(two).toContain(`<li data-eta-part="r0">zero</li><li data-eta-part="r1">one</li><li data-eta-part="r2">two</li>`);
    expect(hear(two, { type: "render", ops: [{ op: "remove", target: '[data-eta-part="r1"]' }] })).not.toContain("one");
    expect(hear(page, { type: "render", ops: [{ op: "tag", target: '[data-eta-part="gone"]', html: "<div>" }] })).toBe(page);
    expect(hear(page, { type: "patch" })).toBe(page);
  });

  test("a part that moves from one parent part to another is where it went, and not where it was", () => {
    const view = (at: "a" | "b") => part("root", `<div>${["a", "b"].map((k) => part(k, `<section>${at === k ? part("head", "<header>H</header>") : ""}</section>`)).join("")}</div>`);
    for (const [from, to] of [["b", "a"], ["a", "b"]] as const) {
      const [before, after] = [drawParts(() => view(from)), drawParts(() => view(to))];
      expect(hear(before.html, { type: "render", ops: diff(before, after) })).toBe(after.html);
    }
  });
});

describe("the patch stream: what an applet that takes a document's patches holds", () => {
  const mount = (props: string, under = "") => `<main><div id="board" data-applet="board" data-doc="ticker:market"${under ? ` data-under="${under}"` : ""} data-props="${props}"></div><div data-applet="plain" data-props="{}"></div></main>`;

  test("a page's applets that take patches, by id, with their props unescaped and where the document sits", () => {
    const found = takersOn(mount("{&quot;quotes&quot;:{&quot;A&quot;:1}}", "/quotes"));
    expect([...found]).toEqual([["board", { applet: "board", doc: "ticker:market", under: "/quotes", props: '{"quotes":{"A":1}}' }]]);
    expect([...takersOn(`<i data-doc="x"></i><b data-doc="y" data-eta-part="p"></b>`).keys()]).toEqual(["#0", "p"]);
  });

  test("a render that carries an applet's mount with props other than it holds starts it again from them; one that does not carry it, or carries what it holds, keeps what it took; one gone is let go", () => {
    const taken = new Map();
    retake(taken, mount("{&quot;A&quot;:1}"));
    taken.get("board").ops.push({ op: "replace", path: "/A", value: 2 });
    retake(taken, mount("{&quot;A&quot;:1}"), { type: "render", ops: [{ op: "replace", target: "#elsewhere", html: "<p>x</p>" }] }); // not the mount: its attribute is still the first render's
    expect(holding(taken.get("board"))).toEqual({ value: { A: 2 } });
    retake(taken, mount("{&quot;A&quot;:2}"), { type: "render", html: mount("{&quot;A&quot;:2}") }); // what it holds
    expect(taken.get("board").ops).toHaveLength(1);
    retake(taken, mount("{&quot;A&quot;:1}"), { type: "render", html: mount("{&quot;A&quot;:1}") }); // a page drawn afresh with the first render's props: undone while the socket was down
    expect(holding(taken.get("board"))).toEqual({ value: { A: 1 } });
    retake(taken, mount("{&quot;A&quot;:5}"));
    expect(holding(taken.get("board"))).toEqual({ value: { A: 5 } });
    retake(taken, "<main></main>");
    expect(taken.size).toBe(0);
  });

  test("what a page shows is compared without the versions its watching mounts hold: an undo moves them on, and nobody sees it", () => {
    expect(unversioned(`<div data-doc="d" data-v="12" data-props="{}"></div><p data-value="v">x</p>`)).toBe(`<div data-doc="d" data-props="{}"></div><p data-value="v">x</p>`);
  });

  test("a patch at or below the version the mount's props hold is held already, and passed over; above it, taken, and the version moves", () => {
    const rows = (json: string, v: number) => `<main><div id="t" data-eta-part="t" data-applet="tally" data-doc="list:1" data-under="/rows" data-v="${v}" data-props="${json.replaceAll('"', "&quot;")}"></div></main>`;
    const taken = new Map();
    retake(taken, rows('{"rows":[{"n":1}]}', 1));
    expect(taken.get("t")).toMatchObject({ v: 1 });
    // a render drawn after the change comes before its patch, which it holds
    const two = rows('{"rows":[{"n":1},{"n":2}]}', 2);
    retake(taken, two, { type: "render", ops: [{ op: "tag", target: '[data-eta-part="t"]', html: splitTag(two.slice("<main>".length))[0] }] });
    taking(taken, { doc: "list:1", version: 2, ops: [{ op: "add", path: "/-", value: { n: 2 } }] });
    taking(taken, { doc: "list:1", version: 3, ops: [{ op: "add", path: "/-", value: { n: 3 } }] });
    taking(taken, { doc: "list:2", version: 9, ops: [{ op: "add", path: "/-", value: { n: 9 } }] }); // another document's
    expect(holding(taken.get("t"))).toEqual({ value: { rows: [{ n: 1 }, { n: 2 }, { n: 3 }] } });
    expect(taken.get("t").v).toBe(3);
    // a mount that says no version takes every patch
    const board = new Map();
    retake(board, mount("{&quot;A&quot;:1}"));
    taking(board, { doc: "ticker:market", version: 1, ops: [{ op: "replace", path: "/A", value: 2 }] });
    expect([holding(board.get("board")), board.get("board").v]).toEqual([{ value: { A: 2 } }, undefined]);
  });

  test("a member's applets against a fresh page: held as it has them, missed props, ops that do not land; one not on the fresh page is the page's to say", () => {
    const taken = new Map();
    retake(taken, mount("{&quot;A&quot;:1,&quot;B&quot;:{&quot;b&quot;:1}}"));
    taken.get("board").ops.push({ op: "replace", path: "/A", value: 2 });
    expect(unheld("ann's", taken, mount("{&quot;B&quot;:{&quot;b&quot;:1},&quot;A&quot;:2}"))).toEqual([]); // keys in any order
    expect(unheld("ann's", taken, mount("{&quot;A&quot;:3,&quot;B&quot;:{&quot;b&quot;:1}}"))[0]).toStartWith("ann's board holds what a fresh render does not");
    taken.get("board").ops.push({ op: "remove", path: "/C" });
    expect(unheld("ann's", taken, mount("{}"))).toEqual(["ann's board was sent ticker:market ops that do not land on its props: Path not found: \"/C\" is not there to remove"]);
    expect(unheld("ann's", taken, "<main></main>")).toEqual([]);
  });

  test("ops land where the document sits in the props, or say why they do not", () => {
    expect(holding({ applet: "board", doc: "d", under: "/quotes", props: '{"quotes":{"A":1}}', ops: [{ op: "replace", path: "/A", value: 3 }] })).toEqual({ value: { quotes: { A: 3 } } });
    expect(holding({ applet: "board", doc: "d", under: "", props: '{"quotes":{}}', ops: [{ op: "replace", path: "/A", value: 3 }] })).toEqual({ error: 'Path not found: "/A" is not there to replace' });
  });
});

describe("hear, after a render in parts: the page as a fresh render draws it, wherever a part went", () => {
  // two days of stops, the tea moving between them; and a split before them, which draws what it
  // holds twice, as columns and as rows, so that there it is no part
  const days = (tea: "mon" | "tue" | "split") => {
    const row = (how = "") => part("tea", `<li${how}>tea</li>`);
    const day = (d: string) => part(d, `<section><ul>${part(`${d}-walk`, `<li>walk</li>`)}${tea === d ? row() : ""}</ul></section>`);
    return `<main>${part("split", `<div><ul>${tea === "split" ? row(' class="col"') : ""}</ul><ol>${tea === "split" ? row(' class="row"') : ""}</ol></div>`)}${day("mon")}${day("tue")}</main>`;
  };

  test("a row that moves to another list is where it went, and not where it was, whichever comes first; and so is one drawn twice", () => {
    for (const [from, to] of [["tue", "mon"], ["mon", "tue"], ["mon", "split"], ["split", "tue"]] as const) {
      const [before, after] = [drawParts(() => days(from)), drawParts(() => days(to))];
      expect(hear(before.html, { type: "render", ops: diff(before, after) })).toBe(after.html);
    }
  });

  test("a wider walk: several changes a render, a row's tag alone, moved and changed at once, a twin that draws its rows twice, a list with more than rows, three deep: every page as drawn afresh", () => {
    type Row = { key: string; in: string; at: number; text: string; cls: string };
    let removedInside = 0;
    for (let s = 1; s <= 5; s++) {
      let seed = s * 7919;
      const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
      const any = <T,>(xs: T[]): T => xs[Math.floor(random() * xs.length)]!;
      let title = "C";
      const page = (rows: Row[]) => {
        const inside = (at: string, how = ""): string =>
          rows.filter((r) => r.in === at).sort((a, b) => a.at - b.at).map((r) => part(r.key, `<li class="${r.cls}"${how}>${r.text}<ul>${inside(r.key)}</ul></li>`)).join("");
        const list = (key: string) => part(key, `<section><ul>${inside(key)}</ul></section>`);
        const split = part("split", `<div><ul>${inside("split", ' data-x="col"')}</ul><ol>${inside("split", ' data-x="row"')}</ol></div>`);
        const twin = part("twin", `<div><ul>${inside("twin")}</ul><ul>${inside("twin")}</ul></div>`);
        return `<main>${inside("page")}${split}${twin}${list("a")}${list("b")}${part("c", `<section><h2>${title}</h2><ul>${inside("c")}<li>+</li></ul></section>`)}</main>`;
      };
      const holds = (rows: Row[], key: string): string[] => [key, ...rows.filter((r) => r.in === key).flatMap((r) => holds(rows, r.key))];
      const doubled = (rows: Row[], r: Row | undefined): boolean => !!r && (r.in === "split" || r.in === "twin" || doubled(rows, rows.find((q) => q.key === r.in)));
      /** Where a row may go: anywhere but into itself; where rows are drawn twice only holding nothing, and never into a row there. */
      const places = (rows: Row[], row?: Row): string[] => {
        const mine = row ? holds(rows, row.key) : [];
        return ["page", "a", "b", "c", ...(mine.length > 1 ? [] : ["split", "twin"]), ...rows.filter((r) => !mine.includes(r.key) && !doubled(rows, r)).map((r) => r.key)];
      };
      let made = 0;
      for (let walk = 0; walk < 60; walk++) {
        let rows: Row[] = [];
        title = "C";
        let before = drawParts(() => page(rows));
        for (let step = 0; step < 10; step++) {
          const next = rows.map((r) => ({ ...r }));
          for (let change = Math.floor(random() * 3); change >= 0; change--) {
            const row = next.length ? any(next) : undefined;
            const roll = random();
            if (!row || roll < 0.2) next.push({ key: `r${made++}`, in: any(places(next)), at: random(), text: "new", cls: "a" });
            else if (roll < 0.5) Object.assign(row, { in: any(places(next, row)), at: random() });
            else if (roll < 0.6) Object.assign(row, { in: any(places(next, row)), at: random(), text: `m${Math.floor(random() * 9)}`, cls: any(["a", "b"]) });
            else if (roll < 0.7) row.at = random();
            else if (roll < 0.8) row.text = `t${Math.floor(random() * 9)}`;
            else if (roll < 0.88) row.cls = row.cls === "a" ? "b" : "a";
            else if (roll < 0.9) title = title === "C" ? "D" : "C";
            else {
              const gone = holds(next, row.key);
              next.splice(0, next.length, ...next.filter((r) => !gone.includes(r.key)));
            }
          }
          const after = drawParts(() => page(next));
          const ops = diff(before, after);
          removedInside += (ops ?? []).filter((o) => o.op === "remove" && o.target.includes(" ")).length;
          expect(ops === undefined ? after.html : hear(before.html, { type: "render", ops })).toBe(after.html);
          [rows, before] = [next, after];
        }
      }
    }
    expect(removedInside).toBeGreaterThan(300); // 3000 renders, and rows taken out of where they left, named there
  });
});

// J: a story fails, and says which page read what, so the fix is first time. Chat, broken on
// purpose: a story that puts its change where nobody reads it, writes each check refuses, and
// controls the wire would refuse without a word.
describe("a failure that says why", () => {
  const only = (prefix: string): Story[] => stories.stories.filter((s) => s.name.startsWith(prefix));
  const withOwner = (docType: string, f: (c: Resource) => Resource): Example => ({ ...example, resources: example.resources.map((c) => (c.docType === docType ? f(c) : c)) });
  const refusing = (reason: string): never => {
    throw refuse(reason);
  };

  test("A story fails, and says which page read what, so the fix is first time: someone not told names the documents their page read and the one written", async () => {
    const failures = await failuresOf(example, [{ name: "Ada says hello, and Cy, in the kitchen, sees it", as: "ada", does: say("hello"), seen: ["ada", "bob", "cy"] }]);
    expect(failures).toEqual(["cy did not see it: cy's page read session, here:kitchen, room:kitchen; the write was to room:general"]);
    // a page that reads what it does not show is told all the same, and says what it read
    const leaky: Example = { ...example, render: (sessionId) => (read("room:general"), example.render(sessionId)) };
    expect(await failuresOf(leaky, only("Ada says hello"))).toContain("after the story, cy was told of room:general, and should not have been: cy's page read room:general, session, here:kitchen, room:kitchen");
    // a tab closing names what it changed
    expect(await failuresOf(example, [{ name: "Bob closes his tab, and Cy sees it", as: "bob", closesTab: true, seen: ["ada", "cy"] }])).toEqual(["cy did not see it: cy's page read session, here:kitchen, room:kitchen; the tab closing changed here:general"]);
  }, 30000);

  test("A story fails, and says which page read what, so the fix is first time: a write refused says which check refused it, in the resource's words", async () => {
    const saying = withOwner("room", (room) => ({
      ...room,
      permit: (ws, op, id) => (op.value === "hi" ? refusing("Not now.") : room.permit!(ws, op, id)),
      shape: (ws, id, ops) => (ops[0]!.value === "nothing" ? [] : ops[0]!.value === "at length" ? refusing("Say less.") : ops[0]!.value === "nowhere" ? [{ op: "replace", path: "/nowhere/at/all", value: 1 }] : room.shape!(ws, id, ops)),
    }));
    const told = (name: string, as: string, does: { doc: string; ops: PatchOp[] }): Story => ({ name, as, does, seen: [as] });
    const report = await run(saying, {
      ...stories,
      stories: [
        told("Ada says hi", "ada", say("hi")),
        told("Ada says nothing", "ada", say("nothing")),
        told("Ada speaks at length", "ada", say("at length")),
        told("Ada says something delta cannot keep", "ada", say("nowhere")),
        told("Ada goes into general, where she is", "ada", enter("general")),
        told("Ada says who is here", "ada", { doc: "here:general", ops: [{ op: "add", path: "/people/ada", value: "Ada" }] }),
        told("Dee speaks in general from the list of rooms", "dee", { doc: "room:general", ops: [{ op: "add", path: "/messages/-", value: "hi" }] }),
      ],
    });
    const refused = report.outcomes.map((o) => o.failures.find((f) => f.startsWith("nothing landed")));
    expect(refused).toEqual([
      'nothing landed: ada\'s write was refused by room\'s permit: "Not now."',
      "nothing landed: ada's write was refused by room's shape",
      'nothing landed: ada\'s write was refused by room\'s shape: "Say less."',
      "nothing landed: ada's write was refused past room's permit and shape: delta applied nothing",
      "nothing landed: ada's write was refused by session's shape",
      "nothing landed: ada's write was refused, as here:general is a memory document, which the wire does not write",
      "nothing landed: dee's write was refused, as dee's page did not read room:general: it read session, lobby:all",
    ]);
  }, 30000);

  test("A story fails, and says which page read what, so the fix is first time: a control the wire would refuse without a word is said, by its page, once", async () => {
    // the session's permit says why it refuses a mood; the room takes what it is sent, unshaped
    const wired = withOwner("session", (session) => ({ ...session, permit: (ws, op, id) => (op.path === "/mood" ? refusing("No moods.") : session.permit!(ws, op, id)) }));
    const careless: Example = {
      ...wired,
      resources: wired.resources.map((c) => (c.docType === "room" ? { ...c, shape: undefined } : c)),
      render: (sessionId) =>
        example.render(sessionId) +
        part(
          "careless",
          [
            `<button${write("room:kitchen", "add", "/messages/-", "psst")}>Psst</button>`, // a document the page forgot to read
            `<button${write("session", "replace", "room", "general")}>In</button>`, // a path with no slash
            `<button${write("session", "move" as "add", "/room")}>Move</button>`, // an op the wire has not
            `<input name="nickname"${write("session", "replace", "/nickname")}>`, // nothing there, and the permit says no without a word
            `<input name="mood"${write("session", "replace", "/mood")}>`, // nothing there, and the permit says why
            `<button disabled${write("session", "replace", "/nickname", "x")}>x</button>`, // sends nothing
            `<button${write("room", "replace", "/topic", "x")}>Topic</button>`, // a room, unshaped, has no topic
          ].join(""),
        ),
    };
    const report = await run(careless, { ...stories, stories: only("Bob closes his tab") });
    expect(report.warnings!.filter((w) => w.story.startsWith("a control the wire refuses")).map((w) => `${w.story} | ${w.says}`)).toEqual([
      `a control the wire refuses, on ada's page | button[data-value='"psst"'], add /messages/- on room:kitchen: the page did not read room:kitchen`,
      `a control the wire refuses, on ada's page | button[data-value='"general"'], replace room on session: room is not a JSON Pointer`,
      "a control the wire refuses, on ada's page | button, move /room on session: move is not add, replace, remove or test",
      'a control the wire refuses, on ada\'s page | input[name="nickname"], replace /nickname on session: session holds nothing at /nickname, and its permit refuses it without a word',
      `a control the wire refuses, on ada's page | button[data-value='"x"'], replace /topic on room: the page did not read room`, // her page before she has a name: in no room
      `a control the wire refuses, on ada's page | button[data-value='"x"'], replace /topic on room: room holds nothing at /topic to replace`,
    ]);
  }, 30000);

  test("a JSON Pointer is held where each step is a key of what is there, an array's by its index", () => {
    const doc = { a: { "b/c": [1, { "d~": null }] } };
    expect(["", "/a", "/a/b~1c", "/a/b~1c/0", "/a/b~1c/1/d~0"].every((p) => holds(doc, p))).toBe(true);
    expect(["/b", "/a/b~1c/2", "/a/b~1c/-", "/a/b~1c/length", "/a/b~1c/0/x", "/a/b~1c/01"].some((p) => holds(doc, p))).toBe(false);
  });
});

describe("a select, held to the wire", () => {
  test("is probed with the option it was drawn showing, as the browser sends it: the last selected, else the first not disabled, or none in a list", () => {
    const w = (body: string, attrs = "") => writesOn(`<select data-write='{"doc":"answer","op":"replace","path":"/kind"}' aria-label="Kind"${attrs}>${body}</select>`).map((x) => x.value);
    expect(w(`<option value="yes">Yes</option><option value="no" selected>No</option>`)).toEqual(["no"]);
    expect(w(`<option value="a" selected>A</option><option value="b" selected>B</option>`)).toEqual(["b"]); // the last selected
    expect(w(`<option value="x" disabled>X</option><option value="peek">Peek</option>`)).toEqual(["peek"]); // the first not disabled
    expect(w(`<optgroup disabled><option value="x">X</option></optgroup><option value="r">r</option>`)).toEqual(["r"]); // a disabled group's options choose nothing
    expect(w(`<option>  Read  only </option>`)).toEqual(["Read only"]); // no value: its words
    expect(w(`<option value="yes">Yes</option>`, ` size="3"`)).toEqual([]); // a list shows nothing chosen: nothing to send
    expect(w(`<option value="r" selected>r</option>`, ` multiple`)).toEqual([]); // several at once: no one value
    expect(writesOn(`<select data-write='{"doc":"d","op":"replace","path":"/k"}' disabled><option value="a">A</option></select>`)).toEqual([]); // drawn disabled: sends nothing
  });
});

test("bun run stories never opens the app's own database: DB_PATH is set before anything loads (cafe-c's feedback)", async () => {
  const { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(`${tmpdir()}/stories-run-`);
  try {
    mkdirSync(`${dir}/src`);
    writeFileSync(`${dir}/src/stories.ts`, "export const stories = { cast: {}, stories: [] };\n");
    const env: Record<string, string | undefined> = { ...process.env, ETA_EXAMPLE: "./src" };
    delete env.DB_PATH;
    const p = Bun.spawn(["bun", `${import.meta.dir}/stories-run.ts`], { cwd: dir, env, stdout: "pipe", stderr: "pipe" });
    expect(await new Response(p.stdout).text()).toContain("no app yet");
    await p.exited;
    expect(existsSync(`${dir}/db.sqlite`)).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
