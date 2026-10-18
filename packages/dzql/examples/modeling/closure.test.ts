import { describe, expect, test } from "bun:test";
import { closureOf, drawClosure, plainClosure, type Register } from "./closure";
import type { Raw } from "./heart";

// hjeli's six registers over the model as the page keeps it, each gap as the page would read it.
const field = (name: string, type = "text") => ({ name, type });
const told: Raw = {
  models: { name: "Leave" },
  stories: {
    "1": { id: 1, text: "Ann asks for a week", actor: "ann", kind: "does", touches: ["requests"] },
    "2": { id: 2, text: "Mo approves it", actor: "mo", kind: "does", touches: ["requests", "approvals"] },
    "3": { id: 3, text: "Bo signs in", actor: "visitor", kind: "does", post: "/login", touches: ["logins"] },
    "4": { id: 4, text: "Ann cannot approve her own", actor: "ann", kind: "cannot", touches: ["requests"] },
    "5": { id: 5, text: "Ann notes a holiday", actor: "ann", kind: "does", touches: ["holidays"] },
  },
  documents: {
    "1": { id: 1, name: "calendar", root: "teams", holds: { teams: { parent: null, fields: [field("name")] }, requests: { parent: "teams", fields: [field("starts", "date")] }, notes: { parent: "pages", fields: [field("bad name")] } }, held_by: ["ann", "jo"], stories: [1, 9] },
    "2": { id: 2, name: "session", root: "sessions", own: 1, holds: { sessions: { parent: null, fields: [] } }, stories: [3] },
    "3": { id: 3, name: "holidays", root: "holidays", holds: { holidays: { parent: null, fields: [] } }, held_by: [], stories: [5] },
    "4": { id: 4, name: "calendar", root: "requests", holds: { requests: { parent: null, fields: [] } }, held_by: ["mo"], stories: [2] },
  },
};
const of = (registers: Register[], predicate: Register["predicate"]) => registers.find((r) => r.predicate === predicate)!;

describe("hjeli's six registers, over the model as it is told", () => {
  const r = closureOf(told);

  test("all six, in hjeli's order", () => {
    expect(r.map((x) => x.predicate)).toEqual(["reachability", "subscription-closure", "actor-closure", "precondition-closure", "referential-closure", "authorization-closure"]);
  });

  test("reachability: an entity no document holds, and a document nobody holds that is not each person's own", () => {
    expect(of(r, "reachability").gaps).toEqual([
      { kind: "unwatched-entity", where: "approvals", detail: "no document holds approvals, so nobody is told when it changes" },
      { kind: "unwatched-entity", where: "logins", detail: "no document holds logins, so nobody is told when it changes" },
      { kind: "unheld-document", where: "holidays", detail: "holidays is held by nobody, and is not each person's own" },
    ]);
  });

  test("subscription closure: a write that reaches no document anyone holds; a refusal and a form posted to a route write nothing", () => {
    expect(of(r, "subscription-closure").gaps).toEqual([
      { kind: "silent-write", where: "story 2 (mo)", detail: "it touches approvals, which reaches no document anyone holds" },
      { kind: "silent-write", where: "story 5 (ann)", detail: "it touches holidays, which reaches no document anyone holds" },
    ]);
  });

  test("actor closure: someone who holds a document and tells no story", () => {
    expect(of(r, "actor-closure").gaps).toEqual([{ kind: "unknown-holder", where: "calendar", detail: "calendar is held by jo, who tells no story" }]);
  });

  test("precondition closure is not asked, never passed, while no story says what it writes", () => {
    expect(of(r, "precondition-closure")).toMatchObject({ notAsked: "no story says what it writes or what it presupposes (writes, requires)", gaps: [] });
  });

  test("referential closure: a story not told, a parent not held, a name no schema takes, a name said twice", () => {
    expect(of(r, "referential-closure").gaps).toEqual([
      { kind: "unknown-story", where: "calendar", detail: "calendar serves story 9, which is not told" },
      { kind: "unknown-parent", where: "calendar", detail: "notes hangs under pages, which calendar does not hold" },
      { kind: "invalid-name", where: "calendar: notes", detail: '"bad name" is not a name a column can take' },
      { kind: "duplicate-name", where: "calendar", detail: "more than one document is named calendar" },
    ]);
    expect(of(closureOf({ models: { name: "x" }, stories: { "1": { id: 1, text: "t", actor: "a", kind: "does", touches: ["two words"] } } }), "referential-closure").gaps).toEqual([
      { kind: "invalid-name", where: "two words", detail: '"two words" is not a name a table can take' },
    ]);
  });

  test("authorization closure: you may write what you may read -- a teller who holds no document holding what they touch", () => {
    // mo holds the second calendar, which holds requests: his. ann holds the first: hers. holidays is held by nobody: ann's write is not hers.
    expect(of(r, "authorization-closure").gaps).toEqual([{ kind: "unscoped-write", where: "story 5 (ann)", detail: "ann touches holidays, held by no document ann holds" }]);
  });

  test("an empty model: every register closed but the one not asked", () => {
    expect(closureOf({ models: { name: "Cafe" } }).map((x) => x.gaps.length)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  test("drawn across the top: each a chip, open, closed or not asked, its gaps beneath; and in plain text for the CLI", () => {
    const html = drawClosure(r);
    expect(html).toStartWith(`<section id="closure" aria-label="hjeli's six registers: 11 gaps">`);
    expect(html).toContain(`<details class="register open" data-predicate="reachability"><summary><span class="dot"></span>Reachability · 3 gaps</summary>`);
    expect(html).toContain(`<details class="register unasked" data-predicate="precondition-closure"><summary><span class="dot"></span>Precondition closure · not asked</summary><div class="register-body"><p class="asks">every row a write presupposes is added by some story, and every state a story requires some write sets</p><p>Not asked: no story says what it writes or what it presupposes (writes, requires).</p>`);
    expect(html).toContain("<li><b>story 5 (ann)</b> ann touches holidays, held by no document ann holds</li>");
    const closed = drawClosure(closureOf({ models: { name: "Cafe" } }));
    expect(closed).toContain(`aria-label="hjeli's six registers: 0 gaps"`);
    expect(closed).toContain(`<details class="register closed" data-predicate="actor-closure"><summary><span class="dot"></span>Actor closure · closed</summary><div class="register-body"><p class="asks">every actor is someone a story knows: whoever holds a document tells a story</p><p>Every one: every actor is someone a story knows: whoever holds a document tells a story.</p>`);
    expect(drawClosure(closureOf({ models: { name: "Cafe" }, documents: { "3": { ...told.documents!["3"]!, stories: [] } } }))).toContain(`aria-label="hjeli's six registers: 1 gap"`);
    expect(plainClosure(r).split("\n").slice(0, 5)).toEqual([
      "Closure (hjeli's six registers)",
      "Reachability: 3 gaps",
      "  unwatched-entity · approvals: no document holds approvals, so nobody is told when it changes",
      "  unwatched-entity · logins: no document holds logins, so nobody is told when it changes",
      "  unheld-document · holidays: holidays is held by nobody, and is not each person's own",
    ]);
  });
});

describe("what a story writes and presupposes, as hjeli had them: precondition closure asked", () => {
  const said: Raw = {
    models: { name: "Leave" },
    stories: {
      "1": { id: 1, text: "Ann asks", actor: "ann", kind: "does", writes: [{ entity: "requests", op: "add" }] },
      "2": { id: 2, text: "Mo approves", actor: "mo", kind: "does", writes: [{ entity: "requests", op: "replace", path: "status", to: "approved" }], requires: [{ entity: "requests", path: "status", value: "waiting" }] },
      "3": { id: 3, text: "Mo renames the team", actor: "mo", kind: "does", writes: [{ entity: "teams", op: "replace", path: "name" }] },
      "4": { id: 4, text: "Ann picks a page", actor: "ann", kind: "does", writes: [{ entity: "sessions", op: "replace", path: "page" }] },
    },
    documents: {
      "1": { id: 1, name: "team", root: "teams", holds: { teams: { parent: null, fields: [] }, requests: { parent: "teams", fields: [] } }, held_by: ["ann", "mo"], stories: [1, 2, 3] },
      "2": { id: 2, name: "session", root: "sessions", own: 1, holds: { sessions: { parent: null, fields: [] } }, stories: [4] },
    },
  };
  test("a change to a row no story adds, and a state no write sets; the visit makes an own document's row", () => {
    expect(of(closureOf(said), "precondition-closure")).toEqual({
      predicate: "precondition-closure",
      asks: "every row a write presupposes is added by some story, and every state a story requires some write sets",
      gaps: [
        { kind: "unestablished-row", where: "story 3 (mo)", detail: "replace teams.name presupposes a teams row, but no story adds one" },
        { kind: "unreachable-precondition", where: "story 2 (mo)", detail: "it presupposes requests.status=waiting, but no write sets it" },
      ],
    });
  });

  test("a write is a touch: the subscription and authorization registers read it", () => {
    const r = closureOf({ ...said, documents: { "2": said.documents!["2"]! } });
    expect(of(r, "subscription-closure").gaps.map((g) => g.detail)).toContain("it touches requests, which reaches no document anyone holds");
  });

  test("dzql model audit: the six over a model's file, exit 1 while one is open, 0 when none is", async () => {
    const { Database } = await import("bun:sqlite");
    const dir = `${process.env.TMPDIR ?? "/tmp"}/audit-${crypto.randomUUID()}`;
    const file = `${dir}.sqlite`;
    const db = new Database(file);
    db.run("CREATE TABLE mdl_stories (id INTEGER, models_id INTEGER, text TEXT, actor TEXT, kind TEXT, post TEXT, touches TEXT)");
    db.run("CREATE TABLE mdl_documents (id INTEGER, models_id INTEGER, name TEXT, root TEXT, own INTEGER, holds TEXT, held_by TEXT, stories TEXT)");
    db.run(`INSERT INTO mdl_stories VALUES (1, 1, 'Ann asks', 'ann', 'does', NULL, '["requests"]')`);
    const audit = async () => {
      const p = Bun.spawn(["bun", `${import.meta.dir}/../../src/cli/index.ts`, "model", "audit", file], { stdout: "pipe" });
      return { out: await new Response(p.stdout).text(), code: await p.exited };
    };
    const open = await audit();
    expect(open.code).toBe(1);
    expect(open.out).toContain("Reachability: 1 gap\n  unwatched-entity · requests: no document holds requests, so nobody is told when it changes\n");
    db.run(`INSERT INTO mdl_documents VALUES (1, 1, 'team', 'requests', 0, '{"requests":{"parent":null,"fields":[]}}', '["ann"]', '[1]')`);
    db.close();
    const closed = await audit();
    expect(closed.out).toContain("Reachability: closed\n");
    expect(closed.code).toBe(0);
    await Bun.file(file).delete();
  }, 30000);
});

describe("a story's writes and requires: kept by the model, said by the CLI, shown in plain text", () => {
  test("the model takes them in hjeli's shape, and refuses a write with no entity or verb, or a state half said", async () => {
    const { model, shape, may } = await import("./model");
    const m = model({ models: { name: "x" }, stories: { "1": { id: 1, text: "t", actor: "a", kind: "does" } } });
    expect(may(m, { op: "replace", path: "/stories/1/writes", value: [] })).toBe(true);
    expect(may(m, { op: "replace", path: "/stories/1/requires", value: [] })).toBe(true);
    expect(shape(m, [{ op: "replace", path: "/stories/1/writes", value: [{ entity: " requests ", op: "replace", path: "status", to: "approved" }, { entity: "requests", op: "add", path: "", to: null }] }])).toEqual([
      { op: "replace", path: "/stories/1/writes", value: [{ entity: "requests", op: "replace", path: "status", to: "approved" }, { entity: "requests", op: "add" }] },
    ]);
    expect(shape(m, [{ op: "replace", path: "/stories/1/requires", value: [{ entity: "requests", path: "status", value: "waiting" }] }])[0]!.value).toEqual([{ entity: "requests", path: "status", value: "waiting" }]);
    expect(shape(m, [{ op: "replace", path: "/stories/1/writes", value: "none" }])[0]!.value).toEqual([]);
    expect(shape(m, [{ op: "replace", path: "/stories/1/requires", value: undefined }])[0]!.value).toEqual([]);
    expect(() => shape(m, [{ op: "replace", path: "/stories/1/writes", value: [{ entity: "requests", op: "upsert" }] }])).toThrow("A write names an entity and add, replace or remove.");
    expect(() => shape(m, [{ op: "replace", path: "/stories/1/writes", value: [null] }])).toThrow("A write names an entity");
    expect(() => shape(m, [{ op: "replace", path: "/stories/1/requires", value: [{ entity: "requests", path: "status" }] }])).toThrow("A state a story presupposes names an entity, its field and the value.");
    expect(() => shape(m, [{ op: "replace", path: "/stories/1/requires", value: [null] }])).toThrow("A state a story presupposes");
  });

  test("the CLI says them: a verb and its target each, and the states as entity.field=value", async () => {
    const { aliases } = await import("./cli");
    expect(aliases.writes!(["2", "add", "requests", "replace", "requests.status=approved", "remove", "requests"])).toEqual({
      doc: "model",
      ops: [{ op: "replace", path: "/stories/2/writes", value: [{ op: "add", entity: "requests" }, { op: "replace", entity: "requests", path: "status", to: "approved" }, { op: "remove", entity: "requests" }] }],
    });
    expect(aliases.requires!(["2", "requests.status=waiting", "bad"])).toEqual({
      doc: "model",
      ops: [{ op: "replace", path: "/stories/2/requires", value: [{ entity: "requests", path: "status", value: "waiting" }, { entity: undefined, path: undefined, value: undefined }] }],
    });
  });

  test("plain text shows what a story writes and presupposes, and the heart lights what it writes", async () => {
    const { plain, heartOf } = await import("./heart");
    const raw: Raw = { models: { name: "L" }, stories: { "1": { id: 1, text: "Mo approves", actor: "mo", kind: "does", touches: ["teams"], writes: [{ entity: "requests", op: "replace", path: "status", to: "approved" }, { entity: "requests", op: "add" }], requires: [{ entity: "requests", path: "status", value: "waiting" }] } } };
    expect(plain(raw)).toContain("1. mo does, no document: Mo approves; writes replace requests.status=approved, add requests; requires requests.status=waiting");
    expect(heartOf(raw).stories[0]!.touches).toEqual(["teams", "requests"]);
  });
});
