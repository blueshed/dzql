import { rows } from "dzql/rendering/bento";
import { esc, join, write } from "dzql/rendering/html";
import { slug } from "dzql/rendering/grid";
import { surfaces } from "../../surfaces";

// The lobby's part of the page: which rooms there are, to go into one.

const { collectionPage, row } = surfaces;

/** What room: every room a row, › into it; the form at the foot names a new one, and goes in. */
export function renderRooms(name: string, rooms: string[]): string {
  const enter = (r: string) => write("session", "replace", "/room", r);
  return collectionPage([{ label: "Chat" }], {
    key: "rooms",
    body: join(
      `<p class="note">You are <b class="user-label">${esc(name)}</b>. Which room?</p>`,
      `<div class="list">${rows(rooms.map((r) => row({ id: `r-${slug(r)}`, tap: enter(r), what: `#${r}`, mark: "chevron" })), "No rooms yet. Name the first.", "room-list")}</div>`,
      `<form class="say" aria-label="Go into a new room"${write("session", "replace", "/room")}><input name="room" autocomplete="off" required placeholder="A new room" aria-label="A new room"><button type="submit" class="tool">Go in</button></form>`,
    ),
  });
}
