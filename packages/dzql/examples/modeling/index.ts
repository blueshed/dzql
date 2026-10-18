import type { Example } from "dzql/rendering/example";
import { modelResource, session } from "./resources";
import { session as sessionOf } from "./model";
import { render } from "./page";
import { signIn } from "./signin";
import index from "./client/index.html";
import { delta, sessions } from "./delta";

// modeling: a description of an application, kept by two people as they talk -- Peter tells the
// stories, Claude writes them down and describes the documents they need, from the CLI -- and
// watched live on the page. The entities are worked out from the documents (./model.ts).
export const example: Example = {
  name: "modeling",
  // The session first: who you are, and what you have picked.
  resources: [session, modelResource],
  render,
  // Signed in or not: a signed-out tab writes nothing, Undo included.
  active: (sessionId) => sessionOf(sessionId).person !== null,
  // The ledger's who is the person, not the visit.
  who: (sessionId) => sessionOf(sessionId).person?.id ?? sessionId,
  index,
  at: "/model", // a route of whatever app it is served beside, in development: never registered in production
  routes: { "/login": signIn },
  delta, // the documents are delta's (./delta.ts)
  session: sessions.of, // a session is a numbered row, named by its cookie
};
