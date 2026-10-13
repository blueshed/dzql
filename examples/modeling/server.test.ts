import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PatchOp } from "../../src/json-patch";
import { createServer } from "../../src/server";
import { run } from "../../src/harness";
import { Refusal } from "../../src/refusal";
import { drawHeart, heartOf, layout, picked, reason, related, shape as shapeOf, singular, type Raw, type Ui } from "./heart";
import { may, model, shape, type Model } from "./model";
import { aliases } from "./cli";
import { stories } from "./stories";
import { example } from "./index";

// A model as delta keeps it: three stories -- one the team serves, one the inbox, one nothing --
// the team rooted at teams holding requests (under teams) and notes (whose parent it does not
// hold), each person's own session, and an inbox for a story no longer told; logins only touched.
const field = (name: string, type = "text") => ({ name, type });
const leave: Raw = {
  models: { name: "Leave" },
  stories: {
    "1": { id: 1, text: "Ann asks", actor: "ann", kind: "does", post: null, touches: ["requests"] },
    "2": { id: 2, text: "Bo signs in", actor: "visitor", kind: "does", post: "/login", touches: ["logins", "sessions"] },
    "3": { id: 3, text: "Ann cannot approve", actor: "ann", kind: "cannot" },
  },
  documents: {
    "1": { id: 1, name: "team", root: "teams", own: 0, holds: { teams: { parent: null, fields: [field("name")] }, requests: { parent: "teams", fields: [field("starts", "date")] }, notes: { parent: "pages", fields: [] } }, held_by: ["ann", "mo"], stories: [1, "3"] },
    "2": { id: 2, name: "session", root: "sessions", own: 1, holds: { sessions: { parent: null, fields: [field("page")] } }, held_by: [], stories: ["2"] },
    "3": { id: 3, name: "inbox", root: "requests", holds: { requests: { parent: null, fields: [field("starts", "text"), field("note")] } }, stories: ["9"] },
  },
};

describe("the heart, worked out from the model", () => {
  const h = heartOf(leave);

  test("a story is born into the documents that serve it, and touches what it says", () => {
    expect(h.example).toBe("Leave");
    expect(h.stories.map((s) => [s.n, s.as, s.kind, s.post, s.born, s.touches])).toEqual([
      [1, "ann", "does", null, ["team"], ["requests"]],
      [2, "visitor", "does", "/login", ["session"], ["logins", "sessions"]],
      [3, "ann", "cannot", null, ["team"], []],
    ]);
  });

  test("a document reaches its root and what it holds, its shape that tree, and serves a story or says it does not", () => {
    expect(h.documents.map((d) => [d.name, d.for, d.reach, d.held, d.needless])).toEqual([
      ["team", "ann, mo", ["teams", "requests", "notes"], 2, false],
      ["session", "nobody yet", ["sessions"], 0, false],
      ["inbox", "nobody yet", ["requests"], 0, true],
    ]);
    expect(h.documents[0]!.shape).toEqual([
      { text: "team:<team>", pad: 0 },
      { text: "teams", pad: 14 },
      { text: "requests", pad: 28 },
      { text: "notes", pad: 28 }, // its parent is not held here: it hangs from the root
    ]);
    expect(h.documents[1]!.shape[0]).toEqual({ text: "session", pad: 0 }); // each person's own: named by its type alone
    expect(shapeOf("x", "a", {})).toEqual([{ text: "x", pad: 0 }, { text: "a", pad: 14 }]);
  });

  test("an entity is every document's that holds it, its fields from each and its first parent; needed by no story, or looked up and never held", () => {
    expect(h.entities.map((e) => [e.name, e.parent, e.columns, e.documents, e.red, e.looked])).toEqual([
      ["teams", null, ["name"], ["team"], false, false],
      ["requests", "teams", ["starts", "note"], ["team", "inbox"], false, false],
      ["notes", "pages", [], ["team"], false, false],
      ["sessions", null, ["page"], ["session"], false, false],
      ["logins", null, [], [], false, true],
    ]);
    const alone = heartOf({ ...leave, stories: { "1": leave.stories!["1"]! } });
    expect(alone.entities.find((e) => e.name === "sessions")!.red).toBe(true); // the session serves no story still told
    expect(heartOf({ models: { name: "Empty" } })).toEqual({ example: "Empty", stories: [], documents: [], entities: [] });
  });

  test("a word's one, as a document's id is said", () => {
    expect(["requests", "people", "stories", "series", "class", "news", "data"].map(singular)).toEqual(["request", "person", "story", "series", "class", "news", "data"]);
  });

  test("what is picked: what was, while it is there; else the first document; else the first story; nothing on an empty model", () => {
    expect(picked(h, { k: "story", id: 2 })).toEqual({ k: "story", id: 2 });
    expect(picked(h, { k: "ent", id: "logins" })).toEqual({ k: "ent", id: "logins" });
    expect(picked(h, { k: "doc", id: "gone" })).toEqual({ k: "doc", id: "team" });
    expect(picked(h)).toEqual({ k: "doc", id: "team" });
    expect(picked(heartOf({ ...leave, documents: {} }))).toEqual({ k: "story", id: 1 });
    expect(picked(heartOf({ models: { name: "Empty" } }))).toBeUndefined();
  });

  test("what goes with what: a document's stories and reach; an entity's stories and documents; a story's documents and touches", () => {
    const sets = (sel: Parameters<typeof related>[1]) => Object.fromEntries(Object.entries(related(h, sel)).map(([k, v]) => [k, [...v]]));
    expect(sets({ k: "doc", id: "team" })).toEqual({ stories: [1, 3], docs: ["team"], ents: ["teams", "requests", "notes"] });
    expect(sets({ k: "ent", id: "requests" })).toEqual({ stories: [1], docs: ["team", "inbox"], ents: ["requests"] });
    expect(sets({ k: "story", id: 2 })).toEqual({ stories: [2], docs: ["session"], ents: ["logins", "sessions"] });
  });

  test("why an entity is marked: needed by no story, or looked up and never held", () => {
    const alone = heartOf({ ...leave, stories: { "1": leave.stories!["1"]! } });
    expect(reason(alone, { kind: "ent", ent: "sessions" })).toEqual({ title: "sessions · needed by no story", one: "Held by Session, which serves no story told.", two: "No story touches it.", red: true });
    expect(reason(alone, { kind: "ent", ent: "requests" }).one).toBe("No document holds it, so nobody is told when it changes."); // it is held, and needed: the mark's reason is not asked of it
    expect(reason(heartOf({ ...leave, stories: {}, documents: { "3": leave.documents!["3"]!, "4": { ...leave.documents!["3"]!, id: 4, name: "outbox" } } }), { kind: "ent", ent: "requests" }).one).toBe("Held by Inbox and Outbox, which serve no story told.");
    expect(reason(h, { kind: "ent", ent: "logins" })).toEqual({ title: "logins · looked up, never held", one: "No document holds it, so nobody is told when it changes.", two: "1 story touches it.", red: false });
    expect(reason(heartOf({ ...leave, stories: { ...leave.stories, "4": { ...leave.stories!["2"]!, id: 4 } } }), { kind: "ent", ent: "logins" }).two).toBe("2 stories touch it.");
  });

  test("the three columns, as the modeller draws them, for each kind of subject", () => {
    const ui: Ui = { hideStories: false, hideEnts: false, pop: null };
    const doc = drawHeart(h, ui);
    expect(doc).toContain("Stories · 2 it was born from");
    expect(doc).toContain("Documents · Team");
    expect(doc).toContain("Entities · 3 of 5 reached");
    expect(doc).toContain('<div class="shape"><div style="padding-left:0px">team:&#60;team&#62;</div>');
    expect(drawHeart(h, { ...ui, sel: { k: "doc", id: "inbox" } })).toContain("held by 0 · serves no story told");
    expect(doc).toContain('<span class="tag">posts to /login · </span>Bo signs in');
    expect(doc).toContain('<span class="cannot">cannot · </span>Ann cannot approve');
    expect(doc).toContain('aria-label="Who looks logins up?"');
    const story = drawHeart(h, { ...ui, sel: { k: "story", id: 1 }, hideStories: true, hideEnts: true, pop: { kind: "ent", ent: "logins" } });
    expect(story).toContain("Stories · story 1");
    expect(story).toContain("Documents · 1 it was born into");
    expect(story).toContain("Entities · 1 it touches");
    expect(story).not.toContain("Bo signs in"); // hidden: it does not go with story 1
    expect(story).toContain('aria-pressed="true" aria-label="Show every story"');
    expect(drawHeart(h, { ...ui, sel: { k: "story", id: 3 }, hideEnts: true })).toContain("No entity goes with story 3.");
    const ent = drawHeart(h, { ...ui, sel: { k: "ent", id: "requests" } });
    expect(ent).toContain("Stories · 1 touch requests");
    expect(ent).toContain("Documents · 2 reach requests");
    const alone = heartOf({ ...leave, documents: {}, stories: { "4": { id: 4, text: "Jo waits", actor: "jo", kind: "does" } } });
    expect(drawHeart(alone, ui)).toContain('<span class="tag">no document · </span>Jo waits');
    const red = heartOf({ ...leave, stories: { "1": leave.stories!["1"]! } });
    expect(drawHeart(red, ui)).toContain('aria-label="Why is sessions marked?"');
    expect(drawHeart(heartOf({ models: { name: "Empty" } }), ui)).toContain("No stories yet.");
  });

  test("the entities' tree: depth left to right, a parent level with its children, narrower when it must fit", () => {
    const tables = [{ name: "a", parent: null }, { name: "b", parent: "a" }, { name: "c", parent: "a" }, { name: "d", parent: "b" }, { name: "e", parent: "e" }];
    const wide = layout(tables);
    expect(wide.pos).toEqual({ d: { x: 472, y: 0 }, b: { x: 236, y: 0 }, c: { x: 236, y: 56 }, a: { x: 0, y: 28 }, e: { x: 0, y: 134.4 } });
    expect(wide.segs.length).toBeGreaterThan(0);
    expect(layout(tables, undefined, 500).pos.d!.x).toBe(400); // two columns of 200, the least they may be
    expect(layout(tables, new Set(["b", "d"])).pos).toEqual({ d: { x: 236, y: 0 }, b: { x: 0, y: 0 } }); // b's parent hidden: b is a root
    expect(layout([])).toEqual({ pos: {}, segs: [], width: 0, height: 0 });
  });
});

describe("the model's rules", () => {
  const m: Model = model(leave);

  /** What `shape` refuses with, or "" when it refuses nothing. */
  const refusal = (op: PatchOp): string => {
    try {
      shape(m, [op]);
      return "";
    } catch (err) {
      return (err as Refusal).reason;
    }
  };

  test("a story: written down with its words, who tells it and whether they do it; retold, reworded, taken back -- never without words or someone", () => {
    expect(shape(m, [{ op: "add", path: "/stories/-", value: { text: " Bo asks ", actor: "bo", kind: "cannot", post: " /login ", touches: ["requests", " "] } }])).toEqual([
      { op: "add", path: "/stories/-", value: { text: "Bo asks", actor: "bo", kind: "cannot", post: "/login", touches: ["requests"] } },
    ]);
    expect(shape(m, [{ op: "add", path: "/stories/-", value: { text: "Bo asks", actor: "bo", kind: "maybe", post: " " } }])).toEqual([
      { op: "add", path: "/stories/-", value: { text: "Bo asks", actor: "bo", kind: "does", post: null, touches: [] } },
    ]);
    expect(refusal({ op: "add", path: "/stories/-" })).toBe("A story needs words.");
    expect(refusal({ op: "add", path: "/stories/-", value: { text: "Bo asks" } })).toBe("A story is someone's: say who tells it.");
    expect(shape(m, [{ op: "replace", path: "/stories/1/text", value: "Ann asks again" }])).toEqual([{ op: "replace", path: "/stories/1/text", value: "Ann asks again" }]);
    expect(refusal({ op: "replace", path: "/stories/1/text", value: 7 })).toBe("A story needs words.");
    expect(shape(m, [{ op: "replace", path: "/stories/1/actor", value: " mo " }])).toEqual([{ op: "replace", path: "/stories/1/actor", value: "mo" }]);
    expect(refusal({ op: "replace", path: "/stories/1/actor", value: "" })).toBe("A story is someone's: say who tells it.");
    expect(shape(m, [{ op: "replace", path: "/stories/1/kind", value: "cannot" }])).toEqual([{ op: "replace", path: "/stories/1/kind", value: "cannot" }]);
    expect(shape(m, [{ op: "replace", path: "/stories/1/touches", value: "requests" }])).toEqual([{ op: "replace", path: "/stories/1/touches", value: [] }]);
    expect(shape(m, [{ op: "remove", path: "/stories/2" }])).toEqual([{ op: "remove", path: "/stories/2" }]);
  });

  test("a document: described with its root and a story it serves; renamed, held, its own, for other stories, taken out", () => {
    expect(shape(m, [{ op: "add", path: "/documents/-", value: { name: " calendar ", root: "requests", stories: ["1", "8", 3], held_by: ["ann", " "], own: true, fields: [{ name: "starts", type: "date" }] } }])).toEqual([
      { op: "add", path: "/documents/-", value: { name: "calendar", root: "requests", own: 1, stories: ["1", "3"], holds: { requests: { parent: null, fields: [{ name: "starts", type: "date" }] } }, held_by: ["ann"] } },
    ]);
    expect(refusal({ op: "add", path: "/documents/-", value: { name: "notes", root: "notes", stories: ["8"] } })).toBe("A document is for a story: name the one it serves.");
    expect(refusal({ op: "add", path: "/documents/-", value: { root: "notes", stories: ["1"] } })).toBe("A document needs a name.");
    expect(refusal({ op: "add", path: "/documents/-", value: { name: "notes", stories: ["1"] } })).toBe("A document holds something: name its root.");
    expect(shape(m, [{ op: "replace", path: "/documents/1/name", value: " staff " }])).toEqual([{ op: "replace", path: "/documents/1/name", value: "staff" }]);
    expect(shape(m, [{ op: "replace", path: "/documents/1/held_by", value: "ann" }])).toEqual([{ op: "replace", path: "/documents/1/held_by", value: [] }]);
    expect(shape(m, [{ op: "replace", path: "/documents/1/stories", value: ["2"] }])).toEqual([{ op: "replace", path: "/documents/1/stories", value: ["2"] }]);
    expect(shape(m, [{ op: "replace", path: "/documents/1/own", value: 0 }])).toEqual([{ op: "replace", path: "/documents/1/own", value: 0 }]);
    expect(shape(m, [{ op: "replace", path: "/documents/1/own", value: true }])).toEqual([{ op: "replace", path: "/documents/1/own", value: 1 }]);
    expect(shape(m, [{ op: "remove", path: "/documents/2" }])).toEqual([{ op: "remove", path: "/documents/2" }]);
  });

  test("what a document holds, an entity at a time: under the root unless it says, its fields; taken out, but never its root", () => {
    const team = m.documents[0]!.holds;
    expect(shape(m, [{ op: "replace", path: "/documents/1/holds/holidays", value: { under: " requests ", fields: [{ name: "date", type: "date" }, { name: "name" }, { name: " " }, null] } }])).toEqual([
      { op: "replace", path: "/documents/1/holds", value: { ...team, holidays: { parent: "requests", fields: [field("date", "date"), field("name")] } } },
    ]);
    expect(shape(m, [{ op: "replace", path: "/documents/1/holds/people", value: { fields: "name" } }])).toEqual([{ op: "replace", path: "/documents/1/holds", value: { ...team, people: { parent: "teams", fields: [] } } }]);
    expect(shape(m, [{ op: "replace", path: "/documents/1/holds/teams", value: { under: "x" } }])).toEqual([{ op: "replace", path: "/documents/1/holds", value: { ...team, teams: { parent: null, fields: [] } } }]);
    expect(shape(m, [{ op: "remove", path: "/documents/1/holds/notes" }])).toEqual([{ op: "replace", path: "/documents/1/holds", value: { teams: team.teams, requests: team.requests } }]);
    expect(refusal({ op: "remove", path: "/documents/1/holds/teams" })).toBe("A document keeps its root: take the document out instead.");
    expect(refusal({ op: "replace", path: "/documents/1/holds/ " })).toBe("An entity needs a name.");
  });

  test("what may be written: a story or a document the model has, or a new one, and only their own fields", () => {
    const yes: PatchOp[] = [
      { op: "add", path: "/stories/-" },
      { op: "remove", path: "/stories/1" },
      ...["text", "actor", "kind", "touches"].map((f) => ({ op: "replace" as const, path: `/stories/1/${f}` })),
      { op: "add", path: "/documents/-" },
      { op: "remove", path: "/documents/2" },
      { op: "replace", path: "/documents/2/holds/sessions" },
      { op: "remove", path: "/documents/2/holds/sessions" },
      ...["name", "held_by", "stories", "own"].map((f) => ({ op: "replace" as const, path: `/documents/2/${f}` })),
    ];
    const no: PatchOp[] = [
      { op: "replace", path: "/stories/-" },
      { op: "add", path: "/stories/-/text" },
      { op: "remove", path: "/stories/9" },
      { op: "replace", path: "/stories/1" },
      { op: "remove", path: "/stories/1/text" },
      { op: "replace", path: "/stories/1/post" },
      { op: "replace", path: "/stories/1/text/x" },
      { op: "replace", path: "/models/name" },
      { op: "remove", path: "/documents/-" },
      { op: "remove", path: "/documents/9" },
      { op: "replace", path: "/documents/2" },
      { op: "add", path: "/documents/2/holds/sessions" },
      { op: "replace", path: "/documents/2/holds" },
      { op: "replace", path: "/documents/2/holds/sessions/x" },
      { op: "remove", path: "/documents/2/name" },
      { op: "replace", path: "/documents/2/name/x" },
      { op: "replace", path: "/documents/2/root" },
    ];
    expect(yes.filter((op) => !may(m, op))).toEqual([]);
    expect(no.filter((op) => may(m, op))).toEqual([]);
    expect(model({ models: { name: "Empty" } })).toEqual({ stories: [], documents: [] });
  });

  test("the CLI's verbs are writes to the model, and nothing else", () => {
    const op = (verb: string, ...args: string[]) => aliases[verb]!(args).ops[0];
    expect(aliases.story!(["ann", "does", "Ann", "asks"])).toEqual({ doc: "model", ops: [{ op: "add", path: "/stories/-", value: { actor: "ann", kind: "does", text: "Ann asks" } }] });
    expect(op("story", "visitor", "does", "Bo", "--post", "/login", "signs", "in")).toEqual({ op: "add", path: "/stories/-", value: { actor: "visitor", kind: "does", text: "Bo signs in", post: "/login" } });
    expect(op("reword", "1", "Ann", "asks")).toEqual({ op: "replace", path: "/stories/1/text", value: "Ann asks" });
    expect(op("touches", "1", "requests", "teams")).toEqual({ op: "replace", path: "/stories/1/touches", value: ["requests", "teams"] });
    expect(op("unsay", "2")).toEqual({ op: "remove", path: "/stories/2" });
    expect(op("document", "team", "teams", "2", "4")).toEqual({ op: "add", path: "/documents/-", value: { name: "team", root: "teams", stories: ["2", "4"] } });
    expect(op("own", "2")).toEqual({ op: "replace", path: "/documents/2/own", value: true });
    expect(op("holds", "1", "requests", "under", "teams", "starts:date", "status")).toEqual({ op: "replace", path: "/documents/1/holds/requests", value: { under: "teams", fields: [field("starts", "date"), field("status")] } });
    expect(op("holds", "1", "teams", "name")).toEqual({ op: "replace", path: "/documents/1/holds/teams", value: { under: undefined, fields: [field("name")] } });
    expect(op("unhold", "1", "requests")).toEqual({ op: "remove", path: "/documents/1/holds/requests" });
    expect(op("heldby", "1", "ann", "bo")).toEqual({ op: "replace", path: "/documents/1/held_by", value: ["ann", "bo"] });
    expect(op("serves", "1", "1", "2")).toEqual({ op: "replace", path: "/documents/1/stories", value: ["1", "2"] });
    expect(op("rename", "1", "the", "team")).toEqual({ op: "replace", path: "/documents/1/name", value: "the team" });
    expect(op("drop", "2")).toEqual({ op: "remove", path: "/documents/2" });
  });
});

describe("modeling, served", () => {
  let server: ReturnType<typeof createServer>;
  beforeAll(() => {
    server = createServer(example, 0);
  });
  afterAll(() => {
    server.stop(true);
  });

  /** Posts the sign-in form, as a browser does: the answer, and the session its cookie names. */
  async function signIn(email: string, password: string, headers: Record<string, string> = {}): Promise<{ res: Response; sessionId?: string }> {
    const res = await fetch(new URL("/login", server.url), { method: "POST", body: new URLSearchParams({ email, password }), redirect: "manual", headers });
    return { res, sessionId: /session_id=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1] };
  }

  test("signing in: only by the form, from this site, with a password that matches the email", async () => {
    expect((await fetch(new URL("/login", server.url), { redirect: "manual" })).headers.get("location")).toBe("/");
    expect((await signIn("peter@modeling.example", "peter-password", { origin: "https://elsewhere.example" })).res.status).toBe(403);
    expect((await signIn("peter@modeling.example", "wrong")).sessionId).toBeUndefined();
    expect((await signIn("nobody@modeling.example", "peter-password", { cookie: "session_id=a-visit" })).sessionId).toBeUndefined();
    expect((await signIn(" Peter@Modeling.example ", "peter-password")).sessionId).toBeString();
  });

  test("a session signs out, and then writes nothing", async () => {
    const { sessionId } = await signIn("peter@modeling.example", "peter-password");
    const url = new URL("/ws", server.url);
    url.protocol = "ws:";
    // @ts-expect-error Bun's runtime-only `headers` option on WebSocket
    const ws: WebSocket = new WebSocket(url, { headers: { Cookie: `session_id=${sessionId}` } });
    const inbox: string[] = [];
    let answered: () => void = () => {};
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.type === "inspect") answered();
      else inbox.push(message.type);
    });
    await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
    const send = async (doc: string, ops: PatchOp[]) => {
      inbox.length = 0;
      ws.send(JSON.stringify({ id: 1, doc, ops }));
      ws.send(JSON.stringify({ type: "inspect" }));
      await new Promise<void>((resolve) => (answered = resolve));
      return [...inbox];
    };
    expect(await send("session", [{ op: "replace", path: "/person_id", value: "2" }])).toEqual(["refused"]);
    expect(await send("session", [{ op: "remove", path: "/person_id" }])).toContain("patch");
    expect(await send("session", [{ op: "remove", path: "/person_id" }])).toEqual(["refused"]);
    ws.close();
  });

  test("every story passes", async () => {
    const report = await run(example, stories);
    expect(report.outcomes.filter((o) => o.failures.length > 0).map((o) => [o.name, o.failures])).toEqual([]);
  }, 60000);
});
