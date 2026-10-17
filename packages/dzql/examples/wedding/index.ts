import type { Example } from "dzql/rendering/example";
import * as sessionDoc from "./documents/session";
import * as weddingDoc from "./documents/wedding";
import { delta, sessions } from "./delta";
import { welcome } from "./views/welcome";
import { toldAt } from "dzql/rendering/refusal";
import { board, everyone, renderBoard, wedding, welcome as welcomeDoc } from "./resources/board";
import { household, renderHousehold } from "./resources/household";
import { session } from "./resources/session";
import { routes } from "./routes";
import index from "./client/index.html";

export const example: Example = {
  name: "wedding",
  resources: [session, household, board, wedding, welcomeDoc, everyone],
  // The welcome until a code says who you are, then whichever of the two it makes you.
  render(sessionId) {
    const visit = sessionDoc.read(sessionId);
    const page = visit.kind === "household" ? renderHousehold(visit, sessionId) : visit.kind === "couple" ? renderBoard(visit) : undefined;
    return page ?? welcome(weddingDoc.welcome(), visit.note, toldAt(sessionId, "session", "/code"));
  },
  // The same guard every write path already needs: a tab that has left (or whose code no longer
  // exists) shouldn't be able to write, undo included, as if it were still in.
  active: (sessionId) => sessionDoc.read(sessionId).code !== null,
  index,
  address: { doc: "session", path: "/page" }, // a screen's URL is where the session goes (the server routes it)
  routes,
  delta, // the documents are delta's (./delta.ts)
  session: sessions.of, // a visit is a numbered row, named by its cookie
};
