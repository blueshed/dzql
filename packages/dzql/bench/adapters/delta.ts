/**
 * delta's write: one round trip, `delta_apply_as(user, doc, ops)` setting the
 * caller for RLS and applying in one call. `compiled`: the document's reads
 * and checks compiled from its definition (generateSql's); else the
 * framework's, which read the definitions at run time.
 */
import { Pool } from "pg";
import type { Adapter } from "../adapter";
import { applyBenchSchema, assertHeldByRls, seedBenchRows, BENCH_DOC_NAME, BENCH_USER_ID } from "../schema";

export function deltaAdapter(adminUrl: string, appUrl: string, compiled: boolean): Adapter {
  const admin = new Pool({ connectionString: adminUrl, max: 1 });
  const app = new Pool({ connectionString: appUrl, max: 4 });
  return {
    name: compiled ? "delta, compiled" : "delta, framework",
    rtt: 1,
    async setup() {
      await applyBenchSchema(admin, { compiled });
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
