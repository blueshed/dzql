import { createTables, defineDoc, defineSchema, registerDocs } from "@blueshed/delta/sqlite";
import { createLocal } from "@blueshed/delta/local";
import type { DeltaOp } from "@blueshed/delta/core";
import { db } from "./db";

// A room is a delta document: delta composes it from its tables, validates every write against
// the schema, applies it in one transaction (a savepoint inside eta's own) and says what the
// write's inverse is. eta keeps what it is for: who sees it, what their page looks like, the
// ledger that makes undo.

export const schema = defineSchema({
  rooms: { table: "cd_rooms", columns: {}, temporal: false },
  // delta keys a collection by an id the writer supplies; a time-ordered UUID (v7) makes the key
  // the order too.
  messages: { table: "cd_messages", parent: "rooms", columns: { name: "text", text: "text", sent_at: "integer" }, temporal: false },
});

// Implied: a room is there before anyone has said anything in it.
const roomDoc = defineDoc("room:", { root: "rooms", include: ["messages"], implied: true });

createTables(db, schema);
const local = createLocal();
const { evict } = registerDocs(local.server, db, schema, [roomDoc]);

// delta keeps an opened document in memory for its subscribers, on the understanding that every
// commit sticks. The harness rolls each story back, and who is told is eta's question, not
// delta's: so eta reads through, and evicts after every call.

export type Room = { rooms: { id: string }; messages: Record<string, Message> };
export type Message = { id: string; rooms_id: string; name: string; text: string; sent_at: number };

export function open(name: string): Room {
  const doc = `room:${name}`;
  const { result } = local.call("open", { doc });
  evict(doc);
  return result;
}

/** Applies `ops` to the room and returns what delta applied (whole rows) and its inverse. Throws if delta refuses. */
export function write(name: string, ops: DeltaOp[]): { applied: DeltaOp[]; inverse: DeltaOp[] } {
  const doc = `room:${name}`;
  local.call("open", { doc });
  const answer = local.call("delta", { doc, ops, inverse: true });
  evict(doc);
  if (answer.error) throw new Error(answer.error.message);
  return { applied: answer.result.ops, inverse: answer.result.inverse };
}
