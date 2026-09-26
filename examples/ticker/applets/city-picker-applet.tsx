// The city picker's mounting, an island (src/island.ts): the zones are HTML -- the server renders
// them as <option>s inside this applet's mount, and the applet reads them there, so nothing about
// them crosses the wire as JSON. Choosing one is a write to the clock document; the placeholder
// follows the clock's own patches. Imported only by client/main.ts -- not measured by the coverage
// table, since only a real browser drives it (client/app.test.ts); the ranking logic in
// city-picker.ts is.
import { list } from "@blueshed/railroad/jsx";
import { computed, signal } from "@blueshed/railroad/signals";
import { registerApplet } from "../../../src/applets";
import { island } from "../../../src/island";
import { cityIn, matches, step, type Zone } from "./city-picker";
import { cityOf, tzAfter, type ClockProps } from "./clock";

/** The zones as the server rendered them: <option value="Asia/Tokyo">Tokyo (UTC+09:00)</option>. */
const zonesFrom = (el: ParentNode): Zone[] => [...el.querySelectorAll("option")].map((o) => ({ tz: o.value, label: o.textContent ?? "", city: cityIn(o.textContent ?? "") }));

// its props are the clock document's own fields, so the clock's ops land on them
const picker = island<ClockProps>((props, ctx, el) => {
  const zones = zonesFrom(el);
  const query = signal("");
  const open = signal(false);
  const active = signal(0); // which suggestion the arrow keys have reached
  const shown = computed(() => (open.get() ? matches(zones, query.get()) : []));
  const choose = (tz: string) => {
    ctx.send("clock", [{ op: "replace", path: "/tz", value: tz }]);
    query.set("");
  };
  // A form, so Enter is the browser's own submit: it takes the highlighted match.
  const submit = (e: Event) => {
    e.preventDefault();
    const chosen = shown.peek()[active.peek()];
    if (chosen) choose(chosen.tz);
  };
  const typed = (e: Event) => {
    query.set((e.target as HTMLInputElement).value);
    active.set(0);
  };
  const keys = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      active.set(step(active.peek(), shown.peek().length, e.key));
    } else if (e.key === "Escape" && query.peek()) {
      e.preventDefault(); // the first Escape empties the word; the next puts the drawer away
      query.set("");
    }
  };
  return (
    <>
      <form onsubmit={submit}>
        <input type="text" placeholder={props.map((p) => cityOf(p.tz))} aria-label="Show the time in" autocomplete="off" value={query} oninput={typed} onkeydown={keys} onfocus={() => open.set(true)} onblur={() => open.set(false)} />
      </form>
      <ul class="suggestions" role="listbox">
        {list(shown, (z) => z.tz, (z$, i$) => {
          const on = () => i$.get() === active.get();
          // mousedown, not click: the input keeps its focus, and so the list
          const take = (e: Event) => (e.preventDefault(), choose(z$.peek().tz));
          return <li role="option" data-tz={z$.peek().tz} class={() => (on() ? "active" : null)} aria-selected={() => String(on())} onmousedown={take}>{z$.map((z) => z.label)}</li>;
        })}
      </ul>
    </>
  );
}, (props, ops) => ({ tz: tzAfter(props.tz, ops) }));

registerApplet("city-picker", picker);
