// The menu applet: a guest's choices, a row per course with the chosen dish and drink on it; tap
// a row and its dishes and drinks are pills -- tap one to choose it, tap it again to let it go.
// Which course is open is this applet's own; a choice is one write, and the pills redraw from
// the render that follows.

import { registerApplet } from "../../../src/applets";
import { esc } from "../views/html";

export interface MenuCourse {
  id: number;
  name: string;
  dishes: { id: number; name: string; dietary: string | null }[];
  drinks: { id: number; name: string }[];
}

export interface MenuProps {
  guestId: number;
  firstName: string;
  courses: MenuCourse[];
  /** By course id: the dish and the drink chosen. */
  choices: Record<string, { dish: number | null; drink: number | null }>;
  /** Not coming: no meal to choose. */
  out?: boolean;
  /** After the deadline: shown, not changeable. */
  locked?: boolean;
}

export function menuHtml(props: MenuProps, open: number | null): string {
  const cap = `<p class="cap">${esc(props.firstName)}’s choices</p>`;
  if (props.out) return `<div class="menu">${cap}<p class="note">${esc(props.firstName)} is not coming, so there is no meal to choose.</p></div>`;
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

const state = new WeakMap<HTMLElement, { props: MenuProps; open: number | null }>();

const draw = (el: HTMLElement) => {
  const s = state.get(el)!;
  el.innerHTML = menuHtml(s.props, s.open);
};

registerApplet("menu", {
  mount(el, ctx) {
    state.set(el, { props: ctx.props as MenuProps, open: null });
    draw(el);
    el.addEventListener("click", (e) => {
      const s = state.get(el)!;
      const target = e.target as Element;
      const pill = target.closest<HTMLElement>(".choice");
      if (pill) {
        const path = `/guests/${s.props.guestId}/choices/${pill.dataset.course}/${pill.dataset.kind}`;
        ctx.send("household", [pill.dataset.on === "true" ? { op: "remove", path } : { op: "replace", path, value: Number(pill.dataset.id) }]);
        return;
      }
      const head = target.closest<HTMLElement>(".menu-head");
      if (head) {
        const id = Number(head.dataset.course);
        s.open = s.open === id ? null : id;
        draw(el);
      }
    });
    return () => state.delete(el);
  },
  update(el, props) {
    const s = state.get(el);
    if (!s) return;
    s.props = props as MenuProps;
    draw(el);
  },
});
