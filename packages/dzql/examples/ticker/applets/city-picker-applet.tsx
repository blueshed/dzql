// The city picker's mounting, an applet drawn by railroad (src/rendering/applet.ts): the zones are HTML -- the server renders
// them as <option>s inside this applet's mount, and the applet reads them there, so nothing about
// them crosses the wire as JSON. Choosing one is a write to the clock document; the placeholder
// follows the clock's own patches. Imported only by client/main.ts, and measured from the pages
// that run it (client/app.test.ts, src/rendering/client-coverage.ts); the ranking logic is city-picker.ts.
import { list } from "@blueshed/railroad/jsx";
import { computed, signal } from "@blueshed/railroad/signals";
import { registerApplet } from "dzql/rendering/applets";
import { applet } from "dzql/rendering/applet";
import { cityIn, matches, step, type Zone } from "./city-picker";
import { cityOf, tzAfter, type ClockProps } from "./clock";

/** The zones as the server rendered them: <option value="Asia/Tokyo">Tokyo (UTC+09:00)</option>. */
const zonesFrom = (el: ParentNode): Zone[] => [...el.querySelectorAll("option")].map((o) => ({ tz: o.value, label: o.textContent ?? "", city: cityIn(o.textContent ?? "") }));

// its props are the clock document's own fields, so the clock's ops land on them
const picker = applet<ClockProps>((props, ctx, el) => {
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
  // A combobox, so a reader hears the list open and the arrow keys move through it: the field says
  // whether its list is showing and which suggestion is highlighted, by the option's id.
  const showing = () => shown.get().length > 0;
  const option = (i: number) => `city-option-${i}`;
  return (
    <>
      <form onsubmit={submit}>
        <input type="text" role="combobox" aria-autocomplete="list" aria-controls="city-suggestions" aria-expanded={() => String(showing())} aria-activedescendant={() => (showing() ? option(active.get()) : null)} placeholder={props.map((p) => cityOf(p.tz))} aria-label="City to show the time in" autocomplete="off" value={query} oninput={typed} onkeydown={keys} onfocus={() => open.set(true)} onblur={() => open.set(false)} />
      </form>
      <ul id="city-suggestions" class="suggestions" role="listbox" aria-label="Cities">
        {list(shown, (z) => z.tz, ({ tz, label }, i$) => {
          const on = () => i$.get() === active.get();
          // mousedown, not click: the input keeps its focus, and so the list
          const take = (e: Event) => (e.preventDefault(), choose(tz.peek()));
          return <li id={() => option(i$.get())} role="option" data-tz={tz.peek()} class={() => (on() ? "active" : null)} aria-selected={() => String(on())} onmousedown={take}>{label}</li>;
        })}
      </ul>
    </>
  );
}, (props, ops) => ({ tz: tzAfter(props.tz, ops) }));

registerApplet("city-picker", picker);
