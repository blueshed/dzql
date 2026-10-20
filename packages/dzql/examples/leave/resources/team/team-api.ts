import { defineDoc } from "@blueshed/delta/sqlite";
import { read as readDoc } from "dzql/rendering/documents";
import type { PatchOp } from "dzql/rendering/json-patch";
import { splitPath } from "@blueshed/delta/core";
import { refuse } from "dzql/rendering/refusal";
import { register } from "../../store";
import { stillMine, workingDaysOf, type Person, type Request, type Span, type Team } from "../../calendar";

export type { Person, Request, Role, Span, Status, Team } from "../../calendar";

// The team (`team:1`), as its pages read it, and the rules a write to it follows: its people and
// every request, written by people and on the ledger.
register([defineDoc("team:", { root: "teams", include: ["people", "requests"] })]);

/** The one team. */
export const TEAM = "1";

export function read(): Team {
  const doc = readDoc<{ teams: { name: string }; people: Record<string, Person>; requests: Record<string, Request> }>(`team:${TEAM}`);
  // an id is text, as the wire says it: a row's number, which the store names
  const people = Object.values(doc.people).map((p) => ({ ...p, id: String(p.id) }));
  const requests = Object.values(doc.requests).map((r) => ({ ...r, id: String(r.id), person_id: String(r.person_id), answered_by: r.answered_by == null ? null : String(r.answered_by) }));
  return { name: doc.teams.name, people, requests: requests.sort((a, b) => a.starts.localeCompare(b.starts) || Number(a.id) - Number(b.id)) };
}

// ───────────────────────────── the team's rules ─────────────────────────────

/** A day, as a request and a draft say it: `2026-10-05`. */
export const DAY = /^\d{4}-\d{2}-\d{2}$/;

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
