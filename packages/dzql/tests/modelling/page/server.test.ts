import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { resolve } from "node:path";
import type { PatchOp } from "dzql/rendering/json-patch";
import { createServer } from "dzql/rendering/server";
import { run } from "dzql/modelling/harness";
import { Refusal } from "dzql/rendering/refusal";
import { BOX, boxHeight, drawHeart, heartOf, layout, picked, plain, reason, related, shape as shapeOf, singular, type Raw, type Ui } from "../../../src/modelling/page/heart";
import { may, model, shape, type Model } from "../../../src/modelling/page/model";
import { aliases, show, stdin } from "../../../src/modelling/page/cli";
import { closureOf, plainClosure } from "../../../src/modelling/page/closure";
import { stories } from "../../../src/modelling/page/stories";
import { links } from "../../../src/modelling/page/signin";
import { example } from "../../../src/modelling/page/index";

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

  test("the model in plain text, as the page shows it: each story, numbered, who and does or cannot; each document, numbered, whose, what it serves, and what it holds under its root", () => {
    const more: Raw = { ...leave, stories: { ...leave.stories, "4": { id: 4, text: "Mo approves", actor: "mo", kind: "does" } } };
    expect(plain(more)).toBe(
      [
        "Leave",
        "",
        "Stories",
        "1. ann does: Ann asks",
        "2. visitor does, posts to /login: Bo signs in",
        "3. ann cannot: Ann cannot approve",
        "4. mo does, no document: Mo approves",
        "",
        "Documents",
        "1. team, held by ann and mo; serves 1 and 3",
        "   teams: name",
        "     requests: starts:date",
        "     notes",
        "2. session, each person's own, held by nobody yet; serves 2",
        "   sessions: page",
        "3. inbox, held by nobody yet; serves no story told",
        "   requests: starts, note",
      ].join("\n"),
    );
    expect(plain({ models: { name: "Cafe" } })).toBe("Cafe\n\nStories\nNone yet.\n\nDocuments\nNone yet.");
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
    expect(doc).toContain("Stories · 2 of 3 it was born from");
    expect(doc).toContain("Documents · Team");
    expect(doc).toContain("Entities · 3 of 5 reached");
    expect(doc).toContain('<div class="shape"><div style="padding-left:0px">team:&lt;team&gt;</div>');
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
    expect(ent).toContain("Stories · 1 of 3 touch requests");
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

  test("an entity's box is as tall as its columns need, and the tree makes room for it", () => {
    const columns = ["words", "kind", "asked_by", "next", "in", "status", "answered_at"]; // canyou's asks: 7 columns, clipped before
    expect(boxHeight([])).toBe(BOX.H);
    expect(boxHeight(["name"])).toBe(BOX.H); // one line, the box as it was
    expect(boxHeight(columns)).toBe(BOX.H + 2 * BOX.LINE); // three lines of about 23 characters
    expect(boxHeight(columns, 17)).toBeGreaterThan(boxHeight(columns)); // a marked box is narrower inside
    const tall = boxHeight(columns);
    const t = layout([{ name: "a", parent: null }, { name: "b", parent: "a", h: tall }, { name: "c", parent: "a" }]);
    expect(t.pos.c!.y).toBe(tall + BOX.ROW - BOX.H); // c starts below b's whole height
    expect(t.pos.a!.y + BOX.H / 2).toBe((tall / 2 + t.pos.c!.y + BOX.H / 2) / 2); // a is level with the middle of its children
    expect(t.height).toBe(t.pos.c!.y + BOX.H);
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
    expect(shape(m, [{ op: "add", path: "/stories/-", value: { text: "Bo asks", actor: "bo", post: " " } }])).toEqual([
      { op: "add", path: "/stories/-", value: { text: "Bo asks", actor: "bo", kind: "does", post: null, touches: [] } },
    ]);
    expect(refusal({ op: "add", path: "/stories/-", value: { text: "Bo asks", actor: "bo", kind: "sees" } })).toBe('A story is one someone does or cannot do, not "sees".');
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
      { op: "add", path: "/documents/-", value: { name: "calendar", root: "requests", own: 1, list: 0, stories: [1, 3], holds: { requests: { parent: null, fields: [{ name: "starts", type: "date" }] } }, held_by: ["ann"] } },
    ]);
    expect(refusal({ op: "add", path: "/documents/-", value: { name: "notes", root: "notes", stories: ["8"] } })).toBe("A document is for a story: name the one it serves.");
    expect(refusal({ op: "add", path: "/documents/-", value: { root: "notes", stories: ["1"] } })).toBe("A document needs a name.");
    expect(refusal({ op: "add", path: "/documents/-", value: { name: "notes", stories: ["1"] } })).toBe("A document holds something: name its root.");
    expect(shape(m, [{ op: "replace", path: "/documents/1/name", value: " staff " }])).toEqual([{ op: "replace", path: "/documents/1/name", value: "staff" }]);
    expect(shape(m, [{ op: "replace", path: "/documents/1/held_by", value: "ann" }])).toEqual([{ op: "replace", path: "/documents/1/held_by", value: [] }]);
    expect(shape(m, [{ op: "replace", path: "/documents/1/stories", value: ["2"] }])).toEqual([{ op: "replace", path: "/documents/1/stories", value: [2] }]);
    expect(shape(m, [{ op: "replace", path: "/documents/1/own", value: 0 }])).toEqual([{ op: "replace", path: "/documents/1/own", value: 0 }]);
    expect(shape(m, [{ op: "replace", path: "/documents/1/own", value: true }])).toEqual([{ op: "replace", path: "/documents/1/own", value: 1 }]);
    // every row of its root (`menu:`), or one of them (`menu:1`)
    expect(shape(m, [{ op: "replace", path: "/documents/1/list", value: true }])).toEqual([{ op: "replace", path: "/documents/1/list", value: 1 }]);
    expect(shape(m, [{ op: "add", path: "/documents/-", value: { name: "menu", root: "items", stories: ["1"], list: true } }])[0]!.value).toMatchObject({ list: 1 });
    // a new root, the number kept: the old root still held, under it (cafe-c's feedback)
    const [root, holds] = shape(m, [{ op: "replace", path: "/documents/1/root", value: " requests " }]);
    expect(root).toEqual({ op: "replace", path: "/documents/1/root", value: "requests" });
    expect((holds!.value as Record<string, { parent: string | null }>).requests!.parent).toBeNull();
    expect((holds!.value as Record<string, { parent: string | null }>).teams!.parent).toBe("requests");
    expect(refusal({ op: "replace", path: "/documents/1/root", value: " " })).toBe("A document holds something: name its root.");
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
      ...["name", "held_by", "stories", "own", "list"].map((f) => ({ op: "replace" as const, path: `/documents/2/${f}` })),
    ];
    const no: PatchOp[] = [
      { op: "replace", path: "/stories/-" },
      { op: "add", path: "/stories/-/text" },
      { op: "replace", path: "/stories/1" },
      { op: "remove", path: "/stories/1/text" },
      { op: "replace", path: "/stories/1/post" },
      { op: "replace", path: "/stories/1/text/x" },
      { op: "replace", path: "/models/name" },
      { op: "remove", path: "/documents/-" },
      { op: "replace", path: "/documents/2" },
      { op: "add", path: "/documents/2/holds/sessions" },
      { op: "replace", path: "/documents/2/holds" },
      { op: "replace", path: "/documents/2/holds/sessions/x" },
      { op: "remove", path: "/documents/2/name" },
      { op: "replace", path: "/documents/2/name/x" },
      { op: "remove", path: "/documents/2/root" },
    ];
    expect(yes.filter((op) => !may(m, op))).toEqual([]);
    expect(no.filter((op) => may(m, op))).toEqual([]);
    // one the model has not got is refused, saying they go by number
    expect(() => may(m, { op: "remove", path: "/stories/9" })).toThrow("No story 9: stories go by their number (show lists them)");
    expect(() => may(m, { op: "replace", path: "/documents/bill/held_by" })).toThrow("No document bill: documents go by their number, not their name (show lists them)");
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
    expect(op("list", "2")).toEqual({ op: "replace", path: "/documents/2/list", value: true });
    expect(op("holds", "1", "requests", "under", "teams", "starts:date", "status")).toEqual({ op: "replace", path: "/documents/1/holds/requests", value: { under: "teams", fields: [field("starts", "date"), field("status")] } });
    expect(op("holds", "1", "teams", "name")).toEqual({ op: "replace", path: "/documents/1/holds/teams", value: { under: undefined, fields: [field("name")] } });
    expect(op("unhold", "1", "requests")).toEqual({ op: "remove", path: "/documents/1/holds/requests" });
    expect(op("heldby", "1", "ann", "bo")).toEqual({ op: "replace", path: "/documents/1/held_by", value: ["ann", "bo"] });
    expect(op("serves", "1", "1", "2")).toEqual({ op: "replace", path: "/documents/1/stories", value: ["1", "2"] });
    expect(op("rename", "1", "the", "team")).toEqual({ op: "replace", path: "/documents/1/name", value: "the team" });
    expect(op("drop", "2")).toEqual({ op: "remove", path: "/documents/2" });
  });

  test("a story's words with an apostrophe are piped in: `-` reads them, so no shell quote is left open", async () => {
    const piped = `${process.env.TMPDIR ?? "/tmp"}/piped-${crypto.randomUUID()}`;
    await Bun.write(piped, "Ann scans the table's QR code\n");
    const was = stdin.path;
    stdin.path = piped;
    try {
      expect(aliases.story!(["ann", "does", "-"]).ops[0]).toEqual({ op: "add", path: "/stories/-", value: { actor: "ann", kind: "does", text: "Ann scans the table's QR code" } });
      expect(aliases.story!(["visitor", "does", "--post", "/login", "-"]).ops[0]).toMatchObject({ value: { text: "Ann scans the table's QR code", post: "/login" } });
      expect(aliases.reword!(["1", "-"]).ops[0]).toEqual({ op: "replace", path: "/stories/1/text", value: "Ann scans the table's QR code" });
      expect(aliases.story!(["ann", "does", "Ann", "-", "Bo"]).ops[0]).toMatchObject({ value: { text: "Ann - Bo" } }); // a dash among words is a word
    } finally {
      stdin.path = was;
      await Bun.file(piped).delete();
    }
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
    const res = await fetch(new URL("/model/login", server.url), { method: "POST", body: new URLSearchParams({ email, password }), redirect: "manual", headers });
    return { res, sessionId: /session_id_model=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1] };
  }

  test("signing in by a link: each keeper's, said as the server starts; one that is no link signs nobody in", async () => {
    const said = links.say(server.url.origin);
    expect(said.map((l) => l.split(":")[0])).toEqual(["Peter", "Claude"]);
    const peter = await fetch(said[0]!.slice("Peter: ".length), { redirect: "manual" });
    expect(peter.status).toBe(303);
    expect(peter.headers.get("location")).toBe("/model");
    expect(peter.headers.get("set-cookie")).toContain("session_id_model="); // the model's own cookie, under its path
    const nobody = await fetch(new URL("/model/in/not-a-link", server.url), { redirect: "manual" });
    expect(nobody.headers.get("set-cookie")).toBeNull();
  });

  test("signing in: only by the form, from this site, with a password that matches the email", async () => {
    expect((await fetch(new URL("/model/login", server.url), { redirect: "manual" })).headers.get("location")).toBe("/model");
    expect((await signIn("peter@modeling.example", "peter-password", { origin: "https://elsewhere.example" })).res.status).toBe(403);
    expect((await signIn("peter@modeling.example", "wrong")).sessionId).toBeUndefined();
    expect((await signIn("nobody@modeling.example", "peter-password", { cookie: "session_id_model=a-visit" })).sessionId).toBeUndefined();
    expect((await signIn(" Peter@Modeling.example ", "peter-password")).sessionId).toBeString();
  });

  test("a session signs out, and then writes nothing", async () => {
    const { sessionId } = await signIn("peter@modeling.example", "peter-password");
    const url = new URL("/model/ws", server.url); // the model is a route of its own, at /model
    url.protocol = "ws:";
    // @ts-expect-error Bun's runtime-only `headers` option on WebSocket
    const ws: WebSocket = new WebSocket(url, { headers: { Cookie: `session_id_model=${sessionId}` } });
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

  test("`show` prints the model as the page shows it, read as the CLI is signed in; signed out, it says to sign in", async () => {
    const ws = `${server.url.href.replace(/^http/, "ws")}model`;
    const file = `${process.env.TMPDIR ?? "/tmp"}/session-${crypto.randomUUID()}`;
    await Bun.write(file, (await signIn("claude@modeling.example", "claude-password")).sessionId!);
    const { readPage } = await import("../../../src/modelling/page/loader/told");
    const raw = await readPage(ws, (await Bun.file(file).text()).trim());
    const page = plain(raw);
    expect(page).toContain("\n21. visitor does, posts to /login: Bo signs in on another phone, and sees the team's calendar\n");
    expect(page).toContain("\n2. session, each person's own, held by ann, bo, mo and visitor; serves 1, 3, 20 and 23\n   sessions: person_id, page, draft:json");

    const printed = spyOn(console, "log").mockImplementation(() => {});
    const said = spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await show(ws, file)).toBe(0);
      expect(printed).toHaveBeenCalledWith(`${page}\n\n${plainClosure(closureOf(raw))}`);
      expect(await show(ws, `${file}-none`)).toBe(1);
      expect(said).toHaveBeenCalledWith("No model on the page: sign in first (login <your link>).");
    } finally {
      printed.mockRestore();
      said.mockRestore();
    }

    // and as the CLI runs it: the kernel's, loading modeling's verbs
    const cli = Bun.spawn(["bun", `${import.meta.dir}/../../../src/rendering/cli.ts`, "show", "--session", file], { env: { ...process.env, ETA_EXAMPLE: resolve(import.meta.dir, "../../../src/modelling/page"), ETA_URL: ws }, stdout: "pipe" });
    const out = await new Response(cli.stdout).text();
    expect(out).toBe(`${page}\n\n${plainClosure(closureOf(raw))}\n`);
    // hjeli's registers over the seed: the logins a sign-in looks up, no document holds
    expect(out).toContain("\nReachability: 1 gap\n  unwatched-entity · logins: no document holds logins, so nobody is told when it changes\n");
    expect(out).toContain("\nPrecondition closure: not asked (no story says what it writes or what it presupposes (writes, requires))\n");
    expect(await cli.exited).toBe(0);
    await Bun.file(file).delete();
  }, 30000);

  test("every story passes", async () => {
    const report = await run(example, stories);
    expect(report.outcomes.filter((o) => o.failures.length > 0).map((o) => [o.name, o.failures])).toEqual([]);
  }, 60000);
});
