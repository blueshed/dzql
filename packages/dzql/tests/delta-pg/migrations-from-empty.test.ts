/**
 * Migrations as a history from empty, on Postgres (delta todo #82): delta's cases
 * (`migrationCases`), on PGlite and on the Postgres server, each case on a database of its own.
 * The changes are made as generateSql makes a table (`tableSql`) and by the helpers that keep
 * delta's scaffolding in step (renameColumn, dropColumn, renameTable).
 */
import { afterAll } from "bun:test";
import { Pool } from "pg";
import { migrationCases } from "@blueshed/delta/testing";
import { migrate } from "../../src/postgres/migrate";
import { tableSql } from "../../src/postgres/codegen";
import { openPglite } from "../../src/postgres/pglite";
import { newPool, PG_URL } from "./setup";

const opened: Pool[] = [];
const admin = await newPool();
let n = 0;
afterAll(async () => {
  for (const p of opened) await p.end();
  for (let i = 1; i <= n; i++) await admin.query(`DROP DATABASE IF EXISTS mig_${process.pid}_${i}`);
  await admin.end();
});

const backend = (open: () => Promise<Pool>) => ({
  open: async () => {
    const pool = await open();
    opened.push(pool);
    return pool;
  },
  migrate: (pool: Pool, list: any[], options?: any) => migrate(pool, list, options),
  columns: async (pool: Pool, table: string) =>
    (await pool.query("SELECT column_name AS c FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 ORDER BY ordinal_position", [table])).rows.map((r) => r.c),
  // a BIGINT as a number, as PGlite gives it and the cases compare it (node-postgres gives a string)
  query: async (pool: Pool, sql: string) => (await pool.query(sql)).rows.map((r) => (typeof r.id === "string" ? { ...r, id: Number(r.id) } : r)),
  makeTables: async (pool: Pool, schema: any) => {
    for (const [key, table] of Object.entries(schema.tables)) await pool.query(tableSql(key, table as any).join("\n"));
  },
  run: async (tx: any, sql: string) => void (await tx.query(sql)),
});

migrationCases("pglite", backend(() => openPglite()));
migrationCases("postgres", backend(async () => {
  const name = `mig_${process.pid}_${++n}`;
  await admin.query(`CREATE DATABASE ${name}`);
  const url = new URL(PG_URL);
  url.pathname = `/${name}`;
  return new Pool({ connectionString: url.href, max: 2 });
}));
