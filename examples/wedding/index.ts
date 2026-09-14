import type { Example } from "../../src/example";
import * as sessionDoc from "./documents/session";
import { board } from "./concepts/board";
import { household } from "./concepts/household";
import { session } from "./concepts/session";
import { routes } from "./routes";
import index from "./client/index.html";

export const example: Example = {
  name: "wedding",
  // The welcome is decided first (no code yet), then whichever of the two the code makes you.
  concepts: [session, household, board],
  // The same guard every write path already needs: a tab that has left (or whose code no longer
  // exists) shouldn't be able to write, undo included, as if it were still in.
  active: (sessionId) => sessionDoc.read(sessionId).code !== null,
  index,
  routes,
};
