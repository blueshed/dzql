/**
 * raw-postgres — direct UPDATE against the same table, baseline RTT.
 *
 * Uses a single statement that sets app.user_id AND updates in one go via
 * a CTE, so the RLS `WITH CHECK` passes without a separate transaction.
 * This is the cheapest possible identity-scoped write — the comparison
 * target that delta-new should approach.
 *
 *   WITH _ AS (SELECT set_config('app.user_id', $3, true))
 *   UPDATE bench_items SET value = $1 WHERE id = $2;
 */
import { Pool } from "pg";
import type { Adapter } from "../adapter";
import { applyBenchSchema, assertHeldByRls, seedBenchRows, BENCH_USER_ID } from "../schema";

export function rawPostgresAdapter(adminUrl: string, appUrl: string): Adapter {
  const admin = new Pool({ connectionString: adminUrl, max: 1 });
  const app = new Pool({ connectionString: appUrl, max: 4 });
  return {
    name: "raw-postgres",
    rtt: 1,
    async setup() {
      await applyBenchSchema(admin, { compiled: true });
      await seedBenchRows(admin);
      await assertHeldByRls(app);
    },
    async writeOp(rowId, newValue) {
      await app.query(
        `WITH _ AS (SELECT set_config('app.user_id', $3, true))
         UPDATE bench_items SET value = $1 WHERE id = $2`,
        [newValue, rowId, String(BENCH_USER_ID)],
      );
    },
    async teardown() {
      await app.end();
      await admin.end();
    },
  };
}
