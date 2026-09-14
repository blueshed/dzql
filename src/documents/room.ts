import { db } from "../db";
import type { PatchOp } from "../json-patch";
import { parsePointer } from "../json-pointer";

export type ChatMessage = { name: string; text: string; sentAt: number };
export type RoomDocument = { transcript: ChatMessage[] };

const ensureStmt = db.query<unknown, [string, number]>(
  "INSERT INTO rooms (name, created_at) VALUES (?, ?) ON CONFLICT(name) DO NOTHING",
);
const listStmt = db.query<{ name: string }, []>("SELECT name FROM rooms ORDER BY created_at ASC");
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

/** Applies a patch and returns the appended message, if this patch added one. */
export function patch(name: string, ops: PatchOp[]): ChatMessage | undefined {
  let added: ChatMessage | undefined;

  for (const op of ops) {
    const segments = parsePointer(op.path);
    if (op.op !== "add" || segments[0] !== "transcript" || segments[1] !== "-") continue;

    const value = op.value as { name: string; text: string };
    const sentAt = Date.now();
    insertMessageStmt.run(name, value.name, value.text, sentAt);
    added = { name: value.name, text: value.text, sentAt };
  }

  return added;
}
