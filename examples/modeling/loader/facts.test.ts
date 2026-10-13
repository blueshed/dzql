import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { StoryRow, Told } from "./documents";
import { bornInto, inSql, keeper, readBy, shape, squared, toldNotAsked, touches, unreached } from "./facts";
import { extract } from "./extract";
import { documentsIn } from "./documents";

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
  test("a table is named where SQL names it: after FROM, JOIN, INTO, UPDATE or TABLE, or in a string a query is handed; never a property or a comment", () => {
    expect(inSql("const ks = Object.keys(x);", "keys")).toBe(false);
    expect(inSql("for (const k of keys) {}", "keys")).toBe(false);
    expect(inSql('db.query("SELECT * FROM keys");', "keys")).toBe(true);
    expect(inSql("  SELECT g.*, h.answer FROM guests g JOIN keys h ON h.id = g.keys_id", "keys")).toBe(true);
    expect(inSql('INSERT INTO "keys" (id) VALUES (1);', "keys")).toBe(true);
    expect(inSql("db.run(`update keys set hash = ?`, [h]);", "keys")).toBe(true);
    expect(inSql("CREATE TABLE IF NOT EXISTS keys (id TEXT)", "keys")).toBe(true);
    expect(inSql('db.prepare<{ n: number }, []>("SELECT keys.id, n FROM sums")', "keys")).toBe(true); // in the query's string
    expect(inSql('db.query("SELECT Object.keys(x)")', "keys")).toBe(false);
    expect(inSql("// read FROM keys", "keys")).toBe(false);
    expect(inSql("-- INSERT INTO keys", "keys")).toBe(false);
  });

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

});

describe("the heart, from a run", () => {
  test("the wedding: couples looked up by whose(), never held; everyone grows as households², reaches what everyone.ts reads; who was told unasked, with the patch", async () => {
    const { heart: h } = await extract("wedding");
    expect(h.ran).toBe(true);
    expect(h.documents.every((d) => d.told !== null)).toBe(true);
    expect(h.entities.filter((e) => e.red).map((e) => e.name)).toEqual([]);
    expect(h.entities.filter((e) => e.looked).map((e) => e.name)).toEqual(["couples"]); // whose() looks it up: a credential, never held
    expect(h.entities.find((e) => e.name === "couples")!.code.filter((c) => !c.seed).map((c) => `${c.by} ${c.at}`)).toEqual(["whose documents/session.ts:52"]);
    expect(h.documents.filter((d) => d.squared).map((d) => d.name)).toEqual(["everyone"]);
    const everyone = h.documents.find((d) => d.name === "everyone")!;
    expect(everyone).toMatchObject({ reach: ["weddings", "households", "guests", "claims"], computed: { by: "everyone.ts" }, for: "okafors, ben", squared: { story: 6, author: "okafors", asked: false } }); // it also tells ben what no story asked: a warning
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

describe("the heart, from the stories alone", () => {
  test("delta.ts's documents defined before any registerDocs, and one delta works out from the tables it watches", () => {
    const src = `export const team = defineDoc("team:", { root: "teams", include: ["people"] });
export const mine = defineCustomDoc<number>("mine:", {
  watch: ["asks", "answers"],
  recompute: (db, me) => ({}),
});
registerDocs(server, db, schema, [team], [mine], { ledger: true });`;
    expect(documentsIn(src, null)).toEqual([
      { name: "team", root: "teams", include: ["people"], kind: "defined", note: "" },
      { name: "mine", root: null, include: [], kind: "custom", note: "worked out by the server from the tables it watches", watch: ["asks", "answers"] },
    ]);
  });

  test("a document kept in memory, whatever the server is called", () => {
    const src = `registerMemory(server, { prefix: "here:", empty: () => ({}) });
registerMemory(local.server,
  { prefix: "lobby:", empty: () => ({}) });`;
    expect(documentsIn(src, null).map((d) => [d.name, d.kind])).toEqual([["here", "live"], ["lobby", "live"]]);
  });

  test("a project with no app: born into its own document, touching its own write's tables (not its premise's), and nothing said of who was told", async () => {
    // a project of its own, outside eta, with stories and a delta.ts and no index.ts
    const dir = await mkdtemp(`${tmpdir()}/alone-`);
    const sqlite = Bun.resolveSync("@blueshed/delta/sqlite", import.meta.dir);
    await Bun.write(
      `${dir}/delta.ts`,
      `import { defineCustomDoc, defineDoc, defineSchema } from ${JSON.stringify(sqlite)};
export const schema = defineSchema({
  teams: { columns: {} },
  people: { parent: "teams", columns: { name: "text" } },
  notes: { parent: "teams", columns: { text: "text" } },
  asks: { parent: "teams", columns: { words: "text" } },
});
export const team = defineDoc("team:", { root: "teams", include: ["people"] });
export const mine = defineCustomDoc<number>("mine:", { watch: ["asks"], parse: Number, recompute: Object });
`,
    );
    const premise = { ann: [{ doc: "team:1", ops: [{ op: "add", path: "/people/-", value: { name: "Cy" } }] }] };
    await Bun.write(
      `${dir}/stories.ts`,
      `export const stories = ${JSON.stringify({
        cast: { ann: [], bo: [] },
        stories: [
          { name: "Ann asks Bo in, and they both see him", as: "ann", does: { doc: "team:1", ops: [{ op: "add", path: "/people/-", value: { name: "Bo" } }] }, seen: ["ann", "bo"] },
          { name: "Bo renames Cy", as: "bo", premise, does: { doc: "team:1", ops: [{ op: "replace", path: "/people/3/name", value: "Kai" }] }, seen: ["ann", "bo"] },
          { name: "Bo cannot write what is worked out", as: "bo", cannot: { doc: "mine:2", ops: [{ op: "remove", path: "/asks/1" }] } },
        ],
      })};\n`,
    );
    const facts = await extract(dir);
    const h = facts.heart;
    expect(facts.harness).toBeNull();
    expect(h.ran).toBe(false);
    expect(h.example).toBe(dir.split("/").at(-1)!);
    expect(h.stories.map((s) => [s.born, s.touches, s.unasked])).toEqual([
      [["team"], ["people"], []],
      [["team"], ["people"], []], // its premise wrote people too, but that only set the stage
      [["mine"], [], []], // a document with no root places no path on a table
    ]);
    expect(h.documents.map((d) => [d.name, d.reach, d.for, d.told, d.squared])).toEqual([
      ["team", ["teams", "people"], "ann, bo", null, null], // ann and bo both write and see it: no run, so no holders²
      ["mine", ["asks"], "nobody, in the stories", null, null],
    ]);
    expect(h.documents[1]!.shape.map((l) => l.text)).toEqual(["mine:<id>", "computed by delta.ts, watching", "asks"]);
    expect(h.entities.filter((e) => e.red).map((e) => e.name)).toEqual(["notes"]);
    await rm(dir, { recursive: true });
  });
});
