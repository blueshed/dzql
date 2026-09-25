import { read as readDoc } from "../../src/documents";
import { address, parseAddress } from "../../src/bento";
import type { PatchOp } from "../../src/json-patch";
import { parsePointer } from "../../src/json-pointer";
import { refuse } from "../../src/refusal";
import { workingDaysOf, type Person, type Request, type Span, type Team } from "./calendar";

export type { Person, Request, Role, Span, Status, Team } from "./calendar";

// leave's two documents as its pages read them, and the rules a write to each follows. The team
// (`team:1`): its people, every request, and each person's draft -- the days they have dragged
// across and not yet asked for. A session (`session:<id>`): who is signed in, if anyone, and where
// they are -- one address, `path?what=which` (src/bento.ts).

/** The one team. */
export const TEAM = "1";

export function team(): Team {
  const doc = readDoc<{ teams: { name: string }; people: Record<string, Person>; requests: Record<string, Request>; drafts?: Record<string, Span & { id: string }> }>(`team:${TEAM}`);
  // an id is text, as the wire says it: a backend names a new row as it likes (a UUID, a serial)
  const people = Object.values(doc.people).map((p) => ({ ...p, id: String(p.id) }));
  const requests = Object.values(doc.requests).map((r) => ({ ...r, id: String(r.id), person_id: String(r.person_id), answered_by: r.answered_by == null ? null : String(r.answered_by) }));
  const drafts = Object.fromEntries(Object.values(doc.drafts ?? {}).map((d) => [String(d.id), { starts: d.starts, ends: d.ends }]));
  return { name: doc.teams.name, people, requests: requests.sort((a, b) => a.starts.localeCompare(b.starts) || a.id.localeCompare(b.id)), drafts };
}

export type Session = { person: Person | null; page: string };

/** Who a session is, if anyone, and where. A person no longer on the team is nobody. */
export function session(sessionId: string): Session {
  const row = readDoc<{ sessions?: { person_id?: string | null; page?: string | null } }>(`session:${sessionId}`)?.sessions ?? {};
  const person = row.person_id == null ? null : (team().people.find((p) => p.id === String(row.person_id)) ?? null);
  return person ? { person, page: row.page ?? "" } : { person: null, page: "" };
}

// ───────────────────────────── where you are ─────────────────────────────

/** A month the calendar starts at: `2026-10`. */
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** An id as delta names a row: letters, digits and dashes. */
const ID = /^[\w-]+$/;

/** An address this session may stand at, or undefined: the calendar (from this month, or a month it names) or the list, and over it one request's drawer, the asking-first, or the draft. */
export function placed(value: unknown): string | undefined {
  const { path, what, which = "" } = parseAddress(String(value ?? ""));
  if (path !== "" && path !== "list" && !MONTH.test(path)) return undefined;
  if (what === undefined) return path;
  if (what === "draft") return address(path, what);
  if ((what === "request" || what === "confirm") && ID.test(which)) return address(path, what, which);
  return undefined;
}

// ───────────────────────────── the session's rules ─────────────────────────────

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A session's write as it takes it: moving about, or signing out, which forgets where you were. */
export function shapeSession(before: Session, ops: PatchOp[]): PatchOp[] {
  return ops.flatMap((op): PatchOp[] => {
    if (op.path === "/person_id") return [{ op: "replace", path: "/person_id", value: null }, { op: "replace", path: "/page", value: null }];
    const page = op.op === "remove" ? "" : placed(op.value);
    return page === undefined || page === before.page ? [] : [{ op: "replace", path: "/page", value: page }];
  });
}

// ───────────────────────────── the team's rules ─────────────────────────────

/**
 * May `me` write `op` to the team, as it stands? Your own draft is yours to set, change and drop;
 * asking is anyone's; moving a request, or taking it back, is its asker's, while it waits;
 * answering is a manager's, for someone else, while it waits.
 */
export function may(me: Person, op: PatchOp, t: Team): boolean {
  const [coll, id, field] = parsePointer(op.path);
  if (coll === "draft") return op.op === "remove" ? id === undefined : id === undefined || ((id === "starts" || id === "ends") && field === undefined);
  if (coll !== "requests") return false;
  if (op.op === "add") return id === "-" && field === undefined;
  const r = t.requests.find((x) => x.id === id);
  if (!r || r.status !== "asked") return false;
  if (op.op === "remove") return field === undefined && r.person_id === me.id;
  if (field === "starts" || field === "ends") return r.person_id === me.id && typeof op.value === "string" && DAY.test(op.value);
  return field === "status" && me.role === "manager" && r.person_id !== me.id && (op.value === "approved" || op.value === "declined");
}

/** Where a person's draft is in the team's document. */
const joinDraft = (personId: string): string => `/drafts/${personId}`;

/** A span's days, checked: it ends on or after it begins, and takes a working day. */
function checked(s: Span): Span {
  if (s.ends < s.starts) throw refuse("The last day is before the first.");
  if (!workingDaysOf(s).length) throw refuse("There are no working days in those.");
  return s;
}

/**
 * The ops as the team takes them. Your draft (`/draft`, the wire's word for it) is your row of the
 * drafts, set whole (a drag) or a day at a time (the drawer's fields), refused when it ends before
 * it begins, dropped when you cancel it. An ask -- your draft, or days said on the wire -- is made
 * whole (who, waiting) and its days checked, and asking for your draft drops it in the same change,
 * so one Undo gives it back. A move is checked as the days it leaves; an answer is signed by who
 * gave it.
 */
export function shape(me: Person, ops: PatchOp[], t: Team): PatchOp[] {
  const draft = t.drafts[me.id] ?? null;
  const mine = joinDraft(me.id);
  const moved = new Map<string, Span>();
  const out = ops.flatMap((op): PatchOp[] => {
    const [coll, id, field] = parsePointer(op.path);
    if (coll === "draft") {
      if (op.op === "remove") return draft ? [{ op: "remove", path: mine }] : [];
      const next: Partial<Span> = id === undefined ? ((op.value as Partial<Span> | null) ?? {}) : { ...(draft ?? {}), [id]: op.value };
      const starts = next.starts ?? next.ends;
      const ends = next.ends ?? next.starts;
      if (typeof starts !== "string" || typeof ends !== "string" || !DAY.test(starts) || !DAY.test(ends)) return [];
      if (ends < starts) throw refuse("The last day is before the first.");
      return [{ op: draft ? "replace" : "add", path: mine, value: { starts, ends } }];
    }
    if (op.op === "add") {
      const said = (op.value ?? draft) as Partial<Span> | null;
      if (!said || typeof said.starts !== "string" || typeof said.ends !== "string" || !DAY.test(said.starts) || !DAY.test(said.ends)) return [];
      const { starts, ends } = checked({ starts: said.starts, ends: said.ends });
      const asked: PatchOp = { op: "add", path: "/requests/-", value: { person_id: me.id, starts, ends, status: "asked", answered_by: null } };
      return op.value === undefined ? [asked, { op: "remove", path: mine }] : [asked];
    }
    if (field === "starts" || field === "ends") {
      const r = t.requests.find((x) => x.id === id)!;
      moved.set(id!, { ...(moved.get(id!) ?? { starts: r.starts, ends: r.ends }), [field]: op.value as string });
      return [op];
    }
    if (op.op === "replace") return [op, { op: "replace", path: `/requests/${id}/answered_by`, value: me.id }];
    return [op];
  });
  for (const s of moved.values()) checked(s);
  return out;
}
