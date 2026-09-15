// The city picker: a typeahead over every zone, ranking a city that starts with what was typed
// above one that merely contains it -- which a native datalist cannot do. The zones are HTML:
// the server renders them as <option>s inside this applet's mount, and the applet reads them
// there at mount, so nothing about them crosses the wire as JSON. Choosing one is a write to
// the clock document; the placeholder follows the clock's own patches.

import { registerApplet } from "../../../src/applets";
import type { PatchOp } from "../../../src/json-patch";

export interface Zone {
  tz: string;
  /** "London, Europe (UTC+01:00)" */
  label: string;
  city: string;
}

export const SHOWN = 8;

/**
 * The zones matching `query`: cities that start with it first -- the shortest first, since
 * "lon" is nearer London than Longyearbyen -- then any label that contains it, up to SHOWN.
 */
export function matches(zones: Zone[], query: string): Zone[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const starts = zones.filter((z) => z.city.toLowerCase().startsWith(q)).sort((a, b) => a.city.length - b.city.length || a.city.localeCompare(b.city));
  const contains = zones.filter((z) => !z.city.toLowerCase().startsWith(q) && z.label.toLowerCase().includes(q));
  return [...starts, ...contains].slice(0, SHOWN);
}

/** The zones as the server rendered them: <option value="Asia/Tokyo">Tokyo, Asia (UTC+09:00)</option>. */
export function zonesFrom(el: ParentNode): Zone[] {
  return [...el.querySelectorAll("option")].map((o) => ({ tz: o.value, label: o.textContent ?? "", city: (o.textContent ?? "").split(",")[0]! }));
}

const cityOf = (tz: string): string => (tz.split("/").pop() ?? tz).replaceAll("_", " ");

type State = { zones: Zone[]; input: HTMLInputElement; list: HTMLUListElement; /** which suggestion the arrow keys have reached */ active: number };
const states = new WeakMap<HTMLElement, State>();

/** The highlighted suggestion after an arrow key: down and up, within the list. */
export function step(active: number, count: number, key: string): number {
  if (count === 0) return 0;
  if (key === "ArrowDown") return Math.min(active + 1, count - 1);
  if (key === "ArrowUp") return Math.max(active - 1, 0);
  return active;
}

registerApplet("city-picker", {
  mount(el, ctx) {
    const zones = zonesFrom(el);
    const city = (ctx.props as { city: string }).city;
    // A form, so Enter is the browser's own submit: it takes the first match.
    el.innerHTML = `<form><input type="text" placeholder="${city.replaceAll('"', "&quot;")}" aria-label="Show the time in" autocomplete="off"></form><ul class="suggestions" role="listbox"></ul>`;
    const form = el.querySelector("form")!;
    const input = el.querySelector("input")!;
    const list = el.querySelector("ul")!;
    const state: State = { zones, input, list, active: 0 };
    states.set(el, state);

    const choose = (tz: string) => {
      ctx.send("clock", [{ op: "replace", path: "/tz", value: tz }]);
      input.value = "";
      list.replaceChildren();
    };
    const highlight = () => {
      [...list.children].forEach((li, i) => {
        li.classList.toggle("active", i === state.active);
        li.setAttribute("aria-selected", String(i === state.active));
      });
    };
    const render = () => {
      state.active = 0;
      list.replaceChildren(
        ...matches(zones, input.value).map((z) => {
          const li = document.createElement("li");
          li.role = "option";
          li.textContent = z.label;
          li.dataset.tz = z.tz;
          li.addEventListener("mousedown", (e) => {
            e.preventDefault(); // keep the input's focus
            choose(z.tz);
          });
          return li;
        }),
      );
      highlight();
    };
    input.addEventListener("input", render);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const chosen = matches(zones, input.value)[state.active];
      if (chosen) choose(chosen.tz);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        state.active = step(state.active, list.children.length, e.key);
        highlight();
      } else if (e.key === "Escape") {
        input.value = "";
        render();
      }
    });
    input.addEventListener("blur", () => list.replaceChildren());
    input.addEventListener("focus", render);
    return () => states.delete(el);
  },
  update(el, props) {
    const s = states.get(el);
    if (s) s.input.placeholder = (props as { city: string }).city;
  },
  // The clock document's own op, off the echo: the placeholder says which city the clock now shows.
  patch(el, ops: PatchOp[]) {
    const s = states.get(el);
    if (!s) return;
    for (const op of ops) if (op.op === "replace" && op.path === "/tz" && typeof op.value === "string") s.input.placeholder = cityOf(op.value);
  },
});
