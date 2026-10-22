/**
 * Two writes that tell each other's documents never deadlock, on the Postgres server.
 *
 * A write bumps the version of every document it tells (`_delta_bump_and_notify`, a row of
 * `_delta_versions` each, locked to the commit). Bumped writer first, then the others, two writers
 * through `tell-board:1` and `tell-posts:` -- each holding the posts the other adds -- locked the two
 * rows in opposite orders, and one was a deadlock (40P01, 409). Bumped in one order, by name, the
 * second waits for the first.
 *
 * To meet every time, each telling is slowed (a trigger on the log sleeps): both writers hold their
 * first row before either asks for its second.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import type { Pool } from "pg";
import { applyDefined, applyFramework, newPool } from "./setup";
import { defineDoc } from "../../src/postgres";

let pool: Pool;
beforeAll(async () => {
  pool = await newPool();
  await applyFramework(pool);
  await applyDefined(pool, {
    tell_boards: { columns: { name: "text" }, temporal: false },
    tell_posts: { parent: "tell_boards", columns: { title: "text" }, temporal: false },
  }, [defineDoc("tell-board:", { root: "tell_boards", include: ["tell_posts"] }), defineDoc("tell-posts:", { root: "tell_posts", include: [] })]);
  await pool.query("INSERT INTO tell_boards (id, name) VALUES (1, 'one') ON CONFLICT DO NOTHING");
  await pool.query("SELECT setval('seq_tell_boards', 1)");
  // both documents open: each write tells both
  await pool.query("INSERT INTO _delta_held (doc_name, holder) VALUES ('tell-board:1', -97), ('tell-posts:', -97) ON CONFLICT DO NOTHING");
  await pool.query(`CREATE OR REPLACE FUNCTION tell_slowly() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.doc_name LIKE 'tell-%' THEN PERFORM pg_sleep(0.3); END IF; RETURN NEW; END $$`);
  await pool.query("CREATE TRIGGER tell_slowly AFTER INSERT ON _delta_ops_log FOR EACH ROW EXECUTE FUNCTION tell_slowly()");
});
afterAll(async () => {
  await pool.query("DROP TRIGGER IF EXISTS tell_slowly ON _delta_ops_log");
  await pool.query("DROP FUNCTION IF EXISTS tell_slowly()");
  await pool.query("DELETE FROM _delta_held WHERE holder = -97");
  await pool.end();
});

const add = (doc: string, title: string) => pool.query("SELECT delta_apply($1, $2::jsonb) AS r", [doc,
  JSON.stringify([{ op: "add", path: "/tell_posts/-", value: { title, ...(doc === "tell-posts:" ? { tell_boards_id: 1 } : {}) } }])]);

test("a write through each document at once: both land, each document told both posts", async () => {
  const before = Number((await pool.query("SELECT count(*) AS n FROM _delta_ops_log WHERE doc_name LIKE 'tell-%'")).rows[0].n);
  const results = await Promise.allSettled([add("tell-board:1", "through the board"), add("tell-posts:", "through the list")]);
  expect(results.map((r) => (r.status === "rejected" ? (r.reason as any).code ?? String(r.reason) : "ok"))).toEqual(["ok", "ok"]);
  const told = (await pool.query("SELECT doc_name, count(*)::int AS n FROM _delta_ops_log WHERE doc_name LIKE 'tell-%' AND id > 0 GROUP BY 1 ORDER BY 1")).rows;
  expect(told.reduce((s, r) => s + r.n, 0) - before).toBe(4);
});
