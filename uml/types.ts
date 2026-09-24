// Every name the diagrams use. The app: chat. A person enters a name, then enters a room's name,
// which takes them into that room (and makes it, if nobody has); says things that everyone in the
// room sees; enters another room's name to move; and logs out. There is no leaving a room but by
// entering another, or logging out. Nothing is chosen from a list: every name is typed, and a blank
// one is refused with a reason.
//
// The documents are what a person has open. A write names a document and a path in it, never a
// function; everyone who has the document open is sent the patch. States are a document's values.
//
// A document is composed for the person reading it; each part has a flavour, by where its truth
// lives. Persistent: survives a restart, on the ledger, undoable. Transient: true while people are
// connected, written by the system as an effect, never undone, gone on restart.

export type Persistent<T> = T;
export type Transient<T> = T;

export type Actor = "person";

export interface Message {
  author: string;
  text: string;
  at: string;
}

/** A room, as the people in it see it. */
export interface RoomDoc {
  name: Persistent<string>;
  members: Transient<string[]>;
  messages: Persistent<Message[]>;
}

/** A person's own session: who they are, and where. */
export interface SessionDoc {
  name: Persistent<string | null>;
  room: Persistent<string | null>;
}

/** The documents, by the name they are opened by, and who has each open. */
export interface Documents {
  "room:<name>": { shape: RoomDoc; openedBy: "everyone in the room" };
  "session": { shape: SessionDoc; openedBy: "the person alone" };
}

/** The writes a person makes: a document and a path, the op, what it is called, and why it is refused. */
export interface Writes {
  "session /name": { replace: string; does: "enter a name"; refused: "a name is needed" };
  "session /room": { replace: string; does: "enter a room's name"; refused: "enter a name first" | "a room's name is needed" };
  "room:<name> /messages/-": { add: Message; does: "say something" };
  "session": { remove: true; does: "log out" };
}

/** The session's values, named: no name yet, a name, a name and a room. */
export type SessionState = "nameless" | "named" | "inRoom";
