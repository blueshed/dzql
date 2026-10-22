/**
 * delta's noOverlap on Postgres, beyond the cases every backend answers (`noOverlapCases`): the
 * database's own EXCLUDE constraint (btree_gist for the equal columns, on PGlite and the server), what
 * it refuses of SQL that writes past `delta_apply`, two writes at once (the write path's check takes
 * turns under its advisory lock, so the second is told in delta's words), and the refusal's SQLSTATE,
 * 23P01, which the listener answers 409.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Pool } from "pg";
import { bookedApp } from "@blueshed/delta/testing";
import { applyFramework, applySql, generateSql, importTables } from "../../src/postgres";
import { openPglite } from "../../src/postgres/pglite";
import { newPool } from "./setup";

const tables = Object.values(bookedApp.schema.tables).map((t) => t.name);
const drop = async (pool: Pool) => {
  await pool.query(`DROP TABLE IF EXISTS ${tables.join(", ")} CASCADE`);
  await pool.query(`DROP SEQUENCE IF EXISTS ${tables.map((t) => `seq_${t}`).join(", ")}`);
};
const ops = (from: string, to: string) => JSON.stringify([{ op: "add", path: "/case_bookings/-", value: { case_halls_id: 1, title: "x", starts: from, ends: to } }]);

for (const [name, open] of [["PGlite", () => openPglite()], ["a Postgres server", () => newPool()]] as const) {
  describe(name, () => {
    let pool: Pool;
    beforeAll(async () => {
      pool = await open();
      await drop(pool);
      await applyFramework(pool);
      await applySql(pool, generateSql(bookedApp.schema, bookedApp.docs));
      await importTables(pool, bookedApp.schema, bookedApp.seed);
    });
    afterAll(async () => {
      await drop(pool);
      await pool.end();
    });

    test("each noOverlap is an EXCLUDE constraint on the current rows, deferred to the commit", async () => {
      const { rows } = await pool.query(`SELECT conrelid::regclass::text AS t, conname, condeferred, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE contype = 'x' AND conname LIKE 'excl\\_case\\_%' ORDER BY conname`);
      expect(rows.map((r: any) => [r.t, r.conname, r.condeferred])).toEqual([
        ["case_bands", "excl_case_bands_from_qty_to_qty", true],
        ["case_bookings", "excl_case_bookings_starts_ends", true],
        ["case_leave", "excl_case_leave_first_last", true],
      ]);
      expect(rows[1].def).toContain("EXCLUDE USING gist (case_halls_id WITH =,");
      expect(rows[1].def).toContain("WHERE ((valid_to IS NULL))");
      // applied again, nothing is made twice; a noOverlap the definitions no longer say is dropped
      await applySql(pool, generateSql(bookedApp.schema, bookedApp.docs));
      const fewer = structuredClone(bookedApp.schema);
      delete fewer.tables.case_bands!.noOverlap;
      await applySql(pool, generateSql(fewer, bookedApp.docs));
      expect((await pool.query(`SELECT count(*)::int AS n FROM pg_constraint WHERE contype = 'x' AND conname LIKE 'excl\\_case\\_%'`)).rows[0].n).toBe(2);
      await applySql(pool, generateSql(bookedApp.schema, bookedApp.docs));
      expect((await pool.query(`SELECT count(*)::int AS n FROM pg_constraint WHERE contype = 'x' AND conname LIKE 'excl\\_case\\_%'`)).rows[0].n).toBe(3);
    });

    test("SQL that writes past delta_apply is held by the database: 23P01 at the commit", async () => {
      const db = await pool.connect();
      try {
        await db.query("BEGIN");
        await db.query("INSERT INTO case_bookings (id, case_halls_id, title, starts, ends) VALUES (90, 1, 'raw', '2026-10-20T09:30:00Z', '2026-10-20T09:45:00Z')");
        await expect(db.query("COMMIT")).rejects.toMatchObject({ code: "23P01" });
      } finally {
        await db.query("ROLLBACK").catch(() => {});
        db.release();
      }
    });

    test("delta_apply's refusal is SQLSTATE 23P01 (an exclusion: 409 on the wire), in delta's words", async () => {
      await expect(pool.query("SELECT delta_apply('case-halls:', $1::jsonb)", [ops("2026-10-20T09:30:00Z", "2026-10-20T09:45:00Z")]))
        .rejects.toMatchObject({ code: "23P01", message: expect.stringMatching(/^Overlaps: case_bookings\/\d+ and case_bookings\/1, of the same case_halls_id, both hold starts to ends at once/) });
    });

    if (name === "a Postgres server") {
      test("two writes at once of the same hall's time: the second waits its turn, and is told in delta's words", async () => {
        const first = await pool.connect();
        const second = await pool.connect();
        try {
          await first.query("BEGIN");
          await first.query("SELECT delta_apply('case-halls:', $1::jsonb)", [ops("2026-10-19T09:00:00Z", "2026-10-19T10:00:00Z")]);
          await second.query("BEGIN");
          const waiting = second.query("SELECT delta_apply('case-halls:', $1::jsonb)", [ops("2026-10-19T09:30:00Z", "2026-10-19T10:30:00Z")]).then(() => null, (err) => err);
          await Bun.sleep(150);   // the second waits on the first's advisory lock
          await first.query("COMMIT");
          const err = await waiting;
          expect(err?.code).toBe("23P01");
          expect(err?.message).toMatch(/^Overlaps: case_bookings\/\d+ and case_bookings\/\d+, of the same case_halls_id/);
          await second.query("ROLLBACK");
        } finally {
          await first.query("ROLLBACK").catch(() => {});
          await second.query("ROLLBACK").catch(() => {});
          first.release();
          second.release();
        }
      });
    }
  });
}
