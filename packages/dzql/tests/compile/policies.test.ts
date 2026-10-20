/**
 * Compiled policies (todo #19): each table every document holding it says by a path has row-level
 * security, `dzql_owns`, whose `dzql_may__<collection>` answers whether the person may have a
 * document that holds the row. Pinned on PGlite as a role the policies hold (NOSUPERUSER
 * NOBYPASSRLS): the rows each person reads of each table, on the seed and after writes; a row
 * written that would not be theirs refused; a table some document holds with no path left alone,
 * and one dzql governed before let go. And the text, for delta's permission documents and a board's.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Pool } from "pg";
import { PGlite } from "@electric-sql/pglite";
import { defineDoc, defineSchema, q } from "@blueshed/delta/backend";
import { permissionDocs, permissionSchema, permissionSeed } from "@blueshed/delta/testing";
import { applyFramework, applySql, generateSql, importTables } from "../../src/postgres";
import { pglitePool } from "../../src/postgres/pglite";
import { compilePolicies } from "../../src/compile/policies";
import { pgliteAs } from "../helpers/pglite";

// a board: its lists and their cards hang from it; its labels from nothing; a card is its author's too
const boardSchema = defineSchema({
  boards: { columns: { owner_id: "integer" } },   // keeps versions
  lists: { parent: "boards", columns: { name: "text" }, temporal: false },
  cards: { parent: "lists", columns: { author_id: "integer", text: "text" }, temporal: false },
  labels: { columns: { name: "text" }, temporal: false },
  notes: { columns: { text: "text" }, temporal: false },
});
const boardDocs = [
  defineDoc("board:", { root: "boards", include: ["lists", "cards", "labels"], owns: "@owner_id" }),
  defineDoc("cards-by:", { root: "cards", include: [], scope: { author_id: ":id" }, owns: "@author_id" }),
  defineDoc("notes:", { root: "notes", include: [] }),   // no path: its table is the app's
];
const boardSeed = {
  tables: {
    boards: [{ id: 1, owner_id: 1 }, { id: 2, owner_id: 2 }],
    lists: [{ id: 1, boards_id: 1, name: "a" }, { id: 2, boards_id: 2, name: "b" }],
    cards: [{ id: 1, lists_id: 1, author_id: 1, text: "ann's" }, { id: 2, lists_id: 1, author_id: 3, text: "cy's on ann's" }, { id: 3, lists_id: 2, author_id: 2, text: "ben's" }],
    labels: [{ id: 1, name: "red" }],
    notes: [{ id: 1, text: "anyone's" }],
  },
};
const apps = [
  { name: "permissions", schema: permissionSchema, docs: Object.values(permissionDocs), seed: permissionSeed },
  { name: "a board", schema: boardSchema, docs: boardDocs, seed: boardSeed },
];

let db: PGlite;
let admin: Pool;
let app: Pool;

beforeAll(async () => {
  db = await PGlite.create();
  admin = pglitePool(db);
  await admin.query("CREATE ROLE dzql_app NOSUPERUSER NOBYPASSRLS");
  app = pgliteAs(db, "dzql_app");
});
afterAll(async () => { await db.close(); });

/** As `person` (none: unbound), in one transaction: `fn` on the role's connection. */
async function as<T>(person: number | null, fn: (db: { query: Pool["query"] }) => Promise<T>): Promise<T> {
  const c = await app.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.user_id', $1, true)", [person === null ? "" : String(person)]);
    return await fn(c);
  } finally { await c.query("ROLLBACK"); c.release(); }
}

/** Each table's rows (id, and version where it keeps them) each person reads. */
async function readBy(schema: typeof permissionSchema) {
  const out: Record<string, Record<string, string[]>> = {};
  for (const person of [null, 1, 2, 3]) {
    out[String(person)] = await as(person, async (c) => {
      const seen: Record<string, string[]> = {};
      for (const t of Object.values(schema.tables)) {
        seen[t.name] = (await c.query(`SELECT id::text || CASE WHEN ${t.temporal ? "valid_to IS NULL" : "TRUE"} THEN '' ELSE ' (past)' END AS r FROM ${q(t.name)} ORDER BY id${t.temporal ? ", valid_from" : ""}`)).rows.map((r) => r.r);
      }
      return seen;
    });
  }
  return out;
}

for (const { name, schema, docs, seed } of apps) {
  describe(`${name}: the rows each person reads`, () => {
    beforeAll(async () => {
      await admin.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT USAGE ON SCHEMA public TO PUBLIC");
      await applyFramework(admin);
      await applySql(admin, generateSql(schema, docs));
      await admin.query("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO dzql_app; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO dzql_app");
      await importTables(admin, schema, seed);
    });

    test("on the seed", async () => {
      expect(await readBy(schema)).toMatchSnapshot();
    });

    test("after writes: a membership let go, a board passed on, a card moved", async () => {
      if (name === "permissions") await admin.query("UPDATE members SET valid_to = now() WHERE id = 1 AND valid_to IS NULL; INSERT INTO members (id, org_id, person_id, active, valid_from) VALUES (1, 1, 1, false, now())");
      else await admin.query("UPDATE boards SET valid_to = now() WHERE id = 2 AND valid_to IS NULL; INSERT INTO boards (id, owner_id, valid_from) VALUES (2, 3, now()); UPDATE cards SET lists_id = 2 WHERE id = 2");
      expect(await readBy(schema)).toMatchSnapshot();
    });
  });
}

describe("a board: what a person may write", () => {
  test("a row is written only where it stays theirs; a table with no path is the app's", async () => {
    // (the board app is the one applied last)
    const tried = async (person: number, sql: string) => as(person, (c) => c.query(sql).then(() => "written", (e) => e.code));
    expect(await tried(1, "INSERT INTO cards (id, lists_id, author_id, text) VALUES (10, 1, 1, 'mine, on my board')")).toBe("written");
    expect(await tried(2, "INSERT INTO cards (id, lists_id, author_id, text) VALUES (11, 1, 1, 'as ann')")).toBe("42501");   // neither his card nor on his board
    expect(await tried(2, "INSERT INTO cards (id, lists_id, author_id, text) VALUES (12, 1, 2, 'his, on her board')")).toBe("written");
    expect(await tried(1, "UPDATE boards SET owner_id = 2 WHERE id = 1 AND valid_to IS NULL")).toBe("42501");   // handed away
    expect(await as(2, (c) => c.query("UPDATE cards SET text = 'his now' WHERE id = 1").then((r) => r.rowCount))).toBe(0);   // not there for him
    expect(await tried(2, "INSERT INTO notes (id, text) VALUES (5, 'anyone may')")).toBe("written");
    const { rows } = await admin.query("SELECT relname, relrowsecurity AS rls, relforcerowsecurity AS forced FROM pg_class WHERE relname IN ('boards', 'cards', 'labels', 'lists', 'notes') ORDER BY relname");
    expect(rows).toEqual(["boards", "cards", "labels", "lists"].map((relname) => ({ relname, rls: true, forced: true })).concat([{ relname: "notes", rls: false, forced: false }]));
  });

  test("each definer function, the policies' and the ownership answers among them, searches the path it was applied with, and pg_temp last", async () => {
    const { rows } = await admin.query("SELECT proname, proconfig FROM pg_proc WHERE prosecdef AND pronamespace = 'public'::regnamespace ORDER BY proname");
    expect(rows.map((r) => r.proname)).toEqual(expect.arrayContaining(["_delta_holders", "dzql_may__boards", "dzql_may__cards", "dzql_owns__board", "dzql_owns__cards_by"]));
    for (const { proname, proconfig } of rows) {
      const path = (proconfig ?? []).find((c: string) => c.startsWith("search_path="));
      expect({ proname, last: path?.split(",").at(-1)?.trim() }).toEqual({ proname, last: "pg_temp" });
    }
  });

  test("a table a document then holds with no path is let go: dzql's policy off, and RLS with it", async () => {
    await applySql(admin, generateSql(boardSchema, [...boardDocs, defineDoc("all-cards:", { root: "cards", include: [] })]));
    const { rows } = await admin.query("SELECT relrowsecurity AS rls, relforcerowsecurity AS forced, (SELECT count(*)::int FROM pg_policies WHERE tablename = 'cards') AS policies FROM pg_class WHERE relname = 'cards'");
    expect(rows).toEqual([{ rls: false, forced: false, policies: 0 }]);
    expect(await as(null, async (c) => (await c.query("SELECT count(*)::int AS n FROM cards")).rows[0].n)).toBeGreaterThan(0);
  });
});

describe("the compiled text", () => {
  test("is the same for the same definitions, and pinned", () => {
    for (const { schema, docs } of apps) {
      expect(compilePolicies(schema, docs)).toBe(compilePolicies(schema, docs));
      expect(compilePolicies(schema, docs)).toMatchSnapshot();
    }
  });
});
