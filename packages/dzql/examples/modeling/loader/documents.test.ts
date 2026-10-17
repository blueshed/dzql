import { describe, expect, test } from "bun:test";
import { post, story, type Stories } from "dzql/modelling/stories";
import { run } from "dzql/modelling/harness";
import { serverWrite } from "dzql/rendering/documents";
import type { Example } from "dzql/rendering/example";
import { bornInto, toldNotAsked, touches } from "./facts";
import { controlsOn, type Heard, type Trace } from "dzql/modelling/harness";
import { attempt, documentsIn, documentsOf, exampleAt, format, heardAs, probes, read, shapeOf, typeOf, watch, type Reading } from "./documents";
import { example as chat } from "../../chat/index";
import { stories as chatStories } from "../../chat/stories";
import { stories as londons } from "./londons/stories";

const cell = (r: Reading, actor: string, doc: string) => r.grid[actor]![doc]!;
const allows = (r: Reading, doc: string, path: string) => r.permitAllows.find((a) => a.doc === doc && a.path === path)?.ops;

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
    const r = await documentsOf(`${import.meta.dir}/londons`);
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
      { name: "session", kind: "stored" },
      { name: "room", kind: "stored" },
      { name: "here", kind: "memory" },
      { name: "lobby", kind: "memory" },
    ]);
    expect(cell(r, "ada", "room")).toMatchObject({ written: 1, refused: 1 });
    expect(cell(r, "ada", "room").held).toBeGreaterThan(0);
    expect(cell(r, "eve", "room")).toEqual({ held: 0, written: 0, refused: 0, told: 0 });
    expect(r.noDocument).toEqual([]);
    expect(r.unneeded).toEqual([]);
    expect(r.readOnly).toEqual(["here", "lobby"]);
    // its session's permit lets any op on /name and /room, but an add on a field is the replace a story does
    expect(r.permitAllows).toEqual([]);
    expect(r.tellsNobody).toEqual([]);
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
    expect(text).toContain("## Writes the server accepts that no page offers (0 paths)");
    expect(text).toContain("Read-only (held, written by nobody): here, lobby");
    expect(text).toContain("14. closes a tab · Bob closes his tab");
    expect(text).toContain("2. cannot · Without a name");
  }, 30000);

  test("the wedding: its permits allow only what a story does or a page offers, and the households read what they never write", async () => {
    const r = await documentsOf("wedding");
    expect(r.noDocument).toEqual([]);
    expect(r.unneeded).toEqual([]);
    expect(r.readOnly).toEqual(["wedding", "welcome", "everyone"]);
    expect(r.permitAllows).toEqual([]); // no story opens a gift's drawer: what it offers is offered all the same
    expect(cell(r, "okafors", "household").refused).toBe(1); // after the deadline
    // the couple's message reaches every welcome; the households hold the wedding, and are sent it unseen
    const message = r.stories.find((s) => s.name.startsWith("The couple change their message"))!;
    expect(message.changes.find((c) => c.doc === "welcome:1")!.told).toMatchObject([{ member: "stranger", seen: true }]);
    expect(message.changes.find((c) => c.doc === "wedding:1")!.told.map((t) => t.seen)).toEqual([false, false, false]);
    expect(format("wedding", r)).toContain("(not in seen)");
  }, 60000);

  test("a write is offered by any page a member can get to, whether or not a story opened it", () => {
    const w = watch(chat);
    w.everywhere("ada", "?keep=gifts/1", controlsOn(`<button data-write='{"doc":"board","op":"remove","path":"/gifts/1"}'></button>`));
    expect(w.controls).toEqual(new Set(["board remove /gifts/*"]));
  });

  test("what permit allows that no story does and no page offers: by path, with its verbs and who; an add on a field it lets be replaced is that replace", () => {
    const lets = (op: string, path: string, who: string[]) => [`room ${op} ${path}`, { doc: "room", op, path, who }] as const;
    const allowed = new Map([
      lets("add", "/messages/-", ["ada"]), // a story says hello
      lets("remove", "/messages/*", ["ada"]), // a control the run drew offers it
      lets("replace", "/messages/*/text", ["ada"]),
      lets("add", "/messages/*/text", ["bob"]), // that replace
      lets("remove", "/messages/*/text", ["bob"]),
    ]);
    const r = read(chatStories, chat, { traces: [], controls: new Set(["room remove /messages/*"]), allowed });
    expect(r.permitAllows).toEqual([{ doc: "room", path: "/messages/*/text", ops: ["replace", "remove"], who: ["ada", "bob"] }]);
    expect(allows(r, "room", "/messages/-")).toBeUndefined();
    expect(format("chat", r)).toContain("## Writes the server accepts that no page offers (1 path)");
    expect(format("chat", r)).toContain("- permit allows room /messages/*/text: replace, remove — to ada, bob");
  });

  test("a document delta.ts defines that no resource owns, and no story uses, is one nobody needs", async () => {
    const src = (await Bun.file(`${import.meta.dir}/../../chat/delta.ts`).text()) + '\nregisterDocs(delta.server, db, schema, [defineDoc("archive:", { root: "rooms", include: [] })]);\n';
    const defined = documentsIn(src, null).map((d) => d.name);
    expect(defined).toEqual(["session", "room", "archive", "here", "lobby"]);
    const r = read(chatStories, chat, { traces: [], controls: new Set(), allowed: new Map() }, defined);
    expect(r.docs).toContainEqual({ name: "archive", kind: "no resource" });
    expect(r.unneeded).toContain("archive");
  });

  test("what the run cannot say from the stories: a document nobody needs, a write with nothing in front of its author, a document the example lacks, a write that tells nobody", async () => {
    const stories: Stories = {
      cast: chatStories.cast,
      stories: [
        story("Ada says something with no room in front of her", { as: "ada", does: { doc: "room", ops: [{ op: "add", path: "/messages/-", value: "hi" }] }, seen: ["ada"] }),
        story("Ada writes to a document nobody keeps", { as: "ada", cannot: { doc: "attic", ops: [{ op: "add", path: "/-", value: 1 }] } }),
        story("The feed writes from no page", { as: "ada", does: { doc: "room", ops: [{ op: "add", path: "/messages/-", value: "tick" }] }, offPage: true, seen: ["ada"] }),
        story("A story the run never told", { as: "ada", does: { doc: "room", ops: [] }, seen: ["ada"] }),
        story("Ada files a room away", { as: "ada", cannot: { doc: "archive", ops: [{ op: "add", path: "/-", value: 1 }] } }),
        story("Ada says something nobody sees", { as: "ada", does: { doc: "room", ops: [{ op: "add", path: "/messages/-", value: "shh" }] }, seen: [] }),
      ],
    };
    const step = (name: string, heard: Trace["heard"]): Trace => ({ story: name, phase: "does", as: "ada", heard, holds: [{ member: "ada", docs: ["told:x", "session:x"] }], ledger: [] });
    const w = watch({ ...chat, resources: [...chat.resources, { docType: "cellar", resolveDoc: () => undefined }] });
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
    const r = read(stories, { ...chat, resources: [...chat.resources, { docType: "cellar", resolveDoc: () => undefined }] }, w, ["archive"]);
    expect(r.noDocument).toEqual([
      { story: "Ada writes to a document nobody keeps", detail: "ada writes attic, a document the example does not have" },
      { story: "Ada files a room away", detail: "ada writes archive, a document no resource owns" },
      { story: "Ada says something with no room in front of her", detail: "ada writes room with no room in front of them" },
    ]);
    expect(r.tellsNobody).toEqual([{ story: "Ada says something nobody sees", detail: "ada writes room, and the story says nobody sees it" }]);
    expect(r.unneeded).toEqual(["here", "lobby", "cellar", "archive", "attic"]);
    expect(r.docs.at(-1)).toEqual({ name: "attic", kind: "not defined" });
    // a kernel's document (what a session is told) is no change of the example's; the render after a patch is that change reaching the page
    expect(r.stories[0]!.changes).toEqual([{ doc: "room:general", told: [{ member: "ada", how: "patch 1 op + page", bytes: expect.any(Number), seen: true }] }]);
    expect(r.stories[3]!.changes).toEqual([]);
    const text = format("x", r);
    expect(text).toContain("- cellar: defined, never written, never held in the run");
    expect(text).toContain("## Writes that tell nobody (1)\n- Ada says something nobody sees — ada writes room, and the story says nobody sees it");
  });
});

describe("a post to a route, read from a run", () => {
  test("born into the documents its told members were told through, touching what delta wrote for the route, and told-not-asked as for a write", async () => {
    const { example: leave } = await import("../../leave/index");
    const { stories: told } = await import("../../leave/stories");
    const rename = async (req: Request) => {
      await serverWrite("team:1", [{ op: "replace", path: "/teams/name", value: String((await req.formData()).get("name")) }]);
      return new Response(null, { status: 303, headers: { Location: "/" } });
    };
    const renaming: Example = { ...leave, routes: { ...leave.routes, "/rename": rename } };
    const stories: Stories = {
      ...told,
      stories: [
        story("Mo follows a link that renames the team, and Ann sees the new name", { as: "mo", does: post("/rename", { name: "The workshop" }), offPage: true, seen: ["ann", "mo"] }),
        ...told.stories.filter((s) => s.name.startsWith("Bo signs in on another phone")),
      ],
    };
    const w = watch(renaming);
    await run(renaming, stories, w.observe);
    const r = read(stories, renaming, w);
    const [renamed, signedIn] = r.stories;
    expect(renamed!.doc).toBeUndefined(); // a post names no document of its own
    expect(renamed!.changes).toEqual([{ doc: "team:1", told: ["ann", "bo", "mo"].map((member) => ({ member, how: expect.stringContaining("patch 1 op"), bytes: expect.any(Number), seen: member !== "bo" })) }]);
    expect(bornInto(renamed!, "session")).toEqual(["team"]);
    expect(toldNotAsked(renamed!, [], "session")).toEqual([{ doc: "team:1", told: [expect.objectContaining({ member: "bo", seen: false })] }]);
    const ledger = w.traces.find((t) => t.story === renamed!.name)!.ledger;
    expect(touches([], ledger, [{ name: "team", root: "teams", include: ["people", "requests"] }])).toEqual(["teams"]);
    expect(bornInto(signedIn!, "session")).toEqual([]); // signing in tells nobody: the session is the page's
    expect(cell(r, "mo", "team").told).toBe(1);
  }, 60000);
});

describe("exampleAt", () => {
  test("a name is one of eta's examples; a path is a project of its own, named by its last part", () => {
    expect(exampleAt("wedding")).toEqual({ dir: `${import.meta.dir}/../../wedding`, name: "wedding" });
    expect(exampleAt("/work/canyou-eta")).toEqual({ dir: "/work/canyou-eta", name: "canyou-eta" });
    expect(exampleAt("../canyou-eta/").name).toBe("canyou-eta");
  });
});
