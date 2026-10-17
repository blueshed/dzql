import { afterAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWs } from "@blueshed/delta/server";
import { setLogLevel } from "@blueshed/delta/logger";
import { mockClient, sendAndAwait, waitFor } from "@blueshed/delta/testing";
import * as json from "@blueshed/delta/json";
import * as sqlite from "@blueshed/delta/sqlite";
import { applyFramework, applySql, createDocListener, docTypeFromDef, generateSql } from "../postgres";
import { openPglite } from "../postgres/pglite";
import { definitionsOf, sourceOf, type Model } from "./definitions";

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
