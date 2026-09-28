import { describe, expect, test } from "bun:test";
import { asDrawn, check, flavourOf, kindOf, linkedTo, links, names, readTypes, typesFindings, undrawn, unwrap } from "./check";

// A small vocabulary in types.ts's plain style: a room and a session, with a part of each kind
// that goes wrong, so every finding has something to find.
const types = readTypes(`
// a line comment, and a block comment, are not read
/** the persistent and the transient */
export type Persistent<T> = T;
export type Transient<T> = T;
export type Actor = "person";
export type ConnectionEvent = "connect" | "disconnect";
export type Mixed = string | "x";
export interface Message { author: string; text: string }
export interface RoomDoc {
  name: Persistent<string>;
  members: Transient<Record<string, true>>;
  messages: Persistent<Message[]>;
  typing: Transient<string[]>;
}
export interface SessionDoc { name: Persistent<string | null>; room: string }
export interface Tables { rooms: { name: string }; messages: { room: string; text?: string } }
export interface Documents {
  "room:<name>": { shape: RoomDoc; openedBy: "everyone in the room" };
  "session": { shape: SessionDoc; openedBy: "the one device" };
  "ghost": { shape: Nothing; openedBy: "nobody" };
}
export interface Reads { "room:<name>": { opens: "on entering its name"; closes: "on leaving" } }
export interface Derivations { "room:<name> /members": "the people in the room"; "session /name": "who they said"; "lobby /rooms": "the rooms" }
export interface Writes {
  "session /name": { replace: string; does: "enter a name"; refused: "a name is needed" };
  "room:<name> /messages/-": { add: { text: string }; does: "say something"; refused: "you are not in this room" | "say it again" };
  "room:<name> /members": { replace: string; does: "take a seat" };
}
export type SessionState = "nameless" | "named";
`);
const uml = (...lines: string[]) => ["@startuml", ...lines, "@enduml"].join("\n");
const json = (example: string) => `@startjson\n#highlight "name"\n${example}\n@endjson`;

describe("reading types.ts", () => {
  test("unions of words, interfaces, the tables as classes, and the documents, writes, reads and derivations", () => {
    expect([...types.unions.keys()]).toEqual(["Actor", "ConnectionEvent", "SessionState"]);
    expect([...types.interfaces.keys()]).toEqual(["Message", "RoomDoc", "SessionDoc", "rooms", "messages"]);
    expect(types.interfaces.get("messages")!.fields).toEqual(["room", "text"]);
    expect(types.documents.map((d) => [d.key, d.shape, d.openedBy, d.match.test("room:general")])).toEqual([
      ["room:<name>", "RoomDoc", "everyone in the room", true],
      ["session", "SessionDoc", "the one device", false],
      ["ghost", "Nothing", "nobody", false],
    ]);
    expect(types.writes[1]).toEqual({ key: "room:<name> /messages/-", doc: "room:<name>", path: "/messages/-", ops: ["add"], does: "say something", refused: ["you are not in this room", "say it again"] });
    expect(types.reads).toEqual([{ doc: "room:<name>", opens: "on entering its name", closes: "on leaving" }]);
    expect(types.derivations[0]).toEqual({ key: "room:<name> /members", doc: "room:<name>", path: "/members", rule: "the people in the room" });
  });

  test("flavours: a part is persistent or transient, or says neither", () => {
    expect(unwrap("Transient<string[]>")).toEqual({ flavour: "transient", inner: "string[]" });
    expect(unwrap("string")).toEqual({ inner: "string" });
    const room = types.documents[0]!;
    expect(flavourOf(types, room, "/members/Ada")).toBe("transient");
    expect(flavourOf(types, room, "")).toBeUndefined();
  });

  test("what types.ts says that contradicts itself", () => {
    expect(typesFindings(types)).toEqual([
      "the write room:<name> /members lands on a transient part: a person does not write it",
      "room:<name> /typing is transient but Derivations does not say what it is derived from",
      "session /name is derived but marked Persistent",
      "SessionDoc.room has no flavour: Persistent or Transient",
      "the derivation lobby /rooms names no document",
      "Reads does not say when session is opened and closed",
      "Reads does not say when ghost is opened and closed",
    ]);
  });
});

test("a label names a name by its words, in order, or run together", () => {
  expect(names("Enter another room's name", "enter a room's name")).toBe(true);
  expect(names("Log out", "logout")).toBe(true);
  expect(names("Leave", "enter a name")).toBe(false);
});

test("the kind of a diagram, and whether it links or is linked to", () => {
  expect([json("{}"), uml("[*] --> a"), uml('usecase "x"'), uml("class A {", "}"), uml("a -> b : x"), uml("note: x")].map(kindOf)).toEqual(["document", "states", "use cases", "classes", "sequence", "other"]);
  expect([links("use cases"), links("classes"), links("sequence"), linkedTo("sequence"), linkedTo("document"), linkedTo("classes")]).toEqual([true, true, false, true, true, false]);
});

describe("checking a diagram against types.ts", () => {
  test("a document drawn as an example: every part of its shape, and nothing else, in each of its items", () => {
    expect(check("document-room", json('{ "name": "general", "members": { "Ada": true }, "messages": [{ "author": "Ada", "text": "hi" }, "x"], "typing": [] }'), types).drift).toEqual([]);
    expect(check("document-room", json('{ "name": "general", "topic": "", "messages": [{ "author": "Ada", "at": 1 }], "members": {} }'), types).drift).toEqual([
      "topic is not in RoomDoc",
      "RoomDoc.typing is not in the example",
      "messages: at is not in Message",
      "messages: Message.text is missing",
    ]);
    expect(check("document-lobby", json("{}"), types).drift).toEqual(["no document in types.ts is called lobby"]);
    expect(check("document-session", json("{ nope"), types).drift).toEqual(["the example is not JSON", "SessionDoc.name is not in the example", "SessionDoc.room is not in the example"]);
  });

  test("a class: an interface, with every field drawn and none it lacks", () => {
    const c = check("classes", uml("class RoomDoc <<document>> {", "  name", "  members", "  messages : Message[]", "  typing", "}", "class Message {", "  author", "  body", "}", "class Nothing {", "  x", "}"), types);
    expect(c.drift).toEqual(["Message.body is not a field of Message", "Message.text is in types.ts but not drawn", "class Nothing is not an interface in types.ts"]);
    expect([...c.uses]).toEqual(["RoomDoc", "Message"]);
  });

  test("a sequence: documents opened and closed, connection events, patches on a shape's paths, writes and how they are refused", () => {
    const c = check("seq-say", uml(
      "actor person",
      "participant server",
      "person -> server : open room:general",
      "person -> server : close room:general",
      "person -> server : open lobby:all",
      "person -> server : connect",
      "server -> person : patch room:general add /members/Ada",
      "server -> person : patch room:general replace /messages/1/body",
      "server -> person : patch room:general add /topic",
      "server -> person : patch lobby:all add /rooms/x",
      "server -> person : patch ghost add /x",
      "person -> server : add room:general /messages/-",
      "server --> person : say it again",
      "server --> person : a name is needed",
      "person -> server : replace room:general /messages/-",
      "person -> server : replace room:general /members",
      "person -> server : add nowhere:x /y",
      "person -> server : remove session",
      "person -> server : replace session /name/2",
      "person -> server : hello there",
    ), types);
    expect(c.drift).toEqual([
      '"open lobby:all": lobby:all is not a document in types.ts',
      '"patch room:general replace /messages/1/body": body is not in Message',
      '"patch room:general add /topic": topic is not in RoomDoc',
      '"patch lobby:all add /rooms/x": lobby:all is not a document in types.ts',
      '"patch ghost add /x": ghost\'s shape Nothing is not an interface',
      '"a name is needed" is not how room:<name> /messages/- is refused',
      '"replace room:general /messages/-": room:<name> /messages/- allows add, not replace',
      '"replace room:general /members": members is transient -- it changes as an effect, a person does not write it',
      '"add nowhere:x /y": nowhere:x is not a document in types.ts',
      'person writes "remove session", which is not in Writes',
      '"replace session /name/2": name is not a list or keyed by name',
      'person writes "replace session /name/2", which is not in Writes',
      'person sends "hello there", which is neither a write nor a connection event',
    ]);
    for (const use of ["open:room:<name>", "close:room:<name>", "event:connect", "derived:room:<name> /members", "write:room:<name> /messages/-", "write:room:<name> /members", "reason:say it again"]) expect(c.uses).toContain(use);
  });

  test("states: a union ending in State, drawn whole, moved by writes and connection events", () => {
    const c = check("session", uml("[*] --> nameless", "nameless --> named : enter a name [not blank] / done", "named --> nameless : disconnect", "named --> gone : dance"), types);
    expect(c.drift).toEqual(["state gone is not in SessionState", 'event "dance" is not a write in Writes or in a union ending in "Event"']);
    expect(c.uses).toContain("does:session /name");
    expect(check("half", uml("[*] --> nameless"), types).drift).toEqual(['SessionState has "named", not drawn']);
    expect(check("other", uml("[*] --> foo"), types).drift).toEqual(['no union ending in "State" in types.ts has these states']);
  });

  test("use cases: actors of Actor, each case what a write does", () => {
    const c = check("use-cases", uml("actor person", "actor robot", 'usecase "Enter a name" as U1', 'usecase "Say something\\nin the room" as U2', 'usecase "Dance" as U3'), types);
    expect(c.drift).toEqual(["actor robot is not in Actor", 'use case "Dance" is not what any write in Writes does']);
    expect(c.uses).toContain("does:room:<name> /messages/-");
  });

  test("what types.ts has that no diagram draws yet", () => {
    const none = undrawn(types, []);
    for (const u of ["Message (a class)", "the document room:<name>, drawn as an example", "the write session /name, in a sequence", '"enter a name", as a use case or a state\'s event', "SessionState (states)", 'the refusal "a name is needed"', "opening room:<name>, in a sequence", "closing room:<name>, in a sequence", "a patch derived for room:<name> /members, in a sequence", 'the event "connect", in a sequence']) expect(none).toContain(u);
    const drawn = [check("document-room", json("{}"), types), check("session", uml("[*] --> nameless", "nameless --> named"), types)];
    expect(undrawn(types, drawn)).not.toContain("SessionState (states)");
    expect(undrawn(types, drawn)).not.toContain("the document room:<name>, drawn as an example");
  });
});

describe("as drawn: links and flavours added at render time, the source left as written", () => {
  const sequence = check("seq-say", uml("actor person", "person -> server : add room:general /messages/-"), types);
  const example = check("document-room", json("{}"), types);

  test("a use case links to the first sequence of its write", () => {
    const drawn = asDrawn(uml('usecase "Say something" as U1', 'usecase "Enter a name" as U2'), "use-cases", types, [example, sequence]);
    expect(drawn).toContain('usecase "Say something" as U1 [[#seq-say{open its sequence}]]');
    expect(drawn).toContain('usecase "Enter a name" as U2\n');
  });

  test("a «document» class links to its example, and each attribute says its flavour", () => {
    const drawn = asDrawn(uml("class RoomDoc <<document>> {", "  members", "  name", "}", "class Message {", "  text", "}"), "classes", types, [sequence, example]);
    expect(drawn).toContain("class RoomDoc <<document>> [[#document-room{open its example}]] {");
    expect(drawn).toContain("  members {transient}\n  name {persistent}\n}");
    expect(drawn).toContain("class Message {\n  text\n}");
  });

  test("a patch to a transient part is not on the ledger; an example highlights its transient parts", () => {
    expect(asDrawn(uml("server -> person : patch room:general add /members/Ada", "server -> person : patch room:general add /messages/-"), "seq", types, [])).toContain(
      "patch room:general add /members/Ada //(derived: not on the ledger)//\nserver -> person : patch room:general add /messages/-\n",
    );
    expect(asDrawn(json("{}"), "document-room", types, [])).toBe('@startjson\n#highlight "members"\n#highlight "typing"\n#highlight "name"\n{}\n@endjson');
    expect(asDrawn(json("{}"), "document-session", types, [])).toBe(json("{}"));
    expect(asDrawn(json("{}"), "document-lobby", types, [])).toBe(json("{}"));
    expect(asDrawn(uml("note: x"), "other", types, [])).toBe(uml("note: x"));
  });
});
