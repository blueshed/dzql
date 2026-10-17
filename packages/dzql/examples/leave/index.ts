import type { Example } from "dzql/rendering/example";
import { session, team } from "./resources";
import { session as sessionOf } from "./documents";
import { render } from "./page";
import { identify, signIn } from "./signin";
import index from "./client/index.html";
import { delta, sessions } from "./delta";

// leave: a small team asks for days off, and a manager answers. The example whose people sign in:
// the sign-in page posts to /login (./signin.ts), and from then on a session is a person.
export const example: Example = {
  name: "leave",
  // The session first: who you are, and where.
  resources: [session, team],
  render,
  // Signed in or not: a signed-out tab writes nothing, Undo included.
  active: (sessionId) => sessionOf(sessionId).person !== null,
  // The ledger's who is the person, not the visit.
  who: (sessionId) => sessionOf(sessionId).person?.id ?? sessionId,
  index,
  identify, // a trusted proxy's header, or the CLI's token (./signin.ts)
  routes: { "/login": signIn },
  delta, // the documents are delta's (./delta.ts)
  session: sessions.of,
};
