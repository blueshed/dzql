import { describe, expect, test } from "bun:test";
import { story, type Stories } from "../src/stories";
import type { Heard, Trace } from "../src/harness";
import { attempt, documentsOf, format, heardAs, probes, read, shapeOf, typeOf, watch, type Reading } from "./documents";
import { example as chat } from "../examples/chat/index";
import { stories as chatStories } from "../examples/chat/stories";
import { stories as londons } from "../examples/londons/stories";

const cell = (r: Reading, actor: string, doc: string) => r.grid[actor]![doc]!;
const allows = (r: Reading) => r.permitAllows.map((a) => `${a.doc} ${a.op} ${a.path}`);

describe("words", () => {
  test("a document's type, a path's shape, and what throws is undefined", () => {
    expect(typeOf("room:general")).toBe("room");
    expect(typeOf("session")).toBe("session");
    expect(shapeOf("/households/2/asks/1/reply")).toBe("/households/*/asks/*/reply");
    expect(shapeOf(`/messages/${Bun.randomUUIDv7()}`)).toBe("/messages/*");
    expect(shapeOf("/requests/*/starts")).toBe("/requests/*/starts");
    expect(shapeOf("/messages/-")).toBe("/messages/-");
    expect(attempt(() => 1)).toBe(1);
    expect(attempt(() => { throw new Error("no"); })).toBeUndefined();
  });

  test("what a member was sent: a page, its parts, a patch, or anything else, with its size", () => {
    expect(heardAs({ type: "render", html: "<p>" })).toEqual({ kind: "page", bytes: 30 });
    expect(heardAs({ type: "render", ops: [{ op: "replace", target: '[data-eta-part="people"]', html: "" }] }).parts).toEqual(["replace people"]);
    expect(heardAs({ type: "render" }).parts).toEqual([]);
    expect(heardAs({ type: "patch", doc: "room:general", ops: [] })).toMatchObject({ kind: "patch", doc: "room:general", ops: 0 });
    expect(heardAs({ type: "patch", doc: "room:general" })).toMatchObject({ ops: 0 });
    expect(heardAs({ type: "refused", reason: "no" }).kind).toBe("refused");
  });
});

describe("probes: what to put to permit, from what a document holds", () => {
  test("the root's fields, each collection's add under each parent row, each row's remove and fields, nested as the wire nests them", () => {
    const board = {
      weddings: { id: 1, message: "Hi" },
      households: { "1": { id: 1, weddings_id: 1, email: "a@x" } },
      asks: { "7": { id: 7, households_id: 1, reply: null } },
      gifts: {},
    };
    const tried = probes(board).map((p) => `${p.op.op} ${p.op.path} ${p.shape}`);
    expect(tried).toContain("replace /message /message");
    expect(tried).toContain("add /households/- /households/-");
    expect(tried).toContain("remove /households/1 /households/*");
    expect(tried).toContain("replace /households/1/email /households/*/email");
    expect(tried).toContain("add /households/1/asks/- /households/*/asks/-");
    expect(tried).toContain("remove /households/1/asks/7/reply /households/*/asks/*/reply");
    expect(tried).toContain("add /gifts/- /gifts/-"); // empty: under the root
    expect(tried.some((t) => t.includes("/id "))).toBe(false); // a row's id is its path, not a field
    expect(probes(board).find((p) => p.op.path === "/message" && p.op.op === "replace")!.op).toEqual({ op: "replace", path: "/message", value: "Hi" });
  });

  test("a document whose wire paths sit under a table (`under`) is that table's row", () => {
    const shapes = probes({ sessions: { id: "s", name: "Ada", room: null } }, "/sessions").map((p) => `${p.op.op} ${p.shape}`);
    expect(shapes).toEqual(["add /name", "replace /name", "remove /name", "add /room", "replace /room", "remove /room"]);
  });
});

describe("from the stories alone", () => {
  test("londons, with no app: each author needs what they write, each seen must hold it; the checks that need an app are not asked", async () => {
    const r = await documentsOf("londons");
    expect(r).toEqual(read(londons));
    expect(r.ran).toBe(false);
    expect(r.docs.map((d) => d.kind)).toEqual(r.docs.map(() => "from the stories"));
    expect(r.docs.map((d) => d.name)).toContain("venue-deployments");
    expect(cell(r, "contractor", "venue-deployments")).toMatchObject({ written: expect.any(Number), refused: expect.any(Number) });
    expect(cell(r, "venueOwner", "venue-deployments").written).toBeGreaterThan(0);
    expect(cell(r, "sponsor", "market").held).toBeGreaterThan(0);
    expect(cell(r, "supplier", "catalogue")).toMatchObject({ held: 0, refused: 1 }); // refused, and needs nothing of it
    expect(r.noDocument).toEqual([]);
    expect(r.unneeded).toEqual([]);
    expect(r.permitAllows).toEqual([]);
    const first = r.stories[0]!;
    expect(first.changes).toEqual([{ doc: "profile", told: [{ member: "stranger", how: "seen", bytes: 0, seen: true }] }]);
    const text = format("londons", r);
    expect(text).toContain("Read from the stories alone (157)");
    expect(text).not.toContain("Writes the server accepts");
    expect(text).toContain("    profile → stranger\n");
  });
});

describe("from a run", () => {
  test("chat: who holds what, who is told, and the two writes permit lets by that no page offers (its permits are code)", async () => {
    const r = await documentsOf("chat");
    expect(r.ran).toBe(true);
    expect(r.docs).toEqual([
      { name: "session", kind: "written" },
      { name: "room", kind: "written" },
      { name: "here", kind: "live" },
      { name: "lobby", kind: "live" },
    ]);
    expect(cell(r, "ada", "room")).toMatchObject({ written: 1, refused: 1 });
    expect(cell(r, "ada", "room").held).toBeGreaterThan(0);
    expect(cell(r, "eve", "room")).toEqual({ held: 0, written: 0, refused: 0, told: 0 });
    expect(r.noDocument).toEqual([]);
    expect(r.unneeded).toEqual([]);
    expect(r.readOnly).toEqual(["here", "lobby"]);
    expect(allows(r)).toEqual(["session add /name", "session add /room"]);
    expect(r.permitAllows[0]!.who).toEqual(["ada", "bob", "cy", "dee", "eve"]);
    // Ada says hello: the room tells Ada and Bob, in parts; Cy, in the kitchen, holds another room
    const hello = r.stories.find((s) => s.name.startsWith("Ada says hello"))!;
    expect(hello.changes.map((c) => c.doc)).toEqual(["room:general"]);
    expect(hello.changes[0]!.told.map((t) => [t.member, t.seen])).toEqual([["ada", true], ["bob", true]]);
    expect(hello.changes[0]!.told[0]!.how).toBe("patch 1 op + parts replace messages");
    // a session is named by its type alone: its id is a credential
    expect(JSON.stringify(r)).not.toMatch(/session:/);
    const refused = r.stories.find((s) => s.kind === "cannot")!;
    expect(refused.changes[0]!.told[0]!.how).toStartWith("refused");
    const text = format("chat", r);
    expect(text).toContain("permit allows session add /name — to ada, bob, cy, dee, eve");
    expect(text).toContain("Read-only (held, written by nobody): here, lobby");
    expect(text).toContain("11. closes a tab · Bob closes his tab");
    expect(text).toContain("2. cannot · Without a name");
  }, 30000);

  test("the wedding: its RULES let the couple remove what no story or page does, and the households read what they never write", async () => {
    const r = await documentsOf("wedding");
    expect(r.noDocument).toEqual([]);
    expect(r.unneeded).toEqual([]);
    expect(r.readOnly).toEqual(["wedding", "welcome", "everyone"]);
    expect(allows(r)).toContain("board remove /message");
    expect(allows(r)).toContain("household remove /message");
    expect(allows(r)).not.toContain("board replace /message"); // a story does it
    expect(allows(r)).not.toContain("board replace /courses/*/dishes/*/name"); // no story does it; a field on the couple's page offers it
    expect(r.permitAllows.find((a) => a.doc === "board")!.who).toEqual(["couple"]);
    expect(cell(r, "couple", "household").refused).toBe(1);
    // the couple's message reaches every welcome; the households hold the wedding, and are sent it unseen
    const message = r.stories.find((s) => s.name.startsWith("The couple change their message"))!;
    expect(message.changes.find((c) => c.doc === "welcome:1")!.told).toMatchObject([{ member: "stranger", seen: true }]);
    expect(message.changes.find((c) => c.doc === "wedding:1")!.told.map((t) => t.seen)).toEqual([false, false, false]);
    expect(format("wedding", r)).toContain("(not in seen)");
  }, 60000);

  test("what the run cannot say from the stories: a document nobody needs, a write with nothing in front of its author, a document the example lacks", async () => {
    const stories: Stories = {
      cast: chatStories.cast,
      stories: [
        story("Ada says something with no room in front of her", { as: "ada", does: { doc: "room", ops: [{ op: "add", path: "/messages/-", value: "hi" }] }, seen: ["ada"] }),
        story("Ada writes to a document nobody keeps", { as: "ada", cannot: { doc: "attic", ops: [{ op: "add", path: "/-", value: 1 }] } }),
        story("The feed writes from no page", { as: "ada", does: { doc: "room", ops: [{ op: "add", path: "/messages/-", value: "tick" }] }, offPage: true, seen: ["ada"] }),
        story("A story the run never told", { as: "ada", does: { doc: "room", ops: [] }, seen: ["ada"] }),
      ],
    };
    const step = (name: string, heard: Trace["heard"]): Trace => ({ story: name, phase: "does", as: "ada", heard, holds: [{ member: "ada", docs: ["told:x", "session:x"] }], ledger: [] });
    const w = watch({ ...chat, compartments: [...chat.compartments, { docType: "cellar", resolveDoc: () => undefined }] });
    // outside a run no socket is open: a step's controls are kept, and nothing is put to permit
    w.observe({ ...step(stories.stories[0]!.name, [{ member: "ada", messages: [
      { type: "patch", doc: "told" },
      { type: "render", ops: [{ op: "replace", target: "x", html: '<button data-write=\'{"doc":"room","op":"add","path":"/messages/-"}\'>' }] },
      { type: "patch", doc: "room:general", ops: [{ op: "add", path: "/messages/1", value: {} }] } as unknown as Heard, // `Heard` types a render's ops
      { type: "render", html: "<p>" },
    ] }]), phase: "does" });
    w.observe({ ...step(stories.stories[0]!.name, []), phase: "undo" });
    w.observe(step(stories.stories[2]!.name, []));
    expect(w.controls).toEqual(new Set(["room add /messages/-"]));
    expect(w.allowed.size).toBe(0);
    const r = read(stories, { ...chat, compartments: [...chat.compartments, { docType: "cellar", resolveDoc: () => undefined }] }, w);
    expect(r.noDocument).toEqual([
      { story: "Ada writes to a document nobody keeps", detail: "ada writes attic, a document the example does not have" },
      { story: "Ada says something with no room in front of her", detail: "ada writes room with no room in front of them" },
    ]);
    expect(r.unneeded).toEqual(["here", "lobby", "cellar", "attic"]);
    expect(r.docs.at(-1)).toEqual({ name: "attic", kind: "no compartment" });
    // a kernel's document (what a session is told) is no change of the example's; the render after a patch is that change reaching the page
    expect(r.stories[0]!.changes).toEqual([{ doc: "room:general", told: [{ member: "ada", how: "patch 1 op + page", bytes: expect.any(Number), seen: true }] }]);
    expect(r.stories[3]!.changes).toEqual([]);
    expect(format("x", r)).toContain("- cellar: defined, never written, never held in the run");
  });
});
