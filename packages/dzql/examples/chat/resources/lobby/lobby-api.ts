import { registerMemory } from "@blueshed/delta/kinds";
import { read as readDoc } from "dzql/rendering/documents";
import { delta } from "../../store";

// Which rooms there are -- a room is there while someone is in it or something has been said in
// it: `lobby:all`. Live, in memory: kept by the server (../../presence.ts), written by nobody on the wire.
registerMemory(delta.server, { prefix: "lobby:", empty: () => ({ rooms: {} as Record<string, true> }) });

/** Every room there is, by name. */
export function list(): string[] {
  return Object.keys(readDoc<{ rooms: Record<string, true> }>("lobby:all")?.rooms ?? {}).sort();
}
