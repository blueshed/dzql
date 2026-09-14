// The pieces the household's pages and the couple's share: dates, rows, summaries, the answer's
// face, the figure a guest's look draws as.

import type { Answer, Guest, HouseholdDocument } from "../documents/household";
import type { Course, Event, Place, Wedding } from "../documents/wedding";
import type { Look } from "../looks";
import type { Spec } from "../applets/figure";
import { esc, join } from "./html";
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

export const pencil = (): string => `<span class="pencil" aria-hidden="true">${icon("pencil", 15)}</span>`;

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

export function eventsSummary(events: Event[]): string {
  if (!events.length) return "none yet";
  const first = events[0]!.when_at ? formatWhen(events[0]!.when_at) : null;
  return `${plural(events.length, "event", "events")}${first ? ` · from ${first}` : ""}`;
}

export function placesSummary(places: Place[]): string {
  return places.length ? plural(places.length, "place", "places") : "none yet";
}

/** What the courses hold, one line: "8 dishes · 8 drinks". */
export function coursesSummary(courses: Course[]): string {
  const dishes = courses.reduce((n, c) => n + c.dishes.length, 0);
  const drinks = courses.reduce((n, c) => n + c.drinks.length, 0);
  return courses.length ? `${plural(dishes, "dish", "dishes")} · ${plural(drinks, "drink", "drinks")}` : "none yet";
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

/** The timetable: a row per event, when, what, where. With `open`, each row opens its keep drawer. */
export function timetableRows(events: Event[], open?: (id: number) => string): string {
  if (!events.length) return `<p class="note">No events yet.</p>`;
  return `<div class="rows timetable">${events
    .map((e) =>
      join(
        `<div class="row-line${open ? " tap" : ""}"${open ? open(e.id) : ""}>`,
        `<span class="when">${esc(e.when_at ? formatWhen(e.when_at) : "—")}</span>`,
        `<span class="what">${esc(e.name)}</span>`,
        `<span class="where">${esc(e.where_at ?? "")}</span>`,
        e.notes && `<p class="note" style="grid-column: 2 / -1">${esc(e.notes)}</p>`,
        "</div>",
      ),
    )
    .join("")}</div>`;
}

/** Where to stay: a row per place, its picture, its name and notes; a link out, or with `open`, its keep drawer. */
export function placeRows(places: Place[], open?: (id: number) => string): string {
  if (!places.length) return `<p class="note">Nowhere yet.</p>`;
  return `<div class="rows">${places
    .map((p) =>
      join(
        `<div class="row-line stay${p.picture_key ? " pic" : ""}${open ? " tap" : ""}"${open ? open(p.id) : ""}>`,
        p.picture_key && picture(p.picture_key, p.name),
        `<div><span class="what">${esc(p.name)}</span>${p.notes ? `<p class="note">${esc(p.notes)}</p>` : ""}</div>`,
        open ? pencil() : p.link ? `<a href="${esc(p.link)}" target="_blank" rel="noopener noreferrer">More</a>` : "<span></span>",
        "</div>",
      ),
    )
    .join("")}</div>`;
}

/** The whole of #app: the flowers along the foot behind everything, then the site. */
export function frame(atWelcome: boolean, body: string): string {
  return `<div class="flowers" aria-hidden="true"></div><div class="site${atWelcome ? " at-welcome" : ""}">${body}</div>`;
}

/** A guest's coming, both states always shown, the current one filled. `locked` after the deadline. */
export function comingPills(write: (value: "1" | "0") => string, coming: number | null, locked = false): string {
  const d = locked ? " disabled" : "";
  return join(
    `<div class="coming-pills" role="radiogroup" aria-label="Coming">`,
    `<button type="button" class="pill pill-sm yes${coming === 1 ? " on" : ""}" role="radio" aria-checked="${coming === 1}"${write("1")}${d}>Yes</button>`,
    `<button type="button" class="pill pill-sm no${coming === 0 ? " on" : ""}" role="radio" aria-checked="${coming === 0}"${write("0")}${d}>No</button>`,
    "</div>",
  );
}
