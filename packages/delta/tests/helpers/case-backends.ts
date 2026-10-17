/**
 * delta's backends as `CaseBackend`s, for the cases in `src/cases/writes.ts`:
 * each stands an app up on a fresh store of its own. (dzql stands up Postgres.)
 * And SQLite as an `UpgradeBackend`, for `schemaContractCases` and `upgradeCases`.
 */
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CaseBackend, UpgradeBackend } from "@blueshed/delta/testing";
import { createLocal } from "../../src/server/local";
import { createWs } from "../../src/server/server";
import * as sqlite from "../../src/server/sqlite";
import * as json from "../../src/server/json";

export const onSqlite: CaseBackend = async ({ schema, docs, seed }) => {
  const db = new Database(":memory:");
  sqlite.createTables(db, schema);
  sqlite.importTables(db, schema, seed);
  const ws = createWs();
  ws.setServer({ publish() {} });
  sqlite.registerDocs(ws, db, schema, docs);
  return { ws, end: async () => db.close() };
};

export const onJson: CaseBackend = async ({ schema, docs, seed }) => {
  const dir = mkdtempSync(join(tmpdir(), "delta-cases-"));
  const file = join(dir, "data.json");
  json.importTables(file, schema, seed);
  const ws = createWs();
  ws.setServer({ publish() {} });
  const store = json.registerDocs(ws, file, schema, docs);
  return { ws, end: async () => { await store.persisted(); rmSync(dir, { recursive: true, force: true }); } };
};

const upgradeDirs: string[] = [];
/** The temp folders `sqliteUpgrades` made, removed: call it from an `afterAll`. */
export const removeUpgradeDirs = () => { for (const d of upgradeDirs.splice(0)) rmSync(d, { recursive: true, force: true }); };

/**
 * SQLite as the upgrade cases ask it: a file each `open`, and a new handle on it each time, as each
 * version of an app (and `delta migrate`) is a process of its own.
 */
export const sqliteUpgrades: UpgradeBackend<string> = {
  async open() { const d = mkdtempSync(join(tmpdir(), "delta-upgrade-")); upgradeDirs.push(d); return join(d, "app.db"); },
  migrate: (file, list, options) => sqlite.migrate(new Database(file), list as sqlite.Migration<Database>[], options),
  status: async (file, list, options) => sqlite.migrationStatus(new Database(file), list as sqlite.Migration<Database>[], options),
  async makeTables(file, schema) { const db = new Database(file); sqlite.createTables(db, schema); sqlite.migrateSchema(db, schema); },
  run: async (tx, sql) => void (tx as Database).run(sql),
  query: async (file, sql) => new Database(file).query(sql).all() as Record<string, unknown>[],
  columns: async (file, table) => (new Database(file).query(`PRAGMA table_info(${table})`).all() as any[]).map((c) => c.name),
  columnTypes: async (file, table) => (new Database(file).query(`PRAGMA table_info(${table})`).all() as any[]).map((c) => `${c.name}:${String(c.type).toLowerCase()}`).toSorted(),
  views: async (file) => (new Database(file).query("SELECT name FROM sqlite_master WHERE type = 'view' ORDER BY name").all() as any[]).map((v) => v.name),
  async serve(file, schema, docs) {
    const local = createLocal();
    sqlite.registerDocs(local.server, new Database(file), schema, docs, [], { ledger: true });
    return local;
  },
  async beside(file, schema, docs) {
    const db = new Database(file);
    sqlite.createTables(db, schema);
    const local = createLocal();
    sqlite.registerDocs(local.server, db, schema, docs, [], { ledger: true });
    return local;
  },
  tools: {
    renameColumn: (tx, table, from, to) => sqlite.renameColumn(tx as Database, table, from, to),
    dropColumn: (tx, table, column) => sqlite.dropColumn(tx as Database, table, column),
    renameTable: (tx, from, to) => sqlite.renameTable(tx as Database, from, to),
  },
};
