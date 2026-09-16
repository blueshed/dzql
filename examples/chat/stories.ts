import type { PatchOp } from "../../src/json-patch";
import { story, type Stories, type Write } from "../../src/stories";

const name = (value: string): Write => ({ doc: "session", ops: [{ op: "replace", path: "/name", value }] });
const room = (value: string): Write => ({ doc: "session", ops: [{ op: "replace", path: "/room", value }] });
const leave: Write = { doc: "session", ops: [{ op: "remove", path: "/room" }] };
const logout: Write = { doc: "session", ops: [{ op: "remove", path: "/name" }] };
const say = (text: string): Write => ({ doc: "room", ops: [{ op: "add", path: "/transcript/-", value: text }] });

/** "room @ key=value, ..." as one session write: the room, then what the tray holds there --
 * `open=people`, `focus=Bob`, `filter.rooms=ge`; a `key.sub` writes `/key/sub`. */
function at(where: string): Write {
  const [room, rest] = where.split(" @ ");
  const ops: PatchOp[] = [{ op: "replace", path: "/room", value: room }];
  for (const pair of rest ? rest.split(", ") : []) {
    const [key, raw] = pair.split("=") as [string, string];
    ops.push({ op: "replace", path: `/${key.split(".").join("/")}`, value: raw === "true" ? true : raw });
  }
  return { doc: "session", ops };
}

// Chat's page is the room a person is in, and the cast already puts everyone in one, so `seen`
// may simply list who notices; where it names a place, the place is the room and what is open there.
export const stories: Stories = {
  cast: { ada: [name("Ada"), room("general")], bob: [name("Bob"), room("general")], cy: [name("Cy"), room("kitchen")], nobody: [] },
  at,
  stories: [
    story("Ada says hello; Bob, in the room, sees it; Cy, in the kitchen, does not", { as: "ada", does: say("hello"), seen: ["ada", "bob"], unseen: ["cy", "nobody"] }),
    story("Cy comes into the room, and Ada and Bob see Cy arrive", { as: "cy", does: room("general"), seen: ["cy", "ada", "bob"] }),
    story("Bob leaves, and the room shows him gone", { as: "bob", does: leave, seen: ["bob", "ada"] }),
    story("Ada logs out, and the room shows her gone", { as: "ada", does: logout, seen: ["ada", "bob"] }),
    story("Nobody can take a message back over the wire; only Undo can", { as: "ada", cannot: { doc: "room", ops: [{ op: "remove", path: "/transcript/0" }] } }),
    story("Without a name you cannot enter a room", { as: "nobody", cannot: room("general") }),

    // ── The room as a box: people are things, a new room is a modal, find on the conversation ──
    story("Ada opens the people, and only her page shows the window", { as: "ada", does: at("general @ open=people"), seen: { ada: "general" } }),
    story("Ada opens Bob's drawer, and only her page shows him chosen", { as: "ada", does: at("general @ open=people, focus=Bob"), seen: { ada: "general @ open=people" } }),
    story("Ada renames herself from her own drawer, and the room sees the new name", { as: "ada", does: name("Ada L"), seen: { ada: "general @ open=people, focus=Ada", bob: "general @ open=people" } }),
    story("Ada asks for a new room, and the modal asks its name", { as: "ada", does: at("general @ open=rooms, new=rooms"), seen: { ada: "general @ open=rooms" } }),
    story("Ada finds hello; the message stays lit and the tally says how many of all", { as: "ada", does: at("general @ open=conversation, filter.conversation=hello"), seen: { ada: "general @ open=conversation" } }),
    story("Ada presses the eye, and the messages that miss are gone from the list", { as: "ada", does: at("general @ open=conversation, filter.conversation=hello, hide.conversation=true"), seen: { ada: "general @ open=conversation, filter.conversation=hello" } }),
    story("Nobody can open a compartment the box does not have", { as: "ada", cannot: at("general @ open=attic") }),
  ],
};
