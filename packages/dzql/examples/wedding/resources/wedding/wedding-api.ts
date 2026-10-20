import { defineDoc } from "@blueshed/delta/sqlite";
import { read as readDoc } from "dzql/rendering/documents";
import { LISTS, register, WEDDING } from "../../store";
import { everyone } from "../everyone/everyone-api";

// The wedding itself and the lists that stand on it, as a household reads them (`wedding:<id>`),
// on the ledger: the couple write them through the board (../board/board-api.ts). How many have
// claimed each gift, never whose, is what households see of each other (../everyone/everyone-api.ts).
register([defineDoc("wedding:", { root: "weddings", include: LISTS })]);

export { WEDDING };

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

export type Row = Record<string, unknown> & { id: string };
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
