import { read as readDoc } from "../../../src/documents";

// A room's conversation, the people in it, and the list of rooms -- as a page reads them, from
// delta (../delta.ts).

export type ChatMessage = { id: string; name: string; text: string; sent_at: number };

/** The room's latest messages, oldest first: their ids are time-ordered, so the key is the order. */
export function read(name: string, limit = 50): ChatMessage[] {
  const messages = Object.values(readDoc<{ messages?: Record<string, ChatMessage> }>(`room:${name}`)?.messages ?? {});
  messages.sort((a, b) => (a.id < b.id ? -1 : 1));
  return messages.slice(-limit);
}

/** Who is in the room, in the order they came. */
export function people(room: string): string[] {
  return Object.keys(readDoc<{ people: Record<string, true> }>(`here:${room}`)?.people ?? {});
}

/** Every room there is, by name. */
export function list(): string[] {
  return Object.keys(readDoc<{ rooms: Record<string, true> }>("lobby:all")?.rooms ?? {}).sort();
}
