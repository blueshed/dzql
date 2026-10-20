import { defineDoc } from "@blueshed/delta/sqlite";
import { read as readDoc } from "dzql/rendering/documents";
import { address, parseAddress } from "dzql/rendering/bento";
import type { PatchOp } from "dzql/rendering/json-patch";
import { splitPath } from "@blueshed/delta/core";
import { refuse } from "dzql/rendering/refusal";
import { register } from "../../store";
import { read as team, DAY } from "../team/team-api";
import type { Person, Span } from "../../calendar";

// A session (`session:<id>`), as its pages read it, and the rules a write to it follows: who is
// signed in, if anyone, and their draft: the days they have dragged across and not yet asked for,
// theirs alone until they ask; and where they are, one address, `path?what=which`
// (dzql/rendering/bento). Off the ledger: signing in, moving about and
// drafting are not the team's history. It holds every column of its row but the cookie's hash.
register([defineDoc("session:", { root: "sessions", include: [], implied: true, columns: { sessions: ["person_id", "page", "draft"] } })], { ledger: false });

export type Session = { person: Person | null; page: string; draft: Span | null };

/** Who a session is, if anyone, and their draft. A person no longer on the team is nobody. */
export function read(sessionId: string): Session {
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

/**
 * A session's write as it takes it, from where it stands (`page`): moving
 * about; signing out, which forgets where you were; or your draft, set whole (a drag) or a day at a
 * time (the drawer's fields), refused when it ends before it begins, and dropped when you cancel it.
 * Setting it opens its drawer; dropping it closes it.
 */
export function shape(before: Session & { page: string }, ops: PatchOp[]): PatchOp[] {
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
