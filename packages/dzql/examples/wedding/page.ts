import { toldAt } from "dzql/rendering/refusal";
import * as sessionDoc from "./resources/session/session-api";
import * as householdDoc from "./resources/household/household-api";
import { householdPage, type HouseholdView } from "./resources/household/household-view";
import * as boardDoc from "./resources/board/board-api";
import { boardPage } from "./resources/board/board-view";
import { may } from "./resources/board/board";
import * as weddingDoc from "./resources/wedding/wedding-api";
import { read as welcomeOf } from "./resources/welcome/welcome-api";
import { welcome } from "./resources/welcome/welcome-view";

// The wedding's page, drawn by the server for whoever is looking, from the parts each resource
// draws (`resources/<name>/<name>-view.ts`): the welcome until a code says who you are, then
// whichever of the two it makes you -- a household's page, or the couple's board.

/** Everything a household's page reads, for this session. */
function viewFor(session: sessionDoc.SessionDocument, sessionId: string): HouseholdView | undefined {
  const h = householdDoc.read(session.id!);
  if (!h) return undefined;
  const w = weddingDoc.wedding();
  return {
    session,
    wordsTold: toldAt(sessionId, "household", "/message"),
    h,
    w,
    courses: weddingDoc.courses(),
    gifts: weddingDoc.gifts(),
    events: weddingDoc.events(),
    places: weddingDoc.places(),
    open: weddingDoc.answersOpen(),
    names: weddingDoc.namesRevealed(w.day),
  };
}

/** A household's page. `viewFor` is always there in practice: read() only reports a kind for a code that exists. */
function renderHousehold(session: sessionDoc.SessionDocument, sessionId: string): string | undefined {
  const v = viewFor(session, sessionId);
  return v && householdPage(v);
}

/** The couple's page. The board is always there in practice: read() only reports a kind for a code that exists. */
function renderBoard(session: sessionDoc.SessionDocument): string | undefined {
  const b = boardDoc.read(session.id!);
  return b && boardPage({ session, b, may });
}

/** The page for a session, where its tab stands (`address`): the welcome until a code says who you are, then whichever of the two it makes you. */
export function render(sessionId: string, address: string): string {
  const visit = sessionDoc.read(sessionId, address); // the visit, where this tab stands
  const page = visit.kind === "household" ? renderHousehold(visit, sessionId) : visit.kind === "couple" ? renderBoard(visit) : undefined;
  return page ?? welcome(welcomeOf(), visit.note, toldAt(sessionId, "session", "/code"));
}
