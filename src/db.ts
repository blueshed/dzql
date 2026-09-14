import { Database } from "bun:sqlite";

const db = new Database(process.env.DB_PATH ?? "db.sqlite");

db.run(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    revoked_at INTEGER
  )
`);

const selectStmt = db.query<{ name: string }, [string]>(
  "SELECT name FROM sessions WHERE id = ? AND revoked_at IS NULL",
);
const upsertStmt = db.query<unknown, [string, string, number]>(`
  INSERT INTO sessions (id, name, created_at) VALUES (?1, ?2, ?3)
  ON CONFLICT(id) DO UPDATE SET name = ?2, revoked_at = NULL
`);
const revokeStmt = db.query<unknown, [number, string]>("UPDATE sessions SET revoked_at = ? WHERE id = ?");

export function getSessionName(id: string): string | null {
  return selectStmt.get(id)?.name ?? null;
}

export function setSessionName(id: string, name: string): void {
  upsertStmt.run(id, name, Date.now());
}

export function clearSession(id: string): void {
  revokeStmt.run(Date.now(), id);
}
