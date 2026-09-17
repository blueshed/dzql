import type { Example } from "../../src/example";
import * as sessionDoc from "./documents/session";
import { render, room } from "./compartments/room";
import { session } from "./compartments/session";
import index from "./client/index.html";

export const example: Example = {
  name: "chat",
  compartments: [session, room],
  render,
  // Same guard every write path already needs: a stale, logged-out tab
  // shouldn't be able to write (including undo) as if it were still active.
  active: (sessionId) => sessionDoc.read(sessionId).name !== null,
  index,
};
