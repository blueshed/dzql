import { registerMemory } from "@blueshed/delta/kinds";
import { read as readDoc } from "dzql/rendering/documents";
import { delta, WEDDING } from "../../store";
import type { Look } from "../../looks";

// What households see of each other (`everyone:<id>`): who stands in the photo, and how many have
// claimed each gift -- never whose. Live, in memory: kept true by the server (../../everyone.ts),
// written by nobody on the wire.
registerMemory(delta.server, { prefix: "everyone:", empty: () => ({ figures: {}, taken: {} }) });

/** One figure in the photo, as every household may see it: whose family, a ghost or not, the look -- and the name only once the names have come down. */
export type Figure = { household: string; ghost: boolean; look: Look; name?: string };
export type Everyone = { figures: Record<string, Figure>; taken: Record<string, number> };

export const everyone = (): Everyone => readDoc<Everyone>(`everyone:${WEDDING}`);

/** Whether a minifigure stands in the photo: "in" (its household said yes and it is coming), "ghost" (a maybe), or not at all. */
export function inPhoto(row: { coming: number | null; answer: "yes" | "maybe" | "no" | null }): "in" | "ghost" | null {
  if (row.coming === 0) return null;
  return row.answer === "yes" ? "in" : row.answer === "maybe" ? "ghost" : null;
}
