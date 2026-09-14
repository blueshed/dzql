import type { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";

/**
 * Applies every `*.sql` file in `dir` that hasn't run yet, recording each as
 * `${namespace}/${file}` in the shared `_migrations` table -- so the kernel's
 * own migrations and an example's can't collide on filename (both might have
 * a `0001_*.sql`). Kernel callers pass `"eta"`; an example passes its own
 * `name`.
 *
 * `legacy` maps record names from before namespacing (or before a rename) to
 * the file they now are, e.g. `{ "0002_sessions.sql": "0001_sessions.sql" }`:
 * a database that already ran the old file is adopted as having run the new
 * one, instead of failing on a second CREATE TABLE. Idempotent, so it's safe
 * to leave in place.
 */
export function migrate(db: Database, dir: string, namespace: string, legacy: Record<string, string> = {}): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);

  const adoptStmt = db.query<unknown, [string, string]>("UPDATE _migrations SET name = ? WHERE name = ?");
  for (const [old, file] of Object.entries(legacy)) adoptStmt.run(`${namespace}/${file}`, old);

  const applied = new Set(
    db
      .query<{ name: string }, []>("SELECT name FROM _migrations")
      .all()
      .map((row) => row.name),
  );
  const recordStmt = db.query<unknown, [string, number]>("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)");

  const files = readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  const applyFile = db.transaction((file: string) => {
    db.run(readFileSync(`${dir}/${file}`, "utf8"));
    recordStmt.run(`${namespace}/${file}`, Date.now());
  });

  for (const file of files) {
    if (applied.has(`${namespace}/${file}`)) continue;
    // A migration file's statements and its _migrations row commit together:
    // a failure partway through (bad SQL, disk error) rolls back cleanly
    // instead of leaving the schema half-applied with nothing recorded.
    applyFile(file);
  }
}
