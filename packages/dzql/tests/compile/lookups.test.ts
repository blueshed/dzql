/**
 * Compiled lookups answer what the framework's answer.
 *
 * A collection's definition: for every collection, and one there is not,
 * `_delta_collection` and `_delta_collection_framework` give the same row.
 *
 * A table's serial: for every table, ids below, at and past what its
 * sequence has handed out, and past 2^53, `_delta_serial_new` answers as the
 * framework's, and `_delta_serial_past` moves the sequence where the
 * framework's does (each from the same sequence, set back between: a
 * sequence does not roll back); and a caller without the table's privilege is
 * answered alike. A table there is not goes to the framework.
 *
 * A document as it stood: for every name the path cases open, at times before,
 * between and after its writes, `delta_open_at` (each compiled document to its
 * own read) and `_delta_open_at_framework` give the same, an error included,
 * on the seed and after writes.
 *
 * Then the write, the reads and the ledger through them: delta's own cases
 * (tests/delta) run with them in place.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Pool } from "pg";
import { createLocal } from "@blueshed/delta/local";
import { setLogLevel } from "@blueshed/delta/logger";
import { pathDocs, pathPublicDocs, pathSchema, pathSeed } from "@blueshed/delta/testing";
import { applyFramework, applySql, createDocListener, docTypeFromDef, generateSql, importTables } from "../../src/postgres";
import { openPglite } from "../../src/postgres/pglite";
import { compileLookups } from "../../src/compile/lookups";

setLogLevel("silent");

const docs = [...pathDocs, ...pathPublicDocs];
const tables = Object.entries(pathSchema.tables);
const names = [
  "fo-board:1", "fo-board:2", "fo-board:99", "fo-board:abc", "fo-menu:1", "fo-household:1", "fo-course:1", "fo-title:1", "fo-tagged:1",
  "fo-notes:1", "fo-all-courses:", "fo-catalog:", "fo-courses-like:So", "fo-seating:1", "fo-seats-kept:1", "fo-slots-of:1", "fo-slots-by:2026-01-02",
  "fo-note:1", "fo-all-notes:", "fo-drinks:1", "fo-plan:1", "fo-plan:7", "fo-weddings:", "fo-guest:1:a@x", "fo-seat-of:1:3", "fo-all-households:",
  "fo-party:1", "fo-slim:1", "fo-notes-on:2019-01-01", "fo-board-on:1:2021-01-01", "fo-asks:1", "fo-pub-courses:", "no-such:1",
];

let pool: Pool;

beforeAll(async () => {
  pool = await openPglite();
  await applyFramework(pool);
  await applySql(pool, generateSql(pathSchema, docs));   // the compiled lookups
  await importTables(pool, pathSchema, pathSeed);
});
afterAll(async () => { await pool.end(); });

/** A call's answer, or its error. */
async function answer(sql: string, params: unknown[]): Promise<unknown> {
  try {
    return (await pool.query(sql, params)).rows[0].r;
  } catch (err: any) {
    return { error: err.message };
  }
}

test("every collection's definition, and one there is not, as the framework gives it", async () => {
  for (const key of [...tables.map(([k]) => k), "no_such"]) {
    const compiled = await answer("SELECT row_to_json(_delta_collection($1)) AS r", [key]);
    expect({ key, row: compiled }).toEqual({ key, row: await answer("SELECT row_to_json(_delta_collection_framework($1)) AS r", [key]) });
  }
});

describe("each table's serial, as the framework reads and moves it", () => {
  for (const [, t] of [...tables, ["no_such", { name: "no_such" }] as const]) {
    test(t.name, async () => {
      const seq = `seq_${t.name}`;
      const there = t.name !== "no_such";
      const state = async () => there ? (await pool.query(`SELECT last_value::text AS v, is_called AS c FROM "${seq}"`)).rows[0] : null;
      const setTo = async (s: any) => { if (there) await pool.query("SELECT setval($1, $2, $3)", [seq, s.v, s.c]); };
      const was = await state();
      const last = there ? Number(was.v) : 0;
      for (const id of [0, 1, last - 1, last, last + 1, last + 50, 9007199254740991, 9007199254740992]) {
        const asked = await answer("SELECT _delta_serial_new($1, $2) AS r", [t.name, id]);
        expect({ table: t.name, id, new: asked }).toEqual({ table: t.name, id, new: await answer("SELECT _delta_serial_new_framework($1, $2) AS r", [t.name, id]) });
        const moved = async (fn: string) => {
          await setTo(was);
          const r = await answer(`SELECT ${fn}($1, $2)::text AS r`, [t.name, id]);
          return { r, after: await state() };
        };
        expect({ table: t.name, id, past: await moved("_delta_serial_past") }).toEqual({ table: t.name, id, past: await moved("_delta_serial_past_framework") });
      }
      await setTo(was);
    });
  }

  test("a caller without the table's privilege is answered alike", async () => {
    await pool.query("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lookups_stranger') THEN CREATE ROLE lookups_stranger; END IF; END $$");
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL ROLE lookups_stranger");
      for (const [, t] of tables) {
        const r = (await c.query("SELECT _delta_serial_new($1, 1) AS compiled, _delta_serial_new_framework($1, 1) AS framework", [t.name])).rows[0];
        expect({ table: t.name, ...r }).toEqual({ table: t.name, compiled: r.framework, framework: r.framework });
        expect({ table: t.name, compiled: r.compiled }).toEqual({ table: t.name, compiled: false });
      }
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  });
});

const TIMES = ["2000-01-01T00:00:00Z", "2021-01-01T00:00:00Z", "2026-01-01T00:00:00Z", "2999-01-01T00:00:00Z"];

function sameOpenAt() {
  for (const name of names) {
    test(name, async () => {
      for (const at of TIMES) {
        const compiled = await answer("SELECT delta_open_at($1, $2::timestamptz) AS r", [name, at]);
        expect({ name, at, doc: compiled }).toEqual({ name, at, doc: await answer("SELECT _delta_open_at_framework($1, $2::timestamptz) AS r", [name, at]) });
      }
      const now = (await pool.query("SELECT now()::text AS n")).rows[0].n;
      const compiled = await answer("SELECT delta_open_at($1, $2::timestamptz) AS r", [name, now]);
      expect({ name, at: "now", doc: compiled }).toEqual({ name, at: "now", doc: await answer("SELECT _delta_open_at_framework($1, $2::timestamptz) AS r", [name, now]) });
    });
  }
}

describe("on the seed, every document as it stood, as the framework reads it", () => sameOpenAt());

describe("after writes of every kind, still", () => {
  beforeAll(async () => {
    const local = createLocal();
    const listener = await createDocListener(local.server, pool, { types: docs.map((def) => docTypeFromDef(def, pool)), ledger: true });
    const write = async (doc: string, ops: unknown[]) => {
      await local.call("open", { doc });
      const r = await local.call("delta", { doc, ops });
      expect(r.error).toBeUndefined();
    };
    await write("fo-board:1", [
      { op: "add", path: "/courses/-", value: { name: "Fish" } },
      { op: "add", path: "/notes/-", value: { text: "and tables" } },
      { op: "remove", path: "/notes/1" },
    ]);
    await write("fo-all-courses:", [{ op: "remove", path: "/courses/2" }]);
    await write("fo-all-households:", [{ op: "replace", path: "/households/2/weddings_id", value: 2 }]);
    await listener.destroy();
  });
  sameOpenAt();
});

describe("the compiled text", () => {
  test("is the same for the same definitions, and pinned", () => {
    expect(compileLookups(pathSchema, docs)).toBe(compileLookups(pathSchema, docs));
    expect(compileLookups(pathSchema, docs)).toMatchSnapshot();
  });
});
