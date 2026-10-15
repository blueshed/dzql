/**
 * Bench schema — a single table owned by a single user, with RLS enabled.
 *
 * Uses `generateSql(schema, docs)` so we stay in sync with whatever the
 * library emits, its compiled reads and checks among it. The only handwritten
 * SQL is the RLS policy (policies are app-level, not framework-level).
 *
 * Every write the bench times runs as an app role (`bench_app`, NOSUPERUSER
 * NOBYPASSRLS), so the policy is evaluated: a superuser bypasses RLS even
 * with FORCE ROW LEVEL SECURITY, and timed so the bench measured nothing
 * about it (todo #25). Set-up runs as the admin the URL names.
 */
import type { Pool } from "pg";
import { applyFramework, defineSchema, defineDoc, generateSql } from "../src/postgres";

export const BENCH_USER_ID = 1;
export const BENCH_DOC_NAME = `bench:${BENCH_USER_ID}`;
export const BENCH_SEED_ROWS = 100;

export const benchSchema = defineSchema({
  bench_items: {
    columns: {
      owner_id: "integer",
      name: "text",
      value: "integer",
    },
    temporal: false,
  },
});

export const benchDocs = [
  defineDoc("bench:", {
    root: "bench_items",
    include: [],
    scope: { owner_id: ":id" },
  }),
];

/** The role every timed write runs as: RLS holds it. */
export const APP_ROLE = "bench_app";

/**
 * Apply table + framework metadata + RLS policy, as the admin. Idempotent.
 * `compiled`: the document's reads and checks compiled (generateSql's); else
 * the framework's, as the framework SQL applied again leaves them.
 */
export async function applyBenchSchema(admin: Pool, { compiled }: { compiled: boolean }): Promise<void> {
  await admin.query(generateSql(benchSchema, benchDocs));
  if (!compiled) await applyFramework(admin);   // its _delta_doc_holds and _delta_row_in_scope: the framework's again
  // NULLIF: a pooled connection reads a transaction-local app.user_id as '' once that transaction is done
  await admin.query(`
    ALTER TABLE bench_items ENABLE ROW LEVEL SECURITY;
    ALTER TABLE bench_items FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS bench_items_owner ON bench_items;
    CREATE POLICY bench_items_owner ON bench_items
      FOR ALL
      USING      (owner_id = NULLIF(current_setting('app.user_id', true), '')::int)
      WITH CHECK (owner_id = NULLIF(current_setting('app.user_id', true), '')::int);
  `);
  await grantApp(admin);   // the table and its functions are new: the app role may use them (not bypass RLS)
}

/** Make the app role, if it is not there, and let it use the tables, sequences and functions there (not bypass RLS). */
export async function ensureAppRole(admin: Pool): Promise<void> {
  const { rows } = await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [APP_ROLE]);
  if (!rows.length) await admin.query(`CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_ROLE}' NOSUPERUSER NOBYPASSRLS`);
  await grantApp(admin);
}

async function grantApp(admin: Pool): Promise<void> {
  await admin.query(`
    GRANT USAGE ON SCHEMA public TO ${APP_ROLE};
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE};
    GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE};
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${APP_ROLE};
  `);
}

/** The admin's URL with the app role signed in. */
export function appUrl(adminUrl: string): string {
  const url = new URL(adminUrl);
  url.username = APP_ROLE;
  url.password = APP_ROLE;
  return url.toString();
}

/** Refuse to time anything as a role RLS does not hold: the numbers would be about nothing. */
export async function assertHeldByRls(app: Pool): Promise<void> {
  const { rows: [r] } = await app.query("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user");
  if (r.rolsuper || r.rolbypassrls) throw new Error("the bench's writes would bypass RLS: run them as a NOSUPERUSER NOBYPASSRLS role");
}

/**
 * Wipe and re-seed the bench table, returning seeded row ids.
 * Bypass RLS by using `set_config` in a transaction.
 */
export async function seedBenchRows(pool: Pool): Promise<number[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [String(BENCH_USER_ID)]);
    await client.query("TRUNCATE bench_items RESTART IDENTITY CASCADE");
    // seq_bench_items isn't owned by the table, so TRUNCATE doesn't touch it.
    await client.query("ALTER SEQUENCE seq_bench_items RESTART WITH 1");
    const ids: number[] = [];
    for (let i = 0; i < BENCH_SEED_ROWS; i++) {
      const { rows } = await client.query(
        "INSERT INTO bench_items (id, owner_id, name, value) VALUES (nextval('seq_bench_items'), $1, $2, $3) RETURNING id",
        [BENCH_USER_ID, `row-${i}`, 0],
      );
      ids.push(Number(rows[0].id));
    }
    await client.query("COMMIT");
    return ids;
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* no-op */ }
    throw e;
  } finally {
    client.release();
  }
}
