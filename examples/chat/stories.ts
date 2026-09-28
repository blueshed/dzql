import { story, type Stories, type Write } from "../../src/stories";

const name = (value: string): Write => ({ doc: "session", ops: [{ op: "replace", path: "/name", value }] });
const room = (value: string): Write => ({ doc: "session", ops: [{ op: "replace", path: "/room", value }] });
const leave: Write = { doc: "session", ops: [{ op: "remove", path: "/room" }] };
const logout: Write = { doc: "session", ops: [{ op: "remove", path: "/name" }] };
const say = (text: string): Write => ({ doc: "room", ops: [{ op: "add", path: "/messages/-", value: text }] });

// Chat is three steps: what's your name, what room, say something. The stories are those steps in
// order, each with who then sees it, and the refusals that keep the steps in order. Nothing in
// chat exists that one of these does not need. The cast: Ada and Bob are in general, Cy is in the
// kitchen, Dee has a name and is choosing a room, Eve has only just arrived. A story hands a page
// 4.5 KB at most (`budget`), by its write, its undo or its redo: a place you go to comes whole, and
// after that only what changed in it. The most is Dee's attic taken back, 4,339 bytes: the lobby again.
export const stories: Stories = {
  cast: { ada: [name("Ada"), room("general")], bob: [name("Bob"), room("general")], cy: [name("Cy"), room("kitchen")], dee: [name("Dee")], eve: [] },
  budget: 4608,
  stories: [
    // ── what's your name ──
    story("Eve gives her name, and is asked which room", { as: "eve", does: name("Eve"), seen: ["eve"] }),
    story("Without a name you cannot enter a room", { as: "eve", cannot: room("general") }),

    // ── what room ──
    story("Dee goes into general, and Ada and Bob see her arrive", { as: "dee", does: room("general"), seen: ["dee", "ada", "bob"], untold: ["cy"] }),
    story("Dee names a room nobody has made, and is in it", { as: "dee", does: room("attic"), seen: ["dee"], untold: ["ada", "bob", "cy"] }),
    story("Without a room name you cannot enter a room", { as: "dee", cannot: room("  ") }),
    story("Cy leaves the kitchen, and the kitchen, empty now, leaves Dee's list of rooms", { as: "cy", does: leave, seen: ["cy", "dee"] }),
    story("Bob leaves, and the room shows him gone", { as: "bob", does: leave, seen: ["bob", "ada"] }),

    // ── say something ──
    story("Ada says hello; Bob, in the room, sees it; Cy, in the kitchen, does not", { as: "ada", does: say("hello"), seen: ["ada", "bob"], untold: ["cy", "dee", "eve"], budget: 1024 }), // a message is its row
    story("Nobody can take a message back over the wire; only Undo can", { as: "ada", cannot: { doc: "room", ops: [{ op: "remove", path: "/messages/any" }] } }),

    // ── and going ──
    story("Ada logs out, and the room shows her gone", { as: "ada", does: logout, seen: ["ada", "bob"] }),
    story("Bob closes his tab, and Ada sees him leave general", { as: "bob", closesTab: true, seen: ["ada"], untold: ["cy", "dee", "eve"] }),
  ],
};
