import { describe, expect, test } from "bun:test";
import { createLocal } from "@blueshed/delta/local";
import { registerMemory } from "@blueshed/delta/kinds";
import { defineDoc, registerDocs } from "@blueshed/delta/sqlite";
import { example } from "../examples/chat";
import { db, schema } from "../examples/chat/delta";
import { stories } from "../examples/chat/stories";
import type { Compartment } from "./compartments/compartment";
import { read } from "./documents";
import type { Example } from "./example";
import { comparable, hear, holding, print, retake, run, takersOn, unheld } from "./harness";
import type { Story } from "./stories";

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

  test("a story by nobody in the cast, or seen by nobody who could, is a failure, not a crash", async () => {
    process.env.STORY_DIFF = "1"; // the excerpt under a failure is for the builder; make sure it prints
    const report = await run(example, {
      cast: stories.cast,
      stories: [
        { name: "a ghost speaks", as: "ghost", does: { doc: "room", ops: [] }, seen: {} },
        { name: "Ada says hello and Eve, who is nowhere, sees it", as: "ada", does: { doc: "room", ops: [{ op: "add", path: "/messages/-", value: "hi" }] }, seen: { eve: "" }, unseen: ["cy"] },
        // a refusal that is false: Ada may speak, so her page changes, and the excerpt says where
        { name: "Ada cannot say hello", as: "ada", cannot: { doc: "room", ops: [{ op: "add", path: "/messages/-", value: "hi" }] } },
      ],
    });
    delete process.env.STORY_DIFF;
    expect(report.failed).toBe(3);
    expect(report.outcomes[2]!.failures.join("\n")).toMatch(/refused, but: ada's page differs\n\s+expected …/);
    expect(report.outcomes[0]!.failures[0]).toContain("ghost");
    expect(report.outcomes[1]!.failures).toContain('eve did not see it on ""');
  }, 30000);

  // Delivery, not only pages: chat broken on purpose, three ways its own stories could not see.
  const only = (prefix: string): Story[] => stories.stories.filter((s) => s.name.startsWith(prefix));
  const withRoom = (f: (room: Compartment) => Compartment): Example => ({ ...example, compartments: example.compartments.map((c) => (c.docType === "room" ? f(c) : c)) });
  const failuresOf = async (broken: Example, told: Story[]): Promise<string[]> => (await run(broken, { ...stories, stories: told })).outcomes.flatMap((o) => o.failures);

  test("someone the story says is unseen, told of the document all the same, fails it: a page that reads what it does not show", async () => {
    const leaky: Example = { ...example, render: (sessionId) => (read("room:general"), example.render(sessionId)) };
    const failures = await failuresOf(leaky, only("Ada says hello"));
    expect(failures).toContain("after the story, cy was told of room:general, and should not have been");
    expect(failures).toContain("after undo, eve was told of room:general, and should not have been");
    expect(failures).toContain("after redo, dee was told of room:general, and should not have been");
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
    expect(failures).toContain("refused, but ada was not answered: a refusal hands the page back");
    expect(failures).toContain("the server failed drawing a page: the page cannot be drawn");
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

  test("an applet that follows its document's patches is compared without its props; any other element keeps them", () => {
    const board = `<div id="board" data-applet="board" data-doc="ticker" data-props="{&quot;price&quot;:1}"></div>`;
    const photo = `<div id="photo" data-applet="photo" data-props="{&quot;n&quot;:2}"></div>`;
    expect(comparable(board + photo)).toBe(`<div id="board" data-applet="board" data-doc="ticker"></div>` + photo);
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
});

describe("the patch stream: what an applet that takes a document's patches holds", () => {
  const mount = (props: string, at = "") => `<main><div id="board" data-applet="board" data-doc="ticker:market"${at ? ` data-at="${at}"` : ""} data-props="${props}"></div><div data-applet="plain" data-props="{}"></div></main>`;

  test("a page's applets that take patches, by id, with their props unescaped and where the document sits", () => {
    const found = takersOn(mount("{&quot;quotes&quot;:{&quot;A&quot;:1}}", "/quotes"));
    expect([...found]).toEqual([["board", { applet: "board", doc: "ticker:market", at: "/quotes", props: '{"quotes":{"A":1}}' }]]);
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
    expect(holding({ applet: "board", doc: "d", at: "/quotes", props: '{"quotes":{"A":1}}', ops: [{ op: "replace", path: "/A", value: 3 }] })).toEqual({ value: { quotes: { A: 3 } } });
    expect(holding({ applet: "board", doc: "d", at: "", props: '{"quotes":{}}', ops: [{ op: "replace", path: "/A", value: 3 }] })).toEqual({ error: "replace /A: no such member" });
  });
});
