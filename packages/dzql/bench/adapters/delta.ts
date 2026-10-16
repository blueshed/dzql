/**
 * delta's write: one round trip, `delta_apply_as(user, doc, ops)` setting the
 * caller for RLS and applying in one call, its document compiled from its
 * definition (generateSql's).
 */
import { Pool } from "pg";
import type { Adapter } from "../adapter";
import { applyBenchSchema, assertHeldByRls, seedBenchRows, BENCH_DOC_NAME, BENCH_USER_ID } from "../schema";

export function deltaAdapter(adminUrl: string, appUrl: string): Adapter {
  const admin = new Pool({ connectionString: adminUrl, max: 1 });
  const app = new Pool({ connectionString: appUrl, max: 4 });
  return {
    name: "delta",
    rtt: 1,
    async setup() {
      await applyBenchSchema(admin);
      await seedBenchRows(admin);
      await assertHeldByRls(app);
    },
    async writeOp(rowId, newValue) {
      const ops = [{ op: "replace", path: `/bench_items/${rowId}/value`, value: newValue }];
      await app.query("SELECT delta_apply_as($1, $2, $3) AS result", [String(BENCH_USER_ID), BENCH_DOC_NAME, JSON.stringify(ops)]);
    },
    async teardown() {
      await app.end();
      await admin.end();
    },
  };
}
