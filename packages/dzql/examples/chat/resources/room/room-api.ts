import { defineDoc } from "@blueshed/delta/sqlite";
import { read as readDoc } from "dzql/rendering/documents";
import { register } from "../../store";

// A room's conversation, as a page reads it: its messages, named by the room (`room:<name>`), on
// the ledger. It is there before its first message, as a name is.
register([defineDoc("room:", { root: "messages", scope: { room: ":room" }, include: [] })]);

export type ChatMessage = { id: number; name: string; text: string; sent_at: number };

/**
 * A room shows fifty messages at a time, oldest first: the latest, or the fifty said before the
 * one `before` names. Their ids are numbered as they are said, so the key is the order, and a window named by
 * one (a keyset, never an offset) does not move when someone speaks. `earlier`: there are more
 * before it.
 */
export function read(name: string, before: number | null = null, limit = 50): { messages: ChatMessage[]; earlier: boolean } {
  const all = Object.values(readDoc<{ messages?: Record<string, ChatMessage> }>(`room:${name}`)?.messages ?? {}).filter((m) => before === null || m.id < before);
  all.sort((a, b) => a.id - b.id);
  return { messages: all.slice(-limit), earlier: all.length > limit };
}
