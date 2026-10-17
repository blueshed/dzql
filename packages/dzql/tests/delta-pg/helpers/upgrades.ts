/**
 * PGlite as delta's upgrade cases ask it (`UpgradeBackend`, for `schemaContractCases` and
 * `upgradeCases` from `@blueshed/delta/testing`): a Postgres in process each `open`, a version's
 * tables made as dzql's start-up makes them (`applyFramework`, then `generateSql`), and an app
 * served over it with the ledger. delta asks the same cases of SQLite.
 */
import type { Pool, PoolClient } from "pg";
import type { UpgradeBackend } from "@blueshed/delta/testing";
import type { DocDef, Schema } from "@blueshed/delta/backend";
import { createLocal } from "@blueshed/delta/local";
import * as pg from "../../../src/postgres";
import { openPglite } from "../../../src/postgres/pglite";

const pools: Pool[] = [];
const listeners: { destroy(): Promise<void> }[] = [];
/** The listeners and pools `pgliteUpgrades` opened, closed: call it from an `afterAll`. */
export const endUpgrades = async () => {
  for (const l of listeners.splice(0)) await l.destroy();
  for (const p of pools.splice(0)) await p.end();
};

const open = async () => { const pool = await openPglite(); pools.push(pool); return pool; };
const makeTables = async (pool: Pool, schema: Schema, docs: DocDef[] = []) => {
  await pg.applyFramework(pool);
  await pg.applySql(pool, pg.generateSql(schema, docs));
};
const serve = async (pool: Pool, schema: Schema, docs: DocDef[]) => {
  const local = createLocal();
  listeners.push(await pg.createDocListener(local.server, pool, { types: docs.map((d) => pg.docTypeFromDef(d, pool)), ledger: true, schema }));
  return local;
};

export const pgliteUpgrades: UpgradeBackend<Pool> = {
  open,
  migrate: (pool, list, options) => pg.migrate(pool, list, options),
  status: (pool, list, options) => pg.migrationStatus(pool, list, options),
  makeTables,
  run: async (tx, sql) => void (await (tx as PoolClient).query(sql)),
  query: async (pool, sql) => (await pool.query(sql)).rows,
  columns: async (pool, table) =>
    (await pool.query("SELECT column_name AS c FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 ORDER BY ordinal_position", [table])).rows.map((r) => r.c),
  columnTypes: async (pool, table) =>
    (await pool.query("SELECT column_name || ':' || data_type AS c FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1", [table])).rows.map((r) => String(r.c).toLowerCase()).toSorted(),
  views: async (pool) =>
    (await pool.query("SELECT table_name AS v FROM information_schema.views WHERE table_schema = current_schema() ORDER BY 1")).rows.map((r) => r.v),
  serve,
  // on Postgres an app has a database of its own: one generateSql per database
  async beside(_pool, schema, docs) {
    const own = await open();
    await makeTables(own, schema, docs);
    return serve(own, schema, docs);
  },
  tools: {
    renameColumn: (tx, table, from, to) => pg.renameColumn(tx as PoolClient, table, from, to),
    dropColumn: (tx, table, column) => pg.dropColumn(tx as PoolClient, table, column),
    renameTable: (tx, from, to) => pg.renameTable(tx as PoolClient, from, to),
  },
};
