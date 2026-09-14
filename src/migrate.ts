import type { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";

export function migrate(db: Database, dir: string): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);

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

  for (const file of files) {
    if (applied.has(file)) continue;
    db.run(readFileSync(`${dir}/${file}`, "utf8"));
    recordStmt.run(file, Date.now());
  }
}
