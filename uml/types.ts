// Every name the diagrams use. The classes are its interfaces, the API is `Api`, a class's states
// are the union named after it (`SessionState`), and its other events a union ending in `Event`.
// watch.ts checks each diagram in src/ against this file and shows where they drift apart.
//
// The app: chat. A person gives a name, goes into a room, says things that everyone in the room
// sees, moves to another room, leaves, and logs out.

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
  chooseName(req: { name: string }): { ok: true } | { ok: false; reason: "a name is needed" };
  chooseRoom(req: { room: Room["name"] }): { room: Room["name"]; members: Session["name"][]; messages: Message[] } | { ok: false; reason: "choose a name first" | "a room name is needed" };
  say(req: { text: string }): { message: Message["id"] };
  leave(): { ok: true };
  logout(): { ok: true };
}
