import type { Example } from "dzql/rendering/example";
import { modelCompartment, session } from "./compartments";
import { session as sessionOf } from "./model";
import { render } from "./page";
import { signIn } from "./signin";
import index from "./client/index.html";
import { delta } from "./delta";

// modeling: a description of an application, kept by two people as they talk -- Peter tells the
// stories, Claude writes them down and describes the documents they need, from the CLI -- and
// watched live on the page. The entities are worked out from the documents (./model.ts).
export const example: Example = {
  name: "modeling",
  // The session first: who you are, and what you have picked.
  compartments: [session, modelCompartment],
  render,
  // Signed in or not: a signed-out tab writes nothing, Undo included.
  active: (sessionId) => sessionOf(sessionId).person !== null,
  // The ledger's who is the person, not the visit.
  who: (sessionId) => sessionOf(sessionId).person?.id ?? sessionId,
  index,
  routes: { "/login": signIn },
  delta, // the documents are delta's (./delta.ts)
};
