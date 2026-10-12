import { describe, expect, test } from "bun:test";
import type { StoryRow, Told } from "./documents";
import { bornInto, keeper, readBy, shape, squared, toldNotAsked, touches, unreached } from "./heart";
import { BOX, layout } from "./layout";
import { extract } from "./extract";

const told = (member: string, seen: boolean): Told => ({ member, how: "patch 1 op", bytes: 100, seen });
const row = (over: Partial<StoryRow>): StoryRow => ({ n: 1, name: "a story", as: "ada", kind: "does", doc: "board", changes: [], ...over });

describe("a story: born into, touches, told and not asked for", () => {
  test("born into its own document, and each its seen were told through -- not the session; a refusal into its own alone", () => {
    const r = row({ changes: [{ doc: "board:1", told: [told("ada", true)] }, { doc: "wedding:1", told: [told("bo", true)] }, { doc: "welcome:1", told: [told("cy", false)] }, { doc: "session", told: [told("ada", true)] }] });
    expect(bornInto(r, "session")).toEqual(["board", "wedding"]);
    expect(bornInto(r, null)).toEqual(["board", "wedding", "session"]);
    expect(bornInto(row({ kind: "cannot", doc: "household", changes: [{ doc: "household", told: [told("ada", false)] }] }), null)).toEqual(["household"]);
    expect(bornInto(row({ kind: "closesTab", doc: undefined, changes: [{ doc: "here:general", told: [told("ada", true)] }] }), null)).toEqual(["here"]);
  });

  test("told, not asked for: a member told who is neither seen nor expected untold; never a refusal, never the session", () => {
    const r = row({ changes: [{ doc: "wedding:1", told: [told("ada", true), told("bo", false), told("cy", false)] }, { doc: "session", told: [told("dee", false)] }, { doc: "board:1", told: [told("ada", true)] }] });
    expect(toldNotAsked(r, ["cy"], "session")).toEqual([{ doc: "wedding:1", told: [told("bo", false)] }]);
    expect(toldNotAsked({ ...r, kind: "cannot" }, [], null)).toEqual([]);
  });

  test("touches: the tables its write's paths name, and those delta wrote that its document holds", () => {
    const docs = [{ name: "board", root: "weddings", include: ["households", "asks", "guests"] }, { name: "everyone", root: null, include: [] }];
    const ledger = [{ doc: "board:1", ops: [{ path: "/asks/1" }, { path: "/guests/9" }, { path: "/sessions" }] }, { doc: "everyone:1", ops: [{ path: "/figures/1" }] }];
    expect(touches([{ table: "asks" }, { table: null }], ledger, docs)).toEqual(["asks", "guests"]);
    expect(touches([{ table: "visits" }], [], docs)).toEqual(["visits"]); // a refusal, or a write with no ledger: its paths alone
  });
});

describe("a document: its telling, its reach, its shape", () => {
  test("holders²: a holder's own write told to them and to another person; two tabs of one person, or a write they don't hold, are not", () => {
    const person = (m: string) => (m === "benToo" ? "ben" : m);
    const rows = [
      row({ n: 1, as: "couple", changes: [{ doc: "wedding:1", told: [told("okafors", true), told("ben", true)] }] }), // the couple hold no wedding
      row({ n: 2, as: "ben", changes: [{ doc: "household:2", told: [told("ben", true), told("benToo", true)] }] }), // one person, two tabs
      row({ n: 3, as: "okafors", kind: "cannot", changes: [{ doc: "everyone:1", told: [told("okafors", false), told("ben", false)] }] }),
      row({ n: 4, as: "okafors", changes: [{ doc: "everyone:1", told: [told("okafors", true), told("ben", false)] }] }),
      row({ n: 5, as: "ben", changes: [{ doc: "everyone:1", told: [told("okafors", true), told("ben", true)] }] }), // the first story says it
    ];
    const n2 = squared(rows, person);
    expect([...n2.keys()]).toEqual(["everyone"]);
    expect(n2.get("everyone")).toMatchObject({ story: 4, doc: "everyone:1", author: "okafors" });
  });

  test("a document kept in memory reads the tables its one keeper's code names; none when no one file keeps it alone", () => {
    const tables = [{ name: "guests", sql: "w_guests" }, { name: "claims", sql: "w_claims" }, { name: "notes", sql: "w_notes" }];
    const files = [
      { path: "everyone.ts", lines: ["// w_notes are not read", "const q = db.query('SELECT * FROM w_guests JOIN w_claims');", "await serverWrite(`everyone:${id}`, ops);"] },
      { path: "board.ts", lines: ["/** `everyone:<id>`, in a comment */", "await serverWrite(`session:${id}`, ops);"] },
      { path: "presence.ts", lines: ['serverWrite(`here:${room}`, a); serverWrite("lobby:all", b);'] },
      { path: "view.ts", lines: ["read(`here:${room}`)"] },
    ];
    expect(keeper("everyone", ["everyone", "session", "here", "lobby"], files, tables)).toEqual({ file: "everyone.ts", reads: ["guests", "claims"] });
    expect(keeper("here", ["everyone", "session", "here", "lobby"], files, tables)).toBeNull(); // presence.ts keeps the lobby too
    expect(keeper("attic", ["attic"], files, tables)).toBeNull();
  });

  test("its shape: the root, and each include under its parent, indented; one whose parent it doesn't hold hangs from the root", () => {
    const parent: Record<string, string> = { households: "weddings", guests: "households", courses: "weddings", dishes: "courses", gifts: "weddings" };
    expect(shape("board:<wedding>", "weddings", ["households", "guests", "dishes", "gifts"], (t) => parent[t] ?? null).map((l) => `${l.pad} ${l.text}`)).toEqual([
      "0 board:<wedding>",
      "14 weddings",
      "28 households",
      "42 guests",
      "28 dishes",
      "28 gifts",
    ]);
  });
});

describe("an entity: red, who reads it, where it sits", () => {
  test("red: a table no document reaches", () => {
    expect(unreached(["weddings", "couples", "visits"], [["weddings"], ["visits"], []])).toEqual(["couples"]);
  });

  test("who reads it: the function that runs the query a line names, or the line's own function; none at the top level", () => {
    const file = {
      path: "session.ts",
      lines: ["const coupleOf = db.query('SELECT * FROM w_couples');", "", "export function whose(code: string) {", "  return coupleOf.get(code);", "}", "const unused = db.query('SELECT 1 FROM w_couples');", "const take = async (x) => {", "  db.run('DELETE FROM w_couples');", "};"],
    };
    expect(readBy(file, 0)).toBe("whose");
    expect(readBy(file, 7)).toBe("take");
    expect(readBy(file, 5)).toBeNull(); // a query nobody runs
    expect(readBy({ path: "x.ts", lines: ["db.run('SELECT 1 FROM w_couples');"] }, 0)).toBeNull();
  });

  test("the tree: depth left to right, a leaf a row, a parent level with the middle of its children, each root's tree apart", () => {
    const { W, H, COL, ROW } = BOX;
    const tables = [
      { name: "weddings", parent: null },
      { name: "households", parent: "weddings" },
      { name: "guests", parent: "households" },
      { name: "asks", parent: "households" },
      { name: "gifts", parent: "weddings" },
      { name: "visits", parent: null },
    ];
    const { pos, segs, width, height } = layout(tables);
    expect(pos.guests).toEqual({ x: 2 * COL, y: 0 });
    expect(pos.asks).toEqual({ x: 2 * COL, y: ROW });
    expect(pos.households).toEqual({ x: COL, y: ROW / 2 });
    expect(pos.gifts).toEqual({ x: COL, y: 2 * ROW });
    expect(pos.weddings).toEqual({ x: 0, y: (ROW / 2 + 2 * ROW) / 2 });
    expect(pos.visits).toEqual({ x: 0, y: 3.4 * ROW });
    expect(width).toBe(2 * COL + W);
    expect(height).toBe(3.4 * ROW + H);
    // a parent's stub, its spine, and a stub to each child: weddings' two, households' two
    expect(segs.length).toBe(2 * (2 + 2));
    expect(segs).toContainEqual({ left: W, top: pos.weddings!.y + H / 2 - 1, width: (COL - W) / 2, height: 2 });

    // hidden: what is left is laid out alone, and a node whose parent is hidden is a root
    const some = layout(tables, new Set(["guests", "asks", "visits"]));
    expect(some.pos).toEqual({ guests: { x: 0, y: 0 }, asks: { x: 0, y: 1.4 * ROW }, visits: { x: 0, y: 2.8 * ROW } });
    expect(some.segs).toEqual([]);
    expect(layout(tables, new Set())).toEqual({ pos: {}, segs: [], width: 0, height: 0 });
  });
});

describe("the heart, from a run", () => {
  test("the wedding: couples red and read by whose(); everyone grows as households², reaches what everyone.ts reads; who was told unasked, with the patch", async () => {
    const { heart: h } = await extract("wedding");
    expect(h.entities.filter((e) => e.red).map((e) => e.name)).toEqual(["couples"]);
    expect(h.entities.find((e) => e.name === "couples")!.code.filter((c) => !c.seed).map((c) => `${c.by} ${c.at}`)).toEqual(["whose documents/session.ts:52"]);
    expect(h.documents.filter((d) => d.squared).map((d) => d.name)).toEqual(["everyone"]);
    const everyone = h.documents.find((d) => d.name === "everyone")!;
    expect(everyone).toMatchObject({ reach: ["weddings", "households", "guests", "claims"], computed: { by: "everyone.ts" }, for: "okafors, ben", squared: { story: 6, author: "okafors" } });
    const board = h.documents.find((d) => d.name === "board")!;
    expect(board.shape.slice(0, 4).map((l) => `${l.pad} ${l.text}`)).toEqual(["0 board:<wedding>", "14 weddings", "28 households", "42 guests"]);
    expect(h.documents.find((d) => d.name === "session")!.shape[0]!.text).toBe("session"); // a session's own: by its type alone
    const by = (start: string) => h.stories.find((s) => s.name.startsWith(start))!;
    expect(by("The couple set a deadline")).toMatchObject({ born: ["board", "wedding"], touches: ["weddings"] });
    expect(by("The couple set a deadline").unasked).toEqual([{ doc: "welcome", told: [expect.objectContaining({ member: "stranger", patch: [{ op: "replace", path: "/weddings/deadline", value: "2027-03-01" }] })] }]);
    expect(by("The couple change their message").unasked.map((u) => [u.doc, u.told.map((t) => t.member)])).toEqual([["wedding", ["okafors", "ben", "benToo"]]]);
    expect(by("The couple say yes to Kemi").touches).toEqual(["asks", "guests"]); // the reply, and the guest delta made of it
    expect(by("The Okafors leave the caterer a note").unasked).toEqual([]); // ben and benToo are expected untold, and are
    expect(by("Once the deadline has passed")).toMatchObject({ kind: "cannot", born: ["household"], touches: ["households"], unasked: [] });
    expect(by("A household enters its code").born).toEqual(["session"]);
    expect(JSON.stringify(h)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/); // no session's id
  }, 30000);

  test("the ticker: a feed's tick, from no page, is nobody's who holds the market, so it says nothing of holders²", async () => {
    const { heart: h } = await extract("ticker");
    expect(h.documents.filter((d) => d.squared)).toEqual([]);
    expect(h.stories.find((s) => s.name.startsWith("Bravo ticks, and every board"))!.unasked[0]!.doc).toBe("ticker");
    expect(h.entities.filter((e) => e.red)).toEqual([]);
  }, 30000);
});
