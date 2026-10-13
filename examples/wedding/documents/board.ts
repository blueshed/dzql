import { read as readDoc } from "../../../src/documents";
import type { PatchOp } from "../../../src/json-patch";
import { splitPath } from "@blueshed/delta/core";
import { db } from "../delta";
import { householdFrom, newId, type HouseholdDocument } from "./household";
import { coursesOf, eventsOf, giftsOf, placesOf, weddingOf, WEDDING, type Course, type Event, type Gift, type Place, type Rows, type Wedding } from "./wedding";
import { integer, text, yesNo } from "./values";

// The couple's document, kept in delta (`board:<wedding>`, ../delta.ts): the wedding and
// everything beneath it -- every household whole, the courses with their dishes and drinks, the
// gifts, the events, where to stay -- and the totals the caterer needs, counted from it. The
// couple own the ground, so every list is written here; a household only ever reads them.

export type Totals = {
  households: number;
  answered: number;
  /** Guests marked coming in households that said yes. */
  coming: number;
  asksWaiting: number;
  /** How many of each dish and drink, by id, and of each dietary mark, among those coming. */
  dishes: Record<string, number>;
  drinks: Record<string, number>;
  dietary: Record<string, number>;
};

export type BoardDocument = Wedding & {
  households: HouseholdDocument[];
  courses: Course[];
  gifts: Gift[];
  events: Event[];
  places: Place[];
  totals: Totals;
};

type Row = Record<string, unknown> & { id: string };
type Doc = { weddings: Row; households?: Rows; guests?: Rows; asks?: Rows; claims?: Rows; courses?: Rows; dishes?: Rows; drinks?: Rows; gifts?: Rows; events?: Rows; places?: Rows };

/** What the caterer needs, counted from the households and the courses. */
export function totals(households: HouseholdDocument[], cs: Course[]): Totals {
  const dishes: Record<string, number> = {};
  const drinks: Record<string, number> = {};
  const dietary: Record<string, number> = {};
  const marksOf = new Map(cs.flatMap((c) => c.dishes).map((d) => [d.id, (d.dietary ?? "").split(",").map((m) => m.trim()).filter(Boolean)]));
  const bump = (into: Record<string, number>, key: string | number) => {
    into[key] = (into[key] ?? 0) + 1;
  };
  let coming = 0;
  for (const h of households) {
    if (h.answer !== "yes") continue;
    for (const g of h.guests) {
      if (g.coming !== 1) continue;
      coming++;
      for (const choice of Object.values(g.choices)) {
        if (choice.dish !== null) {
          bump(dishes, choice.dish);
          for (const mark of marksOf.get(choice.dish) ?? []) bump(dietary, mark);
        }
        if (choice.drink !== null) bump(drinks, choice.drink);
      }
    }
  }
  return {
    households: households.length,
    answered: households.filter((h) => h.answer !== null).length,
    coming,
    asksWaiting: households.reduce((n, h) => n + h.asks.filter((a) => a.reply === null).length, 0),
    dishes,
    drinks,
    dietary,
  };
}

/** The board as the couple read it. `id` is the wedding's. */
export function read(id = WEDDING): BoardDocument | undefined {
  const doc = readDoc<Doc | undefined>(`board:${id}`);
  if (!doc?.weddings) return undefined;
  const households = Object.values(doc.households ?? {})
    .map((h) => householdFrom(h as Row, doc))
    .sort((a, b) => a.code.localeCompare(b.code));
  const codeOf = new Map(households.map((h) => [String(h.id), h.code]));
  const claimants = (giftId: number) =>
    Object.values(doc.claims ?? {})
      .filter((c) => Number(c.gift_id) === giftId)
      .sort((a, b) => String(a.claimed_at).localeCompare(String(b.claimed_at)))
      .map((c) => codeOf.get(String(c.households_id)) ?? "");
  const cs = coursesOf(doc);
  return { ...weddingOf(doc.weddings), households, courses: cs, gifts: giftsOf(doc.gifts, claimants), events: eventsOf(doc.events), places: placesOf(doc.places), totals: totals(households, cs) };
}

// ───────────────────────────── writing ─────────────────────────────

type Col = "text" | "text?" | "bool" | "seq";

const ROOT: Record<string, Col> = { name1: "text", name2: "text", day: "text", deadline: "text?", venue: "text?", message: "text?", picture_key: "text?" };

/** The lists: their columns, their parent (in the document, and on the wire), and the lists beneath them. */
const LISTS: Record<string, { columns: Record<string, Col>; children?: string[]; parent?: string }> = {
  courses: { columns: { name: "text", seq: "seq" }, children: ["dishes", "drinks"] },
  dishes: { columns: { name: "text", dietary: "text?", seq: "seq" }, parent: "courses" },
  drinks: { columns: { name: "text", seq: "seq" }, parent: "courses" },
  gifts: { columns: { name: "text", description: "text?", link: "text?", picture_key: "text?", shared: "bool", seq: "seq" } },
  events: { columns: { name: "text", when_at: "text?", where_at: "text?", notes: "text?", seq: "seq" } },
  places: { columns: { name: "text", notes: "text?", link: "text?", picture_key: "text?", seq: "seq" } },
};

const TOP_LISTS = ["courses", "gifts", "events", "places"];

/** The value a column of this kind takes from an op, or undefined when the op can't be applied to it. */
function coerce(kind: Col, op: PatchOp): unknown {
  const removing = op.op === "remove";
  if (kind === "text") return removing ? undefined : (text(op.value) ?? undefined);
  if (kind === "text?") return removing ? null : text(op.value);
  if (kind === "bool") return removing ? 0 : yesNo(op.value);
  return undefined; // seq is a move, handled by its own branch
}

const isDate = (value: unknown): boolean => typeof value === "string" && !Number.isNaN(new Date(value).getTime());
const isEmail = (value: unknown): value is string => typeof value === "string" && value.includes("@");

/**
 * The couple's write, as the document takes it. The wire says it the couple's way, nested --
 * `/households/1/asks/1/reply`, `/courses/2/dishes/-` -- and each is checked and becomes the rows
 * it moves: a yes to an ask makes the guest it asked for, a move renumbers the list, a course
 * taken off takes its choices with it. Delta's inverse is what undo walks.
 */
/** Two ids the same: the store keeps a serial as a number, a path carries it as text. */
const same = (a: unknown, b: unknown): boolean => a != null && b != null && String(a) === String(b);

const codeTaken = db.query<{ 1: number }, [string]>("SELECT 1 FROM wedding_households WHERE code = ?");

export function shape(doc: Doc, ops: PatchOp[], now = new Date().toISOString()): PatchOp[] {
  // a working copy: each op sees the ones before it in the message
  const d = structuredClone(doc) as Required<Doc>;
  for (const key of ["households", "guests", "asks", "claims", "courses", "dishes", "drinks", "gifts", "events", "places"] as const) d[key] ??= {};
  const out: PatchOp[] = [];
  let made = 0; // a row added at `-` has no id until delta names it: the copy keeps it by a key of its own
  const emit = (op: PatchOp) => {
    out.push(op);
    const [coll, at, field] = splitPath(op.path);
    const id = at === "-" ? `-${++made}` : at!;
    const rows = d[coll as keyof Doc] as Rows;
    if (coll === "weddings") (d.weddings as Record<string, unknown>)[id] = op.value;
    else if (op.op === "remove") delete rows[id];
    else if (field) rows[id]![field] = op.value;
    else rows[id] = { id, ...(op.value as object) };
  };
  /** A household's code: its email's name and the least number no household's code has yet, short enough to type. */
  const codeFor = (email: string): string => {
    const name = email.split("@")[0]!.slice(0, 6).toUpperCase();
    for (let n = 1; ; n++) {
      const code = `${name}${n}`;
      if (!codeTaken.get(code) && !Object.values(d.households).some((h) => h.code === code)) return code;
    }
  };
  const removeGuest = (gid: string) => {
    for (const a of Object.values(d.asks)) if (same(a.guest_id, gid)) emit({ op: "replace", path: `/asks/${a.id}/guest_id`, value: null });
    emit({ op: "remove", path: `/guests/${gid}` });
  };
  /** A guest added to a household, at `-`, or as `gid` where the write refers to them. */
  const addGuest = (hid: string, value: Record<string, unknown>, gid = "-"): void => emit({ op: "add", path: `/guests/${gid}`, value: { households_id: hid, ...value } });

  for (const op of ops) {
    const [head, ...rest] = splitPath(op.path);
    if (!head) continue;

    if (rest.length === 0 && head in ROOT) {
      const value = coerce(ROOT[head]!, op);
      if (value === undefined || ((head === "day" || head === "deadline") && value !== null && !isDate(value))) continue;
      if (d.weddings[head] === value) continue;
      emit({ op: "replace", path: `/weddings/${head}`, value });
      continue;
    }

    if (head === "households") {
      const [key, field, key2, more] = rest;
      if (key === "-") {
        const v = (typeof op.value === "string" ? { email: op.value } : (op.value ?? {})) as { email?: unknown; names?: unknown; plus_ones?: unknown };
        const email = text(v.email);
        if (op.op !== "add" || field !== undefined || !isEmail(email)) continue;
        const hid = newId(); // its guests name it
        emit({ op: "add", path: `/households/${hid}`, value: { code: codeFor(email), email, plus_ones: Math.max(0, integer(v.plus_ones) ?? 0), answer: null, message: null } });
        for (const name of String(v.names ?? "").split(/[,\n]/).map((n) => n.trim()).filter(Boolean)) addGuest(hid, { name, named_by: "couple" });
        continue;
      }
      const h = d.households[key ?? ""];
      if (!h) continue;
      if (field === "email" && key2 === undefined) {
        const email = text(op.value);
        if (!isEmail(email) || email === h.email) continue;
        emit({ op: "replace", path: `/households/${h.id}/email`, value: email });
      } else if (field === "plus_ones" && key2 === undefined) {
        const value = integer(op.value);
        if (value === undefined || value < 0 || value === h.plus_ones) continue;
        emit({ op: "replace", path: `/households/${h.id}/plus_ones`, value });
      } else if (field === "guests" && key2 === "-") {
        const name = text(typeof op.value === "string" ? op.value : (op.value as { name?: unknown } | null)?.name);
        if (op.op !== "add" || more !== undefined || !name) continue;
        addGuest(h.id, { name, named_by: "couple" });
      } else if (field === "guests") {
        const guest = d.guests[key2 ?? ""];
        if (!guest || !same(guest.households_id, h.id) || more !== undefined || op.op !== "remove") continue;
        removeGuest(guest.id);
      } else if (field === "asks" && more === "reply") {
        const ask = d.asks[key2 ?? ""];
        if (!ask || !same(ask.households_id, h.id)) continue;
        const value = op.op === "remove" ? null : op.value;
        if ((value !== null && value !== "yes" && value !== "no") || ask.reply === value) continue;
        emit({ op: "replace", path: `/asks/${ask.id}/reply`, value });
        if (value === "yes" && ask.guest_id == null) {
          // A yes makes a guest (brief.md), remembered on the ask so a change of mind takes them out again.
          const gid = newId(); // the ask names them
          addGuest(h.id, { name: ask.name, named_by: "ask", coming: 1 }, gid);
          emit({ op: "replace", path: `/asks/${ask.id}/guest_id`, value: gid });
        } else if (value !== "yes" && ask.guest_id != null && d.guests[String(ask.guest_id)]) {
          removeGuest(String(ask.guest_id));
        }
      }
      continue;
    }

    if (TOP_LISTS.includes(head)) list(head, undefined, rest, op);
  }
  return out;

  /** A list's row added, removed, moved, or a field of it replaced -- `parentId` for a dish or a drink, its course. */
  function list(table: string, parentId: string | undefined, seg: string[], op: PatchOp): void {
    const spec = LISTS[table]!;
    const rows = d[table as keyof Doc] as Rows;
    const siblings = () => Object.values(rows).filter((r) => !spec.parent || same(r[`${spec.parent}_id`], parentId)).sort((a, b) => Number(a.seq) - Number(b.seq) || Number(a.id) - Number(b.id));
    const [key, col, ...more] = seg;

    if (key === "-") {
      if (op.op !== "add" || col !== undefined) return;
      const v = (typeof op.value === "string" ? { name: op.value } : (op.value ?? {})) as Record<string, unknown>;
      const value: Record<string, unknown> = {};
      for (const [c, kind] of Object.entries(spec.columns)) {
        if (kind === "seq" || v[c] === undefined) continue;
        value[c] = kind === "bool" ? (yesNo(v[c]) ?? 0) : text(v[c]);
      }
      if (!value.name) return;
      if (spec.columns.shared === "bool") value.shared ??= 0;
      value.seq = siblings().length + 1;
      if (spec.parent) value[`${spec.parent}_id`] = parentId;
      emit({ op: "add", path: `/${table}/-`, value });
      return;
    }

    const row = rows[key ?? ""];
    if (!row || (spec.parent && !same(row[`${spec.parent}_id`], parentId))) return;

    if (col === undefined) {
      if (op.op !== "remove") return;
      forget(table, row.id);
      for (const child of spec.children ?? []) for (const r of Object.values(d[child as keyof Doc] as Rows)) if (same(r[`${table}_id`], row.id)) forget(child, r.id);
      emit({ op: "remove", path: `/${table}/${row.id}` });
      return;
    }

    if (spec.children?.includes(col)) return list(col, row.id, more, op);
    const kind = spec.columns[col];
    if (!kind || more.length) return;

    if (kind === "seq") {
      const to = op.op === "remove" ? undefined : integer(op.value);
      if (to === undefined) return;
      const order = siblings();
      const from = order.findIndex((r) => same(r.id, row.id));
      order.splice(from, 1);
      order.splice(Math.min(Math.max(to, 1), order.length + 1) - 1, 0, row);
      order.forEach((r, i) => {
        if (Number(r.seq) !== i + 1) emit({ op: "replace", path: `/${table}/${r.id}/seq`, value: i + 1 });
      });
      return;
    }

    const value = coerce(kind, op);
    if (value === undefined || row[col] === value) return;
    emit({ op: "replace", path: `/${table}/${row.id}/${col}`, value });
  }

  /** What goes with a row taken off: a gift's claims, and every choice of a course, a dish or a drink. */
  function forget(table: string, id: string): void {
    if (table === "gifts") for (const c of Object.values(d.claims)) if (same(c.gift_id, id)) emit({ op: "remove", path: `/claims/${c.id}` });
    if (table !== "courses" && table !== "dishes" && table !== "drinks") return;
    for (const g of Object.values(d.guests)) {
      const choices = structuredClone((g.choices as Record<string, { dish: number | null; drink: number | null }> | null) ?? {});
      let moved = false;
      for (const [course, choice] of Object.entries(choices)) {
        if (table === "courses" && same(course, id)) {
          delete choices[course];
          moved = true;
        } else if (table === "dishes" && same(choice.dish, id)) {
          choice.dish = null;
          moved = true;
        } else if (table === "drinks" && same(choice.drink, id)) {
          choice.drink = null;
          moved = true;
        }
      }
      if (moved) emit({ op: "replace", path: `/guests/${g.id}/choices`, value: choices });
    }
  }
}

/** The board as delta holds it, for `shape`. */
export const held = (id = WEDDING): Doc => readDoc<Doc>(`board:${id}`);
