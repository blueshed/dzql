import { story, type Stories, type Write } from "../../src/stories";

const name = (value: string): Write => ({ doc: "session", ops: [{ op: "replace", path: "/name", value }] });
const room = (value: string): Write => ({ doc: "session", ops: [{ op: "replace", path: "/room", value }] });
const leave: Write = { doc: "session", ops: [{ op: "remove", path: "/room" }] };
const logout: Write = { doc: "session", ops: [{ op: "remove", path: "/name" }] };
const say = (text: string): Write => ({ doc: "room", ops: [{ op: "add", path: "/messages/-", value: text }] });

// Chat is three steps: what's your name, what room, say something. The stories are those steps in
// order, each with who then sees it, and the refusals that keep the steps in order. Nothing in
// chat exists that one of these does not need. The cast: Ada and Bob are in general, Cy is in the
// kitchen, Dee has a name and is choosing a room, Eve has only just arrived.
export const stories: Stories = {
  cast: { ada: [name("Ada"), room("general")], bob: [name("Bob"), room("general")], cy: [name("Cy"), room("kitchen")], dee: [name("Dee")], eve: [] },
  stories: [
    // ── what's your name ──
    story("Eve gives her name, and is asked which room", { as: "eve", does: name("Eve"), seen: ["eve"] }),
    story("Without a name you cannot enter a room", { as: "eve", cannot: room("general") }),

    // ── what room ──
    story("Dee goes into general, and Ada and Bob see her arrive", { as: "dee", does: room("general"), seen: ["dee", "ada", "bob"], unseen: ["cy"] }),
    story("Dee names a room nobody has made, and is in it", { as: "dee", does: room("attic"), seen: ["dee"], unseen: ["ada", "bob", "cy"] }),
    story("Without a room name you cannot enter a room", { as: "dee", cannot: room("  ") }),
    story("Cy comes over from the kitchen, and Ada and Bob see Cy arrive", { as: "cy", does: room("general"), seen: ["cy", "ada", "bob"] }),
    story("Bob leaves, and the room shows him gone", { as: "bob", does: leave, seen: ["bob", "ada"] }),

    // ── say something ──
    story("Ada says hello; Bob, in the room, sees it; Cy, in the kitchen, does not", { as: "ada", does: say("hello"), seen: ["ada", "bob"], unseen: ["cy", "dee", "eve"] }),
    story("Nobody can take a message back over the wire; only Undo can", { as: "ada", cannot: { doc: "room", ops: [{ op: "remove", path: "/messages/any" }] } }),

    // ── and going ──
    story("Ada logs out, and the room shows her gone", { as: "ada", does: logout, seen: ["ada", "bob"] }),
  ],
};
