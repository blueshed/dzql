import { db } from "../db";
import type { PatchOp } from "../../../src/json-patch";
import { parsePointer } from "../../../src/json-pointer";
import { prefixDoc, record } from "../../../src/ledger";
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

export type SessionPatchResult = { version: number; applied: PatchOp[] };

// A `replace` inverse can't restore "no value" (patch() treats a blank/null
// value as invalid and ignores it) -- restoring a field that was previously
// unset must be expressed as `remove`, or undo of a session's very first
// name-set or room-join would silently do nothing.
function restoreOp(path: string, value: string | null): PatchOp {
  return value !== null ? { op: "replace", path, value } : { op: "remove", path };
}

export function patch(id: string, ops: PatchOp[], undoes?: number): SessionPatchResult {
  const applied: PatchOp[] = [];
  const inverse: PatchOp[] = [];

  for (const op of ops) {
    const [field] = parsePointer(op.path);
    const before = read(id);

    if (field === "name" && op.op !== "remove") {
      const name = String(op.value ?? "").trim();
      if (!name) continue;
      upsertNameStmt.run(id, name, Date.now());
      applied.push(op);
      inverse.unshift(restoreOp("/name", before.name));
    } else if (field === "name" && op.op === "remove") {
      // Logout clears both name and room in one statement (see revokeStmt),
      // so its inverse must restore both, or undo would leave the session
      // named but orphaned from the room it was in.
      revokeStmt.run(Date.now(), id);
      applied.push(op);
      if (before.room !== null) {
        inverse.unshift(restoreOp("/room", before.room));
      }
      inverse.unshift(restoreOp("/name", before.name));
    } else if (field === "room" && op.op !== "remove") {
      const room = String(op.value ?? "").trim();
      if (!room) continue;
      ensureExists(room);
      joinRoomStmt.run(id, room, Date.now());
      applied.push(op);
      inverse.unshift(restoreOp("/room", before.room));
    } else if (field === "room" && op.op === "remove") {
      clearRoomStmt.run(id);
      applied.push(op);
      inverse.unshift(restoreOp("/room", before.room));
    }
  }

  const version = record(prefixDoc("session", id), applied, inverse, id, undoes);
  return { version, applied };
}
