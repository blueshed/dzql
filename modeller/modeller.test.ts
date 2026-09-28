import { describe, expect, test } from "bun:test";
import { story, type Stories } from "../src/stories";
import { entityOf, fromStories, locate, noticing, pageOf, pascal, readOp, singular } from "./from-stories";
import { compare, format, judge } from "./report";
import { documentsIn, extract, heardAs, rulesIn } from "./extract";
import { stories as chat } from "../examples/chat/stories";
import { stories as londons } from "../examples/londons/stories";

describe("names", () => {
  test("singular and pascal", () => {
    expect(singular("areas")).toBe("area");
    expect(singular("opportunities")).toBe("opportunity");
    expect(singular("series")).toBe("series");
    expect(singular("address")).toBe("address");
    expect(singular("custody")).toBe("custody");
    expect(pascal("work_windows")).toBe("WorkWindows");
    expect(pascal("venue-deployments")).toBe("VenueDeployments");
    expect(entityOf(["venue", "areas", "sites"])).toBe("VenueAreaSite");
  });
});

describe("locate", () => {
  test("rows, child collections, fields and the root", () => {
    expect(locate("profile", "/-")).toEqual({ chain: ["profile"], row: true });
    expect(locate("venue", "/1/areas/-")).toEqual({ chain: ["venue", "areas"], row: true });
    expect(locate("venue", "/1/areas/2/name")).toEqual({ chain: ["venue", "areas"], field: "name", row: true });
    expect(locate("household", "/message")).toEqual({ chain: ["household"], field: "message", row: false });
    expect(locate("household", "/guests/2/minifigure/top")).toEqual({ chain: ["household", "guests"], field: "minifigure", row: true });
    expect(locate("board", "")).toEqual({ chain: ["board"], row: false });
  });
});

describe("readOp", () => {
  test("a row added, replaced whole, or removed carries its keys as fields", () => {
    expect(readOp("venue", { op: "add", path: "/-", value: { name: "Fenmoor", tv: 90, open: true, from: "2027-03-15" } })).toEqual({
      write: { entity: "Venue", op: "add" },
      fields: [["name", "Fenmoor"], ["tv", 90], ["open", true], ["from", "2027-03-15"]],
    });
    expect(readOp("venue", { op: "add", path: "/-", value: [1, 2] }).fields).toEqual([]);
    expect(readOp("venue", { op: "remove", path: "/1" })).toEqual({ write: { entity: "Venue", op: "remove" }, fields: [] });
  });
  test("a field write carries its value as the state it produces, when the value is a scalar", () => {
    expect(readOp("venue", { op: "replace", path: "/1/status", value: "accepted" }).write).toEqual({ entity: "Venue", op: "replace", path: "status", to: "accepted" });
    expect(readOp("venue", { op: "replace", path: "/1/place", value: { x: 1 } }).write).toEqual({ entity: "Venue", op: "replace", path: "place" });
    expect(readOp("venue", { op: "remove", path: "/1/note" }).write).toEqual({ entity: "Venue", op: "remove", path: "note" });
  });
});

describe("pages and who notices", () => {
  test("pageOf normalises ids and drops the tray", () => {
    expect(pageOf(undefined)).toBe("(where the cast left them)");
    expect(pageOf("")).toBe("home");
    expect(pageOf("venue/1/deployments @ drawer=site/2")).toBe("venue/:id/deployments");
    expect(pageOf("market")).toBe("market");
  });
  test("noticing reads a list, a record, a refusal, and a tab closing", () => {
    const w = { doc: "d", ops: [] };
    expect(noticing(story("a", { as: "x", does: w, seen: ["x", "y"] }))).toEqual([["x", undefined], ["y", undefined]]);
    expect(noticing(story("b", { as: "x", does: w, seen: { x: "", y: "p/1" } }))).toEqual([["x", ""], ["y", "p/1"]]);
    expect(noticing(story("c", { as: "x", cannot: w }))).toEqual([]);
    expect(noticing(story("d", { as: "x", closesTab: true, seen: ["y"] }))).toEqual([["y", undefined]]);
  });
});

// A small market in the wire's words: every branch of the reading, once.
const w = (doc: string, op: "add" | "replace" | "remove", path: string, value?: unknown) => ({
  doc,
  ops: [op === "remove" ? { op, path } : { op, path, value }],
});
const market: Stories = {
  cast: { seller: [], buyer: [], other: [] },
  goTo: (address) => ({ doc: "session", ops: [{ op: "replace", path: "/page", value: address }] }),
  stories: [
    story("the seller lists a stall", { as: "seller", does: w("stall", "add", "/-", { name: "Fish", note: undefined, id: 9 }), seen: { seller: "" } }),
    story("the seller names the stall again", { as: "seller", does: w("stall", "replace", "/1/note", "fresh"), seen: { seller: "stall/1", buyer: "market" } }),
    story("the seller adds a lot", { as: "seller", does: w("stall", "add", "/1/lots/-", { stall_id: 1, fish_id: 3, bin_id: 2, price: 4 }), seen: ["seller", "ghost"], untold: ["nobody"] }),
    story("the buyer shelves a lot", { as: "buyer", does: w("bin", "add", "/-", { name: "top" }), seen: { buyer: "" } }),
    story("the seller shelves a lot too", { as: "seller", does: w("pantry", "add", "/1/bins/-", { name: "cold" }), seen: { seller: "" } }),
    story("the buyer offers", { as: "buyer", does: w("stall", "replace", "/1/lots/1/status", "offered"), seen: { seller: "stall/1" } }),
    story("the seller accepts", { as: "seller", does: w("stall", "replace", "/1/lots/1/status", "accepted"), seen: { seller: "stall/1", buyer: "market" } }),
    story("the seller reprices", { as: "seller", does: w("stall", "replace", "/1/lots/1/price", 5), seen: { seller: "stall/1" } }),
    story("the seller redates", { as: "seller", does: w("stall", "replace", "/1/lots/1/price", "2027-01-01"), seen: { seller: "stall/1" } }),
    story("a stranger walks in", { as: "stranger", does: w("session", "replace", "/page", "market"), seen: { stranger: "market" } }),
    story("the buyer cannot rename a stall", { as: "buyer", cannot: w("stall", "replace", "/1/name", "Mine") }),
    story("the buyer changes a sign nobody adds", { as: "buyer", does: w("sign", "replace", "/1/text", "Open"), seen: { other: "" } }),
    story("the other closes their tab", { as: "other", closesTab: true, seen: ["seller"] }),
  ],
};

describe("fromStories", () => {
  const r = fromStories(market);
  const kinds = (k: string) => r.notes.filter((n) => n.kind === k);

  test("the cast, and every author the cast forgot, are actors", () => {
    expect(r.model.actors.map((a) => a.name)).toEqual(["seller", "buyer", "other", "stranger"]);
    expect(kinds("uncast-author").map((n) => n.where)).toEqual(["a stranger walks in"]);
  });
  test("the session is found by the example's own `goTo`, and its stories write nothing to the model", () => {
    expect(r.session).toBe("session");
    expect(kinds("session-story").map((n) => n.where)).toEqual(["a stranger walks in"]);
    expect(r.model.stories.find((s) => s.action === "a stranger walks in")!.writes).toEqual([]);
  });
  test("names nobody cast are noted, in seen and in unseen", () => {
    expect(kinds("uncast-member").map((n) => n.detail)).toEqual(['"ghost" notices but is not in the cast', '"nobody" must not notice but is not in the cast']);
  });
  test("one page document per actor per page, holding what was noticed there; the author's own page is what it opens", () => {
    expect(r.pages.get("buyer__market")).toEqual({ actor: "buyer", page: "market" });
    const [name] = [...r.pages].find(([, p]) => p.actor === "seller" && p.page === "stall/:id")!;
    const stall = r.model.documents.find((d) => d.name === name)!;
    expect(stall.node.from).toBe("Stall");
    expect(stall.node.fields.some((f) => f.kind === "array" && f.node.from === "StallLot")).toBe(true);
    expect(r.model.stories.find((s) => s.action === "the buyer offers")!.opens).toEqual([]);
    expect(r.model.stories.find((s) => s.action === "the seller accepts")!.opens).toEqual([stall.name]);
    expect([...r.pages.values()]).toContainEqual({ actor: "seller", page: "(where the cast left them)" });
  });
  test("a reference resolves by the collection's own name, or is noted as ambiguous or unresolved", () => {
    const lot = r.model.entities.find((e) => e.name === "StallLot")!;
    expect(lot.fields.find((f) => f.name === "stall_id")!.fk).toBe("Stall.id");
    expect(kinds("unresolved-reference").map((n) => n.where)).toEqual(["StallLot.fish_id"]);
    expect(kinds("ambiguous-reference")[0]).toEqual({ kind: "ambiguous-reference", where: "StallLot.bin_id", detail: "could be Bin or PantryBin" });
  });
  test("an entity has an id, every field a write showed, and a type from the first value seen", () => {
    const stall = r.model.entities.find((e) => e.name === "Stall")!;
    expect(stall.fields).toEqual([
      { name: "id", type: "id" },
      { name: "name", type: "string" },
      { name: "note", type: "string" },
    ]);
    const lot = r.model.entities.find((e) => e.name === "StallLot")!;
    expect(lot.fields.find((f) => f.name === "price")!.type).toBe("number");
    expect(r.collections.get("PantryBin")).toBe("pantry/bins");
  });
  test("an example without `goTo` has no session to leave out", () => {
    expect(fromStories({ cast: { a: [] }, stories: [] }).session).toBeUndefined();
  });
});

describe("judge and format", () => {
  const { reading, report } = judge(market);

  test("counts", () => {
    expect(report.counts).toEqual({ stories: 13, does: 11, cannot: 1, closesTab: 1, actors: 4, pages: 7, entities: 5, fields: 15 });
  });
  test("hjeli's predicates run unchanged: a row changed that no story adds is a gap", () => {
    expect(report.gaps.map((g) => `${g.predicate}:${g.kind}:${g.refs?.entity ?? g.refs?.actor}`)).toContain("precondition-closure:unestablished-row:Sign");
  });
  test("what only stories can ask", () => {
    expect(report.story.authorBlind.map((f) => f.where)).toEqual(["the buyer offers", "the buyer changes a sign nobody adds"]);
    expect(report.story.manyWriters).toEqual([{ check: "many-writers", where: "StallLot.status", detail: "written by buyer, seller" }]);
    expect(report.story.states).toEqual([{ field: "StallLot.status", values: ["accepted", "offered"], moves: 2 }]);
    expect([...report.story.refusals]).toEqual([["Stall", 1]]);
  });
  test("compare, by whole name and by the collection's own name", () => {
    const other = {
      actors: [{ name: "seller", auth_claim: "sub" }],
      entities: [{ name: "Stall", fields: [] }, { name: "Lot", fields: [] }, { name: "Fishmonger", fields: [] }],
      documents: [],
      stories: [],
    };
    const c = compare(reading, other, []);
    expect(c.shared).toEqual(["Stall", "StallLot = Lot"]);
    expect(c.onlyTheirs).toEqual(["Fishmonger"]);
    expect(c.onlyOurs).toContain("PantryBin");
    const text = format("market", report, c);
    expect(text).toContain("# market: closure over stories");
    expect(text).toContain("13 stories (11 does, 1 cannot, 1 closes a tab)");
    expect(text).toContain("unestablished-row · buyer: the buyer changes a sign nobody adds");
    expect(text).toContain("- shared by name (2): Stall, StallLot = Lot");
    expect(format("market", report)).not.toContain("Against the other model");
  });
  test("a gap-free predicate reads in the singular and the plural", () => {
    const one = format("x", { ...report, gaps: report.gaps.slice(0, 1) });
    expect(one).toMatch(/: 1 gap —/);
  });
});

describe("the examples", () => {
  test("chat reads without notes", () => {
    const { report } = judge(chat);
    expect(report.counts.stories).toBe(11);
    expect(report.notes).toEqual([]);
  });

  // Step 1's finding, pinned: every one of Londons' row gaps is a row added under another name,
  // through another document -- the stories do not say which table a document's path lands in.
  test("londons: every row gap is a twin added through another document", () => {
    const { reading, report } = judge(londons);
    expect(report.counts).toMatchObject({ stories: 157, does: 133, cannot: 24 });
    const rowGaps = report.gaps.filter((g) => g.kind === "unestablished-row");
    expect(rowGaps.length).toBe(26);
    expect([...new Set(rowGaps.map((g) => g.refs!.entity))].sort()).toEqual(["Custody", "MarketCampaign", "MarketPackage", "ProjectSupplyOffer", "Scenario", "VenueDeployment", "WorkerAssignment"]);
    expect(report.gaps.filter((g) => g.kind !== "unestablished-row")).toEqual([]);
    const added = reading.model.stories.flatMap((s) => s.writes.filter((w) => w.op === "add" && !w.path).map((w) => w.entity));
    for (const twin of ["Stock", "Campaign", "OccasionPackage", "Opportunity", "EngagementScenario", "ProjectDeployment", "ProjectWindowAssignment"]) expect(added).toContain(twin);
    // The session is what `goTo` writes, and it is left out: the page's state, not the model's.
    expect(reading.session).toBe("session");
    expect(londons.goTo!("venue/1 @ drawer=site/2, reading.map=deployments").ops).toEqual([
      { op: "replace", path: "/page", value: "venue/1" },
      { op: "replace", path: "/drawer", value: "site/2" },
      { op: "replace", path: "/reading/map", value: "deployments" },
    ]);
  });

  test("every example's stories read, and hjeli's predicates judge them", async () => {
    for await (const file of new Bun.Glob("*/stories.ts").scan(`${import.meta.dir}/../examples`)) {
      const { stories } = (await import(`../examples/${file}`)) as { stories: Stories };
      expect(judge(stories).report.counts.stories).toBe(stories.stories.length);
    }
  });
});

describe("extract: an example's facts, from its files and a run of its stories", () => {
  test("a compartment's rules, with the lists they name; none where its permit is code", () => {
    const rules = rulesIn(['const LIST = "(gifts|places)";', "const RULES: Rule[] = [", '  { path: /^\\/message$/, ops: ["replace"], dated: true },', "  { path: new RegExp(`^/${LIST}/-$`), ops: [\"add\"] },", "];"].join("\n"));
    expect(rules.map((r) => [r.path.test("/message"), r.path.test("/gifts/-"), r.ops, !!r.dated])).toEqual([[true, false, ["replace"], true], [false, true, ["add"], false]]);
    expect(rulesIn("permit: (ws, op) => op.path === \"/room\"")).toEqual([]);
  });

  test("delta.ts's documents: what each includes, which are on the ledger, which the session is, and which are kept in memory", () => {
    const src = `const LISTS = ["gifts", "places"];
registerDocs(delta.server, db, schema, [
  defineDoc("board:", { root: "weddings", include: ["households", ...LISTS] }),
  defineDoc("wedding:", { root: "weddings", include: LISTS }),
], [], { ledger: true });
// a visit, with no ledger
registerDocs(delta.server, db, schema, [defineDoc("session:", { root: "visits", include: [], implied: true })]);
registerMemory(delta.server, { prefix: "everyone:", empty: () => ({}) });`;
    expect(documentsIn(src, "session")).toEqual([
      { name: "board", root: "weddings", include: ["households", "gifts", "places"], kind: "written", note: "" },
      { name: "wedding", root: "weddings", include: ["gifts", "places"], kind: "written", note: "" },
      { name: "session", root: "visits", include: [], kind: "written, no ledger", note: "the session: who you are and where" },
      { name: "everyone", root: null, include: [], kind: "live", note: "kept by the server, in memory" },
    ]);
  });

  test("what a member was sent: a page, its parts, a patch, or anything else, with its size", () => {
    expect(heardAs({ type: "render", html: "<p>" })).toEqual({ kind: "page", bytes: 30 });
    expect(heardAs({ type: "render", ops: [{ op: "replace", target: '[data-eta-part="people"]', html: "" }] }).parts).toEqual(["replace people"]);
    expect(heardAs({ type: "patch", doc: "room:general", ops: [] })).toMatchObject({ kind: "patch", doc: "room:general", ops: 0 });
    expect(heardAs({ type: "refused", reason: "no" }).kind).toBe("refused");
  });

  test("chat: every story placed on its tables and run, a tab closing among them; its permits are code", async () => {
    const facts = await extract("chat");
    expect(facts.harness.passed + facts.harness.failed).toBe(chat.stories.length);
    expect(facts.documents.map((d) => `${d.name}: ${d.kind}`)).toEqual(["session: written", "room: written", "here: live", "lobby: live"]);
    expect(facts.permits).toEqual([]);
    const say = facts.stories.find((s) => s.name.startsWith("Ada says hello"))!;
    expect(say.ops).toEqual([{ op: "add", path: "/messages/-", table: "messages", field: null, permitted: null }]);
    expect(say.sequence.map((t) => t.phase)).toEqual(["does", "undo", "redo"]);
    const closes = facts.stories.find((s) => s.kind === "closesTab")!;
    expect(closes).toMatchObject({ doc: null, ops: [], session: false });
    expect(closes.sequence[0]!.heard.find((h) => h.member === "ada")!.messages.length).toBeGreaterThan(0);
    expect(facts.tables.find((t) => t.name === "messages")!.parent).toBe("rooms");
    expect(facts.tasks.length).toBeGreaterThan(0);
  }, 30000);

  test("the wedding: its rules, dated or not, its session, and the seed that makes a table's rows", async () => {
    const facts = await extract("wedding");
    expect(facts.session).toBe("session");
    expect(facts.documents.find((d) => d.name === "session")).toMatchObject({ kind: "written, no ledger", note: "the session: who you are and where" });
    expect(facts.permits.some((p) => p.doc === "household" && p.dated)).toBe(true);
    expect(facts.tables.find((t) => t.name === "couples")!.code.some((c) => c.seed)).toBe(true);
    const note = facts.stories.find((s) => s.name.startsWith("The Okafors leave the caterer a note"))!;
    expect(note.ops[0]).toMatchObject({ table: "households", field: "message", permitted: true });
    expect(facts.stories.find((s) => s.premise && s.kind === "cannot")).toBeDefined();
  }, 30000);
});
