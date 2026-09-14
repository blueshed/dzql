import { registerApplet } from "../applets";

type Props = { rooms: string[] };

registerApplet("room-picker", {
  mount(el, ctx) {
    const { rooms } = ctx.props as Props;

    el.innerHTML = `
      <form data-event="join-room">
        <input id="room" name="room" type="text" placeholder="Join or create a room" autocomplete="off" autofocus required />
      </form>
      <ul class="room-picker-suggestions"></ul>
    `;

    const input = el.querySelector("input")!;
    const list = el.querySelector("ul")!;

    function renderSuggestions() {
      const query = input.value.trim().toLowerCase();
      const matches = query ? rooms.filter((room) => room.toLowerCase().includes(query)) : rooms;

      const items = matches.map((room) => {
        const li = document.createElement("li");
        li.textContent = room;
        li.dataset.event = "join-room";
        li.dataset.room = room;
        return li;
      });

      if (matches.length === 0) {
        const hint = document.createElement("li");
        hint.className = "hint";
        hint.textContent = query ? `Press Enter to create "${query}"` : "No rooms yet — type a name and press Enter";
        items.push(hint);
      }

      list.replaceChildren(...items);
    }

    input.addEventListener("input", renderSuggestions);
    renderSuggestions();
  },
});
