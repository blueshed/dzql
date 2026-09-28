import { describe, expect, setSystemTime, spyOn, test } from "bun:test";
import type { PatchOp } from "./json-patch";
import { createLocal } from "@blueshed/delta/local";
import { registerMemory } from "@blueshed/delta/kinds";
import { defineDoc, registerDocs } from "@blueshed/delta/sqlite";
import { example } from "../examples/chat";
import { db, schema } from "../examples/chat/delta";
import { stories } from "../examples/chat/stories";
import type { Compartment } from "./compartments/compartment";
import { read } from "./documents";
import { appletProps, appletWrites, write } from "./html";
import type { Example } from "./example";
import { size } from "./costs";
import { comparable, controlsOn, goesTo, hear, holding, largest, MOST_PROPS, offers, placeOf, print, propsCost, retake, run, takersOn, unheld, type Outcome, type Report, type Trace, type Wire } from "./harness";
import { diff, drawParts, part, splitTag } from "./parts";
import type { Story } from "./stories";
import { refuse } from "./refusal";

// The harness against chat's own stories: one outcome per story, named as the story is, and the
// cast's setup shared by all. What each story finds is the example's business (a failing story is
// a finding, not a broken harness); this checks the harness runs every story and reports honestly.
describe("stories harness", () => {
  test("runs every story and reports by name", async () => {
    const report = await run(example, stories);
    expect(report.outcomes.map((o) => o.name)).toEqual(stories.stories.map((s) => s.name));
    expect(report.passed + report.failed).toBe(stories.stories.length);
    const seen = report.outcomes.find((o) => o.name.startsWith("Ada says hello"))!;
    expect(seen.failures.filter((f) => f.includes("did not see") || f.includes("noticed"))).toEqual([]);
    const refused = report.outcomes.find((o) => o.name.startsWith("Nobody can take"))!;
    expect(refused.failures).toEqual([]);
    print(report);
  }, 30000);

  test("an observer is told each write as the wire carried it: who heard what, and what the ledger took", async () => {
    const traces: Trace[] = [];
    const pick = (start: string) => stories.stories.find((s) => s.name.startsWith(start))!;
    const report = await run(example, { cast: stories.cast, stories: [pick("Ada says hello"), pick("Nobody can take"), pick("Bob closes his tab")] }, (t) => traces.push(t));
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
  }, 30000);

  describe("a story's cost on the wire", () => {
    const pick = (start: string) => stories.stories.find((s) => s.name.startsWith(start))!;
    const [hello, take, close] = [{ ...pick("Ada says hello"), budget: undefined }, pick("Nobody can take"), pick("Bob closes his tab")]; // hello's own budget aside: each test says its own
    /** What a budget says of each page handed more than it, on each step of a story: its write (or refusal, or tab closing), then its undo, then its redo. */
    const failing = (o: Outcome, whose: string, budget: number, step = "write") =>
      (["handed", "undo", "redo"] as const).flatMap((phase) =>
        (o.wire![phase] ?? []).filter((h) => h.bytes > budget).map((h) => `${h.member}'s page was handed ${h.bytes.toLocaleString("en")} bytes on the ${phase === "handed" ? step : phase}, more than the ${whose} budget of ${budget.toLocaleString("en")}: the most, ${h.most.part}, ${size(h.most.bytes)}`),
      );

    test("each member's page is handed what the story's own step sent it, as the page takes it and as it crossed the wire, beside the write's own size, with its biggest part named", async () => {
      const report = await run(example, { cast: stories.cast, stories: [hello, take, close] });
      expect(report.failed).toBe(0);
      const [said, refused, closed] = report.outcomes.map((o) => o.wire!) as [Wire, Wire, Wire];
      expect(said.write).toBe(Buffer.byteLength(JSON.stringify(hello.does)));
      expect(said.handed.map((h) => h.member)).toEqual(["ada", "bob"]); // cy, in the kitchen, and dee and eve, in no room, are handed nothing
      expect(said.handed.map((h) => h.most.part)).toEqual(["messages", "messages"]); // the new message, beside the last: a part of the messages
      expect([said.undo, said.redo].map((phase) => phase!.map((h) => h.member))).toEqual([["ada", "bob"], ["ada", "bob"]]); // an undo and a redo are writes too, to the same pages
      expect(refused.write).toBe(Buffer.byteLength(JSON.stringify(take.cannot)));
      expect(refused.handed.map((h) => h.member)).toEqual(["ada"]); // told no, and her page handed back
      expect(refused.handed[0]!.most.part).toBe("the whole page");
      expect(refused.handed[0]!.sent).toBeLessThan(refused.handed[0]!.bytes / 2); // a page crosses the wire compressed
      expect(closed.write).toBeUndefined(); // a tab closing writes nothing
      expect(closed.handed.map((h) => h.member)).toEqual(["ada"]);
      expect([refused.undo, refused.redo, closed.undo, closed.redo]).toEqual([undefined, undefined, undefined, undefined]); // nothing to undo
      for (const h of [...said.handed, ...said.undo!, ...said.redo!, ...refused.handed, ...closed.handed]) {
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
        { name: "Ada says hello and Eve, who is nowhere, sees it", as: "ada", does: { doc: "room", ops: [{ op: "add", path: "/messages/-", value: "hi" }] }, seen: { eve: "" }, untold: ["cy"] },
        // a refusal that is false: Ada may speak, so her page changes, and the excerpt says where
        { name: "Ada cannot say hello", as: "ada", cannot: { doc: "room", ops: [{ op: "add", path: "/messages/-", value: "hi" }] } },
        // a refusal told as saying why, where chat's says nothing
        { name: "Eve, with no name, is told she needs one", as: "eve", cannot: { doc: "session", ops: [{ op: "replace", path: "/room", value: "general" }] }, told: "You need a name first." },
      ],
    });
    delete process.env.STORY_DIFF;
    expect(report.failed).toBe(4);
    expect(report.outcomes[3]!.failures).toEqual(['refused, but eve was not told "You need a name first."']);
    expect(report.outcomes[2]!.failures.join("\n")).toMatch(/refused, but: ada's page differs\n\s+expected …/);
    expect(report.outcomes[0]!.failures[0]).toContain("ghost");
    expect(report.outcomes[1]!.failures).toContain('eve did not see it on ""');
  }, 30000);

  test("a story is one kind, with only its own keys: one that mixes them fails by name and is not run, so no half of it is dropped", async () => {
    const say = { doc: "room", ops: [{ op: "add" as const, path: "/messages/-", value: "hi" }] };
    const general = { doc: "session", ops: [{ op: "replace" as const, path: "/room", value: "general" }] };
    const misshapen = (story: object) => story as Story; // what the types refuse, as a story file that is not type-checked says it
    const report = await run(example, {
      cast: stories.cast,
      stories: [
        misshapen({ name: "Bob says hi and closes his tab", as: "bob", does: say, closesTab: true, seen: ["ada"] }),
        misshapen({ name: "Eve cannot go into general, and closes her tab", as: "eve", cannot: general, closesTab: true, seen: ["ada"] }),
        misshapen({ name: "Bob closes his tab from general", as: "bob", closesTab: true, from: "general", seen: ["ada"] }),
        misshapen({ name: "Bob does not close his tab", as: "bob", closesTab: false, seen: ["ada"] }),
        misshapen({ name: "Bob is somewhere", as: "bob", seen: ["ada"] }),
        misshapen({ name: "Eve cannot go into general, and Ada sees nothing", as: "eve", cannot: general, seen: ["ada"], untold: ["ada"] }),
        misshapen({ name: "Ada says hi, told something, by an old name", as: "ada", does: say, seen: ["ada", "bob"], told: "hi", unseen: ["cy"] }),
        { name: "Ada says hi, with nothing left undefined counted", as: "ada", does: say, from: undefined, seen: ["ada", "bob"], untold: ["cy"] },
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
      stories: [{ name: "Ada says hello, and only Ada sees it", as: "ada", does: { doc: "room", ops: [{ op: "add", path: "/messages/-", value: "hello" }] }, seen: ["ada"] }],
    });
    expect(report.outcomes[0]!.failures.map((f) => f.split("\n")[0])).toEqual(["bob noticed, and should not have"]);
  }, 30000);

  test("a story is done from the author's page: no control for it fails, so does a write that lands nothing, and so does a button offered that is always refused", async () => {
    const say = { doc: "room", ops: [{ op: "add" as const, path: "/messages/-", value: "hi" }] };
    const room = (value: string) => ({ doc: "session", ops: [{ op: "replace" as const, path: "/room", value }] });
    const report = await run(example, {
      cast: stories.cast,
      stories: [
        // Dee is choosing a room: nowhere on her page to say anything, and nothing to say it in
        { name: "Dee speaks before she is in a room", as: "dee", does: say, seen: ["dee"] },
        // the form is there; a blank name is refused, so nothing lands
        { name: "Dee enters a room with no name", as: "dee", does: room("  "), seen: ["dee"] },
        // a button on Dee's page sends exactly this: a story that calls it refused says so
        { name: "Dee cannot go into general", as: "dee", cannot: room("general") },
      ],
    });
    const first = (i: number) => report.outcomes[i]!.failures.map((f) => f.split("\n")[0]);
    expect(first(0)).toContain("dee has no control on their page for add /messages/- on room");
    expect(first(0)).toContain("nothing landed: dee's write was refused");
    expect(first(1)).not.toContain("dee has no control on their page for replace /room on session");
    expect(first(1)).toContain("nothing landed: dee's write was refused");
    expect(first(2)).toContain("dee's page offers this, and it is refused without a word: a control that always fails");
  }, 30000);

  test("a story's premise is its own: made before it, as each member it names, rolled back with it; one whose write changes nothing is not told", async () => {
    const say = { doc: "room", ops: [{ op: "add" as const, path: "/messages/-", value: "hello" }] };
    const general = { doc: "session", ops: [{ op: "replace" as const, path: "/room", value: "general" }] };
    const report = await run(example, {
      cast: stories.cast,
      stories: [
        { name: "Cy, back in general, sees Ada say hello", as: "ada", premise: { cy: [general] }, does: say, seen: ["ada", "bob", "cy"], untold: ["dee", "eve"] },
        { name: "Cy, in the kitchen again, is told nothing of it", as: "ada", does: say, seen: ["ada", "bob"], untold: ["cy"] },
        { name: "Eve, with no name, is in general first", as: "ada", premise: { eve: [general] }, does: say, seen: ["ada", "bob"] },
        { name: "A ghost is in general first", as: "ada", premise: { ghost: [general] }, does: say, seen: ["ada", "bob"] },
        { name: "Dee goes into general twice", as: "ada", premise: { dee: [general, general] }, does: say, seen: ["ada", "bob", "dee"] },
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
      `<button data-write='{"doc":"room","op":"replace","path":"/name"}' data-value="Tess &amp; Tom">x</button>`,
      `<button data-write='{"doc":"ledger","op":"remove","path":"/latest"}'>undo</button>`,
      `<button data-write='{"doc":"household","op":"replace","path":"/answer"}' data-value="maybe" disabled>maybe</button>`,
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

  test("a cast signs in through the example's own sign-in route; one that cannot is said, not run as a visitor", async () => {
    const { example: leave } = await import("../examples/leave/index");
    const { stories: told } = await import("../examples/leave/stories");
    const first = told.stories.slice(0, 1);
    expect((await run(leave, { ...told, stories: first })).failed).toBe(0);
    const wrong = { ...told, stories: first, signIn: (name: string) => (name === "visitor" ? undefined : { path: "/login", form: { email: `${name}@leave.example`, password: "not-it" } }) };
    expect(run(leave, wrong)).rejects.toThrow("ann could not sign in at /login: 303");
  }, 30000);

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
    const { example: ticker } = await import("../examples/ticker/index");
    const { stories: told } = await import("../examples/ticker/stories");
    const desk = (page: string) => ({ doc: "desk", ops: [{ op: "replace" as const, path: "/page", value: page }] });
    const report = await run(ticker, { ...told, stories: [{ name: "Ann, asked about Alpha, opens Bravo's drawer behind the question", as: "ann", from: "market?confirm=ALPH", does: desk("market?symbol=BRVO"), seen: ["ann"] }] });
    expect(report.outcomes[0]!.failures).toEqual(["ann has no control on their page for replace /page on desk"]);
  }, 30000);

  test("a story stands where it stands whatever the day: leave's, under October's clock, where the month they name is this one", async () => {
    const { example: leave } = await import("../examples/leave/index");
    const { stories: told } = await import("../examples/leave/stories");
    setSystemTime(new Date("2026-10-15T12:00:00Z"));
    try {
      const report = await run(leave, told);
      expect(report.outcomes.flatMap((o) => o.failures)).toEqual([]);
    } finally {
      setSystemTime();
    }
  }, 60000);

  test("an applet on a document offers only what its mount says it writes: a drawer that lost its picker fails the story, though the clock's face reads the same document", async () => {
    const { example: ticker } = await import("../examples/ticker/index");
    const { stories: told } = await import("../examples/ticker/stories");
    const tokyo = told.stories.filter((s) => s.name.startsWith("Ann sets her clock to Tokyo"));
    expect((await run(ticker, { ...told, stories: tokyo })).outcomes[0]!.failures).toEqual([]);
    const pickerless: Example = { ...ticker, render: (sessionId) => ticker.render(sessionId).replace(/<div id="city"[^]*?<\/datalist><\/div>/, "") };
    expect((await run(pickerless, { ...told, stories: tokyo })).outcomes[0]!.failures).toEqual(["ann has no control on their page for replace /tz on clock"]);
  }, 30000);

  test("an applet offers only what its mount says it writes: a drawer that lost its control fails its story, whatever applet is beside it", async () => {
    const { example: leave } = await import("../examples/leave/index");
    const { stories: told } = await import("../examples/leave/stories");
    const approve = write("team", "replace", "/requests/1/status", "approved");
    const lost: Example = { ...leave, render: (sessionId) => leave.render(sessionId).replace(approve, "") };
    const report = await run(lost, { ...told, stories: told.stories.filter((s) => s.name.startsWith("Mo approves")) });
    expect(report.outcomes.flatMap((o) => o.failures)).toContain("mo has no control on their page for replace /requests/1/status on team");
  }, 30000);

  test("after the deadline the Okafors are offered nothing to answer or choose with: live answer buttons fail the refusal, and a choice the menu cannot make has no control", async () => {
    const { example: wedding } = await import("../examples/wedding/index");
    const { stories: told } = await import("../examples/wedding/stories");
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

    const { example: leave } = await import("../examples/leave/index");
    const { stories: told } = await import("../examples/leave/stories");
    const stale: Example = { ...leave, render: (sessionId) => leave.render(sessionId).replace(/data-writes='[^']*'/, `data-writes='{"doc":"team","path":"/draft"}'`) };
    const report = await run(stale, { ...told, stories: told.stories.filter((s) => s.name.startsWith("Ann drags across") || s.name.startsWith("Ann cannot move Bo's week")) });
    expect(report.outcomes.map((o) => o.failures.filter((f) => f.startsWith("applet declaration")))).toEqual([
      ['applet declaration must be [doc, op, path]: calendar says {"doc":"team","path":"/draft"}'],
      ['applet declaration must be [doc, op, path]: calendar says {"doc":"team","path":"/draft"}'],
    ]);
  }, 30000);

  // Delivery, not only pages: chat broken on purpose, three ways its own stories could not see.
  const only = (prefix: string): Story[] => stories.stories.filter((s) => s.name.startsWith(prefix));
  const withRoom = (f: (room: Compartment) => Compartment): Example => ({ ...example, compartments: example.compartments.map((c) => (c.docType === "room" ? f(c) : c)) });
  const failuresOf = async (broken: Example, told: Story[]): Promise<string[]> => (await run(broken, { ...stories, stories: told })).outcomes.flatMap((o) => o.failures);

  test("someone the story says is untold, told of the document all the same, fails it: a page that reads what it does not show", async () => {
    const leaky: Example = { ...example, render: (sessionId) => (read("room:general"), example.render(sessionId)) };
    const failures = await failuresOf(leaky, only("Ada says hello"));
    expect(failures).toContain("after the story, cy was told of room:general, and should not have been");
    expect(failures).toContain("after undo, eve was told of room:general, and should not have been");
    expect(failures).toContain("after redo, dee was told of room:general, and should not have been");
  }, 30000);

  test("a tab closing the server does not tell fails its story: nobody still looking sees it", async () => {
    const deaf: Example = { ...example, compartments: example.compartments.map((c) => ({ ...c, onClose: undefined })) };
    const failures = await failuresOf(deaf, only("Bob closes his tab"));
    expect(failures).toEqual(["nothing landed: closing bob's tab changed nothing", "ada did not see it"]);
  }, 30000);

  test("the fresh render is read from storage: a copy that drifted from the tables fails the story, by name", async () => {
    // the tables changed behind delta's back: each message said brings in one nobody said, and the
    // copy every page is drawn from never hears of it -- so the pages agree with the copy. (Not the
    // said message itself: delta reads back each row it writes, as it is kept, and tells that.)
    db.run("CREATE TEMP TRIGGER drift AFTER INSERT ON chat_messages BEGIN INSERT OR REPLACE INTO chat_messages (id, rooms_id, name, text, sent_at) VALUES (NEW.id || '~', NEW.rooms_id, NEW.name, 'not what was said', NEW.sent_at); END");
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
    const { example: ticker } = await import("../examples/ticker/index");
    // the ticker's own story, told here: Ann's desk says she is on her board
    const desk = (page: string) => ({ doc: "desk", ops: [{ op: "replace" as const, path: "/page", value: page }] });
    const watch = { doc: "watchlist", ops: [{ op: "add" as const, path: "/symbols/-", value: "CHRL" }] };
    const watches = { cast: { ann: [desk("board")] }, goTo: desk, stories: [{ name: "Ann, on her board, watches Charlie Metals", as: "ann", from: "board?new", does: watch, seen: { ann: "board" } }] };
    expect((await run(ticker, watches)).failed).toBe(0);
    // Ann's desk row is lost when she watches: the copy keeps the desk, off the ledger, the tables do
    // not. (Not as the desk is written: delta reads back each row it writes, and a desk it cannot
    // find refuses the write.)
    db.run("CREATE TEMP TRIGGER lost AFTER INSERT ON ticker_watchlists BEGIN DELETE FROM ticker_desks WHERE id = NEW.id; END");
    try {
      const failures = (await run(ticker, watches)).outcomes.flatMap((o) => o.failures);
      expect(failures).toContain("after the story, ann's open page is not what a fresh render shows");
    } finally {
      db.run("DROP TRIGGER lost");
    }
  }, 30000);

  test("a refusal that is really the server failing fails the story, and so does one nobody answers", async () => {
    const throwing = withRoom((room) => ({ ...room, permit: () => { throw new Error("a permit that throws"); } }));
    expect((await failuresOf(throwing, only("Nobody can take"))).some((f) => f.startsWith("the server failed") && f.endsWith("a permit that throws"))).toBe(true);

    // the page handed back cannot be drawn: the refusal goes unanswered
    let refusing = false;
    const unanswered: Example = {
      ...withRoom((room) => ({ ...room, permit: (ws, op, id) => ((refusing = true), room.permit!(ws, op, id)) })),
      render: (sessionId) => {
        if (refusing) throw new Error(`the page cannot be drawn${(refusing = false) || ""}`);
        return example.render(sessionId);
      },
    };
    const failures = await failuresOf(unanswered, only("Nobody can take"));
    expect(failures).toContain("refused, but ada was not answered: the page was not handed back");
    expect(failures).toContain("the server failed drawing a page: the page cannot be drawn");
  }, 30000);

  test("a story's write is answered as its own: a refused write says why, a refusal that says another reason is caught, and one that lands is no refusal", async () => {
    const say = { doc: "room", ops: [{ op: "add" as const, path: "/messages/-", value: "hi" }] };
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
        { name: "Ada says hi", as: "ada", does: say, seen: ["ada", "bob"] },
        { name: "Ada cannot take a message back, told one thing", as: "ada", cannot: takeBack, told: "Nobody takes a message back." },
        { name: "Ada cannot take a message back, told why, where her page does not say it", as: "ada", cannot: takeBack, told: "Messages are kept." },
        { name: "Ada cannot say hello", as: "ada", cannot: { ...say, ops: [{ ...say.ops[0]!, value: "hello" }] } },
      ],
    });
    const first = (i: number) => report.outcomes[i]!.failures.map((f) => f.split("\n")[0]);
    expect(first(0)).toContain('nothing landed: ada\'s write was refused: "Not now."');
    expect(first(1)).toEqual(['refused, but ada was not told "Nobody takes a message back.": they were told "Messages are kept."']);
    expect(first(2)).toEqual(['refused and told "Messages are kept.", but ada\'s page does not show it']);
    expect(first(3)).toContain("refused, but it landed: ada's write was echoed back to them");
  }, 30000);

  test("a write that is not on the ledger fails, unless its compartment keeps it off; a compartment that says so and is on it fails too", async () => {
    // chat's documents left off the ledger by mistake: no undo could ever work
    const bare = createLocal();
    registerDocs(bare.server, db, schema, [defineDoc("session:", { root: "sessions", include: [], implied: true }), defineDoc("room:", { root: "rooms", include: ["messages"], implied: true })], []);
    registerMemory(bare.server, { prefix: "here:", empty: () => ({ people: {} }) });
    registerMemory(bare.server, { prefix: "lobby:", empty: () => ({ rooms: {} }) });
    const forgot = await failuresOf({ ...example, delta: bare }, only("Ada says hello"));
    expect(forgot).toContain("the server failed writing room:general: delta recorded no ledger entry: register it with { ledger: true }, or say its compartment keeps it off the ledger (ledger: false)");
    expect(forgot.some((f) => f.startsWith("the server failed writing session: delta recorded no ledger entry"))).toBe(true); // a session's own, named by type

    const lying = await failuresOf(withRoom((room) => ({ ...room, ledger: false })), only("Ada says hello"));
    expect(lying).toContain("the server failed writing room:general: its compartment keeps it off the ledger (ledger: false), yet delta recorded the write");
  }, 30000);

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

  // Where a person can go (n87): the harness puts people anywhere by a session write of its own, so
  // a story could stand where no control leads. The ticker, with controls taken off its pages.
  describe("a story stands only where a control leads", async () => {
    const { example: ticker } = await import("../examples/ticker/index");
    const { stories: told } = await import("../examples/ticker/stories");
    const desk = (page: string) => write("desk", "replace", "/page", page);
    const without = (...controls: string[]): Example => ({ ...ticker, render: (sessionId) => controls.reduce((html, c) => html.replaceAll(c, ""), ticker.render(sessionId)) });
    const named = (prefix: string): Story[] => told.stories.filter((s) => s.name.startsWith(prefix));

    test("a story whose from no page offers a way to fails by name, though the harness can put its author there", async () => {
      const report = await run(without(desk("board?new")), { ...told, stories: named("Ann watches Charlie Metals, and only her board grows") });
      expect(report.outcomes[0]!.failures).toEqual(['no control leads ann to "board?new", where the story has them act']);
      expect((await run(ticker, { ...told, stories: named("Ann watches Charlie Metals, and only her board grows") })).failed).toBe(0);
    }, 30000);

    test("so does a place a seen puts someone, and what a place holds after \" @ \" must be sent from the page there", async () => {
      const report = await run(without(desk("market?symbol=BRVO"), write("desk", "replace", "/reading/board", "list")), { ...told, stories: named("Bravo ticks") });
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
      expect((await run(without(desk("market")), { ...told, stories: drops })).outcomes[0]!.failures).toEqual(['no control leads ann to "market?confirm=ALPH", where the story has them act']);
    }, 30000);
  });

  test("where a person can go is judged from where the story starts: a place another story's write opened is not one this story can reach", async () => {
    const { example: wedding } = await import("../examples/wedding/index");
    const { stories: told } = await import("../examples/wedding/stories");
    // Ben has no plus-one, so nothing on his page opens the plus; the couple giving him one draws it there, for that story alone
    const plus: Story = { name: "Ben, with no plus-one, cannot name one from the plus", as: "ben", from: "?new=guests", cannot: { doc: "household", ops: [{ op: "add", path: "/guests/-", value: "Someone Else" }] } };
    const letBen = told.stories.find((s) => s.name.startsWith("The couple let Ben bring one more"))!;
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
    const desk = (page: string) => ({ doc: "desk", ops: [{ op: "replace" as const, path: "/page", value: page }] });
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
    const desk = (page: string) => ({ doc: "desk", ops: [{ op: "replace" as const, path: "/page", value: page }] });
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
    const { example: ticker } = await import("../examples/ticker/index");
    const { stories: told } = await import("../examples/ticker/stories");
    const ticks = told.stories.filter((s) => s.name.startsWith("Bravo ticks while Ann has its drawer open"));
    const report = await run(ticker, { ...told, stories: [...ticks, ...ticks] });
    expect(report.failed).toBe(0);
    // told twice, said once: the board and the clock sent again as the cast stands where the story says, the spark with the drawer each tick
    expect(report.warnings!.map((w) => [w.story, /was sent the (\S+) applet's props again/.exec(w.says)?.[1]])).toEqual(["board", "clock", "spark"].map((applet) => [ticks[0]!.name, applet]));
    const said: string[] = [];
    const log = spyOn(console, "log").mockImplementation((line: string) => void said.push(line));
    try {
      print(report);
      print({ ...report, warnings: report.warnings!.slice(0, 1) });
    } finally {
      log.mockRestore();
    }
    expect(said).toContain(`warn  ${ticks[0]!.name}\n        ${report.warnings![2]!.says}`);
    expect(said.filter((line) => line.includes("passed"))).toEqual(["\n2 passed, 0 failed, 3 warnings", "\n2 passed, 0 failed, 1 warning"]);
  }, 30000);
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

  test("a render that changes an applet's props starts it again from them; one that does not keeps what it took; one gone is let go", () => {
    const taken = new Map();
    retake(taken, mount("{&quot;A&quot;:1}"));
    taken.get("board").ops.push({ op: "replace", path: "/A", value: 2 });
    retake(taken, mount("{&quot;A&quot;:1}"));
    expect(holding(taken.get("board"))).toEqual({ value: { A: 2 } });
    retake(taken, mount("{&quot;A&quot;:5}"));
    expect(holding(taken.get("board"))).toEqual({ value: { A: 5 } });
    retake(taken, "<main></main>");
    expect(taken.size).toBe(0);
  });

  test("a member's applets against a fresh page: held as it has them, missed props, ops that do not land; one not on the fresh page is the page's to say", () => {
    const taken = new Map();
    retake(taken, mount("{&quot;A&quot;:1,&quot;B&quot;:{&quot;b&quot;:1}}"));
    taken.get("board").ops.push({ op: "replace", path: "/A", value: 2 });
    expect(unheld("ann's", taken, mount("{&quot;B&quot;:{&quot;b&quot;:1},&quot;A&quot;:2}"))).toEqual([]); // keys in any order
    expect(unheld("ann's", taken, mount("{&quot;A&quot;:3,&quot;B&quot;:{&quot;b&quot;:1}}"))[0]).toStartWith("ann's board holds what a fresh render does not");
    taken.get("board").ops.push({ op: "remove", path: "/C" });
    expect(unheld("ann's", taken, mount("{}"))).toEqual(["ann's board was sent ticker:market ops that do not land on its props: remove /C: no such member"]);
    expect(unheld("ann's", taken, "<main></main>")).toEqual([]);
  });

  test("ops land where the document sits in the props, or say why they do not", () => {
    expect(holding({ applet: "board", doc: "d", under: "/quotes", props: '{"quotes":{"A":1}}', ops: [{ op: "replace", path: "/A", value: 3 }] })).toEqual({ value: { quotes: { A: 3 } } });
    expect(holding({ applet: "board", doc: "d", under: "", props: '{"quotes":{}}', ops: [{ op: "replace", path: "/A", value: 3 }] })).toEqual({ error: "replace /A: no such member" });
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

  test("parts moved at random -- between lists, into rows and out of them, to where they are drawn twice -- gone, come and changed: every page as drawn afresh", () => {
    type Row = { key: string; in: string; at: number; text: string };
    let seed = 7;
    const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const any = <T,>(xs: T[]): T => xs[Math.floor(random() * xs.length)]!;
    // a page of rows that may hold rows: at its head, in a split that draws its own twice, and in two lists
    const page = (rows: Row[]) => {
      const inside = (at: string, how = ""): string =>
        rows.filter((r) => r.in === at).sort((a, b) => a.at - b.at).map((r) => part(r.key, `<li${how}>${r.text}<ul>${inside(r.key)}</ul></li>`)).join("");
      const list = (key: string) => part(key, `<section><ul>${inside(key)}</ul></section>`);
      return `<main>${inside("page")}${part("split", `<div><ul>${inside("split", ' class="col"')}</ul><ol>${inside("split", ' class="row"')}</ol></div>`)}${list("a")}${list("b")}</main>`;
    };
    /** A row, and every row it holds. */
    const holds = (rows: Row[], key: string): string[] => [key, ...rows.filter((r) => r.in === key).flatMap((r) => holds(rows, r.key))];
    /** Where a row may go: anywhere but into itself; into the split only holding nothing, and never into a row there (what it held would be drawn twice too). */
    const places = (rows: Row[], row?: Row): string[] => {
      const mine = row ? holds(rows, row.key) : [];
      return ["page", "a", "b", ...(mine.length > 1 ? [] : ["split"]), ...rows.filter((r) => !mine.includes(r.key) && r.in !== "split").map((r) => r.key)];
    };
    let made = 0;
    let moved = 0;
    for (let walk = 0; walk < 300; walk++) {
      let rows: Row[] = [];
      let before = drawParts(() => page(rows));
      for (let step = 0; step < 6; step++) {
        const next = rows.map((r) => ({ ...r }));
        const row = next.length ? any(next) : undefined;
        const roll = random();
        if (!row || roll < 0.2) next.push({ key: `r${made++}`, in: any(places(next)), at: random(), text: "new" });
        else if (roll < 0.6) Object.assign(row, { in: any(places(next, row)), at: random() });
        else if (roll < 0.75) row.at = random();
        else if (roll < 0.9) row.text = `t${Math.floor(random() * 9)}`;
        else {
          const gone = holds(next, row.key);
          next.splice(0, next.length, ...next.filter((r) => !gone.includes(r.key)));
        }
        const after = drawParts(() => page(next));
        const ops = diff(before, after);
        if (next.some((r) => rows.some((was) => was.key === r.key && was.in !== r.in))) moved++;
        expect(ops === undefined ? after.html : hear(before.html, { type: "render", ops })).toBe(after.html);
        [rows, before] = [next, after];
      }
    }
    expect(moved).toBeGreaterThan(300);
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
