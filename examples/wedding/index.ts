import type { Example } from "../../src/example";
import * as sessionDoc from "./documents/session";
import * as weddingDoc from "./documents/wedding";
import { delta } from "./delta";
import { welcome } from "./views/welcome";
import { reasonFor } from "../../src/refusal";
import { board, everyone, renderBoard, wedding, welcome as welcomeDoc } from "./compartments/board";
import { household, renderHousehold } from "./compartments/household";
import { session } from "./compartments/session";
import { routes } from "./routes";
import index from "./client/index.html";

export const example: Example = {
  name: "wedding",
  compartments: [session, household, board, wedding, welcomeDoc, everyone],
  // The welcome until a code says who you are, then whichever of the two it makes you.
  render(sessionId) {
    const visit = sessionDoc.read(sessionId);
    const page = visit.kind === "household" ? renderHousehold(visit) : visit.kind === "couple" ? renderBoard(visit) : undefined;
    return page ?? welcome(weddingDoc.welcome(), visit.note, reasonFor(sessionId, "session", "/code"));
  },
  // The same guard every write path already needs: a tab that has left (or whose code no longer
  // exists) shouldn't be able to write, undo included, as if it were still in.
  active: (sessionId) => sessionDoc.read(sessionId).code !== null,
  index,
  routes,
  delta, // the documents are delta's (./delta.ts)
};
