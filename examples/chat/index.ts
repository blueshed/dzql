import type { Example } from "../../src/example";
import * as sessionDoc from "./documents/session";
import { room } from "./concepts/room";
import { session } from "./concepts/session";
import index from "./client/index.html";

export const example: Example = {
  name: "chat",
  concepts: [session, room],
  // Same guard every write path already needs: a stale, logged-out tab
  // shouldn't be able to write (including undo) as if it were still active.
  active: (sessionId) => sessionDoc.read(sessionId).name !== null,
  index,
};
