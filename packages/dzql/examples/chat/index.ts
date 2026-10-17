import type { Example } from "dzql/rendering/example";
import * as sessionDoc from "./documents/session";
import { here, lobby, render, room } from "./resources/room";
import { session } from "./resources/session";
import index from "./client/index.html";
import { delta, sessions } from "./delta";

export const example: Example = {
  name: "chat",
  resources: [session, room, here, lobby],
  delta,
  session: sessions.of,
  render,
  // Same guard every write path already needs: a stale, logged-out tab
  // shouldn't be able to write (including undo) as if it were still active.
  active: (sessionId) => sessionDoc.read(sessionId).name !== null,
  index,
};
