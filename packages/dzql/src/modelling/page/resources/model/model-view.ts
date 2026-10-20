import { watch } from "dzql/rendering/documents";
import { appletProps, esc, join, write } from "dzql/rendering/html";
import { part } from "dzql/rendering/parts";
import { toldAt, toldTo } from "dzql/rendering/refusal";
import { closureOf, drawClosure } from "../../closure";
import { drawHeart, heartOf } from "../../heart";
import { MODEL, raw } from "./model-api";

// The model's part of the page: the model as the modeller draws it -- its stories, its documents
// and its entities, three columns -- in one applet that watches the model document, so every
// change, whoever makes it, is drawn as delta tells it. Click one and the other two light up. The
// server draws the first paint with the applet's own drawing (../../heart.ts). Above them, hjeli's
// six registers over the model (../../closure.ts): a part, drawn again with every change.

/** Why the last write to the model was refused, wherever in it, if it was: a write comes from the CLI, so there is no control to say it beside. */
function toldOfModel(sessionId: string): string {
  const line = toldTo(sessionId);
  return line?.doc === "model" ? toldAt(sessionId, "model", line.path) : "";
}

/** The model: its name and how to read it, why the last write was refused if it was, and the three columns. */
export function modelPage(sessionId: string): string {
  const doc = raw();
  return join(
    `<div class="heart-page">`,
    `<header><h1>${esc(doc.models.name)}</h1><p>click a story, a document or an entity: the other two light up</p>`,
    `<button type="button" class="sign-out"${write("session", "remove", "/person_id")}>Sign out</button></header>`,
    part("closure", drawClosure(closureOf(doc))),
    part("told", `<div id="told">${toldOfModel(sessionId)}</div>`),
    `<div class="cols" id="model" data-applet="heart"${appletProps(doc, watch(`model:${MODEL}`))}>${drawHeart(heartOf(doc), { hideStories: false, hideEnts: false, pop: null })}</div>`,
    `<div id="pop"></div>`,
    `</div>`,
  );
}
