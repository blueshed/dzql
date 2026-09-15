import { story, type Stories, type Write } from "../../src/stories";

const name = (value: string): Write => ({ doc: "session", ops: [{ op: "replace", path: "/name", value }] });
const room = (value: string): Write => ({ doc: "session", ops: [{ op: "replace", path: "/room", value }] });
const leave: Write = { doc: "session", ops: [{ op: "remove", path: "/room" }] };
const logout: Write = { doc: "session", ops: [{ op: "remove", path: "/name" }] };
const say = (text: string): Write => ({ doc: "room", ops: [{ op: "add", path: "/transcript/-", value: text }] });

export const stories: Stories = {
  cast: { ada: [name("Ada"), room("general")], bob: [name("Bob"), room("general")], cy: [name("Cy"), room("kitchen")], nobody: [] },
  stories: [
    story("Ada says hello; Bob, in the room, sees it; Cy, in the kitchen, does not", { as: "ada", does: say("hello"), seen: { ada: "room", bob: "room" }, unseen: ["cy", "nobody"] }),
    story("Cy comes into the room, and Ada and Bob see Cy arrive", { as: "cy", does: room("general"), seen: { cy: "room", ada: "room", bob: "room" } }),
    story("Bob leaves, and the room shows him gone", { as: "bob", does: leave, seen: { bob: "room", ada: "room" } }),
    story("Ada logs out, and the room shows her gone", { as: "ada", does: logout, seen: { ada: "session", bob: "room" } }),
    story("Nobody can take a message back over the wire; only Undo can", { as: "ada", cannot: { doc: "room", ops: [{ op: "remove", path: "/transcript/0" }] } }),
    story("Without a name you cannot enter a room", { as: "nobody", cannot: room("general") }),
  ],
};
