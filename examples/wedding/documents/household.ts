import { db } from "../delta";
import { read as readDoc } from "../../../src/documents";
import type { PatchOp } from "../../../src/json-patch";
import { splitPath } from "@blueshed/delta/core";
import { allowsLook, isLookField, LOOK_FIELDS, type Look } from "../looks";
import type { Course, Row, Rows } from "./wedding";
import { integer, text, yesNo } from "./values";

// A household's document, kept in delta (`household:<id>`, ../delta.ts): the answer, the message,
// the guests (each wearing a minifigure, with their choices), the asks, and the gifts it has
// claimed. The household writes it; the couple read every household through the board
// (documents/board.ts), which builds each one with `householdFrom` here.

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

const byId = (a: Row, b: Row) => Number(a.id) - Number(b.id);

export const guestOf = (g: Row): Guest => ({
  id: Number(g.id),
  name: g.name as string,
  named_by: g.named_by as NamedBy,
  coming: (g.coming as number | null) ?? null,
  minifigure: Object.fromEntries([...LOOK_FIELDS, "built_at"].map((f) => [f, g[f] ?? null])) as Look,
  choices: (g.choices as Record<string, Choice> | null) ?? {},
});

/** A household whole, from its row and the guests, asks and claims that stand on it (in whichever document holds them). */
export function householdFrom(h: Row, rows: { guests?: Rows; asks?: Rows; claims?: Rows }): HouseholdDocument {
  const mine = (r: Row) => r.households_id === h.id;
  return {
    id: Number(h.id),
    code: h.code as string,
    email: h.email as string,
    plus_ones: Number(h.plus_ones),
    answer: (h.answer as Answer | null) ?? null,
    message: (h.message as string | null) ?? null,
    guests: Object.values(rows.guests ?? {}).filter(mine).sort(byId).map(guestOf),
    asks: Object.values(rows.asks ?? {})
      .filter(mine)
      .sort(byId)
      .map((a) => ({ id: Number(a.id), name: a.name as string, asked_at: a.asked_at as string, reply: (a.reply as Ask["reply"]) ?? null, guest_id: a.guest_id == null ? null : Number(a.guest_id) })),
    claims: Object.values(rows.claims ?? {})
      .filter(mine)
      .sort((a, b) => String(a.claimed_at).localeCompare(String(b.claimed_at)))
      .map((c) => Number(c.gift_id)),
  };
}

export function read(id: string): HouseholdDocument | undefined {
  const doc = readDoc<{ households: Row | null; guests?: Rows; asks?: Rows; claims?: Rows } | undefined>(`household:${id}`);
  return doc?.households ? householdFrom(doc.households, doc) : undefined;
}

let minted = 0;

/**
 * An id for a row the same write refers to (a new household, which its guests name; the guest a
 * yes makes, which its ask names): a row added at `-` is named by delta only as the write lands.
 * An add may name only an id past every one delta's serial has handed out, which nothing here
 * reads, so this one is past any it could have reached -- the clock in microseconds, climbing, as
 * delta's docs say -- and the serial moves on past it. A stopgap until delta lets a write refer
 * to a row it makes at `-`.
 */
export const newId = (): string => String((minted = Math.max(Date.now() * 1000, minted + 1)));

/** A claim's own key: the gift and the household, so the one gift may be claimed by many (when shared). */
export const claimKey = (giftId: number, householdId: number): string => `${giftId}-${householdId}`;

const claimedStmt = db.query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM wedding_claims WHERE gift_id = ?");

/** What a household may choose from and claim: the courses, and the gifts that are there and shared or not yet taken. */
export type Offer = { courses: Course[]; gifts: { id: number; shared: boolean }[] };

const isAnswer = (value: unknown): value is Answer => value === "yes" || value === "maybe" || value === "no";

/**
 * A household's write, as the document takes it. The wire says it the household's way -- `/answer`,
 * `/guests/2/minifigure/top`, `/guests/2/choices/2/dish`, `/claims/-` with a gift's id -- and each
 * is checked (a valid value, a change, a dish the course offers, a gift not taken) and becomes the
 * rows it moves. The wire may name a plus-one or an ask and nothing more, and a plus-one only
 * while one is owed, counted down across the message. Delta's inverse is what undo walks.
 */
export function shape(h: HouseholdDocument, offer: Offer, ops: PatchOp[], now = new Date().toISOString()): PatchOp[] {
  const out: PatchOp[] = [];
  const guests = new Map(h.guests.map((g) => [g.id, structuredClone(g)]));
  let answer = h.answer;
  let message = h.message;
  let owed = h.plus_ones - h.guests.filter((g) => g.named_by === "household").length;
  const claims = new Set(h.claims);
  const nameOf = (value: unknown) => text(typeof value === "string" ? value : (value as { name?: unknown } | null)?.name);

  for (const op of ops) {
    const [head, second, third, fourth, fifth] = splitPath(op.path);
    const removing = op.op === "remove";

    if (head === "answer") {
      const value = removing ? null : op.value;
      if ((value !== null && !isAnswer(value)) || value === answer) continue;
      answer = value;
      out.push({ op: "replace", path: "/households/answer", value });
    } else if (head === "message") {
      const value = removing ? null : text(op.value);
      if (value === message) continue;
      message = value;
      out.push({ op: "replace", path: "/households/message", value });
    } else if (head === "guests" && second === "-") {
      const name = op.op === "add" ? nameOf(op.value) : null;
      if (!name || owed-- <= 0) continue;
      out.push({ op: "add", path: "/guests/-", value: { name, named_by: "household" } });
    } else if (head === "guests") {
      const guest = guests.get(integer(second) ?? -1);
      if (!guest) continue;
      if (third === "coming" && fourth === undefined) {
        const value = removing ? null : yesNo(op.value);
        if (value === undefined || value === guest.coming) continue;
        guest.coming = value;
        out.push({ op: "replace", path: `/guests/${guest.id}/coming`, value });
      } else if (third === "minifigure" && fourth && isLookField(fourth) && fifth === undefined) {
        if (removing || !allowsLook(fourth, op.value) || guest.minifigure[fourth] === op.value) continue;
        (guest.minifigure as Record<string, unknown>)[fourth] = op.value;
        out.push({ op: "replace", path: `/guests/${guest.id}/${fourth}`, value: op.value });
        // the first touch on a blank minifigure builds it
        if (guest.minifigure.built_at === null) {
          guest.minifigure.built_at = now;
          out.push({ op: "replace", path: `/guests/${guest.id}/built_at`, value: now });
        }
      } else if (third === "choices" && (fifth === "dish" || fifth === "drink")) {
        const course = offer.courses.find((c) => c.id === integer(fourth));
        if (!course) continue;
        const current = guest.choices[String(course.id)] ?? { dish: null, drink: null };
        let value: number | null = null;
        if (!removing) {
          const id = integer(op.value);
          const offered = fifth === "dish" ? course.dishes.some((d) => d.id === id) : course.drinks.some((d) => d.id === id);
          if (!offered) continue;
          value = id!;
        }
        if (current[fifth] === value) continue;
        guest.choices = { ...guest.choices, [String(course.id)]: { ...current, [fifth]: value } };
        out.push({ op: "replace", path: `/guests/${guest.id}/choices`, value: guest.choices });
      }
    } else if (head === "asks" && second === "-") {
      const name = op.op === "add" ? nameOf(op.value) : null;
      if (!name) continue;
      out.push({ op: "add", path: "/asks/-", value: { name, asked_at: now, reply: null, guest_id: null } });
    } else if (head === "claims" && second === "-") {
      const gift = offer.gifts.find((g) => g.id === (op.op === "add" ? integer(op.value) : undefined));
      if (!gift || claims.has(gift.id) || (!gift.shared && claimedStmt.get(String(gift.id))!.n > 0)) continue;
      claims.add(gift.id);
      out.push({ op: "add", path: `/claims/${claimKey(gift.id, h.id)}`, value: { gift_id: String(gift.id), claimed_at: now } });
    } else if (head === "claims" && removing && third === undefined) {
      const giftId = integer(second);
      if (giftId === undefined || !claims.delete(giftId)) continue;
      out.push({ op: "remove", path: `/claims/${claimKey(giftId, h.id)}` });
    }
  }

  // Two writes to one guest's choices in a message are one write of where they end.
  return out.filter((op, i) => !(op.path.endsWith("/choices") && out.slice(i + 1).some((later) => later.path === op.path)));
}

/** The row an op writes, or none. */
const rowOf = (op: PatchOp | undefined): Record<string, unknown> => ((op as { value?: Record<string, unknown> } | undefined)?.value ?? {});

/**
 * What a household's write did, in the household's words: from the rows it left and the rows as
 * they were before it (`was`), each whole, as the ledger keeps them. Undo says it took this back,
 * and Redo that it did it again (compartments/household.ts `afterWalk`). A guest the rows only
 * number is named from `h`, a claimed gift from `gifts`.
 */
export function whatItDid(left: PatchOp[], was: PatchOp[], h: HouseholdDocument, gifts: { id: number; name: string }[]): string[] {
  return left.flatMap((op) => {
    const [table, id] = splitPath(op.path);
    const row = rowOf(op);
    const before = rowOf(was.find((w) => w.path === op.path));
    const changed = (field: string) => JSON.stringify(row[field] ?? null) !== JSON.stringify(before[field] ?? null);
    if (table === "households") return [changed("answer") && "your answer", changed("message") && "your note"].filter((w): w is string => !!w);
    if (table === "guests" && op.op === "add") return [`bringing ${row.name}`];
    if (table === "guests") {
      const name = h.guests.find((g) => String(g.id) === id)!.name;
      return [changed("coming") ? `whether ${name} is coming` : changed("choices") ? `${name}'s choices` : `${name}'s look`];
    }
    if (table === "asks") return [`asking for ${row.name}`];
    const gift = gifts.find((g) => claimKey(g.id, h.id) === id)!.name; // a claim
    return [op.op === "add" ? `claiming “${gift}”` : `giving back “${gift}”`];
  });
}
