// The pieces the household's pages and the couple's share: dates, rows, summaries, the answer's
// face, the figure a guest's look draws as. No one resource's part of the page: each view
// (`resources/<name>/<name>-view.ts`) draws with them, so they sit beside ./page.ts.

import type { Answer, Guest, HouseholdDocument } from "./resources/household/household-api";
import type { Course, Event, Place, Wedding } from "./resources/wedding/wedding-api";
import { row, site } from "./surfaces";
import { rows } from "dzql/rendering/bento";

export { layers, matches } from "dzql/rendering/bento";
import { esc } from "./html";
import { icon } from "./icons";

export function formatDay(day: string): string {
  const d = new Date(`${day}T00:00:00`);
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

export function formatWhen(when: string): string {
  const d = new Date(when);
  return Number.isNaN(d.getTime()) ? when : d.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" });
}

export const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;


export const firstNameOf = (name: string): string => name.trim().split(/\s+/)[0]!;

/** A family's names as a run (CLAUDE.md, say a thing once): a surname shared with the name before
 * it -- or with `start`, the household's code the run is under -- is said once, not on every name.
 * "Ada Okafor", "Femi Okafor" under OKAFOR are "Ada", "Femi"; a plus-one's own surname stays. */
export function runNames(names: string[], start = ""): string[] {
  let before = start.trim().toLowerCase();
  return names.map((name) => {
    const words = name.trim().split(/\s+/);
    const surname = words.length > 1 ? words.at(-1)!.toLowerCase() : "";
    const same = surname !== "" && surname === before;
    if (surname) before = surname;
    return same ? words.slice(0, -1).join(" ") : name;
  });
}

/** The couple's names, the root's name. */
export const coupleName = (w: Pick<Wedding, "name1" | "name2">): string => `${w.name1} & ${w.name2}`;

export { specOf } from "./applets/figure";

/** Not coming: said so, or not said while the household said no. Still, and marked no at their feet (guestMark). */
export function isGuestOut(g: Pick<Guest, "coming">, h: Pick<HouseholdDocument, "answer">): boolean {
  return g.coming === 0 || (g.coming === null && h.answer === "no");
}

export const isComing = (g: Pick<Guest, "coming">): boolean => g.coming === 1;

export const picture = (key: string, alt: string): string => `<img class="pic" src="/pictures/${esc(key)}" alt="${esc(alt)}" loading="lazy">`;

const ANSWER_SAYS: Record<Answer, string> = { yes: "Yes, we'll be there", maybe: "Maybe", no: "Sorry, no" };

/** The face of an answer: one disc filled in its colour -- yes green, maybe amber, no red -- or, with no answer yet, a dashed ring with a question in it. */
export function faceMark(answer: Answer | null, size = 44, decorative = false): string {
  const a11y = decorative ? 'aria-hidden="true"' : `role="img" aria-label="${esc(answer ? ANSWER_SAYS[answer] : "No answer yet")}"`;
  const inner = answer ? icon(answer === "yes" ? "smile" : answer === "maybe" ? "meh" : "frown", Math.round(size * 0.68)) : '<span class="q">?</span>';
  return `<span class="face-mark ${answer ?? "none"}" style="width:${size}px;height:${size}px" ${a11y}>${inner}</span>`;
}

export const answerSays = (answer: Answer | null): string => (answer ? ANSWER_SAYS[answer] : "Are you coming?");

export type AnswerMark = Answer | "none";
const ANSWER_WORD: Record<AnswerMark, string> = { yes: "coming", maybe: "maybe", no: "not coming", none: "no answer yet" };
export const answerOf = (h: Pick<HouseholdDocument, "answer">): AnswerMark => h.answer ?? "none";

/** The mark at one guest's feet: their own coming where it is said, the household's answer where it is not. */
export const guestMark = (g: Pick<Guest, "coming">, h: Pick<HouseholdDocument, "answer">): AnswerMark =>
  isGuestOut(g, h) ? "no" : isComing(g) ? "yes" : answerOf(h);

export function answerWord(mark: AnswerMark, word = ANSWER_WORD[mark]): string {
  return `<span class="answer-word ${mark}"><i class="dot ${mark}"></i>${esc(word)}</span>`;
}

/** A guest's choices as one line: "Soup & Prosecco · Sea bass · —", a dash for a course not chosen in. */
export function choicesLine(g: Guest, courses: Course[]): string {
  const parts = courses.map((c) => {
    const choice = g.choices[String(c.id)];
    if (!choice) return "—";
    const dish = c.dishes.find((d) => d.id === choice.dish)?.name;
    const drink = c.drinks.find((d) => d.id === choice.drink)?.name;
    return [dish, drink].filter(Boolean).join(" & ") || "—";
  });
  return parts.every((p) => p === "—") ? "nothing chosen" : parts.join(" · ");
}

export interface ListOptions {
  /** With `open`, each row opens its keep drawer (✎); without, the rows are read only. */
  open?: (id: number) => string;
  /** The row whose drawer is open. */
  chosen?: number;
}

/** A place and its town are one place: "The Mount Without" is where "The Mount Without, Bristol" is. */
const placeOf = (where: string | null | undefined): string => (where ?? "").split(",")[0]!.trim().toLowerCase();

/** The timetable: a row per event -- when leads the line, then what, and where when it moves: an
 * event where the one above it is (or, from `at`, where the day is) does not name it again. To a
 * guest, reading, it says nothing; to the couple, keeping the list (`open`), it says "same place", so
 * a place not yet set, which says nothing, is not taken for one said above. */
export function timetableRows(events: Event[], o: ListOptions & { at?: string | null } = {}): string {
  let here = placeOf(o.at);
  return rows(
    events.map((e) => {
      const where = e.where_at ? placeOf(e.where_at) : "";
      const said = !where ? null : where !== here ? e.where_at : o.open ? "same place" : null;
      here = where; // an event with no place breaks the run: "same place" is only ever the row above's
      return row({
        id: `event-${e.id}`,
        tap: o.open?.(e.id),
        chosen: o.open ? o.chosen === e.id : undefined,
        lead: `<span class="when">${esc(e.when_at ? formatWhen(e.when_at) : "—")}</span>`,
        what: e.name,
        note: [said, e.notes].filter(Boolean).join(" · ") || null,
        mark: o.open ? "pencil" : undefined,
      });
    }),
    "No events yet.",
  );
}

/** Where to stay: a row per place -- its picture, its name and notes; a link out for a guest, ✎ its drawer for the couple. The picture's
 * name is the row's, beside it, so it says nothing of its own. */
export function placeRows(places: Place[], o: ListOptions = {}): string {
  return rows(
    places.map((p) =>
      row({
        id: `place-${p.id}`,
        tap: o.open?.(p.id),
        chosen: o.open ? o.chosen === p.id : undefined,
        lead: p.picture_key ? picture(p.picture_key, "") : undefined,
        what: p.name,
        note: p.notes,
        state: !o.open && p.link ? `<a href="${esc(p.link)}" target="_blank" rel="noopener noreferrer">More</a>` : undefined,
        mark: o.open ? "pencil" : undefined,
      }),
    ),
    "Nowhere yet.",
  );
}

/** The whole of #app: the flowers along the foot behind everything, then the site, at the session's page (`site`); at the welcome, there is no page to follow. */
export function frame(atWelcome: boolean, body: string, page?: string): string {
  return `<div class="flowers" aria-hidden="true"></div>` + site(page, body, atWelcome ? "at-welcome" : "");
}
