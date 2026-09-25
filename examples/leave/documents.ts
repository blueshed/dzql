import { read as readDoc } from "../../src/documents";
import { address, parseAddress } from "../../src/bento";
import type { PatchOp } from "../../src/json-patch";
import { parsePointer } from "../../src/json-pointer";
import { refuse } from "../../src/refusal";

// leave's two documents as its pages read them, and the rules a write to each follows. The team
// (`team:1`): its people and every request. A session (`session:<id>`): who is signed in, if
// anyone, and where they are -- one address, `path?what=which` (src/bento.ts).

export type Role = "member" | "manager";
export type Person = { id: string; name: string; role: Role };
export type Status = "asked" | "approved" | "declined";
export type Request = { id: string; person_id: string; starts: string; ends: string; status: Status; answered_by: string | null };
export type Team = { name: string; people: Person[]; requests: Request[] };

/** An id as delta names a row: letters, digits and dashes. */
const ID = /^[\w-]+$/;

/** The one team. */
export const TEAM = "1";

export function team(): Team {
  const doc = readDoc<{ teams: { name: string }; people: Record<string, Person>; requests: Record<string, Request> }>(`team:${TEAM}`);
  // an id is text, as the wire says it: a backend names a new row as it likes (a UUID, a serial)
  const people = Object.values(doc.people).map((p) => ({ ...p, id: String(p.id) }));
  const requests = Object.values(doc.requests).map((r) => ({ ...r, id: String(r.id), person_id: String(r.person_id), answered_by: r.answered_by == null ? null : String(r.answered_by) }));
  const byStart = (a: Request, b: Request) => a.starts.localeCompare(b.starts) || a.id.localeCompare(b.id);
  return { name: doc.teams.name, people, requests: requests.sort(byStart) };
}

export type Session = { person: Person | null; page: string };

/** Who a session is, if anyone, and where. A person no longer on the team is nobody. */
export function session(sessionId: string): Session {
  const row = readDoc<{ sessions?: { person_id?: string | null; page?: string | null } }>(`session:${sessionId}`)?.sessions ?? {};
  const person = row.person_id == null ? null : (team().people.find((p) => p.id === String(row.person_id)) ?? null);
  return { person, page: person ? (row.page ?? "") : "" };
}

// ───────────────────────────── who is off when ─────────────────────────────

/** The day after `day` (YYYY-MM-DD). */
export const nextDay = (day: string): string => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** Every day a request covers, first to last. */
export function daysOf(r: Pick<Request, "starts" | "ends">): string[] {
  const out: string[] = [];
  for (let d = r.starts; d <= r.ends; d = nextDay(d)) out.push(d);
  return out;
}

/** Who is off on each day: every request not declined, by the days it covers. */
export function offOn(t: Team): Map<string, Request[]> {
  const off = new Map<string, Request[]>();
  for (const r of t.requests) if (r.status !== "declined") for (const d of daysOf(r)) off.set(d, [...(off.get(d) ?? []), r]);
  return off;
}

/** How many colours tell people apart (client/styles.css: `who-0` to `who-8`). */
export const COLOURS = 9;

/** A person's colour: their place in the team, by id, so it is the same on every page and every day. */
export function colourOf(t: Team, personId: string): number {
  const ids = t.people.map((p) => p.id).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  return Math.max(0, ids.indexOf(personId)) % COLOURS;
}

/** The days on which more than one person is off. */
export const clashes = (off: Map<string, Request[]>): string[] => [...off].filter(([, rs]) => new Set(rs.map((r) => r.person_id)).size > 1).map(([d]) => d);

/** Who else is off during `r`, and on how many of its days: what a manager weighs before answering. */
export function alsoOff(t: Team, r: Request): { request: Request; days: number }[] {
  const mine = new Set(daysOf(r));
  return t.requests
    .filter((o) => o.person_id !== r.person_id && o.status !== "declined")
    .map((o) => ({ request: o, days: daysOf(o).filter((d) => mine.has(d)).length }))
    .filter((o) => o.days > 0);
}

// ───────────────────────────── where you are ─────────────────────────────

/** An address this session may stand at, or undefined: the box, your leave or the team's, and over it one request's drawer, the ask, or the asking-first. */
export function placed(value: unknown): string | undefined {
  const { path, what, which = "" } = parseAddress(String(value ?? ""));
  if (path !== "" && path !== "mine" && path !== "team" && path !== "calendar") return undefined;
  if (what === undefined) return path;
  if (what === "new") return path === "mine" ? address(path, what) : undefined;
  if (path === "calendar") return undefined; // the calendar is read, and nothing opens over it
  if ((what === "request" || what === "confirm") && ID.test(which)) return address(path, what, which);
  return undefined;
}

// ───────────────────────────── the team's rules ─────────────────────────────

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * May `me` write `op` to the team, as it stands? Asking is anyone's; taking a request back is its
 * asker's, while it waits; answering is a manager's, for someone else, while it waits.
 */
export function may(me: Person, op: PatchOp, t: Team): boolean {
  const [coll, id, field] = parsePointer(op.path);
  if (coll !== "requests") return false;
  if (op.op === "add") return id === "-" && field === undefined;
  const r = t.requests.find((x) => x.id === id);
  if (!r || r.status !== "asked") return false;
  if (op.op === "remove") return field === undefined && r.person_id === me.id;
  return field === "status" && me.role === "manager" && r.person_id !== me.id && (op.value === "approved" || op.value === "declined");
}

/** The ops as the team takes them: an ask made whole (who, waiting) and its days checked; an answer signed by who gave it. */
export function shape(me: Person, ops: PatchOp[]): PatchOp[] {
  return ops.flatMap((op): PatchOp[] => {
    const [, id] = parsePointer(op.path);
    if (op.op === "add") {
      const { starts, ends } = (op.value ?? {}) as { starts?: unknown; ends?: unknown };
      if (typeof starts !== "string" || typeof ends !== "string" || !DAY.test(starts) || !DAY.test(ends)) return [];
      if (ends < starts) throw refuse("The last day is before the first.");
      return [{ op: "add", path: "/requests/-", value: { person_id: me.id, starts, ends, status: "asked", answered_by: null } }];
    }
    if (op.op === "replace") return [op, { op: "replace", path: `/requests/${id}/answered_by`, value: me.id }];
    return [op];
  });
}
