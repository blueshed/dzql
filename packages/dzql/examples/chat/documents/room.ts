import { read as readDoc } from "dzql/rendering/documents";

// A room's conversation, the people in it, and the list of rooms -- as a page reads them, from
// delta (../delta.ts).

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

/** Who is in the room, in the order they came. */
export function people(room: string): string[] {
  return Object.keys(readDoc<{ people: Record<string, true> }>(`here:${room}`)?.people ?? {});
}

/** Every room there is, by name. */
export function list(): string[] {
  return Object.keys(readDoc<{ rooms: Record<string, true> }>("lobby:all")?.rooms ?? {}).sort();
}
