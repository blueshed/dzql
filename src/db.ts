import { Database } from "bun:sqlite";

const db = new Database(process.env.DB_PATH ?? "db.sqlite");

db.run(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    room TEXT,
    created_at INTEGER NOT NULL,
    revoked_at INTEGER
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS rooms (
    name TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room TEXT NOT NULL,
    name TEXT NOT NULL,
    text TEXT NOT NULL,
    sent_at INTEGER NOT NULL
  )
`);

const selectNameStmt = db.query<{ name: string }, [string]>(
  "SELECT name FROM sessions WHERE id = ? AND revoked_at IS NULL",
);
const selectRoomStmt = db.query<{ room: string | null }, [string]>(
  "SELECT room FROM sessions WHERE id = ? AND revoked_at IS NULL",
);
const upsertSessionStmt = db.query<unknown, [string, string, number]>(`
  INSERT INTO sessions (id, name, created_at) VALUES (?1, ?2, ?3)
  ON CONFLICT(id) DO UPDATE SET name = ?2, revoked_at = NULL
`);
const setRoomStmt = db.query<unknown, [string | null, string]>("UPDATE sessions SET room = ? WHERE id = ?");
const revokeStmt = db.query<unknown, [number, string]>(
  "UPDATE sessions SET revoked_at = ?, room = NULL WHERE id = ?",
);

const ensureRoomStmt = db.query<unknown, [string, number]>(
  "INSERT INTO rooms (name, created_at) VALUES (?, ?) ON CONFLICT(name) DO NOTHING",
);
const listRoomsStmt = db.query<{ name: string }, []>("SELECT name FROM rooms ORDER BY created_at ASC");

const insertMessageStmt = db.query<unknown, [string, string, string, number]>(
  "INSERT INTO messages (room, name, text, sent_at) VALUES (?, ?, ?, ?)",
);
const selectMessagesStmt = db.query<{ name: string; text: string; sentAt: number }, [string, number]>(
  "SELECT name, text, sent_at as sentAt FROM messages WHERE room = ? ORDER BY id DESC LIMIT ?",
);

export function getSessionName(id: string): string | null {
  return selectNameStmt.get(id)?.name ?? null;
}

export function setSessionName(id: string, name: string): void {
  upsertSessionStmt.run(id, name, Date.now());
}

export function getSessionRoom(id: string): string | null {
  return selectRoomStmt.get(id)?.room ?? null;
}

export function setSessionRoom(id: string, room: string): void {
  setRoomStmt.run(room, id);
}

export function leaveCurrentRoom(id: string): void {
  setRoomStmt.run(null, id);
}

export function clearSession(id: string): void {
  revokeStmt.run(Date.now(), id);
}

export function ensureRoom(name: string): void {
  ensureRoomStmt.run(name, Date.now());
}

export function listRooms(): string[] {
  return listRoomsStmt.all().map((row) => row.name);
}

export type ChatMessage = { name: string; text: string; sentAt: number };

export function addMessage(room: string, name: string, text: string): ChatMessage {
  const sentAt = Date.now();
  insertMessageStmt.run(room, name, text, sentAt);
  return { name, text, sentAt };
}

export function getMessages(room: string, limit = 50): ChatMessage[] {
  return selectMessagesStmt.all(room, limit).reverse();
}
