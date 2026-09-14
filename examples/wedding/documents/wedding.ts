import { db } from "../db";
import type { Look } from "../looks";

// The wedding itself and the lists that stand on it, read-only here: the couple write them
// through the board document (documents/board.ts), and a household reads them beside its own.

export type Kind = "household" | "couple";

export type Wedding = {
  id: number;
  code: string;
  day: string;
  deadline: string | null;
  name1: string;
  name2: string;
  venue: string | null;
  message: string | null;
  picture_key: string | null;
};

const weddingStmt = db.query<Wedding, []>(
  "SELECT id, code, day, deadline, name1, name2, venue, message, picture_key FROM weddings ORDER BY id LIMIT 1",
);
const householdCodeStmt = db.query<{ id: number }, [string]>("SELECT id FROM households WHERE code = ?");
const coupleCodeStmt = db.query<{ id: number }, [string]>("SELECT id FROM weddings WHERE code = ?");

/** The one wedding. The seed migration guarantees there is one. */
export function wedding(): Wedding {
  return weddingStmt.get()!;
}

/** Whose code this is: a household's, the couple's (the wedding's own), or nobody's. Codes are stored upper-case; compare the same way. */
export function kindOf(code: string): Kind | null {
  const upper = code.toUpperCase();
  if (householdCodeStmt.get(upper)) return "household";
  if (coupleCodeStmt.get(upper)) return "couple";
  return null;
}

/** Has the day come? Read from the wedding's date, never written: the date produces it. */
export function dayHasCome(now = Date.now()): boolean {
  return now >= new Date(wedding().day).getTime();
}

/** May a household still answer and choose? Until the deadline, if there is one. */
export function answersOpen(now = Date.now()): boolean {
  const { deadline } = wedding();
  return deadline === null || now < new Date(deadline).getTime();
}

/** Does the photo carry names? On the day, and to the couple always (that's the caller's call); REVEAL=1 forces it for a demo. */
export function namesRevealed(now = Date.now()): boolean {
  return process.env.REVEAL === "1" || dayHasCome(now);
}

export type Dish = { id: number; course_id: number; name: string; dietary: string | null; seq: number };
export type Drink = { id: number; course_id: number; name: string; seq: number };
export type Course = { id: number; name: string; seq: number; dishes: Dish[]; drinks: Drink[] };

const coursesStmt = db.query<{ id: number; name: string; seq: number }, []>("SELECT id, name, seq FROM courses ORDER BY seq, id");
const dishesStmt = db.query<Dish, []>("SELECT id, course_id, name, dietary, seq FROM dishes ORDER BY seq, id");
const drinksStmt = db.query<Drink, []>("SELECT id, course_id, name, seq FROM drinks ORDER BY seq, id");

/** The courses in the order served, each with its dishes and drinks in theirs. */
export function courses(): Course[] {
  const dishes = dishesStmt.all();
  const drinks = drinksStmt.all();
  return coursesStmt.all().map((c) => ({
    ...c,
    dishes: dishes.filter((d) => d.course_id === c.id),
    drinks: drinks.filter((d) => d.course_id === c.id),
  }));
}

export type Gift = {
  id: number;
  name: string;
  description: string | null;
  link: string | null;
  picture_key: string | null;
  seq: number;
  shared: boolean;
  /** How many households have claimed it. */
  taken: number;
  /** Who has: the households' codes. For the couple's eyes; a household's view never shows these. */
  claimants: string[];
};

const giftsStmt = db.query<Omit<Gift, "shared" | "taken" | "claimants"> & { shared: number }, []>(
  "SELECT id, name, description, link, picture_key, seq, shared FROM gifts ORDER BY seq, id",
);
const claimsStmt = db.query<{ gift_id: number; code: string }, []>(
  "SELECT c.gift_id, h.code FROM gift_claims c JOIN households h ON h.id = c.household_id ORDER BY c.id",
);

export function gifts(): Gift[] {
  const claims = claimsStmt.all();
  return giftsStmt.all().map((g) => {
    const claimants = claims.filter((c) => c.gift_id === g.id).map((c) => c.code);
    return { ...g, shared: g.shared === 1, taken: claimants.length, claimants };
  });
}

export type Event = { id: number; name: string; when_at: string | null; where_at: string | null; notes: string | null; seq: number };
export type Place = { id: number; name: string; notes: string | null; link: string | null; picture_key: string | null; seq: number };

const eventsStmt = db.query<Event, []>("SELECT id, name, when_at, where_at, notes, seq FROM events ORDER BY seq, id");
const placesStmt = db.query<Place, []>("SELECT id, name, notes, link, picture_key, seq FROM places ORDER BY seq, id");

export function events(): Event[] {
  return eventsStmt.all();
}

export function places(): Place[] {
  return placesStmt.all();
}

/** One minifigure as the photo sees it: its look, its guest's coming, its household's answer -- and the name, which the view shows only when it may. */
export type PhotoRow = {
  guest_id: number;
  name: string;
  coming: number | null;
  household_id: number;
  code: string;
  answer: "yes" | "maybe" | "no" | null;
  look: Look;
};

const photoStmt = db.query<Omit<PhotoRow, "look"> & Look, []>(`
  SELECT g.id AS guest_id, g.name, g.coming, h.id AS household_id, h.code, h.answer,
         m.skin, m.hair, m.hair_color, m.top, m.legs, m.face, m.attitude, m.built_at
  FROM minifigures m
  JOIN guests g ON g.id = m.guest_id
  JOIN households h ON h.id = g.household_id
  ORDER BY h.id, g.id
`);

/** Every minifigure, with what decides whether it stands in the photo. The view applies the rule: yes and coming, in; maybe, a ghost; otherwise not. */
export function photo(): PhotoRow[] {
  return photoStmt.all().map(({ skin, hair, hair_color, top, legs, face, attitude, built_at, ...rest }) => ({
    ...rest,
    look: { skin, hair, hair_color, top, legs, face, attitude, built_at },
  }));
}

/** Whether a minifigure stands in the photo: "in" (its household said yes and it is coming), "ghost" (a maybe), or not at all. */
export function inPhoto(row: Pick<PhotoRow, "coming" | "answer">): "in" | "ghost" | null {
  if (row.coming === 0) return null;
  return row.answer === "yes" ? "in" : row.answer === "maybe" ? "ghost" : null;
}

export type Picture = { type: string; bytes: Uint8Array };

const pictureStmt = db.query<Picture, [string]>("SELECT type, bytes FROM pictures WHERE key = ?");
const putPictureStmt = db.query<unknown, [string, string, Uint8Array, number]>(
  "INSERT INTO pictures (key, type, bytes, created_at) VALUES (?, ?, ?, ?)",
);

export function picture(key: string): Picture | undefined {
  return pictureStmt.get(key) ?? undefined;
}

export function putPicture(key: string, type: string, bytes: Uint8Array): void {
  putPictureStmt.run(key, type, bytes, Date.now());
}
