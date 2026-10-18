import { afterAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWs } from "@blueshed/delta/server";
import { setLogLevel } from "@blueshed/delta/logger";
import { mockClient, sendAndAwait, waitFor } from "@blueshed/delta/testing";
import * as json from "@blueshed/delta/json";
import * as sqlite from "@blueshed/delta/sqlite";
import { applyFramework, applySql, createDocListener, docTypeFromDef, generateSql } from "../postgres";
import { openPglite } from "../postgres/pglite";
import { definitionsOf, nextMigrationOf, sourceOf, testsOf, typesOf, type Model } from "./definitions";

setLogLevel("silent");

// A model as the model's page keeps it: two stories, and the two documents they need.
const model: Model = {
  stories: {
    "1": { id: 1, text: "Ann asks for two days off, and Mo sees them waiting", actor: "ann", kind: "does" },
    "2": { id: 2, text: "Ann picks a day on her calendar", actor: "ann", kind: "does" },
  },
  documents: {
    "1": {
      id: 1, name: "team", root: "teams", stories: [1], held_by: ["ann", "mo"],
      holds: {
        teams: { parent: null, fields: [{ name: "name" }] },
        people: { parent: "teams", fields: [{ name: "name" }, { name: "teams_id" }] },
        requests: { parent: "teams", fields: [{ name: "person_id", type: "integer" }, { name: "starts", type: "date" }, { name: "days", type: "number" }, { name: "id" }] },
      },
    },
    "2": { id: 2, name: "session", root: "sessions", own: 1, stories: [2], holds: { sessions: { parent: null, fields: [{ name: "page" }, { name: "draft", type: "json" }, { name: "seen", type: "a word of its own" }] } } },
  },
};

describe("the model as delta's definitions", () => {
  const { schema, docs } = definitionsOf(model);

  test("an entity for each one a document holds, hanging from its parent, with the fields documents give it", () => {
    expect(Object.keys(schema.tables)).toEqual(["teams", "people", "requests", "sessions"]);
    expect(schema.tables.requests!.parent).toEqual({ collection: "teams", fkColumn: "teams_id" });
    expect(schema.tables.requests!.columns).toEqual({
      person_id: { type: "integer", nullable: true },
      starts: { type: "text", nullable: true }, // a day, as its text
      days: { type: "real", nullable: true },
    });
    expect(Object.keys(schema.tables.people!.columns)).toEqual(["name"]); // its parent's key is delta's
    expect(schema.tables.sessions!.columns.seen).toEqual({ type: "text", nullable: true }); // a word delta has no type for: text
  });

  test("a document for each, over its root and what it holds; one whose root hangs from nothing is there before its row", () => {
    expect(docs).toEqual([
      { prefix: "team:", root: "teams", include: ["people", "requests"], scope: {}, implied: true },
      { prefix: "session:", root: "sessions", include: [], scope: {}, implied: true },
    ]);
    const withPerson = definitionsOf({ documents: [...Object.values(model.documents!), { id: 3, name: "person", root: "people", holds: { people: { parent: null } } }] });
    expect(withPerson.docs[2]).toEqual({ prefix: "person:", root: "people", include: [], scope: {} }); // a person hangs from a team, so is made there first
  });

  test("a document said with no holds holds its root, and a model with nothing in it is empty", () => {
    expect(definitionsOf({ documents: [{ id: 1, name: "note", root: "notes" }] }).schema.tables.notes!.columns).toEqual({});
    expect(definitionsOf({})).toEqual({ schema: { tables: {} }, docs: [] });
  });
});

describe("the source dzql model export writes", () => {
  const dir = mkdtempSync(join(import.meta.dir, ".model-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("reads as the definitions, says what each document is for, and what is not decided", async () => {
    const source = sourceOf(model);
    expect(source).toContain(`import { defineDoc, defineSchema } from "@blueshed/delta/json";`);
    expect(source).toContain(`  requests: { columns: { person_id: "integer?", starts: "text?", days: "real?" }, temporal: false, parent: "teams" },`);
    expect(source).toContain(`  // for: Ann asks for two days off, and Mo sees them waiting\n  defineDoc("team:", { root: "teams", include: ["people", "requests"], implied: true }),`);
    expect(source).toContain("each person's own");
    await Bun.write(join(dir, "model.ts"), source);
    const written = await import(join(dir, "model.ts"));
    expect(written.schema).toEqual(definitionsOf(model).schema);
    expect(written.docs).toEqual(definitionsOf(model).docs);
    expect(sourceOf(model, "dzql/postgres")).toContain(`from "dzql/postgres";`);
  });
});

// The same definitions on each store: the team opens before its row, its first write makes it,
// a person added under it is held by it, and it reads back the same everywhere.
const { schema, docs } = definitionsOf(model);
type Ws = ReturnType<typeof createWs>;
const stores: [string, () => Promise<{ ws: Ws; end: () => Promise<void> }>][] = [
  ["delta's JSON file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dzql-model-"));
    const ws = createWs();
    json.registerDocs(ws, join(dir, "app.json"), schema, docs);
    // the file is saved after a write is answered
    return { ws, end: async () => { await waitFor(() => existsSync(join(dir, "app.json"))); rmSync(dir, { recursive: true, force: true }); } };
  }],
  ["SQLite", async () => {
    const db = new Database(":memory:");
    sqlite.createTables(db, schema);
    const ws = createWs();
    sqlite.registerDocs(ws, db, schema, docs);
    return { ws, end: async () => db.close() };
  }],
  ["dzql's compiled Postgres (PGlite)", async () => {
    const pool = await openPglite();
    await applyFramework(pool);
    await applySql(pool, generateSql(schema, docs));
    const ws = createWs();
    ws.setServer({ publish() {} });
    const listener = await createDocListener(ws, pool, { types: docs.map((def) => docTypeFromDef(def, pool)) });
    return { ws, end: async () => { await listener.destroy(); await pool.end(); } };
  }],
];

for (const [name, open] of stores) {
  test(`on ${name}: the team opens, is written, and holds who is added to it`, async () => {
    const { ws, end } = await open();
    try {
      const ann = mockClient({ clientId: "ann" });
      expect((await sendAndAwait(ws, ann, { action: "open", doc: "team:1" })).result.teams).toMatchObject({ id: 1 });
      expect((await sendAndAwait(ws, ann, { action: "delta", doc: "team:1", ops: [{ op: "replace", path: "/teams/1/name", value: "Ops" }] })).error).toBeUndefined();
      expect((await sendAndAwait(ws, ann, { action: "delta", doc: "team:1", ops: [{ op: "add", path: "/people/-", value: { name: "Ann" } }] })).error).toBeUndefined();
      const mo = mockClient({ clientId: "mo" });
      const team = (await sendAndAwait(ws, mo, { action: "open", doc: "team:1" })).result;
      expect(team.teams).toMatchObject({ id: 1, name: "Ops" });
      expect(Object.values(team.people)).toEqual([expect.objectContaining({ name: "Ann", teams_id: 1 })]);
    } finally {
      await end();
    }
  }, 30_000);
}

describe("the rest of what the model makes: the snapshot, the trajectory, the tests", () => {
  // the cafe: the table document roots at tables; the kitchen puts tables under cafes
  const cafe = (more: Partial<Record<"price", string>> = {}): Model => ({
    stories: {
      "1": { id: 1, text: "George opens the cafe with its tables", actor: "george", kind: "does", writes: [{ entity: "tables", op: "add" }] } as never,
      "2": { id: 2, text: "John orders at his table", actor: "john", kind: "does", writes: [{ entity: "orders", op: "add", path: "status", to: "ordered" }] } as never,
      "3": { id: 3, text: "Paul says it is ready", actor: "paul", kind: "does", writes: [{ entity: "orders", op: "replace", path: "status", to: "ready" }], requires: [{ entity: "orders", path: "status", value: "ordered" }] } as never,
      "4": { id: 4, text: "George places it", actor: "george", kind: "does", writes: [{ entity: "orders", op: "replace", path: "status", to: "placed" }], requires: [{ entity: "orders", path: "status", value: "ready" }] } as never,
      "5": { id: 5, text: "John pays", actor: "john", kind: "does", writes: [{ entity: "payments", op: "add" }], requires: [{ entity: "orders", path: "status", value: "placed" }] } as never,
    },
    documents: {
      "1": { id: 1, name: "table", root: "tables", held_by: ["john"], stories: [2, 3, 4, 5], holds: { tables: { parent: null, fields: [] }, orders: { parent: "tables", fields: [{ name: "status" }] }, payments: { parent: "tables", fields: [{ name: "amount", type: "integer" }] } } },
      "2": { id: 2, name: "kitchen", root: "cafes", held_by: ["paul"], stories: [2, 3], holds: { cafes: { parent: null, fields: [] }, tables: { parent: "cafes", fields: [] }, orders: { parent: "tables", fields: [{ name: "status" }] } } },
      "3": { id: 3, name: "till", root: "cafes", held_by: ["george"], stories: [1, 2, 3, 4, 5], holds: { cafes: { parent: null, fields: [] }, tables: { parent: "cafes", fields: [{ name: "number", type: "integer" }] }, orders: { parent: "tables", fields: [{ name: "status" }] }, payments: { parent: "tables", fields: [{ name: "amount", type: "integer" }, ...(more.price ? [{ name: "tip", type: more.price }] : [])] } } },
    },
  });

  test("a document's root says nothing of its parent: the parent another document gives wins", () => {
    expect(definitionsOf(cafe()).schema.tables.tables!.parent?.collection).toBe("cafes");
  });

  test("types.ts: the definitions, a row per table, each document's shape", () => {
    const t = typesOf(cafe());
    expect(t).toContain("export const tables: Parameters<typeof defineSchema>[0] = {");
    expect(t).toContain("export const schema = defineSchema(tables);");
    expect(t).toContain("export type TablesRow = { id: number; cafes_id: number; number: number | null; };");
    expect(t).toContain("export type TableDoc = { tables: TablesRow; orders: Record<string, OrdersRow>; payments: Record<string, PaymentsRow>; };");
  });

  test("the next migration: what the schema says beyond the steps so far; none when they lead to it; folded, they are the schema", async () => {
    const { stateOf, diff } = await import("@blueshed/delta/migrations");
    const first = nextMigrationOf([], cafe())!;
    expect(first.name).toBe("001-tables-orders-payments");
    const dir = mkdtempSync(join(import.meta.dir, ".steps-"));
    try {
      const load = async (m: { name: string; source: string }) => (await Bun.write(join(dir, `${m.name}.ts`), m.source), await import(join(dir, `${m.name}.ts`)));
      const history = [await load(first)];
      expect(nextMigrationOf(history, cafe())).toBeUndefined();
      const second = nextMigrationOf(history, cafe({ price: "integer" }))!;
      expect(second.name).toBe("002-payments");
      expect(second.source).toContain('addColumn("payments", "tip", { type: "integer", nullable: true })');
      history.push(await load(second));
      expect(diff(stateOf(history), definitionsOf(cafe({ price: "integer" })).schema)).toEqual({ changes: [], byHand: [] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a step a diff cannot make is written once, with what is owed by hand; never again while a step owes it", async () => {
    const under = (parent: string): Model => ({
      stories: { "1": { id: 1, text: "Ann orders", actor: "ann", kind: "does" } },
      documents: { "1": { id: 1, name: "floor", root: "cafes", held_by: ["ann"], stories: [1], holds: { cafes: { parent: null, fields: [] }, tables: { parent: "cafes", fields: [] }, orders: { parent, fields: [{ name: "status" }] } } } },
    });
    const dir = mkdtempSync(join(import.meta.dir, ".steps-"));
    try {
      const load = async (m: { name: string; source: string }) => (await Bun.write(join(dir, `${m.name}.ts`), m.source), await import(join(dir, `${m.name}.ts`)));
      const history = [await load(nextMigrationOf([], under("tables"))!)];
      const moved = nextMigrationOf(history, under("cafes"))!;
      expect(moved.source).toContain("// By hand:");
      history.push(await load(moved));
      expect(nextMigrationOf(history, under("cafes"), (line) => moved.source.includes(line))).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("model.test.ts: written beside the rest, it passes, and each story is seen by everyone it tells", async () => {
    const app = mkdtempSync(join(import.meta.dir, ".export-"));
    try {
      mkdirSync(join(app, "migrations"));
      await Bun.write(join(app, "types.ts"), typesOf(cafe()));
      const first = nextMigrationOf([], cafe())!;
      await Bun.write(join(app, "migrations", `${first.name}.ts`), first.source);
      await Bun.write(join(app, "model.test.ts"), testsOf(cafe(), "cafe"));
      const run = Bun.spawnSync(["bun", "test", "model.test.ts"], { cwd: app, env: { ...process.env, LOG_LEVEL: "silent" } });
      const out = run.stderr.toString();
      expect(out).toContain(" 6 pass");
      expect(out).toContain(" 0 fail");
    } finally {
      rmSync(app, { recursive: true, force: true });
    }
  }, 30_000);

  test("model.test.ts passes on the stories it was made from: one write that adds, changes and takes away; a replace with no value said; a row added on a page of rows", async () => {
    // the second cafe's: the manager keeps the menu (add, a price changed, a dish gone, in one write), and sets up a table
    const menu: Model = {
      stories: {
        "1": { id: 1, text: "The manager keeps the menu up to date", actor: "manager", kind: "does", writes: [{ entity: "items", op: "add", path: "name", to: "Tea" }, { entity: "items", op: "replace", path: "price" }, { entity: "items", op: "remove" }] } as never,
        "2": { id: 2, text: "The manager sets up a table", actor: "manager", kind: "does", writes: [{ entity: "tables", op: "add" }] } as never,
      },
      documents: {
        "1": { id: 1, name: "menu", root: "menus", held_by: ["manager"], stories: [1], holds: { menus: { parent: null, fields: [] }, items: { parent: "menus", fields: [{ name: "name" }, { name: "price", type: "integer" }] } } },
        "2": { id: 2, name: "table", root: "tables", held_by: ["manager"], stories: [2], holds: { tables: { parent: null, fields: [{ name: "number", type: "integer" }] } } },
        "3": { id: 3, name: "floor", root: "cafes", held_by: ["manager"], stories: [2], holds: { cafes: { parent: null, fields: [] }, tables: { parent: "cafes", fields: [{ name: "number", type: "integer" }] } } },
      },
    };
    const app = mkdtempSync(join(import.meta.dir, ".export-"));
    try {
      mkdirSync(join(app, "migrations"));
      await Bun.write(join(app, "types.ts"), typesOf(menu));
      const first = nextMigrationOf([], menu)!;
      await Bun.write(join(app, "migrations", `${first.name}.ts`), first.source);
      const tests = testsOf(menu, "menu");
      expect(tests).toContain('"path":"/items/1/price","value":1'); // an integer, not null
      expect(tests).toContain('{"doc":"floor:1","ops":[{"op":"add","path":"/tables/-"'); // on the page of tables, not the table's own
      await Bun.write(join(app, "model.test.ts"), tests);
      const run = Bun.spawnSync(["bun", "test", "model.test.ts"], { cwd: app, env: { ...process.env, LOG_LEVEL: "silent" } });
      expect(run.stderr.toString()).toContain(" 0 fail");
    } finally {
      rmSync(app, { recursive: true, force: true });
    }
  }, 30_000);

  test("a story's premise: the stories it needs, each after what it needs in turn", () => {
    const cafe: Model = {
      stories: {
        "1": { id: 1, text: "The cook says it is ready", actor: "cook", kind: "does", writes: [{ entity: "orders", op: "replace", path: "status", to: "ready" }] } as never,
        "2": { id: 2, text: "The customer orders", actor: "customer", kind: "does", writes: [{ entity: "orders", op: "add" }] } as never,
        "3": { id: 3, text: "The manager sets up a table", actor: "manager", kind: "does", writes: [{ entity: "tables", op: "add" }] } as never,
      },
      documents: {
        "1": { id: 1, name: "floor", root: "cafes", held_by: ["manager", "customer", "cook"], stories: [1, 2, 3], holds: { cafes: { parent: null, fields: [] }, tables: { parent: "cafes", fields: [] }, orders: { parent: "tables", fields: [{ name: "status" }] } } },
      },
    };
    const ready = testsOf(cafe).split("\n").find((l) => l.includes("The cook says it is ready"))!;
    expect(ready.indexOf('"path":"/tables/-"')).toBeLessThan(ready.indexOf('"path":"/orders/-"')); // the table, then the order on it
  });
});
