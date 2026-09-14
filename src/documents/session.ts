import type { ServerWebSocket } from "bun";
import { db } from "../db";
import type { PatchOp } from "../json-patch";
import { parsePointer } from "../json-pointer";
import { joinRoom, leaveRoom } from "../rooms";
import type { SessionData } from "../session";
import { ensureExists } from "./room";

export type SessionDocument = { name: string | null; room: string | null };

const readStmt = db.query<{ doc: string }, [string]>(`
  SELECT json_object('name', name, 'room', room) AS doc
  FROM sessions
  WHERE id = ? AND revoked_at IS NULL
`);
const upsertNameStmt = db.query<unknown, [string, string, number]>(`
  INSERT INTO sessions (id, name, created_at) VALUES (?1, ?2, ?3)
  ON CONFLICT(id) DO UPDATE SET name = ?2, revoked_at = NULL
`);
// Upserts, unlike a plain UPDATE, so joining a room works even for a session
// that never set a name (a document read/patch shouldn't require a hidden call order).
const joinRoomStmt = db.query<unknown, [string, string, number]>(`
  INSERT INTO sessions (id, room, created_at) VALUES (?1, ?2, ?3)
  ON CONFLICT(id) DO UPDATE SET room = ?2
`);
const clearRoomStmt = db.query<unknown, [string]>("UPDATE sessions SET room = NULL WHERE id = ?");
const revokeStmt = db.query<unknown, [number, string]>(
  "UPDATE sessions SET revoked_at = ?, room = NULL WHERE id = ?",
);

export function read(id: string): SessionDocument {
  const row = readStmt.get(id);
  return row ? JSON.parse(row.doc) : { name: null, room: null };
}

function setRoom(id: string, room: string | null, ws: ServerWebSocket<SessionData> | undefined) {
  const previous = read(id).room;
  if (previous && ws) leaveRoom(previous, ws);

  if (room) {
    ensureExists(room);
    if (ws) joinRoom(room, ws);
    joinRoomStmt.run(id, room, Date.now());
  } else {
    clearRoomStmt.run(id);
  }
}

export function patch(id: string, ops: PatchOp[], ws?: ServerWebSocket<SessionData>): void {
  for (const op of ops) {
    const [field] = parsePointer(op.path);

    if (field === "name" && op.op !== "remove") {
      const name = String(op.value ?? "").trim();
      if (name) upsertNameStmt.run(id, name, Date.now());
    } else if (field === "name" && op.op === "remove") {
      setRoom(id, null, ws);
      revokeStmt.run(Date.now(), id);
    } else if (field === "room" && op.op !== "remove") {
      const room = String(op.value ?? "").trim();
      if (room) setRoom(id, room, ws);
    } else if (field === "room" && op.op === "remove") {
      setRoom(id, null, ws);
    }
  }
}
