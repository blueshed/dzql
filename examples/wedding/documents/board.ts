import type { SQLQueryBindings } from "bun:sqlite";
import { db } from "../db";
import { reading } from "../../../src/reading";
import type { PatchOp } from "../../../src/json-patch";
import { parsePointer } from "../../../src/json-pointer";
import { prefixDoc, record } from "../../../src/ledger";
import * as householdDoc from "./household";
import { courses, events, gifts, places, type Course, type Event, type Gift, type Place, type Wedding } from "./wedding";
import { integer, restore, text, yesNo } from "./values";

// The couple's document: the wedding and everything beneath it -- every household whole, the
// courses with their dishes and drinks, the gifts, the events, where to stay, and the totals the
// caterer needs. The couple own the ground, so every list is written here; a household only ever
// reads them (documents/wedding.ts).

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
  households: householdDoc.HouseholdDocument[];
  courses: Course[];
  gifts: Gift[];
  events: Event[];
  places: Place[];
  totals: Totals;
};

type Row = Record<string, unknown>;

const boardStmt = db.query<Wedding, [string]>(
  "SELECT id, code, day, deadline, name1, name2, venue, message, picture_key FROM weddings WHERE code = ?",
);
const householdCodesStmt = db.query<{ code: string }, [number]>("SELECT code FROM households WHERE wedding_id = ? ORDER BY code");
const householdOfStmt = db.query<{ id: number; code: string; email: string; plus_ones: number }, [number, number]>(
  "SELECT id, code, email, plus_ones FROM households WHERE id = ? AND wedding_id = ?",
);
const insertHouseholdStmt = db.query<unknown, [number | null, number, string | null, string, number, string | null, string | null]>(
  "INSERT INTO households (id, wedding_id, code, email, plus_ones, answer, message) VALUES (?, ?, ?, ?, ?, ?, ?)",
);
const deleteHouseholdStmt = db.query<unknown, [number]>("DELETE FROM households WHERE id = ?");
const setEmailStmt = db.query<unknown, [string, number]>("UPDATE households SET email = ? WHERE id = ?");
const setPlusOnesStmt = db.query<unknown, [number, number]>("UPDATE households SET plus_ones = ? WHERE id = ?");
const askOfStmt = db.query<householdDoc.Ask, [number, number]>(
  "SELECT id, name, asked_at, reply, guest_id FROM asks WHERE id = ? AND household_id = ?",
);
const askForGuestStmt = db.query<{ id: number }, [number]>("SELECT id FROM asks WHERE guest_id = ?");
const setReplyStmt = db.query<unknown, [string | null, number]>("UPDATE asks SET reply = ? WHERE id = ?");
const setAskGuestStmt = db.query<unknown, [number | null, number]>("UPDATE asks SET guest_id = ? WHERE id = ?");
const insertClaimStmt = db.query<unknown, [number, number]>("INSERT INTO gift_claims (gift_id, household_id) VALUES (?, ?)");
const claimsOfGiftStmt = db.query<{ household_id: number }, [number]>("SELECT household_id FROM gift_claims WHERE gift_id = ? ORDER BY id");

function totals(households: householdDoc.HouseholdDocument[], cs: Course[]): Totals {
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

export function read(code: string): BoardDocument | undefined {
  reading("board", code);
  const w = boardStmt.get(code);
  if (!w) return undefined;
  const households = householdCodesStmt.all(w.id).map((r) => householdDoc.read(r.code)!);
  const cs = courses();
  return { ...w, households, courses: cs, gifts: gifts(), events: events(), places: places(), totals: totals(households, cs) };
}

// ───────────────────────────── the wedding's own fields ─────────────────────────────

type Col = "text" | "text?" | "bool" | "seq";

const ROOT: Record<string, Col> = { name1: "text", name2: "text", day: "text", deadline: "text?", venue: "text?", message: "text?", picture_key: "text?" };
const setRootStmts = Object.fromEntries(
  Object.keys(ROOT).map((col) => [col, db.query<unknown, [SQLQueryBindings, number]>(`UPDATE weddings SET ${col} = ? WHERE id = ?`)]),
);

/** The value a column of this kind takes from an op, or undefined when the op can't be applied to it. */
function coerce(kind: Col, op: PatchOp): unknown {
  const removing = op.op === "remove";
  if (kind === "text") return removing ? undefined : (text(op.value) ?? undefined);
  if (kind === "text?") return removing ? null : text(op.value);
  if (kind === "bool") return removing ? 0 : yesNo(op.value);
  return undefined; // seq is a move, handled by its own branch
}

const isDate = (value: unknown): boolean => typeof value === "string" && !Number.isNaN(new Date(value).getTime());

function applyRoot(w: Wedding, col: string, op: PatchOp): PatchOp[] | undefined {
  const kind = ROOT[col];
  if (!kind) return;
  const value = coerce(kind, op);
  if (value === undefined) return;
  if ((col === "day" || col === "deadline") && value !== null && !isDate(value)) return;
  const before = w[col as keyof Wedding];
  if (before === value) return;
  setRootStmts[col]!.run(value as SQLQueryBindings, w.id);
  return [restore(op.path, before)];
}

// ───────────────────────────── the lists ─────────────────────────────
// Courses (with dishes and drinks beneath), gifts, events, places: one shape, one set of
// statements built from this registry -- the table and column names come from here, never from
// the wire. Every row has a `seq`; a write to it is a move, and the rows are renumbered.

type ListSpec = { parent: string; columns: Record<string, Col>; children?: string[] };

const LISTS: Record<string, ListSpec> = {
  courses: { parent: "wedding_id", columns: { name: "text", seq: "seq" }, children: ["dishes", "drinks"] },
  dishes: { parent: "course_id", columns: { name: "text", dietary: "text?", seq: "seq" } },
  drinks: { parent: "course_id", columns: { name: "text", seq: "seq" } },
  gifts: { parent: "wedding_id", columns: { name: "text", description: "text?", link: "text?", picture_key: "text?", shared: "bool", seq: "seq" } },
  events: { parent: "wedding_id", columns: { name: "text", when_at: "text?", where_at: "text?", notes: "text?", seq: "seq" } },
  places: { parent: "wedding_id", columns: { name: "text", notes: "text?", link: "text?", picture_key: "text?", seq: "seq" } },
};

/** The tables a path may start with, in a document rooted at the wedding. */
const TOP_LISTS = ["courses", "gifts", "events", "places"];

function rowsOf(table: string, parentId: number): Row[] {
  return db.query<Row, [number]>(`SELECT * FROM ${table} WHERE ${LISTS[table]!.parent} = ? ORDER BY seq, id`).all(parentId);
}

function rowOf(table: string, parentId: number, id: number): Row | undefined {
  return rowsOf(table, parentId).find((r) => r.id === id);
}

/** A row whole, with its children (and a gift's claims, by household id), so an undo of its removal puts everything back. */
function snapshot(table: string, parentId: number, id: number): Row {
  const row = rowOf(table, parentId, id)!;
  for (const child of LISTS[table]!.children ?? []) row[child] = rowsOf(child, id).map((r) => snapshot(child, id, Number(r.id)));
  if (table === "gifts") row.claims = claimsOfGiftStmt.all(id).map((c) => c.household_id);
  return row;
}

/** Inserts a row from a wire value (a bare name, or a whole row coming back through undo); undefined if it has no name. */
function insertRow(table: string, parentId: number, value: unknown): number | undefined {
  const spec = LISTS[table]!;
  const v = (typeof value === "string" ? { name: value } : (value ?? {})) as Row;
  const cols: Record<string, unknown> = {};
  for (const [col, kind] of Object.entries(spec.columns)) {
    if (kind === "seq") continue;
    const given = v[col];
    if (given === undefined) continue;
    cols[col] = kind === "bool" ? (yesNo(given) ?? 0) : text(given);
  }
  if (!cols.name) return;
  if (spec.columns.shared === "bool" && cols.shared === undefined) cols.shared = 0;
  const seq = integer(v.seq) ?? rowsOf(table, parentId).length + 1;
  const names = ["id", spec.parent, "seq", ...Object.keys(cols)];
  const values = [integer(v.id) ?? null, parentId, seq, ...Object.values(cols)] as SQLQueryBindings[];
  const result = db
    .query<unknown, SQLQueryBindings[]>(`INSERT INTO ${table} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`)
    .run(...values);
  const id = integer(v.id) ?? Number(result.lastInsertRowid);
  for (const child of spec.children ?? []) {
    for (const item of (Array.isArray(v[child]) ? v[child] : []) as unknown[]) insertRow(child, id, item);
  }
  if (table === "gifts") {
    for (const householdId of (Array.isArray(v.claims) ? v.claims : []) as number[]) insertClaimStmt.run(id, householdId);
  }
  return id;
}

function deleteRow(table: string, id: number): void {
  db.query<unknown, [number]>(`DELETE FROM ${table} WHERE id = ?`).run(id);
}

function setCol(table: string, id: number, col: string, value: unknown): void {
  db.query<unknown, [SQLQueryBindings, number]>(`UPDATE ${table} SET ${col} = ? WHERE id = ?`).run(value as SQLQueryBindings, id);
}

/** Where a row stands in its list, 1-based. */
function position(table: string, parentId: number, id: number): number {
  return rowsOf(table, parentId).findIndex((r) => r.id === id) + 1;
}

/** Moves a row to the 1-based position `to` (clamped), renumbering the list 1..N. */
function move(table: string, parentId: number, id: number, to: number): void {
  const rows = rowsOf(table, parentId);
  const moving = rows.find((r) => r.id === id)!;
  const rest = rows.filter((r) => r.id !== id);
  rest.splice(Math.min(Math.max(to, 1), rows.length) - 1, 0, moving);
  rest.forEach((r, i) => setCol(table, Number(r.id), "seq", i + 1));
}

function applyList(table: string, parentId: number, seg: string[], base: string, op: PatchOp): PatchOp[] | undefined {
  const spec = LISTS[table]!;
  const [key, ...rest] = seg;

  if (key === "-") {
    if (op.op !== "add" || rest.length) return;
    const id = insertRow(table, parentId, op.value);
    return id === undefined ? undefined : [{ op: "remove", path: `${base}/${id}` }];
  }

  const id = integer(key);
  const row = id === undefined ? undefined : rowOf(table, parentId, id);
  if (!row || id === undefined) return;

  if (rest.length === 0) {
    if (op.op !== "remove") return;
    const whole = snapshot(table, parentId, id);
    deleteRow(table, id);
    return [{ op: "add", path: `${base}/-`, value: whole }];
  }

  const [col, ...more] = rest;
  if (col && spec.children?.includes(col)) return applyList(col, id, more, `${base}/${id}/${col}`, op);
  const kind = col ? spec.columns[col] : undefined;
  if (!kind || more.length) return;

  if (kind === "seq") {
    const to = op.op === "remove" ? undefined : integer(op.value);
    if (to === undefined) return;
    const from = position(table, parentId, id);
    move(table, parentId, id, to);
    if (position(table, parentId, id) === from) return;
    return [{ op: "replace", path: op.path, value: from }];
  }

  const value = coerce(kind, op);
  if (value === undefined || row[col!] === value) return;
  setCol(table, id, col!, value);
  return [restore(op.path, row[col!])];
}

// ───────────────────────────── the households ─────────────────────────────

type HouseholdValue = Partial<householdDoc.HouseholdDocument> & { email: string; names?: string };

function householdValue(value: unknown): HouseholdValue | undefined {
  const v = (typeof value === "string" ? { email: value } : value) as Partial<HouseholdValue> | null;
  const email = text(v?.email);
  return email && email.includes("@") ? { ...v, email } : undefined;
}

/** Inserts a household (the trigger mints its code unless the value brings one back), its guests -- from `names` on an invitation, or whole from a snapshot -- its asks and its claims. */
function insertHousehold(weddingId: number, v: HouseholdValue): number {
  const result = insertHouseholdStmt.run(v.id ?? null, weddingId, v.code ?? null, v.email, v.plus_ones ?? 0, v.answer ?? null, v.message ?? null);
  const id = v.id ?? Number(result.lastInsertRowid);
  const guests: householdDoc.GuestValue[] = v.guests ?? (v.names ?? "").split(/[,\n]/).map((name) => ({ name: name.trim() })).filter((g) => g.name);
  for (const guest of guests) householdDoc.addGuest(id, guest, "couple");
  for (const ask of v.asks ?? []) householdDoc.addAsk(id, ask);
  for (const giftId of v.claims ?? []) householdDoc.claim(giftId, id);
  return id;
}

/** A guest value on the board may also say which ask brought them, so an undo relinks the two. */
type BoardGuestValue = householdDoc.GuestValue & { ask_id?: number };

function applyHouseholds(w: Wedding, seg: string[], op: PatchOp): PatchOp[] | undefined {
  const [key, ...rest] = seg;

  if (key === "-") {
    const value = op.op === "add" && !rest.length ? householdValue(op.value) : undefined;
    if (!value) return;
    const id = insertHousehold(w.id, value);
    return [{ op: "remove", path: `/households/${id}` }];
  }

  const hid = integer(key);
  const h = hid === undefined ? undefined : householdOfStmt.get(hid, w.id);
  if (!h) return;
  const base = `/households/${h.id}`;

  if (rest.length === 0) {
    // Only reachable via undo: walks back an invitation, and the whole household comes back with it.
    if (op.op !== "remove") return;
    const whole = householdDoc.read(h.code)!;
    deleteHouseholdStmt.run(h.id);
    return [{ op: "add", path: "/households/-", value: whole }];
  }

  const [field, key2, ...more] = rest;

  if (field === "email" && rest.length === 1) {
    const value = householdValue(op.value)?.email;
    if (!value || value === h.email) return;
    setEmailStmt.run(value, h.id);
    return [{ op: "replace", path: op.path, value: h.email }];
  }

  if (field === "plus_ones" && rest.length === 1) {
    const value = integer(op.value);
    if (value === undefined || value < 0 || value === h.plus_ones) return;
    setPlusOnesStmt.run(value, h.id);
    return [{ op: "replace", path: op.path, value: h.plus_ones }];
  }

  if (field === "guests") {
    if (key2 === "-") {
      if (op.op !== "add" || more.length) return;
      const raw = (typeof op.value === "string" ? { name: op.value } : (op.value ?? {})) as BoardGuestValue;
      const name = text(raw.name);
      if (!name) return;
      const gid = householdDoc.addGuest(h.id, { ...raw, name }, "couple");
      if (raw.ask_id !== undefined) setAskGuestStmt.run(gid, raw.ask_id);
      return [{ op: "remove", path: `${base}/guests/${gid}` }];
    }
    const gid = integer(key2);
    const guest = gid === undefined ? undefined : householdDoc.guestOf(h.id, gid);
    if (!guest || more.length || op.op !== "remove") return;
    const ask = askForGuestStmt.get(guest.id);
    householdDoc.removeGuest(guest.id);
    return [{ op: "add", path: `${base}/guests/-`, value: { ...guest, ...(ask ? { ask_id: ask.id } : {}) } }];
  }

  if (field === "asks") {
    const aid = integer(key2);
    const ask = aid === undefined ? undefined : askOfStmt.get(aid, h.id);
    if (!ask || more.length !== 1 || more[0] !== "reply") return;
    const value = op.op === "remove" ? null : op.value;
    if (value !== null && value !== "yes" && value !== "no") return;
    if (ask.reply === value) return;
    setReplyStmt.run(value, ask.id);
    const inverse: PatchOp[] = [restore(op.path, ask.reply)];
    if (value === "yes" && ask.guest_id === null) {
      // A yes makes a guest (brief.md), remembered on the ask so a change of mind takes them out again.
      const gid = householdDoc.addGuest(h.id, { name: ask.name, coming: 1 }, "ask");
      setAskGuestStmt.run(gid, ask.id);
    } else if (value !== "yes" && ask.guest_id !== null) {
      // Taking the yes back takes the guest with it; the inverse puts them back first, whole,
      // then restores the yes (which then finds its guest already there and makes no second one).
      const guest = householdDoc.guestOf(h.id, ask.guest_id);
      if (guest) {
        householdDoc.removeGuest(guest.id);
        inverse.unshift({ op: "add", path: `${base}/guests/-`, value: { ...guest, ask_id: ask.id } });
      }
    }
    return inverse;
  }

  return;
}

/** Applies one op to the wedding, returning the ops that undo it -- or undefined if it did not apply. */
function applyOne(w: Wedding, op: PatchOp): PatchOp[] | undefined {
  const [head, ...rest] = parsePointer(op.path);
  if (!head) return;
  if (rest.length === 0 && head in ROOT) return applyRoot(w, head, op);
  if (head === "households") return applyHouseholds(w, rest, op);
  if (TOP_LISTS.includes(head)) return applyList(head, w.id, rest, `/${head}`, op);
  return;
}

export type BoardPatchResult = { version: number; applied: PatchOp[] };

/** Applies a patch to the wedding with this code, recording it (and its inverse) on the ledger. One transaction: every statement here (including a household's own, reached through the helpers above), the ledger row, and the version it returns commit together or not at all. */
export const patch = db.transaction(function patch(code: string, ops: PatchOp[], sessionId: string, undoes?: number): BoardPatchResult {
  const applied: PatchOp[] = [];
  const inverse: PatchOp[] = [];

  for (const op of ops) {
    const w = boardStmt.get(code);
    if (!w) break;
    const undo = applyOne(w, op);
    if (!undo) continue;
    applied.push(op);
    inverse.unshift(...undo);
  }

  const version = record(prefixDoc("board", code), applied, inverse, sessionId, undoes);
  return { version, applied };
});
