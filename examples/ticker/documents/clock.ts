import { db } from "../db";
import { reading } from "../../../src/reading";
import type { PatchOp } from "../../../src/json-patch";
import { parsePointer } from "../../../src/json-pointer";
import { prefixDoc, record } from "../../../src/ledger";

// A session's clock: the city whose time it shows, as an IANA zone ("Europe/Zurich"). The
// zones are the runtime's own list; a write names one of them or does not apply. Choosing a
// city is the person's doing, so it is on the ledger and Undo takes them back.

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

export const cityOf = (tz: string): string => (tz.split("/").pop() ?? tz).replaceAll("_", " ");

/** The offset of a zone from UTC at `now`, as "+HH:MM" / "-HH:MM" ("+00:00" for UTC). */
export function offsetOf(tz: string, now = new Date()): string {
  const part = new Intl.DateTimeFormat("en-GB", { timeZone: tz, timeZoneName: "longOffset" }).formatToParts(now).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = /([+-])(\d{2}):?(\d{2})?/.exec(part);
  return m ? `${m[1]}${m[2]}:${m[3] ?? "00"}` : "+00:00";
}

const readStmt = db.query<{ tz: string }, [string]>("SELECT tz FROM clocks WHERE session_id = ?");
const upsertStmt = db.query<unknown, [string, string]>("INSERT INTO clocks (session_id, tz) VALUES (?1, ?2) ON CONFLICT(session_id) DO UPDATE SET tz = ?2");

export function read(sessionId: string): ClockDocument {
  reading("clock", sessionId);
  const tz = readStmt.get(sessionId)?.tz ?? DEFAULT_TZ;
  return { tz, city: cityOf(tz), offset: offsetOf(tz) };
}

export type ClockPatchResult = { version: number; applied: PatchOp[] };

/** `replace /tz` with a zone the runtime knows; anything else does not apply. One transaction: every statement here, the ledger row, and the version it returns commit together or not at all. */
export const patch = db.transaction(function patch(sessionId: string, ops: PatchOp[], undoes?: number): ClockPatchResult {
  const applied: PatchOp[] = [];
  const inverse: PatchOp[] = [];

  for (const op of ops) {
    const [field] = parsePointer(op.path);
    if (field !== "tz" || op.op !== "replace") continue;
    const tz = String(op.value ?? "").trim();
    const before = read(sessionId).tz;
    if (!ZONE_SET.has(tz) || tz === before) continue;
    upsertStmt.run(sessionId, tz);
    applied.push({ ...op, value: tz });
    inverse.unshift({ op: "replace", path: "/tz", value: before });
  }

  const version = record(prefixDoc("clock", sessionId), applied, inverse, sessionId, undoes);
  return { version, applied };
});
