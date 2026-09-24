// Every name the diagrams use. The classes are its interfaces, the API is `Api`, a class's states
// are the union named after it (`SessionState`), and its other events a union ending in `Event`.
// watch.ts checks each diagram in src/ against this file and shows where they drift apart.
//
// The app: chat. A person enters a name, then enters a room's name, which takes them into that
// room (and makes it, if nobody has); says things that everyone in the room sees; enters another
// room's name to move; and logs out. There is no leaving a room but by entering another, or logging out. Nothing is chosen from a list: every name is typed,
// and a blank one is refused with a reason.

export type Actor = "person";

export interface Session {
  id: string;
  name: string | null;
  room: Room["name"] | null;
  state: SessionState;
}

export interface Room {
  name: string;
}

export interface Message {
  id: string;
  room: Room["name"];
  author: Session["name"];
  text: string;
  at: string;
}

export type SessionState = "nameless" | "named" | "inRoom";

export interface Api {
  enterName(req: { name: string }): { ok: true } | { ok: false; reason: "a name is needed" };
  enterRoomName(req: { room: Room["name"] }): { room: Room["name"]; members: Session["name"][]; messages: Message[] } | { ok: false; reason: "enter a name first" | "a room's name is needed" };
  say(req: { text: string }): { message: Message["id"] };
  logout(): { ok: true };
}
