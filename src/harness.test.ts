import { describe, expect, test } from "bun:test";
import type { PatchOp } from "./json-patch";
import { createLocal } from "@blueshed/delta/local";
import { registerMemory } from "@blueshed/delta/kinds";
import { defineDoc, registerDocs } from "@blueshed/delta/sqlite";
import { example } from "../examples/chat";
import { db, schema } from "../examples/chat/delta";
import { stories } from "../examples/chat/stories";
import type { Compartment } from "./compartments/compartment";
import { read } from "./documents";
import { appletWrites, write } from "./html";
import type { Example } from "./example";
import { comparable, controlsOn, hear, holding, offers, placeOf, print, retake, run, takersOn, unheld } from "./harness";
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

  test("a story's premise is its own: made before it, as each member it names, rolled back with it; one that does not hold is not told", async () => {
    const say = { doc: "room", ops: [{ op: "add" as const, path: "/messages/-", value: "hello" }] };
    const general = { doc: "session", ops: [{ op: "replace" as const, path: "/room", value: "general" }] };
    const report = await run(example, {
      cast: stories.cast,
      stories: [
        { name: "Cy, back in general, sees Ada say hello", as: "ada", premise: { cy: [general] }, does: say, seen: ["ada", "bob", "cy"], untold: ["dee", "eve"] },
        { name: "Cy, in the kitchen again, is told nothing of it", as: "ada", does: say, seen: ["ada", "bob"], untold: ["cy"] },
        { name: "Eve, with no name, is in general first", as: "ada", premise: { eve: [general] }, does: say, seen: ["ada", "bob"] },
        { name: "A ghost is in general first", as: "ada", premise: { ghost: [general] }, does: say, seen: ["ada", "bob"] },
      ],
    });
    expect(report.outcomes.map((o) => o.failures)).toEqual([
      [],
      [],
      ["the premise did not hold: eve's write to session was refused"],
      ["the premise names ghost, and no one in the cast is called that"],
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

  test("controls: a button sends its own value, a field or a form any, an applet on a document any write to it, one that says what it writes exactly that", () => {
    const page = [
      `<button data-write='{"doc":"room","op":"replace","path":"/name"}' data-value="Tess &amp; Tom">x</button>`,
      `<button data-write='{"doc":"ledger","op":"remove","path":"/latest"}'>undo</button>`,
      `<button data-write='{"doc":"household","op":"replace","path":"/answer"}' data-value="maybe" disabled>maybe</button>`,
      `<input data-write='{"doc":"household","op":"replace","path":"/message"}' disabled>`,
      `<form data-write='{"doc":"room","op":"add","path":"/messages/-"}'></form>`,
      `<div class="site" data-page="gifts?new=gifts" data-page-write='{"doc":"session","op":"replace","path":"/page"}'></div>`,
      `<div data-applet="clock" data-doc="clock" data-props="{}"></div>`,
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
    expect(any("session", { op: "replace", path: "/page", value: "day" })).toBe(true);
    expect(any("clock", { op: "replace", path: "/tz", value: "Asia/Tokyo" })).toBe(true);
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
    const failures = await failuresOf(deaf, only("Cy closes her tab"));
    expect(failures).toEqual(["nothing landed: closing cy's tab changed nothing", "ada did not see it", "bob did not see it"]);
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
