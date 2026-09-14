import { db } from "../db";
import type { PatchOp } from "../json-patch";
import { parsePointer } from "../json-pointer";
import { record } from "../ledger";

export type ChatMessage = { name: string; text: string; sentAt: number };
export type RoomDocument = { transcript: ChatMessage[] };

const ensureStmt = db.query<unknown, [string, number]>(
  "INSERT INTO rooms (name, created_at) VALUES (?, ?) ON CONFLICT(name) DO NOTHING",
);
const listStmt = db.query<{ name: string }, []>("SELECT name FROM rooms ORDER BY created_at ASC");
const countStmt = db.query<{ count: number }, [string]>("SELECT COUNT(*) AS count FROM messages WHERE room = ?");
const transcriptStmt = db.query<{ doc: string }, [string, number]>(`
  SELECT json_group_array(json_object('name', name, 'text', text, 'sentAt', sent_at)) AS doc
  FROM (SELECT name, text, sent_at FROM messages WHERE room = ? ORDER BY id DESC LIMIT ?)
`);
const insertMessageStmt = db.query<unknown, [string, string, string, number]>(
  "INSERT INTO messages (room, name, text, sent_at) VALUES (?, ?, ?, ?)",
);

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

export type RoomPatchResult = { version: number; applied: PatchOp[]; added?: ChatMessage };

/** Applies a patch, returning the new version, the ops that actually took effect, and the appended message if any. */
export function patch(name: string, ops: PatchOp[], sessionId: string): RoomPatchResult {
  let added: ChatMessage | undefined;
  const applied: PatchOp[] = [];
  const inverse: PatchOp[] = [];

  for (const op of ops) {
    const segments = parsePointer(op.path);
    if (op.op !== "add" || segments[0] !== "transcript" || segments[1] !== "-") continue;

    const value = op.value as { name: string; text: string };
    // The index the new message lands at in the full (unpaginated) history,
    // not read()'s limited view, so the inverse stays correct regardless of limit.
    // This index is only stable as long as nothing before it has been removed
    // since — undo (walking a session's own writes newest-first) relies on that.
    const index = countStmt.get(name)?.count ?? 0;
    const sentAt = Date.now();
    insertMessageStmt.run(name, value.name, value.text, sentAt);
    added = { name: value.name, text: value.text, sentAt };

    applied.push(op);
    inverse.unshift({ op: "remove", path: `/transcript/${index}` });
  }

  const version = record(`room:${name}`, applied, inverse, sessionId);
  return { version, applied, added };
}
