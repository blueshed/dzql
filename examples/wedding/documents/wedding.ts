import { db } from "../delta";
import { read as readDoc } from "../../../src/documents";
import type { Look } from "../looks";

// The wedding itself and the lists that stand on it, as a household reads them (`wedding:<id>`,
// ../delta.ts): the couple write them through the board (documents/board.ts). And what
// households see of each other (`everyone:<id>`, kept by ../everyone.ts): who stands in the photo,
// and how many have claimed each gift -- never whose.

/** The one wedding. */
export const WEDDING = "1";

export type Wedding = {
  id: number;
  day: string;
  deadline: string | null;
  name1: string;
  name2: string;
  venue: string | null;
  message: string | null;
  picture_key: string | null;
};

type Row = Record<string, unknown> & { id: string };
export type Rows = Record<string, Row>;

/** The rows of a collection in their order (seq, then id), each with its id as a number. */
export function ordered<T>(rows: Rows | undefined, map: (row: Row) => T): T[] {
  return Object.values(rows ?? {})
    .sort((a, b) => Number(a.seq ?? 0) - Number(b.seq ?? 0) || Number(a.id) - Number(b.id))
    .map(map);
}

export const weddingOf = (row: Row): Wedding => ({
  id: Number(row.id),
  day: row.day as string,
  deadline: (row.deadline as string | null) ?? null,
  name1: row.name1 as string,
  name2: row.name2 as string,
  venue: (row.venue as string | null) ?? null,
  message: (row.message as string | null) ?? null,
  picture_key: (row.picture_key as string | null) ?? null,
});

type Lists = { weddings: Row; courses?: Rows; dishes?: Rows; drinks?: Rows; gifts?: Rows; events?: Rows; places?: Rows };

const lists = (): Lists => readDoc<Lists>(`wedding:${WEDDING}`);

/** The wedding as a household reads it. */
export function wedding(): Wedding {
  return weddingOf(lists().weddings);
}

/** The wedding as a visitor without a code reads it: its own row, nothing beneath it. */
export function welcome(): Wedding {
  return weddingOf(readDoc<{ weddings: Row }>(`welcome:${WEDDING}`).weddings);
}

/** Has the day come? Read from the wedding's date, never written: the date produces it. */
export function dayHasCome(day: string, now = Date.now()): boolean {
  return now >= new Date(day).getTime();
}

/** May a household still answer and choose? Until the deadline, if there is one. */
export function answersOpen(now = Date.now()): boolean {
  const { deadline } = wedding();
  return deadline === null || now < new Date(deadline).getTime();
}

/** Does the photo carry names? On the day, and to the couple always (that's the caller's call); REVEAL=1 forces it for a demo. */
export function namesRevealed(day: string, now = Date.now()): boolean {
  return process.env.REVEAL === "1" || dayHasCome(day, now);
}

export type Dish = { id: number; course_id: number; name: string; dietary: string | null; seq: number };
export type Drink = { id: number; course_id: number; name: string; seq: number };
export type Course = { id: number; name: string; seq: number; dishes: Dish[]; drinks: Drink[] };

/** The courses in the order served, each with its dishes and drinks in theirs. */
export function coursesOf(doc: Pick<Lists, "courses" | "dishes" | "drinks">): Course[] {
  const dishes = ordered(doc.dishes, (d): Dish => ({ id: Number(d.id), course_id: Number(d.courses_id), name: d.name as string, dietary: (d.dietary as string | null) ?? null, seq: Number(d.seq) }));
  const drinks = ordered(doc.drinks, (d): Drink => ({ id: Number(d.id), course_id: Number(d.courses_id), name: d.name as string, seq: Number(d.seq) }));
  return ordered(doc.courses, (c) => ({
    id: Number(c.id),
    name: c.name as string,
    seq: Number(c.seq),
    dishes: dishes.filter((d) => d.course_id === Number(c.id)),
    drinks: drinks.filter((d) => d.course_id === Number(c.id)),
  }));
}

export const courses = (): Course[] => coursesOf(lists());

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
  /** Who has: the households' codes. For the couple's eyes; a household's reading of the gifts never has them. */
  claimants: string[];
};

export function giftsOf(rows: Rows | undefined, claimants: (id: number) => string[]): Gift[] {
  return ordered(rows, (g) => {
    const who = claimants(Number(g.id));
    return {
      id: Number(g.id),
      name: g.name as string,
      description: (g.description as string | null) ?? null,
      link: (g.link as string | null) ?? null,
      picture_key: (g.picture_key as string | null) ?? null,
      seq: Number(g.seq),
      shared: Number(g.shared) === 1,
      taken: who.length,
      claimants: who,
    };
  });
}

/** The gifts as a household reads them: how many have claimed each, never who. */
export function gifts(): Gift[] {
  const { taken } = everyone();
  return giftsOf(lists().gifts, (id) => Array.from({ length: taken[String(id)] ?? 0 }, () => ""));
}

export type Event = { id: number; name: string; when_at: string | null; where_at: string | null; notes: string | null; seq: number };
export type Place = { id: number; name: string; notes: string | null; link: string | null; picture_key: string | null; seq: number };

export const eventsOf = (rows: Rows | undefined): Event[] =>
  ordered(rows, (e) => ({ id: Number(e.id), name: e.name as string, when_at: (e.when_at as string | null) ?? null, where_at: (e.where_at as string | null) ?? null, notes: (e.notes as string | null) ?? null, seq: Number(e.seq) }));

export const placesOf = (rows: Rows | undefined): Place[] =>
  ordered(rows, (p) => ({ id: Number(p.id), name: p.name as string, notes: (p.notes as string | null) ?? null, link: (p.link as string | null) ?? null, picture_key: (p.picture_key as string | null) ?? null, seq: Number(p.seq) }));

export const events = (): Event[] => eventsOf(lists().events);
export const places = (): Place[] => placesOf(lists().places);

// ───────────────────────────── everyone ─────────────────────────────

/** One figure in the photo, as every household may see it: whose family, a ghost or not, the look -- and the name only once the names have come down. */
export type Figure = { household: string; ghost: boolean; look: Look; name?: string };
export type Everyone = { figures: Record<string, Figure>; taken: Record<string, number> };

export const everyone = (): Everyone => readDoc<Everyone>(`everyone:${WEDDING}`);

/** One minifigure as the photo sees it: its look, and what decides whether it stands in the photo. */
export type PhotoRow = {
  guest_id: number;
  name: string;
  coming: number | null;
  household_id: number;
  answer: "yes" | "maybe" | "no" | null;
  look: Look;
};

/** Whether a minifigure stands in the photo: "in" (its household said yes and it is coming), "ghost" (a maybe), or not at all. */
export function inPhoto(row: Pick<PhotoRow, "coming" | "answer">): "in" | "ghost" | null {
  if (row.coming === 0) return null;
  return row.answer === "yes" ? "in" : row.answer === "maybe" ? "ghost" : null;
}

/** Everyone in the photo, family by family, as a household may see them. */
export function photo(): PhotoRow[] {
  return Object.entries(everyone().figures)
    .map(([id, f]): PhotoRow => ({ guest_id: Number(id), name: f.name ?? "", coming: 1, household_id: Number(f.household), answer: f.ghost ? "maybe" : "yes", look: f.look }))
    .sort((a, b) => a.household_id - b.household_id || a.guest_id - b.guest_id);
}

export type Picture = { type: string; bytes: Uint8Array };

const pictureStmt = db.query<Picture, [string]>("SELECT type, bytes FROM wedding_pictures WHERE key = ?");
const putPictureStmt = db.query<unknown, [string, string, Uint8Array, number]>(
  "INSERT INTO wedding_pictures (key, type, bytes, created_at) VALUES (?, ?, ?, ?)",
);

export function picture(key: string): Picture | undefined {
  return pictureStmt.get(key) ?? undefined;
}

export function putPicture(key: string, type: string, bytes: Uint8Array): void {
  putPictureStmt.run(key, type, bytes, Date.now());
}
