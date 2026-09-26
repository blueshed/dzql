// The pieces the household's pages and the couple's share: dates, rows, summaries, the answer's
// face, the figure a guest's look draws as.

import type { Answer, Guest, HouseholdDocument } from "../documents/household";
import type { Course, Event, Place, Wedding } from "../documents/wedding";
import type { Look } from "../looks";
import type { Spec } from "../applets/figure";
import { row } from "./bento";
import { rows } from "../../../src/bento";

export { layers, matches } from "../../../src/bento";
import { esc } from "./html";
import { part } from "../../../src/parts";
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

/** The couple's names, the root's name. */
export const coupleName = (w: Pick<Wedding, "name1" | "name2">): string => `${w.name1} & ${w.name2}`;

/** A guest's look as the drawing takes it, the name beside it. */
export function specOf(look: Look, name?: string): Spec {
  const { built_at, ...rest } = look;
  return { ...rest, name };
}

/** Not coming: said so, or not said while the household said no. Faded and still. */
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

/** The timetable: a row per event -- when leads the line, then what and where. */
export function timetableRows(events: Event[], o: ListOptions = {}): string {
  return rows(
    events.map((e) =>
      row({
        id: `event-${e.id}`,
        tap: o.open?.(e.id),
        chosen: o.open ? o.chosen === e.id : undefined,
        lead: `<span class="when">${esc(e.when_at ? formatWhen(e.when_at) : "—")}</span>`,
        what: e.name,
        note: [e.where_at, e.notes].filter(Boolean).join(" · ") || null,
        mark: o.open ? "pencil" : undefined,
      }),
    ),
    "No events yet.",
  );
}

/** Where to stay: a row per place -- its picture, its name and notes; a link out for a guest, ✎ its drawer for the couple. */
export function placeRows(places: Place[], o: ListOptions = {}): string {
  return rows(
    places.map((p) =>
      row({
        id: `place-${p.id}`,
        tap: o.open?.(p.id),
        chosen: o.open ? o.chosen === p.id : undefined,
        lead: p.picture_key ? picture(p.picture_key, p.name) : undefined,
        what: p.name,
        note: p.notes,
        state: !o.open && p.link ? `<a href="${esc(p.link)}" target="_blank" rel="noopener noreferrer">More</a>` : undefined,
        mark: o.open ? "pencil" : undefined,
      }),
    ),
    "Nowhere yet.",
  );
}

/**
 * The whole of #app: the flowers along the foot behind everything, then the site. `page`, when a
 * household or the couple has one, is the session's own page as `data-page`/`data-page-write` --
 * the kernel client mirrors it into the URL and sends this write back on the browser's own
 * back/forward (change-request.md item 3). Pre-login (the welcome), there is no page to follow.
 */
export function frame(atWelcome: boolean, body: string, page?: string, locked = false): string {
  const pageAttrs = page === undefined ? "" : ` data-page="${esc(page)}" data-page-write='${JSON.stringify({ doc: "session", op: "replace", path: "/page" })}'`;
  // `locked` (a drawer or a modal open) holds the page behind it still on a phone: `styles.css`
  // reads the class off `.site` via `body:has(.site.locked)`, since the render owns no element
  // of `body` itself to add the class to directly.
  // the site is a part: a drawer or a modal opening changes its tag (locked, the address) and a layer inside it, and nothing else is sent
  return `<div class="flowers" aria-hidden="true"></div>` + part("site", `<div class="site${atWelcome ? " at-welcome" : ""}${locked ? " locked" : ""}"${pageAttrs}>${body}</div>`);
}
