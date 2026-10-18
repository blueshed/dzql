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

  test("all six, in hjeli's order, then Easy's coverage and derive-ux's playability", () => {
    expect(r.map((x) => x.predicate)).toEqual(["reachability", "subscription-closure", "actor-closure", "precondition-closure", "referential-closure", "authorization-closure", "coverage", "playability"]);
  });

  test("reachability: an entity no document holds, a document nobody holds that is not each person's own, and one that holds no field", () => {
    expect(of(r, "reachability").gaps).toEqual([
      { kind: "unwatched-entity", where: "approvals", detail: "no document holds approvals, so nobody is told when it changes" },
      { kind: "unwatched-entity", where: "logins", detail: "no document holds logins, so nobody is told when it changes" },
      { kind: "unheld-document", where: "holidays", detail: "holidays is held by nobody, and is not each person's own" },
      { kind: "unserved-story", where: "story 4 (ann)", detail: "no document serves it: which document is it done on? (serves <document's number> ... 4)" },
      { kind: "empty-document", where: "holidays", detail: "holidays holds no field: say what it holds (holds 3 <entity> <field>...)" },
      { kind: "empty-document", where: "calendar", detail: "calendar holds no field: say what it holds (holds 4 <entity> <field>...)" },
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
    expect(closureOf({ models: { name: "Cafe" } }).map((x) => x.gaps.length)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  test("drawn across the top: each a chip, open, closed or not asked, its gaps beneath; and in plain text for the CLI", () => {
    const html = drawClosure(r);
    expect(html).toStartWith(`<section id="closure" aria-label="the model's checks: 14 gaps">`);
    expect(html).toContain(`<details class="register open" data-predicate="reachability"><summary><span class="dot"></span>Reachability · 6 gaps</summary>`);
    expect(html).toContain(`<details class="register unasked" data-predicate="precondition-closure"><summary><span class="dot"></span>Precondition closure · not asked</summary><div class="register-body"><p class="asks">every row a write presupposes is added by some story, and every state a story requires some write sets</p><p>Not asked: no story says what it writes or what it presupposes (writes, requires).</p>`);
    expect(html).toContain("<li><b>story 5 (ann)</b> ann touches holidays, held by no document ann holds</li>");
    const closed = drawClosure(closureOf({ models: { name: "Cafe" } }));
    expect(closed).toContain(`aria-label="the model's checks: 0 gaps"`);
    expect(closed).toContain(`<details class="register unasked" data-predicate="actor-closure"><summary><span class="dot"></span>Actor closure · not asked</summary><div class="register-body"><p class="asks">every actor is someone a story knows, and has something in front of them: whoever holds a document tells a story, whoever tells a story holds a document</p><p>Not asked: no story is told yet.</p>`);
    const asked = drawClosure(closureOf({ models: { name: "Cafe" }, stories: { "1": { id: 1, text: "Ann asks", actor: "ann", kind: "does", touches: ["requests"] } }, documents: { "1": { id: 1, name: "team", root: "requests", holds: { requests: { parent: null, fields: [field("starts")] } }, held_by: ["ann"], stories: [1] } } }));
    expect(asked).toContain(`<details class="register closed" data-predicate="actor-closure"><summary><span class="dot"></span>Actor closure · closed</summary>`);
    expect(drawClosure(closureOf({ models: { name: "Cafe" }, documents: { "3": { ...told.documents!["3"]!, stories: [] } } }))).toContain(`aria-label="the model's checks: 2 gaps"`) // held by nobody, and holds no field;
    expect(plainClosure(r).split("\n").slice(0, 5)).toEqual([
      "Checks (hjeli's six, Easy's coverage, derive-ux's playability)",
      "Reachability: 6 gaps",
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
  test("a state no write sets; a document's root row is the document's, and the visit makes an own document's row", () => {
    expect(of(closureOf(said), "precondition-closure")).toEqual({
      predicate: "precondition-closure",
      asks: "every row a write presupposes is added by some story, and every state a story requires some write sets",
      gaps: [
        { kind: "unreachable-precondition", where: "story 2 (mo)", detail: "it presupposes requests.status=waiting, but no write sets it" },
      ],
    });
  });

  test("a write is a touch: the subscription and authorization registers read it", () => {
    const r = closureOf({ ...said, documents: { "2": said.documents!["2"]! } });
    expect(of(r, "subscription-closure").gaps.map((g) => g.detail)).toContain("it touches requests, which reaches no document anyone holds");
  });

  test("dzql model check: the checks over the model's file, exit 1 and nothing made while one is open; then the app's files", async () => {
    const { mkdtempSync, rmSync, existsSync, readdirSync } = await import("node:fs");
    const dir = mkdtempSync(`${import.meta.dir}/.check-`);
    const file = `${dir}/model.json`;
    const story = { id: 1, models_id: 1, text: "Ann asks", actor: "ann", kind: "does", post: null, touches: [], writes: [{ entity: "requests", op: "add" }], requires: null };
    const write = (documents: unknown[], more: unknown[] = []) => Bun.write(file, JSON.stringify({ tables: { models: [{ id: 1, name: "Team" }], stories: [story, ...more], documents } }));
    const check = async () => {
      const p = Bun.spawn(["bun", `${import.meta.dir}/../../src/cli/index.ts`, "model", "check", "--out", `${dir}/app`], { stdout: "pipe", env: { ...process.env, MODEL_FILE: file } });
      return { out: await new Response(p.stdout).text(), code: await p.exited };
    };
    try {
      await write([]);
      const open = await check();
      expect(open.code).toBe(1);
      expect(open.out).toContain("Reachability: 2 gaps\n  unwatched-entity · requests: no document holds requests, so nobody is told when it changes\n");
      expect(existsSync(`${dir}/app`)).toBe(false);
      // a model with no stories makes nothing
      await Bun.write(file, JSON.stringify({ tables: { models: [{ id: 1, name: "Team" }] } }));
      expect((await check()).out).toBe("No stories yet: nothing made.\n");
      expect(existsSync(`${dir}/app`)).toBe(false);
      // a file a person wrote is kept: the model's goes beside it
      await Bun.write(`${dir}/app/types.ts`, "// the app's own\n");
      await write([{ id: 1, models_id: 1, name: "team", root: "teams", own: 0, holds: { teams: { parent: null, fields: [] }, requests: { parent: "teams", fields: [{ name: "starts" }] } }, held_by: ["ann"], stories: [1] }]);
      const closed = await check();
      expect(closed.out).toContain("Reachability: closed\n");
      expect(closed.code).toBe(0);
      expect(readdirSync(`${dir}/app`).sort()).toEqual(["guards.ts", "migrations", "model.test.ts", "types.model.ts", "types.ts"]); // no stories: the app's are its own
      expect(await Bun.file(`${dir}/app/types.ts`).text()).toBe("// the app's own\n");
      expect(readdirSync(`${dir}/app/migrations`)).toEqual(["001-teams-requests.ts"]);
      expect((await check()).out).not.toContain("new)"); // the model unchanged: no next step
      // a parent changed is a step only a person can finish: written once, saying so, and not again
      const grouping = { id: 2, models_id: 1, text: "Ann makes a group", actor: "ann", kind: "does", post: null, touches: [], writes: [{ entity: "groups", op: "add" }], requires: null };
      await write([{ id: 1, models_id: 1, name: "team", root: "teams", own: 0, holds: { teams: { parent: null, fields: [] }, groups: { parent: "teams", fields: [] }, requests: { parent: "groups", fields: [{ name: "starts" }] } }, held_by: ["ann"], stories: [1, 2] }], [grouping]);
      await check();
      expect(readdirSync(`${dir}/app/migrations`).sort()).toEqual(["001-teams-requests.ts", "002-groups.ts"]);
      expect(await Bun.file(`${dir}/app/migrations/002-groups.ts`).text()).toContain("// By hand: requests: its parent is");
      await check();
      expect(readdirSync(`${dir}/app/migrations`)).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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

describe("what the cafe showed: checks that only a schema would have caught", () => {
  // John orders under a table nobody adds; the menu is never written; money is said as numeric
  const cafe: Raw = {
    models: { name: "Cafe" },
    stories: {
      "1": { id: 1, text: "John orders at his table", actor: "john", kind: "does", writes: [{ entity: "orders", op: "add", path: "status", to: "ordered" }] },
      "2": { id: 2, text: "Paul says it is ready", actor: "paul", kind: "does", writes: [{ entity: "orders", op: "replace", path: "state", to: "ready" }] },
    },
    documents: {
      "1": { id: 1, name: "table", root: "tables", holds: { tables: { parent: null, fields: [field("number", "integer")] }, orders: { parent: "tables", fields: [field("status")] } }, held_by: ["john"], stories: [1] },
      "2": { id: 2, name: "kitchen", root: "cafes", holds: { cafes: { parent: null, fields: [] }, tables: { parent: "cafes", fields: [] }, orders: { parent: "tables", fields: [field("status")] } }, held_by: ["paul"], stories: [1, 2] },
      "3": { id: 3, name: "menu", root: "menus", holds: { menus: { parent: null, fields: [] }, items: { parent: "menus", fields: [field("price", "numeric")] } }, held_by: ["john"], stories: [1] },
      "4": { id: 4, name: "elsewhere", root: "rooms", holds: { rooms: { parent: null, fields: [] }, tables: { parent: "rooms", fields: [] } }, held_by: ["john"], stories: [1] },
    },
  };
  const r = closureOf(cafe);

  test("reachability: an entity held and never written is always empty; an implied root with no fields is not", () => {
    expect(of(r, "reachability").gaps.filter((g) => g.kind === "unwritten-entity").map((g) => g.where)).toEqual(["tables", "items"]);
  });

  test("subscription closure: a write to a field no document holds", () => {
    expect(of(r, "subscription-closure").gaps).toEqual([{ kind: "unwatched-field", where: "story 2 (paul)", detail: "replace orders.state=ready sets orders.state, which no document holds" }]);
  });

  test("precondition closure: a row added under a parent no story adds (an implied root needs none)", () => {
    expect(of(r, "precondition-closure").gaps).toContainEqual({ kind: "unestablished-parent", where: "story 1 (john)", detail: "add orders.status=ordered adds under a tables row, but no story adds one" });
  });

  test("referential closure: one table under two parents, and a type the model does not know -- never guessed as text", () => {
    const gaps = of(r, "referential-closure").gaps;
    expect(gaps).toContainEqual({ kind: "parent-clash", where: "tables", detail: "one table hangs from one parent, but kitchen puts tables under cafes and elsewhere puts tables under rooms" });
    expect(gaps).toContainEqual({ kind: "unknown-type", where: "menu: items.price", detail: '"numeric" is not a type the model knows (text, integer, real, boolean, json, timestamptz, date)' });
  });
});

describe("Easy's coverage and derive-ux's playability, over the model as told", () => {
  const raw: Raw = {
    models: { name: "Cafe" },
    stories: {
      "1": { id: 1, text: "John orders", actor: "john", kind: "does", writes: [{ entity: "orders", op: "add", path: "status", to: "ordered" }] },
      "2": { id: 2, text: "Paul says ready", actor: "paul", kind: "does", writes: [{ entity: "orders", op: "replace", path: "status", to: "ready" }], requires: [{ entity: "orders", path: "status", value: "ordered" }] },
      "3": { id: 3, text: "Ann takes it", actor: "ann", kind: "does", writes: [{ entity: "orders", op: "replace", path: "status", to: "taken" }], requires: [{ entity: "orders", path: "status", value: "ready" }] },
      "4": { id: 4, text: "Paul cannot order", actor: "paul", kind: "cannot", writes: [{ entity: "orders", op: "add", path: "status", to: "ordered" }] },
    },
    documents: {
      "1": { id: 1, name: "table", root: "orders", holds: { orders: { parent: null, fields: [field("status"), field("item")] } }, held_by: ["john"], stories: [1] },
      "2": { id: 2, name: "kitchen", root: "orders", holds: { orders: { parent: null, fields: [field("status")] } }, held_by: ["paul", "jo"], stories: [1, 2, 4] },
      "3": { id: 3, name: "door", root: "orders", holds: { orders: { parent: null, fields: [] } }, held_by: ["ann"], stories: [3] },
    },
  };
  const r = closureOf(raw);

  test("coverage: a write not decided for someone who holds what it changes; a cannot story decides it", () => {
    expect(of(r, "coverage").gaps).toEqual([
      { kind: "undecided-write", where: "add orders.status", detail: "jo holds it, and no story says whether jo may add orders.status" },
      { kind: "undecided-write", where: "replace orders.status", detail: "john holds it, and no story says whether john may replace orders.status" },
      { kind: "undecided-write", where: "replace orders.status", detail: "jo holds it, and no story says whether jo may replace orders.status" },
    ]);
  });

  test("playability: a turn its taker cannot see, a wait its maker cannot see; one way on and an end are advice", () => {
    expect(of(r, "playability").gaps).toEqual([
      { kind: "blind-turn", where: "story 3 (ann)", detail: "it is ann's move once orders.status=ready, but no document ann holds shows orders.status" },
    ]);
    expect(of(r, "playability").advice).toContainEqual({ kind: "single-exit", where: "orders.status=ordered", detail: 'orders.status=ordered has one way on (paul: "Paul says ready"), and no way to say no' });
    expect(of(r, "playability").advice).toContainEqual({ kind: "terminal-state", where: "orders.status=taken", detail: "orders.status=taken is made, and no story moves on from it: an end, or a story not yet told" });
    expect(of(r, "playability").advice).toContainEqual({ kind: "uneditable-field", where: "orders.item", detail: "no story changes orders.item once its row is made" });
    const blind = closureOf({ ...raw, documents: { ...raw.documents, "2": { ...raw.documents!["2"]!, held_by: ["jo"] } } });
    expect(of(blind, "playability").gaps).toContainEqual({ kind: "blind-wait", where: "story 2 (paul)", detail: "paul sets orders.status=ready and waits on someone else, but holds no document that shows orders.status" });
  });
});

describe("a name the app cannot take is caught before anything is made (cafe-c's feedback)", () => {
  test("a document's name is one word: a space or a hyphen is a referential gap, with the rename to say", () => {
    const named = (name: string) => closureOf({ models: { name: "Cafe" }, stories: { "1": { id: 1, text: "Ann sits", actor: "ann", kind: "does" } }, documents: { "2": { id: 2, name, root: "visits", holds: { visits: { parent: null, fields: [field("table")] } }, held_by: ["ann"], stories: [1] } } });
    expect(of(named("my table"), "referential-closure").gaps).toContainEqual({ kind: "invalid-name", where: "my table", detail: '"my table" is not a name a document can take: one word, letters, digits and _ (rename 2 my_table)' });
    expect(of(named("my-table"), "referential-closure").gaps.map((g) => g.kind)).toContain("invalid-name");
    expect(of(named("my_table"), "referential-closure").gaps).toEqual([]);
  });

  test("a cannot that the same teller's does already lets through is never refused: a coverage gap", () => {
    const cafe = (requires?: { entity: string; path: string; value: string }[]) => closureOf({
      models: { name: "Cafe" },
      stories: {
        "1": { id: 1, text: "The manager opens an invoice", actor: "manager", kind: "does", writes: [{ entity: "invoices", op: "add" }], ...(requires && { requires }) },
        "21": { id: 21, text: "The manager cannot open an invoice on a table with an unpaid one", actor: "manager", kind: "cannot", writes: [{ entity: "invoices", op: "add" }], requires: [{ entity: "invoices", path: "paid", value: "false" }] },
      },
      documents: { "1": { id: 1, name: "floor", root: "tables", holds: { tables: { parent: null, fields: [field("name")] }, invoices: { parent: "tables", fields: [field("paid", "boolean")] } }, held_by: ["manager"], stories: [1, 21] } },
    });
    expect(of(cafe(), "coverage").gaps).toContainEqual({ kind: "shadowed-cannot", where: "story 21 (manager)", detail: "story 1 already lets manager add invoices, presupposing nothing, so this is never refused: say what tells them apart (requires 1 ...)" });
    expect(of(cafe([{ entity: "tables", path: "name", value: "free" }]), "coverage").gaps.map((g) => g.kind)).not.toContain("shadowed-cannot");
  });

  test("making the model's files fails out loud: nothing made, and why", async () => {
    const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
    const { make } = await import("../../src/cli/model");
    const dir = mkdtempSync(`${import.meta.dir}/.make-`);
    try {
      const story = { id: 1, models_id: 1, text: "Ann sits", actor: "ann", kind: "does", post: null, touches: [], writes: [{ entity: "visits", op: "add" }], requires: null };
      const doc = { id: 1, models_id: 1, name: "seat", root: "visits", own: 0, holds: { visits: { parent: null, fields: [{ name: "table" }] } }, held_by: ["ann"], stories: [1] };
      writeFileSync(`${dir}/model.json`, JSON.stringify({ tables: { models: [{ id: 1, name: "Cafe" }], stories: [story], documents: [doc] } }));
      writeFileSync(`${dir}/out`, "a file where the folder goes");
      const made = await make(`${dir}/model.json`, `${dir}/out`);
      expect(made.ok).toBe(false);
      expect(made.said).toStartWith(`Nothing made: making ${dir}/out/ failed:`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("a model with little said is not shown as fine (the second cafe's feedback)", () => {
  test("a story that says nothing it writes or reads, and a teller with nothing in front of them", () => {
    const r = closureOf({
      models: { name: "Cafe" },
      stories: {
        "1": { id: 1, text: "The cook says when it is ready", actor: "cook", kind: "does" },
        "2": { id: 2, text: "The customer orders", actor: "customer", kind: "does", touches: ["items"] },
      },
      documents: { "1": { id: 1, name: "bill", root: "items", holds: { items: { parent: null, fields: [field("name")] } }, held_by: ["customer"], stories: [2] } },
    });
    expect(of(r, "subscription-closure").gaps).toContainEqual({ kind: "silent-story", where: "story 1 (cook)", detail: "it says nothing it writes or reads: say its writes (writes <story> add <entity>...) or what it touches" });
    expect(of(r, "actor-closure").gaps).toContainEqual({ kind: "nothing-in-front", where: "cook", detail: "cook tells a story and holds no document: what do they need in front of them? (heldby <document's number> cook)" });
  });
});

test("advice: a document a role holds, whose root is one of many, does not say which is each person's", () => {
  const r = closureOf({
    models: { name: "Cafe" },
    stories: {
      "1": { id: 1, text: "George opens a table", actor: "george", kind: "does", writes: [{ entity: "tables", op: "add" }] },
      "2": { id: 2, text: "John orders", actor: "john", kind: "does", writes: [{ entity: "orders", op: "add" }] },
    },
    documents: {
      "1": { id: 1, name: "table", root: "tables", holds: { tables: { parent: null, fields: [field("number", "integer")] }, orders: { parent: "tables", fields: [field("item")] } }, held_by: ["john", "george"], stories: [1, 2] },
    },
  });
  expect(of(r, "actor-closure").advice).toEqual([
    { kind: "whose-copy", where: "table (john)", detail: "there are many tables: which one is john's, and how do they come to hold it? (a story that gives it them, or a document of their own that says)" },
  ]);
});

test("advice: whose copy goes quiet once their own document names it, or a row it hangs under", () => {
  const cafe = (field_: string) => closureOf({
    models: { name: "Cafe" },
    stories: {
      "1": { id: 1, text: "George opens an invoice", actor: "george", kind: "does", writes: [{ entity: "invoices", op: "add" }] },
      "2": { id: 2, text: "John scans his table", actor: "john", kind: "does", writes: [{ entity: "visits", op: "replace", path: field_ }] },
    },
    documents: {
      "1": { id: 1, name: "invoice", root: "invoices", holds: { invoices: { parent: null, fields: [field("paid", "boolean")] } }, held_by: ["john", "george"], stories: [1] },
      "3": { id: 3, name: "floor", root: "cafes", holds: { cafes: { parent: null, fields: [] }, tables: { parent: "cafes", fields: [field("name")] }, invoices: { parent: "tables", fields: [field("paid", "boolean")] } }, held_by: ["george"], stories: [1] },
      "2": { id: 2, name: "seat", root: "visits", own: 1, holds: { visits: { parent: null, fields: [field(field_)] } }, stories: [2] },
    },
  });
  expect(of(cafe("table"), "actor-closure").advice).toEqual([]); // the floor hangs invoices under tables, and the seat names one
  expect(of(cafe("invoice_id"), "actor-closure").advice).toEqual([]);
  expect(of(cafe("colour"), "actor-closure").advice!.map((a) => a.where)).toEqual(["invoice (john)"]);
});
