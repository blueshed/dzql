import { read as readDoc } from "dzql/rendering/documents";
import type { PatchOp } from "dzql/rendering/json-patch";
import { cityOf } from "../applets/clock"; // the applet's own, pure: the browser says the city the same way
export { cityOf };

// A session's clock, kept in delta (`clock:<id>`, the session's row's `tz`, ../delta.ts): the city whose time it shows, as
// an IANA zone ("Europe/Zurich"). The zones are the runtime's own list; a write names one of them
// or does not apply. Choosing a city is the person's doing, so it is on the ledger and Undo takes
// them back.

export const DEFAULT_TZ = process.env.CLOCK_TZ ?? "Europe/Zurich";

export type ClockDocument = {
  tz: string;
  /** The city, as people say it: the zone's last segment, "New_York" as "New York". */
  city: string;
  /** The zone's offset from UTC right now, "+02:00". */
  offset: string;
};

/** Every zone the runtime knows, "Area/City" and the like, sorted. */
export const ZONES: readonly string[] = Intl.supportedValuesOf("timeZone");
const ZONE_SET = new Set(ZONES);

/** The offset of a zone from UTC at `now`, as "+HH:MM" / "-HH:MM" ("+00:00" for UTC). */
export function offsetOf(tz: string, now = new Date()): string {
  const part = new Intl.DateTimeFormat("en-GB", { timeZone: tz, timeZoneName: "longOffset" }).formatToParts(now).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = /([+-])(\d{2}):?(\d{2})?/.exec(part);
  return m ? `${m[1]}${m[2]}:${m[3] ?? "00"}` : "+00:00";
}

export function read(sessionId: string): ClockDocument {
  const tz = readDoc<{ desks?: { tz: string | null } }>(`clock:${sessionId}`)?.desks?.tz ?? DEFAULT_TZ;
  return { tz, city: cityOf(tz), offset: offsetOf(tz) };
}

/** The zone after `ops`: `replace /tz` with a zone the runtime knows; anything else does not apply. */
export function after(tz: string, ops: PatchOp[]): string {
  let next = tz;
  for (const op of ops) {
    const zone = String(op.value ?? "").trim();
    if (op.path === "/tz" && op.op === "replace" && ZONE_SET.has(zone)) next = zone;
  }
  return next;
}
