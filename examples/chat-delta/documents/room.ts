import { db } from "../db";
import { reading } from "../../../src/reading";
import type { PatchOp } from "../../../src/json-patch";
import { prefixDoc, record } from "../../../src/ledger";
import * as delta from "../delta";
import type { Message } from "../delta";

export type { Message };

// A room is a delta document (delta.ts). What is left here is eta's: the list of rooms, which is
// not a document of delta's (a room is there while someone is in it, and people are eta's
// sessions), and the ledger entry every write makes, from the inverse delta hands back.
const listStmt = db.query<{ name: string }, []>(
  "SELECT rooms_id AS name FROM cd_messages UNION SELECT room FROM cd_sessions WHERE room IS NOT NULL AND revoked_at IS NULL ORDER BY 1",
);

export function list(): string[] {
  return listStmt.all().map((row) => row.name);
}

/** The room's conversation, oldest first: its ids are time-ordered, so the key is the order. */
export function read(name: string, limit = 50): Message[] {
  reading("room", name);
  const messages = Object.values(delta.open(name).messages);
  messages.sort((a, b) => (a.id < b.id ? -1 : 1));
  return messages.slice(-limit);
}

export type RoomPatchResult = { version: number; applied: PatchOp[] };

/** One transaction: delta's write (a savepoint inside it), the ledger row, and the version it returns commit together or not at all. */
export const patch = db.transaction(function patch(name: string, ops: PatchOp[], sessionId: string, undoes?: number): RoomPatchResult {
  const { applied, inverse } = delta.write(name, ops);
  const version = record(prefixDoc("room", name), applied, inverse, sessionId, undoes);
  return { version, applied };
});
