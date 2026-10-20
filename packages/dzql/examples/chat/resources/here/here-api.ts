import { registerMemory } from "@blueshed/delta/kinds";
import { read as readDoc } from "dzql/rendering/documents";
import { delta } from "../../store";

// Who is in a room: `here:<room>`, the names present, in the order they came. Live, in memory:
// kept by the server from the sessions and the connections (../../presence.ts), written by nobody
// on the wire.
registerMemory(delta.server, { prefix: "here:", empty: () => ({ people: {} as Record<string, true> }) });

/** Who is in the room, in the order they came. */
export function people(room: string): string[] {
  return Object.keys(readDoc<{ people: Record<string, true> }>(`here:${room}`)?.people ?? {});
}
