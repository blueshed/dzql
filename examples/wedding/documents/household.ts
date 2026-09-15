import { db } from "../db";
import type { PatchOp } from "../../../src/json-patch";
import { parsePointer } from "../../../src/json-pointer";
import { prefixDoc, record } from "../../../src/ledger";
import { allowsLook, isLookField, LOOK_FIELDS, type Look, type LookField } from "../looks";
import { integer, restore, text, yesNo } from "./values";

// A household's document: the answer, the message, the guests (each with its minifigure and its
// choices), the asks, and the gifts it has claimed. The household writes it by its code; the
// couple read every household's through the board (documents/board.ts), which also reuses the
// guest and ask helpers here so a household removed and restored by undo comes back whole.

export type Answer = "yes" | "maybe" | "no";
export type NamedBy = "couple" | "household" | "ask";
export type Choice = { dish: number | null; drink: number | null };
export type Guest = {
  id: number;
  name: string;
  named_by: NamedBy;
  coming: number | null;
  minifigure: Look;
  /** By course id: the dish and the drink chosen, either possibly null. */
  choices: Record<string, Choice>;
};
export type Ask = { id: number; name: string; asked_at: string; reply: "yes" | "no" | null; guest_id: number | null };
export type HouseholdDocument = {
  id: number;
  code: string;
  email: string;
  plus_ones: number;
  answer: Answer | null;
  message: string | null;
  guests: Guest[];
  asks: Ask[];
  /** The ids of the gifts this household has claimed. */
  claims: number[];
};

type HouseholdRow = Omit<HouseholdDocument, "guests" | "asks" | "claims">;
type GuestRow = Omit<Guest, "minifigure" | "choices"> & Look;

const householdStmt = db.query<HouseholdRow, [string]>(
  "SELECT id, code, email, plus_ones, answer, message FROM households WHERE code = ?",
);
const guestsStmt = db.query<GuestRow, [number]>(`
  SELECT g.id, g.name, g.named_by, g.coming, m.skin, m.hair, m.hair_color, m.top, m.legs, m.face, m.attitude, m.built_at
  FROM guests g JOIN minifigures m ON m.guest_id = g.id
  WHERE g.household_id = ? ORDER BY g.id
`);
const choicesStmt = db.query<{ guest_id: number; course_id: number; dish_id: number | null; drink_id: number | null }, [number]>(
  "SELECT guest_id, course_id, dish_id, drink_id FROM choices WHERE guest_id IN (SELECT id FROM guests WHERE household_id = ?)",
);
const asksStmt = db.query<Ask, [number]>("SELECT id, name, asked_at, reply, guest_id FROM asks WHERE household_id = ? ORDER BY id");
const claimsStmt = db.query<{ gift_id: number }, [number]>("SELECT gift_id FROM gift_claims WHERE household_id = ? ORDER BY id");

const setAnswerStmt = db.query<unknown, [string | null, number]>("UPDATE households SET answer = ? WHERE id = ?");
const setMessageStmt = db.query<unknown, [string | null, number]>("UPDATE households SET message = ? WHERE id = ?");
const insertGuestStmt = db.query<unknown, [number | null, number, string, string, number | null]>(
  "INSERT INTO guests (id, household_id, name, named_by, coming) VALUES (?, ?, ?, ?, ?)",
);
const deleteGuestStmt = db.query<unknown, [number]>("DELETE FROM guests WHERE id = ?");
const setComingStmt = db.query<unknown, [number | null, number]>("UPDATE guests SET coming = ? WHERE id = ?");
// One statement per column: the column name comes from the model's own list, never the wire.
const setLookStmts = Object.fromEntries(
  [...LOOK_FIELDS, "built_at"].map((field) => [field, db.query<unknown, [string | null, number]>(`UPDATE minifigures SET ${field} = ? WHERE guest_id = ?`)]),
) as Record<LookField | "built_at", ReturnType<typeof db.query<unknown, [string | null, number]>>>;
const courseExistsStmt = db.query<{ id: number }, [number]>("SELECT id FROM courses WHERE id = ?");
const dishInCourseStmt = db.query<{ id: number }, [number, number]>("SELECT id FROM dishes WHERE id = ? AND course_id = ?");
const drinkInCourseStmt = db.query<{ id: number }, [number, number]>("SELECT id FROM drinks WHERE id = ? AND course_id = ?");
const upsertChoiceStmt = db.query<unknown, [number, number, number | null, number | null]>(`
  INSERT INTO choices (guest_id, course_id, dish_id, drink_id) VALUES (?1, ?2, ?3, ?4)
  ON CONFLICT(guest_id, course_id) DO UPDATE SET dish_id = ?3, drink_id = ?4
`);
const insertAskStmt = db.query<unknown, [number | null, number, string, string, string | null, number | null]>(
  "INSERT INTO asks (id, household_id, name, asked_at, reply, guest_id) VALUES (?, ?, ?, ?, ?, ?)",
);
const deleteAskStmt = db.query<unknown, [number]>("DELETE FROM asks WHERE id = ?");
const giftExistsStmt = db.query<{ id: number }, [number]>("SELECT id FROM gifts WHERE id = ?");
const insertClaimStmt = db.query<unknown, [number, number]>("INSERT INTO gift_claims (gift_id, household_id) VALUES (?, ?)");
const deleteClaimStmt = db.query<unknown, [number, number]>("DELETE FROM gift_claims WHERE gift_id = ? AND household_id = ?");

function guestsOf(householdId: number): Guest[] {
  const choices = choicesStmt.all(householdId);
  return guestsStmt.all(householdId).map(({ skin, hair, hair_color, top, legs, face, attitude, built_at, ...guest }) => ({
    ...guest,
    minifigure: { skin, hair, hair_color, top, legs, face, attitude, built_at },
    choices: Object.fromEntries(
      choices.filter((c) => c.guest_id === guest.id).map((c) => [String(c.course_id), { dish: c.dish_id, drink: c.drink_id }]),
    ),
  }));
}

export function read(code: string): HouseholdDocument | undefined {
  const row = householdStmt.get(code);
  if (!row) return undefined;
  return { ...row, guests: guestsOf(row.id), asks: asksStmt.all(row.id), claims: claimsStmt.all(row.id).map((c) => c.gift_id) };
}

/** One guest of a household, whole (the shape an undo puts back), or undefined if no such guest is theirs. */
export function guestOf(householdId: number, guestId: number): Guest | undefined {
  return guestsOf(householdId).find((g) => g.id === guestId);
}

/** What an add on /guests/- carries: a bare name, or a whole guest coming back through undo. */
export type GuestValue = Partial<Omit<Guest, "name" | "minifigure">> & { name: string; minifigure?: Partial<Look> };

function guestValue(value: unknown): GuestValue | undefined {
  const v = (typeof value === "string" ? { name: value } : value) as Partial<GuestValue> | null;
  const name = text(v?.name);
  return name ? { ...v, name } : undefined;
}

/** Inserts a guest (with a blank minifigure, by trigger), then restores whatever look and choices the value carries. Returns the guest's id. */
export function addGuest(householdId: number, value: GuestValue, namedBy: NamedBy): number {
  const result = insertGuestStmt.run(value.id ?? null, householdId, value.name, value.named_by ?? namedBy, value.coming ?? null);
  const id = value.id ?? Number(result.lastInsertRowid);
  for (const field of [...LOOK_FIELDS, "built_at"] as const) {
    const v = value.minifigure?.[field];
    if (v !== undefined) setLookStmts[field].run(v, id);
  }
  for (const [courseId, choice] of Object.entries(value.choices ?? {})) {
    upsertChoiceStmt.run(id, Number(courseId), choice.dish, choice.drink);
  }
  return id;
}

export function removeGuest(guestId: number): void {
  deleteGuestStmt.run(guestId);
}

export type AskValue = Partial<Ask> & { name: string };

function askValue(value: unknown): AskValue | undefined {
  const v = (typeof value === "string" ? { name: value } : value) as Partial<AskValue> | null;
  const name = text(v?.name);
  return name ? { ...v, name } : undefined;
}

export function addAsk(householdId: number, value: AskValue): number {
  const result = insertAskStmt.run(
    value.id ?? null,
    householdId,
    value.name,
    value.asked_at ?? new Date().toISOString(),
    value.reply ?? null,
    value.guest_id ?? null,
  );
  return value.id ?? Number(result.lastInsertRowid);
}

/** A claim on a gift by a household. False when the store refuses it: the gift is taken, or already theirs. */
export function claim(giftId: number, householdId: number): boolean {
  try {
    insertClaimStmt.run(giftId, householdId);
    return true;
  } catch {
    return false;
  }
}

const isAnswer = (value: unknown): value is Answer => value === "yes" || value === "maybe" || value === "no";

/** Applies one op to a household, returning the ops that undo it -- or undefined if it did not apply. */
function applyOne(h: HouseholdRow, op: PatchOp): PatchOp[] | undefined {
  const seg = parsePointer(op.path);
  const [head, second, third, fourth, fifth] = seg;
  const removing = op.op === "remove";

  if (head === "answer" && seg.length === 1) {
    const value = removing ? null : op.value;
    if (value !== null && !isAnswer(value)) return;
    if (h.answer === value) return;
    setAnswerStmt.run(value, h.id);
    return [restore("/answer", h.answer)];
  }

  if (head === "message" && seg.length === 1) {
    const value = removing ? null : text(op.value);
    if (h.message === value) return;
    setMessageStmt.run(value, h.id);
    return [restore("/message", h.message)];
  }

  if (head === "guests") {
    if (second === "-") {
      const value = op.op === "add" ? guestValue(op.value) : undefined;
      if (!value) return;
      const id = addGuest(h.id, value, "household");
      return [{ op: "remove", path: `/guests/${id}` }];
    }
    const gid = integer(second);
    const guest = gid === undefined ? undefined : guestOf(h.id, gid);
    if (!guest) return;

    if (seg.length === 2) {
      // Only reachable via undo (the compartment's permit() never allows a remove here): walks back a plus-one.
      if (!removing) return;
      removeGuest(guest.id);
      return [{ op: "add", path: "/guests/-", value: guest }];
    }

    if (third === "coming" && seg.length === 3) {
      const value = removing ? null : yesNo(op.value);
      if (value === undefined || guest.coming === value) return;
      setComingStmt.run(value, guest.id);
      return [restore(op.path, guest.coming)];
    }

    if (third === "minifigure" && seg.length === 4 && fourth) {
      if (fourth === "built_at") {
        // Only reachable via undo: the first touch on a blank minifigure stamps built_at, and its inverse unstamps it.
        const value = removing ? null : text(op.value);
        setLookStmts.built_at.run(value, guest.id);
        return [restore(op.path, guest.minifigure.built_at)];
      }
      if (!isLookField(fourth) || removing || !allowsLook(fourth, op.value)) return;
      if (guest.minifigure[fourth] === op.value) return;
      setLookStmts[fourth].run(op.value, guest.id);
      const inverse: PatchOp[] = [{ op: "replace", path: op.path, value: guest.minifigure[fourth] }];
      if (guest.minifigure.built_at === null) {
        setLookStmts.built_at.run(new Date().toISOString(), guest.id);
        inverse.push({ op: "remove", path: `/guests/${guest.id}/minifigure/built_at` });
      }
      return inverse;
    }

    if (third === "choices" && seg.length === 5 && (fifth === "dish" || fifth === "drink")) {
      const courseId = integer(fourth);
      if (courseId === undefined || !courseExistsStmt.get(courseId)) return;
      const current = guest.choices[String(courseId)] ?? { dish: null, drink: null };
      let value: number | null = null;
      if (!removing) {
        const id = integer(op.value);
        const offered = id === undefined ? undefined : fifth === "dish" ? dishInCourseStmt.get(id, courseId) : drinkInCourseStmt.get(id, courseId);
        if (!offered) return;
        value = id!;
      }
      if (current[fifth] === value) return;
      const next = { ...current, [fifth]: value };
      upsertChoiceStmt.run(guest.id, courseId, next.dish, next.drink);
      return [restore(op.path, current[fifth])];
    }
    return;
  }

  if (head === "asks") {
    if (second === "-") {
      const value = op.op === "add" ? askValue(op.value) : undefined;
      if (!value) return;
      const id = addAsk(h.id, value);
      return [{ op: "remove", path: `/asks/${id}` }];
    }
    const aid = integer(second);
    const ask = aid === undefined ? undefined : asksStmt.all(h.id).find((a) => a.id === aid);
    if (!ask || seg.length !== 2 || !removing) return;
    // Only reachable via undo: walks back an ask.
    deleteAskStmt.run(ask.id);
    return [{ op: "add", path: "/asks/-", value: ask }];
  }

  if (head === "claims") {
    if (second === "-") {
      const giftId = op.op === "add" ? integer(op.value) : undefined;
      if (giftId === undefined || !giftExistsStmt.get(giftId) || !claim(giftId, h.id)) return;
      return [{ op: "remove", path: `/claims/${giftId}` }];
    }
    const giftId = integer(second);
    if (giftId === undefined || !removing || seg.length !== 2) return;
    if (deleteClaimStmt.run(giftId, h.id).changes === 0) return;
    return [{ op: "add", path: "/claims/-", value: giftId }];
  }

  return;
}

export type HouseholdPatchResult = { version: number; applied: PatchOp[] };

/** Applies a patch to the household with this code, recording it (and its inverse) on the ledger. One transaction: every statement here, the ledger row, and the version it returns commit together or not at all. */
export const patch = db.transaction(function patch(code: string, ops: PatchOp[], sessionId: string, undoes?: number): HouseholdPatchResult {
  const applied: PatchOp[] = [];
  const inverse: PatchOp[] = [];

  for (const op of ops) {
    const h = householdStmt.get(code);
    if (!h) break;
    const undo = applyOne(h, op);
    if (!undo) continue;
    applied.push(op);
    inverse.unshift(...undo);
  }

  const version = record(prefixDoc("household", code), applied, inverse, sessionId, undoes);
  return { version, applied };
});
