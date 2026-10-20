/**
 * The lobby's part of the page: everyone here, each in their colour, and a line to join it (a
 * name, and a colour from `colours:`). The page never writes `here:lobby`; it calls `join`, and
 * the server's write comes back through the document, to every page holding it.
 */
import { list, when, type JSX } from "@blueshed/railroad";
import { colours, here, join, me, myId } from "./here";

function joined(e: SubmitEvent) {
  e.preventDefault();
  const form = e.target as HTMLFormElement;
  const field = (name: string) => (form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement).value;
  void join({ name: field("name"), colour: field("colour") });
}

export function HereView(): JSX.Element {
  const people = here.data.map((d) => Object.entries(d?.people ?? {}).map(([id, p]) => ({ id, ...p })).sort((a, b) => a.name.localeCompare(b.name)));
  return (
    <section class="here">
      <h2>Here now</h2>
      <ul>
        {list(people, (p) => p.id, ({ id, colour, name }) => (
          <li class="person">
            <span class="swatch" style={colour.map((c) => `background: ${c}`)} />
            <span class="name">{name}</span>
            {when(() => id.get() === myId.get(), () => <em> (you)</em>)}
          </li>
        ))}
      </ul>
      <form id="join" onsubmit={joined}>
        <input name="name" autocomplete="off" placeholder="your name" />
        {/* the colours never change (a static document): drawn once, when they arrive */}
        {when(colours.data, (c$) => <select name="colour">{c$.peek().colours.map((c) => <option value={c}>{c}</option>)}</select>)}
        <button>{me.map((m) => (m ? "Change" : "Join"))}</button>
      </form>
    </section>
  );
}
