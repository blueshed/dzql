import { registerApplet } from "../../../src/applets";

type Props = { rooms: string[] };

// The applet manages its own container by hand (see the [data-applet]
// boundary in morph.ts), so its live state -- the current rooms list and
// how to re-render against it -- lives here, addressable by element, for
// update() to reach after a props change without losing the typed filter.
const instances = new WeakMap<HTMLElement, { rooms: string[]; render(): void }>();

registerApplet("room-picker", {
  mount(el, ctx) {
    const state = { rooms: (ctx.props as Props).rooms, render: () => {} };
    instances.set(el, state);

    el.innerHTML = `
      <form data-write='{"doc":"session","op":"replace","path":"/room"}'>
        <input id="room" name="room" type="text" placeholder="Join or create a room" autocomplete="off" autofocus required />
      </form>
      <ul class="room-picker-suggestions"></ul>
    `;

    const input = el.querySelector("input")!;
    const list = el.querySelector("ul")!;

    state.render = () => {
      const query = input.value.trim().toLowerCase();
      const matches = query ? state.rooms.filter((room) => room.toLowerCase().includes(query)) : state.rooms;

      const items = matches.map((room) => {
        const li = document.createElement("li");
        li.textContent = room;
        li.dataset.write = JSON.stringify({ doc: "session", op: "replace", path: "/room" });
        li.dataset.value = room;
        return li;
      });

      if (matches.length === 0) {
        const hint = document.createElement("li");
        hint.className = "hint";
        hint.textContent = query ? `Press Enter to create "${query}"` : "No rooms yet — type a name and press Enter";
        items.push(hint);
      }

      list.replaceChildren(...items);
    };

    input.addEventListener("input", state.render);
    state.render();

    return () => instances.delete(el);
  },
  update(el, props) {
    const state = instances.get(el);
    if (!state) return;
    state.rooms = (props as Props).rooms;
    state.render(); // re-filter against the new list, leaving the typed query untouched
  },
});
