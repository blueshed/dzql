/**
 * Two writes to one row at once, on the Postgres server: the second waits on the first's lock, and
 * finds the row as the first left it -- never "not there". A row stored again (a replace's put) is an
 * UPDATE, which a waiting lock follows to the row's new version; deleted and inserted again, a waiting
 * `SELECT ... FOR UPDATE` found the row it waited on gone, and the second write was a 404 (seen in CI:
 * review-findings, "Finding #1"). Temporal rows keep their versions, and are asked the same.
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
    race_rows: { columns: { name: "text" }, temporal: false },
    race_kept: { columns: { name: "text" }, temporal: true },
  }, [defineDoc("race:", { root: "race_rows", include: [] }), defineDoc("race-kept:", { root: "race_kept", include: [] })]);
});
afterAll(async () => { await pool.end(); });

for (const [coll, temporal] of [["race_rows", false], ["race_kept", true]] as const) {
  test(`${coll}: a write that waited on another's lock finds the row as the other left it`, async () => {
    const { rows: [{ id }] } = await pool.query(`INSERT INTO ${coll} (name) VALUES ('original') RETURNING id::int AS id`);
    const first = await pool.connect();
    const second = await pool.connect();
    try {
      await first.query("BEGIN");
      const held = (await first.query("SELECT _delta_row_lock($1, $1, $2, $3) AS r", [coll, temporal, id])).rows[0].r;
      await second.query("BEGIN");
      const waiting = second.query("SELECT _delta_row_lock($1, $1, $2, $3) AS r", [coll, temporal, id]);
      await Bun.sleep(100); // the second is waiting on the first's lock
      await first.query("SELECT _delta_row_put($1, $1, $2, $3, $4::jsonb, now())", [coll, temporal, id, JSON.stringify({ ...held, name: "first" })]);
      await first.query("COMMIT");
      const found = (await waiting).rows[0].r;
      expect(found).toMatchObject({ id, name: "first" });
      await second.query("ROLLBACK");
    } finally {
      await first.query("ROLLBACK").catch(() => {});
      first.release();
      second.release();
    }
  });
}
