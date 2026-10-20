import { layers } from "dzql/rendering/bento";
import { read as sessionOf } from "./resources/session/session-api";
import { renderNameForm } from "./resources/session/session-view";
import { read as roomOf } from "./resources/room/room-api";
import { renderRoom } from "./resources/room/room-view";
import { people } from "./resources/here/here-api";
import { list } from "./resources/lobby/lobby-api";
import { renderRooms } from "./resources/lobby/lobby-view";

// Chat's page, drawn by the server for whoever is looking, from the parts each resource draws
// (`resources/<name>/<name>-view.ts`). Chat is three steps -- your name, a room, say something --
// and each page is a collection, not a box, drawn with the kernel's surfaces (./surfaces.ts): the
// rooms, a row each and the one form that names a new one; a room, its conversation and the one
// form that says something, with who is here across its head. The trail is the way back, and the
// page's tools are undo, redo and logging out. Nothing here is kept between taps: what the page
// shows is the session's name, room and how far back it reads, and the room's messages and people.
// Your room is the session's, not a tab's (./resources/session/session.ts): chat has no address,
// and its pages are drawn at none.

/** Chat's page: the three steps, in the bento's frame (nothing opens over them). No name, the name form; no room, the rooms; else the room. */
export function render(sessionId: string): string {
  const { name, room, before } = sessionOf(sessionId);
  const page = !name ? renderNameForm() : !room ? renderRooms(name, list()) : renderRoom(name, room, people(room), before, roomOf(room, before));
  return layers(page, "", "");
}
