// The menu applet's drawing: a guest's choices, a row per course with the chosen dish and drink
// on it; tap a row and its dishes and drinks are pills -- tap one to choose it, tap it again to
// let it go. The drawing is a string, tested here without a browser; the mounting that opens a
// row and turns a tap into a write is menu-applet.ts, imported only by client/main.ts
// (change-request.md item 4).

import { esc } from "../views/html";

export interface MenuCourse {
  id: number;
  name: string;
  dishes: { id: number; name: string; dietary: string | null }[];
  drinks: { id: number; name: string }[];
}

export interface MenuProps {
  guestId: number;
  courses: MenuCourse[];
  /** By course id: the dish and the drink chosen. */
  choices: Record<string, { dish: number | null; drink: number | null }>;
  /** Not coming: no meal to choose. */
  out?: boolean;
  /** After the deadline: shown, not changeable. */
  locked?: boolean;
}

/** The meal, in the guest's drawer: the drawer's title already says whose. */
export function menuHtml(props: MenuProps, open: number | null): string {
  const cap = `<p class="cap">The meal</p>`;
  if (props.out) return `<div class="menu">${cap}<p class="note">Not coming, so there is no meal to choose.</p></div>`;
  const rows = props.courses.map((course) => {
    const choice = props.choices[String(course.id)] ?? { dish: null, drink: null };
    const summary = [course.dishes.find((d) => d.id === choice.dish)?.name, course.drinks.find((d) => d.id === choice.drink)?.name].filter(Boolean).join(" · ");
    const isOpen = open === course.id;
    const head = `<button type="button" class="menu-head" aria-expanded="${isOpen}" data-course="${course.id}"><span class="when">${esc(course.name)}</span><span class="${summary ? "chosen" : "unchosen"}">${esc(summary || "Choose…")}</span></button>`;
    const pill = (kind: "dish" | "drink", d: { id: number; name: string; dietary?: string | null }, chosen: number | null) => {
      const on = chosen === d.id;
      return `<button type="button" class="choice ${kind}${on ? " on" : ""}" role="radio" aria-checked="${on}" data-course="${course.id}" data-kind="${kind}" data-id="${d.id}" data-on="${on}"${props.locked ? " disabled" : ""}>${esc(d.dietary ? `${d.name} (${d.dietary})` : d.name)}</button>`;
    };
    const pills = isOpen
      ? `<div class="menu-pills">` +
        (course.dishes.length ? `<div class="pills" role="radiogroup" aria-label="${esc(`${course.name}: dish`)}">${course.dishes.map((d) => pill("dish", d, choice.dish)).join("")}</div>` : "") +
        (course.drinks.length ? `<div class="pills" role="radiogroup" aria-label="${esc(`${course.name}: drink`)}">${course.drinks.map((d) => pill("drink", d, choice.drink)).join("")}</div>` : "") +
        `</div>`
      : "";
    return `<div class="menu-row${isOpen ? " open" : ""}">${head}${pills}</div>`;
  });
  return `<div class="menu">${cap}${rows.join("")}</div>`;
}
