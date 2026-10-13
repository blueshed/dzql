import { layers } from "../../src/bento";
import { watch } from "../../src/documents";
import { appletProps, esc, join, write } from "../../src/html";
import { part } from "../../src/parts";
import { toldAt, toldTo } from "../../src/refusal";
import { drawHeart, heartOf } from "./heart";
import { MODEL, raw, session as sessionOf } from "./model";

// modeling's page. Signed out: sign in. Signed in: the model as the modeller draws it -- its
// stories, its documents and its entities, three columns -- in one applet that watches the model
// document, so every change, whoever makes it, is drawn as delta tells it. Click one and the other
// two light up. The server draws the first paint with the applet's own drawing (./heart.ts).

/** Signed out: the one thing to do, and why the last try did not work, if it did not. */
function signInPage(sessionId: string): string {
  return join(
    `<section class="door"><h1 class="cap">Modeling</h1>`,
    `<form class="sign-in" method="post" action="/login">`,
    `<label class="modal-field"><span class="note">Email</span><input name="email" type="email" autocomplete="username" required autofocus></label>`,
    `<label class="modal-field"><span class="note">Password</span><input name="password" type="password" autocomplete="current-password" required></label>`,
    toldAt(sessionId, "session", "/login"),
    `<button type="submit" class="tool">Sign in</button>`,
    `</form></section>`,
  );
}

/** Why the last write to the model was refused, wherever in it, if it was: a write comes from the CLI, so there is no control to say it beside. */
function toldOfModel(sessionId: string): string {
  const line = toldTo(sessionId);
  return line?.doc === "model" ? toldAt(sessionId, "model", line.path) : "";
}

/** The model: its name and how to read it, why the last write was refused if it was, and the three columns. */
function modelPage(sessionId: string): string {
  const doc = raw();
  return join(
    `<div class="heart-page">`,
    `<header><h1>${esc(doc.models.name)}</h1><p>click a story, a document or an entity: the other two light up</p>`,
    `<button type="button" class="sign-out"${write("session", "remove", "/person_id")}>Sign out</button></header>`,
    part("told", `<div id="told">${toldOfModel(sessionId)}</div>`),
    `<div class="cols" id="model" data-applet="heart"${appletProps(doc, watch(`model:${MODEL}`))}>${drawHeart(heartOf(doc), { hideStories: false, hideEnts: false, pop: null })}</div>`,
    `<div id="pop"></div>`,
    `</div>`,
  );
}

export function render(sessionId: string): string {
  return layers(sessionOf(sessionId).person ? modelPage(sessionId) : signInPage(sessionId), "", "");
}
