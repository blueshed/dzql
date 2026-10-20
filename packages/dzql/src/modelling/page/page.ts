import { layers } from "dzql/rendering/bento";
import { read as sessionOf } from "./resources/session/session-api";
import { signInPage } from "./resources/session/session-view";
import { modelPage } from "./resources/model/model-view";

// modeling's page, drawn by the server for whoever is looking, from the parts each resource draws
// (`resources/<name>/<name>-view.ts`). Signed out: sign in. Signed in: the model, as the modeller
// draws it.

export function render(sessionId: string): string {
  return layers(sessionOf(sessionId).person ? modelPage(sessionId) : signInPage(), "", "");
}
