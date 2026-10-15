/**
 * The entry an undo or a redo takes (_delta_ledger_tip, todo #28). It was a
 * recursive walk of every chain the cursor ever began; it is now found newest
 * first among the cursor's own entries. The old walk is kept here as the
 * reference: over ledgers made through the real functions -- three cursors
 * writing, removing and adding rows they share, writing facts (never undone), undoing, redoing and walking a
 * change by name, conflicts recorded as they come -- both take the same entry
 * for every cursor, both ways, after every step. And an undo on a cursor with a
 * long history costs about what it costs on a short one.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Pool } from "pg";
import { setLogLevel } from "@blueshed/delta/logger";
import { applyFramework, applySql, defineDoc, defineSchema, generateSql } from "../../src/postgres";
import { openPglite } from "../../src/postgres/pglite";

setLogLevel("silent");

const schema = defineSchema({ items: { columns: { name: "text", n: "integer" } } });
const docs = [defineDoc("items:", { root: "items", include: [] })];

/** The tip as it was found before todo #28: every chain of the cursor, walked. */
const REFERENCE = `CREATE OR REPLACE FUNCTION _t_tip_reference(p_cursor TEXT, p_back BOOLEAN)
RETURNS _delta_ledger AS $$
  WITH RECURSIVE chain(id, depth) AS (
    SELECT id, 0 FROM _delta_ledger WHERE cursor = p_cursor AND undoes IS NULL AND undoable
    UNION ALL
    SELECT l.id, c.depth + 1 FROM _delta_ledger l JOIN chain c ON l.undoes = c.id
  ),
  tips AS (
    SELECT c.id, c.depth FROM chain c
    WHERE NOT EXISTS (SELECT 1 FROM _delta_ledger w WHERE w.undoes = c.id)
  )
  SELECT l.* FROM _delta_ledger l JOIN tips t ON t.id = l.id
  WHERE CASE WHEN p_back THEN t.depth % 2 = 0
        ELSE t.depth % 2 = 1 AND l.undoable
          AND l.id > COALESCE((SELECT MAX(id) FROM _delta_ledger WHERE cursor = p_cursor AND undoes IS NULL AND undoable), 0)
        END
  ORDER BY l.id DESC
  LIMIT 1;
$$ LANGUAGE sql STABLE;`;

let pool: Pool;

beforeAll(async () => {
  pool = await openPglite();
  await applyFramework(pool);
  await applySql(pool, generateSql(schema, docs));
  await pool.query(REFERENCE);
});
afterAll(async () => { await pool.end(); });

/** A seeded run of numbers, so a failure comes back the same. */
function random(seed: number) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}

const cursors = ["c1", "c2", "c3"];

async function tips(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const c of cursors) {
    for (const back of [true, false]) {
      const { rows: [r] } = await pool.query("SELECT (_delta_ledger_tip($1, $2)).id AS now, (_t_tip_reference($1, $2)).id AS was", [c, back]);
      out[`${c} ${back ? "undo" : "redo"}`] = { now: r.now, was: r.was };
    }
  }
  return out;
}

describe("the tip taken is the one the old walk took", () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    test(`a run of 150 steps, seed ${seed}`, async () => {
      await pool.query("TRUNCATE _delta_ledger, _delta_ops_log, _delta_versions, items RESTART IDENTITY CASCADE");
      await pool.query("SELECT setval('seq_items', 1, false)");
      const next = random(seed);
      const pick = <T,>(xs: T[]) => xs[Math.floor(next() * xs.length)]!;
      for (let step = 0; step < 150; step++) {
        const cursor = pick(cursors);
        const ids = (await pool.query("SELECT id FROM current_items ORDER BY id")).rows.map((r) => Number(r.id));
        const roll = next();
        try {
          if (roll < 0.35 || ids.length === 0) {
            await pool.query("SELECT delta_apply_logged('items:', $1, 'who', $2)", [JSON.stringify([{ op: "add", path: "/items/-", value: { name: `s${step}`, n: step } }]), cursor]);
          } else if (roll < 0.6) {
            await pool.query("SELECT delta_apply_logged('items:', $1, 'who', $2)", [JSON.stringify([{ op: "replace", path: `/items/${pick(ids)}/n`, value: step }]), cursor]);
          } else if (roll < 0.64) {   // a fact: written, never undone
            await pool.query("SELECT delta_apply_logged('items:', $1, 'who', $2, FALSE)", [JSON.stringify([{ op: "replace", path: `/items/${pick(ids)}/name`, value: `fact ${step}` }]), cursor]);
          } else if (roll < 0.68) {
            await pool.query("SELECT delta_apply_logged('items:', $1, 'who', $2)", [JSON.stringify([{ op: "remove", path: `/items/${pick(ids)}` }]), cursor]);
          } else if (roll < 0.85) {
            await pool.query("SELECT delta_undo($1, 'who')", [cursor]);
          } else if (roll < 0.95) {
            await pool.query("SELECT delta_redo($1, 'who')", [cursor]);
          } else {
            const mine = (await pool.query("SELECT id FROM _delta_ledger WHERE cursor = $1 ORDER BY id", [cursor])).rows.map((r) => Number(r.id));
            if (mine.length) await pool.query("SELECT delta_walk($1, 'who', $2, FALSE, NULL, $3)", [cursor, next() < 0.5, pick(mine)]);
          }
        } catch {
          // a refusal (a row not there, an entry no change of this cursor's) is a step like any other
        }
        const now = await tips();
        for (const [k, v] of Object.entries(now) as [string, { now: unknown; was: unknown }][]) {
          expect({ seed, step, tip: k, entry: v.now }).toEqual({ seed, step, tip: k, entry: v.was });
        }
      }
      // the run made chains to walk: walks, and walks recorded as changing nothing
      const { rows: [r] } = await pool.query("SELECT count(*) FILTER (WHERE undoes IS NOT NULL) AS walks, count(*) FILTER (WHERE NOT undoable) AS skips FROM _delta_ledger");
      expect(Number(r.walks)).toBeGreaterThan(10);
    }, 120_000);
  }
});

describe("an undo costs what was written since, not the cursor's whole history", () => {
  test("finding the tip of a long history reads a few entries, where the old walk read them all", async () => {
    await pool.query("TRUNCATE _delta_ledger, _delta_ops_log, _delta_versions, items RESTART IDENTITY CASCADE");
    await pool.query("SELECT setval('seq_items', 1, false)");
    await pool.query("SELECT delta_apply_logged('items:', $1, 'who', 'long')", [JSON.stringify([{ op: "add", path: "/items/-", value: { name: "a", n: 0 } }])]);
    for (let i = 0; i < 1500; i++) {   // a long history: a write and its undo, 1,500 times
      await pool.query("SELECT delta_apply_logged('items:', $1, 'who', 'long')", [JSON.stringify([{ op: "replace", path: "/items/1/n", value: i }])]);
      await pool.query("SELECT delta_undo('long', 'who')");
    }
    await pool.query("SELECT delta_apply_logged('items:', $1, 'who', 'long')", [JSON.stringify([{ op: "replace", path: "/items/1/n", value: -1 }])]);
    await pool.query("ANALYZE _delta_ledger");   // statistics, as a database that has run a while has them
    // the ledger's rows one lookup reads, by this transaction's own counters (no stats flush to wait for)
    const reads = async (fn: string, back: boolean) => {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        // the table's rows read, and its indexes' (a plain index scan's fetches are counted on the index, not the table)
        const count = async () => Number((await c.query(
          `SELECT pg_stat_get_xact_tuples_fetched('_delta_ledger'::regclass) + pg_stat_get_xact_tuples_returned('_delta_ledger'::regclass)
                + (SELECT COALESCE(sum(pg_stat_get_xact_tuples_fetched(i.indexrelid)), 0) FROM pg_index i WHERE i.indrelid = '_delta_ledger'::regclass) AS n`)).rows[0].n);
        const before = await count();
        const id = (await c.query(`SELECT (${fn}('long', $1)).id AS id`, [back])).rows[0].id;
        return { id, read: (await count()) - before };
      } finally {
        await c.query("ROLLBACK");
        c.release();
      }
    };
    for (const back of [true, false]) {
      const now = await reads("_delta_ledger_tip", back);
      const was = await reads("_t_tip_reference", back);
      expect({ back, id: now.id }).toEqual({ back, id: was.id });
      expect({ back, few: now.read < 50 }).toEqual({ back, few: true });
      if (back) expect({ back, all: was.read > 1000 }).toEqual({ back, all: true });   // what an undo was: every chain of 1,500, read
    }
  }, 300_000);
});
