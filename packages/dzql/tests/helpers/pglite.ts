// One PGlite for the whole test process: booting one costs about 2.4 s, and every compile test file
// wants one. `sharedPglite()` hands each file the same database with its `public` schema dropped
// and made again, so nothing of the file before it is left; the pool's `end()` keeps it open for
// the next file (it closes as the process ends).
import type { Pool } from "pg";
import type { PGlite } from "@electric-sql/pglite";
import { openPglite, pglitePool } from "../../src/postgres/pglite";

const KEY = Symbol.for("dzql.tests.pglite");
const g = globalThis as unknown as Record<symbol, Promise<Pool> | undefined>;

export async function sharedPglite(): Promise<Pool> {
  const pool = await (g[KEY] ??= openPglite());
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT USAGE ON SCHEMA public TO PUBLIC;"); // as a new database has it
  return new Proxy(pool, { get: (target, name) => (name === "end" ? async () => {} : Reflect.get(target, name, target)) }) as Pool;
}

/**
 * The same PGlite as `role` (row-level security's tests, todo #19): every query and transaction is
 * run under `SET LOCAL ROLE`, so a role made NOSUPERUSER NOBYPASSRLS is held by the tables' policies,
 * while a pool on `db` itself stays the superuser that applies the SQL and seeds the rows.
 */
export function pgliteAs(db: PGlite, role: string): Pool {
  const as = `SET LOCAL ROLE ${role}`;
  return pglitePool({
    query: (text: string, params?: unknown[]) => db.transaction(async (tx) => { await tx.query(as); return tx.query(text, params); }),
    exec: (text: string) => db.transaction(async (tx) => { await tx.query(as); return tx.exec(text); }),
    transaction: <T>(fn: (tx: any) => Promise<T>) => db.transaction(async (tx) => { await tx.query(as); return fn(tx); }),
    listen: (channel: string, callback: (payload: string) => void) => db.listen(channel, callback),
    close: async () => {},
  });
}

/**
 * Waits until what a write set going has been heard: NOTIFY is heard after the commit and fetched
 * then, by queries queued behind it on the one PGlite, so a few round trips through it, and a turn
 * after each, that bring nothing more to `heard` are the quiet. Not a fixed beat.
 */
export async function quietOn(pool: Pool, heard: { length: number }): Promise<void> {
  let seen = -1;
  while (seen !== heard.length) {
    seen = heard.length;
    for (let i = 0; i < 3; i++) {
      await pool.query("SELECT 1");
      await new Promise((r) => setTimeout(r, 0));
    }
  }
}
