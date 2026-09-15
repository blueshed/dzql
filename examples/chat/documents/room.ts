import { db } from "../db";
import type { PatchOp } from "../../../src/json-patch";
import { parsePointer } from "../../../src/json-pointer";
import { prefixDoc, record } from "../../../src/ledger";

export type ChatMessage = { id: number; name: string; text: string; sentAt: number };
export type RoomDocument = { transcript: ChatMessage[] };

const ensureStmt = db.query<unknown, [string, number]>(
  "INSERT INTO rooms (name, created_at) VALUES (?, ?) ON CONFLICT(name) DO NOTHING",
);
const listStmt = db.query<{ name: string }, []>("SELECT name FROM rooms ORDER BY created_at ASC");
const countStmt = db.query<{ count: number }, [string]>("SELECT COUNT(*) AS count FROM messages WHERE room = ?");
const transcriptStmt = db.query<{ doc: string }, [string, number]>(`
  SELECT json_group_array(json_object('id', id, 'name', name, 'text', text, 'sentAt', sent_at)) AS doc
  FROM (SELECT id, name, text, sent_at FROM messages WHERE room = ? ORDER BY id DESC LIMIT ?)
`);
const insertMessageStmt = db.query<unknown, [string, string, string, number]>(
  "INSERT INTO messages (room, name, text, sent_at) VALUES (?, ?, ?, ?)",
);
// A redo's value is a remove's own inverse, carrying the message's original id and sentAt back
// (see below) -- inserted with that id rather than a fresh one, so it is the same message, not a
// new one under the old text. Only a replay can send a value shaped this way: the room
// compartment's write() maps every wire value to {name, text} (see compartments/room.ts).
const insertMessageWithIdStmt = db.query<unknown, [number, string, string, string, number]>(
  "INSERT INTO messages (id, room, name, text, sent_at) VALUES (?, ?, ?, ?, ?)",
);
const messageAtIndexStmt = db.query<{ id: number; name: string; text: string; sentAt: number }, [string, number]>(`
  SELECT id, name, text, sent_at AS sentAt FROM messages WHERE room = ? ORDER BY id ASC LIMIT 1 OFFSET ?
`);
const deleteMessageStmt = db.query<unknown, [number]>("DELETE FROM messages WHERE id = ?");

export function ensureExists(name: string): void {
  ensureStmt.run(name, Date.now());
}

export function list(): string[] {
  return listStmt.all().map((row) => row.name);
}

export function read(name: string, limit = 50): RoomDocument {
  const row = transcriptStmt.get(name, limit);
  const transcript: ChatMessage[] = row ? JSON.parse(row.doc).reverse() : [];
  return { transcript };
}

export type RoomPatchResult = { version: number; applied: PatchOp[]; added?: ChatMessage; removed?: ChatMessage };

/** Applies a patch, returning the new version, the ops that actually took effect, and the appended (or, via undo, removed) message if any. One transaction: every statement here, the ledger row, and the version it returns commit together or not at all. */
export const patch = db.transaction(function patch(name: string, ops: PatchOp[], sessionId: string, undoes?: number): RoomPatchResult {
  let added: ChatMessage | undefined;
  let removed: ChatMessage | undefined;
  const applied: PatchOp[] = [];
  const inverse: PatchOp[] = [];

  for (const op of ops) {
    const segments = parsePointer(op.path);
    if (segments[0] !== "transcript") continue;

    if (op.op === "add" && segments[1] === "-") {
      const value = op.value as { id?: number; name: string; text: string; sentAt?: number };
      const text = String(value.text ?? "").trim();
      if (!text) continue;
      // The index the new message lands at in the full (unpaginated) history,
      // not read()'s limited view, so the inverse stays correct regardless of limit.
      // This index is only stable as long as nothing before it has been removed
      // since — undo (walking a session's own writes newest-first) relies on that.
      const index = countStmt.get(name)?.count ?? 0;
      const sentAt = value.sentAt ?? Date.now();
      let id: number;
      if (value.id !== undefined) {
        insertMessageWithIdStmt.run(value.id, name, value.name, text, sentAt);
        id = value.id;
      } else {
        id = Number(insertMessageStmt.run(name, value.name, text, sentAt).lastInsertRowid);
      }
      added = { id, name: value.name, text, sentAt };

      applied.push(op);
      inverse.unshift({ op: "remove", path: `/transcript/${index}` });
    } else if (op.op === "remove" && segments[1] !== undefined) {
      // Only reachable via undo (the room compartment's own permit() never allows
      // a "remove" write from the wire): walks back a specific add by index.
      const index = Number(segments[1]);
      if (!Number.isInteger(index) || index < 0) continue;
      const message = messageAtIndexStmt.get(name, index);
      if (!message) continue;
      deleteMessageStmt.run(message.id);
      removed = message;

      applied.push(op);
      // Re-adding lands at the end of the transcript, not back at its original position -- fine
      // for undo. The value carries the message's own id and sentAt, not just name and text, so
      // a redo of this (this inverse's own inverse) brings back the same message, not a new one.
      inverse.unshift({ op: "add", path: "/transcript/-", value: { id: message.id, name: message.name, text: message.text, sentAt: message.sentAt } });
    }
  }

  const version = record(prefixDoc("room", name), applied, inverse, sessionId, undoes);
  return { version, applied, added, removed };
});
