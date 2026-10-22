/**
 * dzql/postgres — delta's Postgres backend, compiled from its definitions.
 *
 * Schema + stored functions + LISTEN dispatch. Tables are generated from
 * a TypeScript schema definition; all mutations go through stored functions
 * that apply JSON-Patch ops and emit NOTIFY events. The doc-listener fans
 * those events out to WebSocket subscribers.
 *
 *   import { applyFramework, registerDocs } from "dzql/postgres";
 *
 *   await applyFramework(pool);
 *   await registerDocs(ws, pool, schema, docs, customDocs, { auth, ledger: true });
 *
 * `registerDocs` takes what delta's SQLite `registerDocs` takes; `openStore`
 * does the whole start (migrations, then the framework and documents together,
 * `applyCompiled`, only when they changed) for an app. The
 * stored functions are `src/sql/001*.sql`: `applyFramework(pool)` applies
 * them, or `bunx dzql init <dir>` copies them for a migration tool
 * (plain idempotent SQL; order is alphabetical).
 */

export {
  defineSchema,
  defineDoc,
  pruneOpsLog,
  validateOps,
} from "./schema";
export type {
  ColumnDef,
  TableDef,
  Schema,
  ResolvedTable,
  DocDef,
  ValidationError,
} from "./schema";

export { generateSql } from "./codegen";

export { exportTables, importTables } from "./carry";
export type { Snapshot } from "@blueshed/delta/backend";
export type { GenerateSqlOptions } from "./codegen";

export {
  applyCompiled,
  applyFramework,
  applySql,
  frameworkSqlFiles,
} from "./bootstrap";
export type { ApplyCompiledOptions, ApplyCompiledResult, CompiledSet } from "./bootstrap";

export { migrate, migrationStatus, renameColumn, dropColumn, renameTable, fromFolder } from "./migrate";
export type { Migration, MigrateOptions, MigrateResult, MigrationStatus } from "./migrate";

export { registerDocs } from "./register";
export type { RegisterOptions } from "./register";
export { createDocListener, defineCustomDoc } from "./listener";
export { storyStore } from "./story-store";
export { openStore } from "./app-store";
export type { AppStore, History, Registration, StoreOptions } from "./app-store";
export type { CustomDocDef } from "./listener";

export { docTypeFromDef } from "./registry";
export type { DocType, Writer } from "./registry";

export { withAppAuth } from "./auth";
// what the server reads past the documents' paths, as the tables' owner: who is signed in, a custom document's rows
export { asOwner } from "./sql";
