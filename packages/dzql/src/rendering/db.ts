import { Database } from "bun:sqlite";
import { createTables, fromFolder, migrate, migrateSchema, type defineSchema } from "@blueshed/delta/sqlite";

type Schema = ReturnType<typeof defineSchema>;

export const db = new Database(process.env.DB_PATH ?? "db.sqlite");

// WAL: one sync a commit, and readers never wait on a writer (an in-memory database ignores it).
db.exec("PRAGMA journal_mode = WAL");

/**
 * An app's tables, made as delta makes them at start-up: its migrations in `folder` first (what the
 * schema cannot say: a rename, a drop, data moved), then a table the schema has and the database
 * not (`createTables`), then a column (`migrateSchema`). The examples may share a database, and each
 * runs only its own migrations: `app` says whose. Returns whose they are, and the schema, as
 * `migrate` takes them.
 */
export async function openTables(schema: Schema, app: string, folder: string, on: Database = db): Promise<{ app: string; schema: Schema }> {
  const migrating = { app, schema };
  await migrate(on, await fromFolder(folder), migrating);
  createTables(on, schema);
  migrateSchema(on, schema);
  return migrating;
}
