/**
 * Each column the documents look rows up by gets an index: a `refs` or `cascadeOn`
 * column, a column a scope reads its root rows by, a column an `owns` path's hop filters by --
 * beside the parent keys and the temporal (id, valid_to) that `tableSql` indexes.
 *
 * Here: which columns, for delta's fixtures; the text, pinned; and on PGlite, with rows enough for
 * the planner to care, each kind of lookup read by its index where, without it, the table is read
 * whole (a sequential scan, or every row by its key, filtered).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Pool } from "pg";
import { setLogLevel } from "@blueshed/delta/logger";
import { defineDoc, defineSchema } from "@blueshed/delta/backend";
import { cinemaApp, pathDocs, pathPublicDocs, pathSchema, permissionDocs, permissionSchema } from "@blueshed/delta/testing";
import { applyFramework, applySql, generateSql } from "../../src/postgres";
import { sharedPglite } from "../helpers/pglite";
import { compileIndexes, lookupColumns } from "../../src/compile/indexes";

setLogLevel("silent");

describe("the columns looked up by", () => {
  test("delta's path documents: each scope's column (not like, at, a boolean or json), and a cascadeOn's", () => {
    expect(lookupColumns(pathSchema, [...pathDocs, ...pathPublicDocs])).toEqual([
      ["asks", "from"], ["favours", "households_id"], ["households", "email"], ["seats", "table_no"], ["slots", "price"], ["slots", "starts"], ["tags", "label"],
    ]);
  });

  test("the permission cases: each owns path's hop, and a scope", () => {
    expect(lookupColumns(permissionSchema, Object.values(permissionDocs))).toEqual([["members", "org_id"], ["people", "team_id"], ["venues", "org_id"]]);
  });

  test("the cinema: each refs column", () => {
    expect(lookupColumns(cinemaApp.schema, cinemaApp.docs)).toEqual([["case_showings", "film"], ["case_showings", "usher"]]);
  });

  test("an id, a parent key and a unique constraint's first column are indexed already", () => {
    const schema = defineSchema({
      orgs: { columns: { code: "text" }, unique: ["code"], temporal: false },
      teams: { parent: "orgs", columns: { name: "text" }, temporal: false },
    });
    const docs = [defineDoc("org-by:", { root: "orgs", include: [], scope: { code: ":code" } }), defineDoc("teams-of:", { root: "teams", include: [], scope: { orgs_id: ":org" } })];
    expect(lookupColumns(schema, docs)).toEqual([]);
    expect(compileIndexes(schema, docs)).toBe("");
  });

  test("the text, the same for the same definitions, and pinned", () => {
    expect(compileIndexes(permissionSchema, Object.values(permissionDocs))).toBe(compileIndexes(permissionSchema, Object.values(permissionDocs)));
    expect(compileIndexes(permissionSchema, Object.values(permissionDocs))).toMatchSnapshot();
  });
});

describe("on PGlite, each lookup goes from reading the table whole to its index", () => {
  let pool: Pool;
  const N = 10000;

  beforeAll(async () => {
    pool = await sharedPglite();
    await applyFramework(pool);
    const { schema, docs } = cinemaApp;
    await applySql(pool, generateSql(permissionSchema, Object.values(permissionDocs)));
    await applySql(pool, generateSql(schema, docs));   // its tables beside them: only the indexes are asked of here
    await pool.query(`INSERT INTO case_screens (id, name) VALUES (1, 'one')`);
    await pool.query(`INSERT INTO case_showings (id, case_screens_id, film, usher) SELECT g, 1, g % 500, NULL FROM generate_series(1, ${N}) g`);
    await pool.query(`INSERT INTO members (id, org_id, person_id, active) SELECT g, g % 1000, g, TRUE FROM generate_series(1, ${N}) g`);
    await pool.query(`INSERT INTO people (id, name, team_id) SELECT g, 'p' || g, g % 1000 FROM generate_series(1, ${N}) g`);
    await pool.query("ANALYZE");
  }, 60_000);   // rows enough for the planner: past bun's 5s default on a loaded machine
  afterAll(async () => { await pool.end(); });

  /** The plan of `sql`, with the index `index` and without it. */
  async function plans(index: string, sql: string): Promise<{ with: string; without: string }> {
    const plan = async () => (await pool.query(`EXPLAIN ${sql}`)).rows.map((r) => r["QUERY PLAN"]).join("\n");
    const withIndex = await plan();
    const def = (await pool.query("SELECT indexdef FROM pg_indexes WHERE indexname = $1", [index])).rows[0]?.indexdef;
    expect(def).toBeDefined();
    await pool.query(`DROP INDEX "${index}"`);
    const without = await plan();
    await pool.query(def);
    return { with: withIndex, without };
  }

  test("a film no showing names (refs): is it still named, as its remove asks?", async () => {
    const p = await plans("idx_case_showings_film", "SELECT r.id FROM current_case_showings r WHERE r.film = 9999 ORDER BY r.id LIMIT 1");
    expect(p.without).toMatch(/Filter: .*film = 9999/);   // every row read and filtered (by the key's order, for the LIMIT)
    expect(p.without).not.toContain("Index Cond");
    expect(p.with).toContain("idx_case_showings_film");
  });

  test("an org's active members (an owns path's hop)", async () => {
    const p = await plans("idx_members_org_id", "SELECT 1 FROM members m WHERE m.org_id = 7 AND m.active = TRUE AND m.valid_to IS NULL AND m.person_id = 7");
    expect(p.without).toContain("Seq Scan on members");
    expect(p.with).toContain("idx_members_org_id");
  });

  test("the change log pruned by age (delta_prune_ops) reads the old entries alone", async () => {
    await pool.query(`INSERT INTO _delta_ops_log (doc_name, version, ops, created_at)
      SELECT 'd:' || (g % 50), g, '[]'::jsonb, now() - (g || ' seconds')::interval FROM generate_series(1, ${N}) g`);
    await pool.query("ANALYZE _delta_ops_log");
    const p = await plans("idx_delta_ops_log_created", "DELETE FROM _delta_ops_log WHERE created_at < NOW() - interval '5 hours'");
    expect(p.without).toContain("Seq Scan on _delta_ops_log");
    expect(p.with).toContain("idx_delta_ops_log_created");
  }, 30_000);

  test("a team's people (a scope)", async () => {
    const p = await plans("idx_people_team_id", "SELECT t.id FROM people t WHERE t.team_id = 7");
    expect(p.without).toContain("Seq Scan on people");
    expect(p.with).toContain("idx_people_team_id");
  });
});
