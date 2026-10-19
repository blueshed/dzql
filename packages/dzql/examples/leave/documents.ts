import { read as readDoc } from "dzql/rendering/documents";
import { address, parseAddress } from "dzql/rendering/bento";
import type { PatchOp } from "dzql/rendering/json-patch";
import { splitPath } from "@blueshed/delta/core";
import { refuse } from "dzql/rendering/refusal";
import { stillMine, workingDaysOf, type Person, type Request, type Span, type Team } from "./calendar";

export type { Person, Request, Role, Span, Status, Team } from "./calendar";

// leave's two documents as its pages read them, and the rules a write to each follows. The team
// (`team:1`): its people and every request. A session (`session:<id>`): who is signed in, if anyone,
// where they are -- one address, `path?what=which` (src/rendering/bento.ts) -- and their draft: the days
// they have dragged across and not yet asked for, theirs alone until they ask.

/** The one team. */
export const TEAM = "1";

export function team(): Team {
  const doc = readDoc<{ teams: { name: string }; people: Record<string, Person>; requests: Record<string, Request> }>(`team:${TEAM}`);
  // an id is text, as the wire says it: a row's number, which the store names
  const people = Object.values(doc.people).map((p) => ({ ...p, id: String(p.id) }));
  const requests = Object.values(doc.requests).map((r) => ({ ...r, id: String(r.id), person_id: String(r.person_id), answered_by: r.answered_by == null ? null : String(r.answered_by) }));
  return { name: doc.teams.name, people, requests: requests.sort((a, b) => a.starts.localeCompare(b.starts) || Number(a.id) - Number(b.id)) };
}

export type Session = { person: Person | null; page: string; draft: Span | null };

/** Who a session is, if anyone, where, and their draft. A person no longer on the team is nobody. */
export function session(sessionId: string): Session {
  const row = readDoc<{ sessions?: { person_id?: number | string | null; page?: string | null; draft?: Span | null } }>(`session:${sessionId}`)?.sessions ?? {};
  const person = row.person_id == null ? null : (team().people.find((p) => p.id === String(row.person_id)) ?? null);
  return person ? { person, page: row.page ?? "", draft: row.draft ?? null } : { person: null, page: "", draft: null };
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

/**
 * A session's write as it takes it: moving about; signing out, which forgets where you were; or your
 * draft, set whole (a drag) or a day at a time (the drawer's fields), refused when it ends before it
 * begins, and dropped when you cancel it. Setting it opens its drawer; dropping it closes it.
 */
export function shapeSession(before: Session, ops: PatchOp[]): PatchOp[] {
  let { page, draft } = before;
  for (const op of ops) {
    const [field, day] = splitPath(op.path);
    if (field === "person_id") return [{ op: "replace", path: "/person_id", value: null }, { op: "replace", path: "/page", value: null }];
    if (field === "page") {
      page = (op.op === "remove" ? "" : placed(op.value)) ?? page;
      continue;
    }
    const { path } = parseAddress(page);
    if (op.op === "remove") {
      if (draft) [draft, page] = [null, path];
      continue;
    }
    const next: Partial<Span> = day === undefined ? ((op.value as Partial<Span> | null) ?? {}) : { ...draft, [day]: op.value };
    const starts = next.starts ?? next.ends;
    const ends = next.ends ?? next.starts;
    if (typeof starts !== "string" || typeof ends !== "string" || !DAY.test(starts) || !DAY.test(ends)) continue;
    if (ends < starts) throw refuse("The last day is before the first.");
    [draft, page] = [{ starts, ends }, address(path, "draft")];
  }
  return [
    ...(draft !== before.draft ? [{ op: "replace" as const, path: "/draft", value: draft }] : []),
    ...(page !== before.page ? [{ op: "replace" as const, path: "/page", value: page }] : []),
  ];
}

// ───────────────────────────── the team's rules ─────────────────────────────

/**
 * May `me` write `op` to the team, as it stands? Asking is anyone's; moving a request, or taking it
 * back, is its asker's while it waits (and a manager's own, which they approved themselves);
 * answering is a manager's, for someone else, while it waits. A draft is not the team's: it is the
 * session's.
 */
export function may(me: Person, op: PatchOp, t: Team): boolean {
  const [coll, id, field] = splitPath(op.path);
  if (coll !== "requests") return false;
  if (op.op === "add") return id === "-" && field === undefined;
  const r = t.requests.find((x) => x.id === id);
  if (!r) return false;
  if (op.op === "remove") return field === undefined && stillMine(me, r);
  if (field === "starts" || field === "ends") return stillMine(me, r) && typeof op.value === "string" && DAY.test(op.value);
  return field === "status" && r.status === "asked" && me.role === "manager" && r.person_id !== me.id && (op.value === "approved" || op.value === "declined");
}

/** A span's days, checked: it ends on or after it begins, and takes a working day. */
function checked(s: Span): Span {
  if (s.ends < s.starts) throw refuse("The last day is before the first.");
  if (!workingDaysOf(s).length) throw refuse("There are no working days in those.");
  return s;
}

/**
 * The ops as the team takes them. An ask -- your draft (`draft`, from your session), or days said on
 * the wire -- is made whole (who, waiting; a manager's own approved at once, by them) and its days
 * checked. A move is checked as the days it leaves; an answer is signed by who gave it.
 */
export function shape(me: Person, ops: PatchOp[], t: Team, draft: Span | null): PatchOp[] {
  const moved = new Map<string, Span>();
  const out = ops.flatMap((op): PatchOp[] => {
    const [, id, field] = splitPath(op.path);
    if (op.op === "add") {
      const said = (op.value ?? draft) as Partial<Span> | null;
      if (!said || typeof said.starts !== "string" || typeof said.ends !== "string" || !DAY.test(said.starts) || !DAY.test(said.ends)) return [];
      const { starts, ends } = checked({ starts: said.starts, ends: said.ends });
      // a manager's own leave: nobody else answers it, so it is approved at once, by them, for all to see
      const manager = me.role === "manager";
      return [{ op: "add", path: "/requests/-", value: { person_id: Number(me.id), starts, ends, status: manager ? "approved" : "asked", answered_by: manager ? Number(me.id) : null } }];
    }
    if (field === "starts" || field === "ends") {
      const r = t.requests.find((x) => x.id === id)!;
      moved.set(id!, { ...(moved.get(id!) ?? { starts: r.starts, ends: r.ends }), [field]: op.value as string });
      return [op];
    }
    if (op.op === "replace") return [op, { op: "replace", path: `/requests/${id}/answered_by`, value: Number(me.id) }];
    return [op];
  });
  for (const s of moved.values()) checked(s);
  return out;
}
