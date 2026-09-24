// The city picker's mounting: the zones are HTML -- the server renders them as <option>s inside
// this applet's mount, and the applet reads them there, so nothing about them crosses the wire as
// JSON. Choosing one is a write to the clock document; the placeholder follows the clock's own
// patches. Imported only by client/main.ts, like chat's room-picker -- not measured by the
// coverage table, since only a real browser drives it; the ranking logic above it is
// (change-request.md item 4).

import { registerApplet } from "../../../src/applets";
import type { PatchOp } from "../../../src/json-patch";
import { cityIn, matches, step, type Zone } from "./city-picker";
import { cityOf } from "./clock";

/** The zones as the server rendered them: <option value="Asia/Tokyo">Tokyo (UTC+09:00)</option>. */
function zonesFrom(el: ParentNode): Zone[] {
  return [...el.querySelectorAll("option")].map((o) => ({ tz: o.value, label: o.textContent ?? "", city: cityIn(o.textContent ?? "") }));
}

const cityOf = (tz: string): string => (tz.split("/").pop() ?? tz).replaceAll("_", " ");

type State = { zones: Zone[]; input: HTMLInputElement; list: HTMLUListElement; /** which suggestion the arrow keys have reached */ active: number };
const states = new WeakMap<HTMLElement, State>();

registerApplet("city-picker", {
  mount(el, ctx) {
    const zones = zonesFrom(el);
    // its props are the clock document's own field, so the clock's ops land on them; the city is read off the zone
    const city = cityOf((ctx.props as { tz: string }).tz);
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
    if (s) s.input.placeholder = cityOf((props as { tz: string }).tz);
  },
  // The clock document's own op, off the echo: the placeholder says which city the clock now shows.
  patch(el, ops: PatchOp[]) {
    const s = states.get(el);
    if (!s) return;
    for (const op of ops) if (op.op === "replace" && op.path === "/tz" && typeof op.value === "string") s.input.placeholder = cityOf(op.value);
  },
});
