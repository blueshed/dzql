// Every name the diagrams use. The app: chat. A person enters a name, then enters a room's name,
// which takes them into that room (and makes it, if nobody has); says things that everyone in the
// room sees; enters another room's name to move; and logs out. There is no leaving a room but by
// entering another, or logging out. Nothing is chosen from a list: every name is typed, and a blank
// one is refused with a reason.
//
// The documents are what a person has open. The app opens and closes them for the person (Reads). A
// write names a document and a path in it, never a function (Writes); everyone who has the document
// open is sent the patch. States are a document's values.
//
// A document is composed for the person reading it, and each part has a flavour. Persistent: stored,
// it survives a restart. Transient: derived from who is connected (Derivations), never stored, never
// written; after a restart nobody is connected, so it is empty until people come back. Whether Undo
// can take a write back is the write's own (`undoable`): only what someone said is on the ledger.

export type Persistent<T> = T;
export type Transient<T> = T;

export type Actor = "person";

/** A connection comes and goes without anyone writing anything. */
export type ConnectionEvent = "connect" | "disconnect";

export interface Message {
  author: string;
  text: string;
  at: string;
}

/** A room, as the people in it see it. */
export interface RoomDoc {
  name: Persistent<string>;
  members: Transient<Record<string, true>>;
  messages: Persistent<Message[]>;
}

/** A person's own session: who they are, and where. `room` is null until `name` is set (SessionState). */
export interface SessionDoc {
  name: Persistent<string | null>;
  room: Persistent<string | null>;
}

/** The lobby: the rooms that have people in them now. It informs: a room's name is still typed. */
export interface LobbyDoc {
  rooms: Transient<Record<string, true>>;
}

/** The tables beneath the documents' persistent parts. Transient parts have none. */
export interface Tables {
  rooms: { name: string };
  messages: { room: string; author: string; text: string; at: string };
  sessions: { id: string; name: string | null; room: string | null };
}

/** The documents, by the name they are opened by, and who has each open. */
export interface Documents {
  "room:<name>": { shape: RoomDoc; openedBy: "everyone in the room" };
  "session": { shape: SessionDoc; openedBy: "the person alone" };
  "lobby": { shape: LobbyDoc; openedBy: "everyone with a name" };
}

/** When the app opens and closes each document for a person. Opening sends the document whole; a room sends its latest messages. */
export interface Reads {
  "session": { opens: "on connect"; closes: "on disconnect, or logging out" };
  "lobby": { opens: "once the person has a name"; closes: "on disconnect, or logging out" };
  "room:<name>": { opens: "on entering its name"; closes: "on entering another room's name, disconnecting, or logging out" };
}

/** Each transient part, and what it is derived from. It is derived again whenever a session connects, disconnects or moves, and a patch goes only where its value changed. */
export interface Derivations {
  "room:<name> /members": "the names of the connected sessions whose room is <name>";
  "lobby /rooms": "the rooms of the connected sessions";
}

/** The writes a person makes: a document and a path, the op, what it is called, why it is refused, and whether Undo can take it back. */
export interface Writes {
  "session /name": { replace: string; does: "enter a name"; refused: "a name is needed" | "that name is in use"; undoable: false };
  "session /room": { replace: string; does: "enter a room's name"; refused: "enter a name first" | "a room's name is needed"; undoable: false };
  "room:<name> /messages/-": { add: { text: string }; does: "say something"; refused: "you are not in this room"; stamps: "author and at"; undoable: true };
  "session": { remove: true; does: "log out"; undoable: false };
}

/** The session's values, named: no name yet, a name, a name and a room. */
export type SessionState = "nameless" | "named" | "inRoom";
