import { bento, layers, rows } from "../../src/bento";
import { esc, join, write } from "../../src/html";
import { slug } from "../../src/grid";
import { toldAt } from "../../src/refusal";
import { derive, model, related, session as sessionOf, type Chosen } from "./model";
import { icon } from "./icons";

// modeling's page. Signed out: sign in. Signed in: the model, a box of three -- its stories, the
// documents they need, and the entities worked out from those -- each whole in its cell. Pick one
// and what goes with it stands in the other two while the rest fades; pick it again and all stand.
// A gap is said where it is: a story no document serves, a document no story needs, an entity
// only such documents hold. Every change, whoever makes it, is drawn as it lands.

const { boxPage, cell, row } = bento({ icon, session: "session", leave: { text: "Sign out", icon: "log-out", path: "/person_id" } });

const pick = (c: Chosen): string => write("session", "replace", "/chosen", `${c.k}:${c.id}`);

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

/** A list said as English says it: "a, b and c". */
const said = (xs: string[]): string => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/** The model: three cells, each its whole list, and what is picked lighting what goes with it. */
function modelPage(sessionId: string, chosen: Chosen | undefined): string {
  const m = model();
  const d = derive(m);
  const lit = chosen && related(m, d, chosen);
  const docName = (id: string) => m.documents.find((x) => x.id === id)!.name;
  const isChosen = (c: Chosen) => chosen?.k === c.k && chosen.id === c.id;

  const stories = m.stories.map((s) =>
    row({ id: `story-${s.id}`, tap: pick({ k: "story", id: s.id }), chosen: isChosen({ k: "story", id: s.id }), hushed: !!lit && !lit.stories.has(s.id), lead: `<span class="n">${esc(s.id)}</span>`, what: s.text, state: d.servedBy(s.id).length ? undefined : "no document" }),
  );
  const documents = m.documents.map((x) =>
    row({
      id: `document-${x.id}`,
      tap: pick({ k: "document", id: x.id }),
      chosen: isChosen({ k: "document", id: x.id }),
      hushed: !!lit && !lit.documents.has(x.id),
      what: x.name,
      note: x.held_by.length ? `held by ${said(x.held_by)}` : "held by nobody yet",
      state: d.needed.has(x.id) ? undefined : "no story",
    }),
  );
  const entities = d.entities.map((e) =>
    row({
      id: `entity-${slug(e.name)}`,
      tap: pick({ k: "entity", id: e.name }),
      chosen: isChosen({ k: "entity", id: e.name }),
      hushed: !!lit && !lit.entities.has(e.name),
      what: e.name,
      note: `${e.fields.map((f) => (f.type === "text" ? f.name : `${f.name}: ${f.type}`)).join(", ")} · in ${said(e.documents.map(docName))}`,
      state: e.documents.some((id) => d.needed.has(id)) ? undefined : "no story",
    }),
  );

  return boxPage([{ label: m.name }], [], [
    cell({ name: "Stories", count: m.stories.length, body: rows(stories, "No stories yet.") + toldAt(sessionId, "model", "/stories/-") }),
    cell({ name: "Documents", count: m.documents.length, body: rows(documents, "No documents yet.") + toldAt(sessionId, "model", "/documents/-") }),
    cell({ name: "Entities", count: d.entities.length, body: rows(entities, "None yet: a document holds them.") }),
  ]);
}

export function render(sessionId: string): string {
  const { person, chosen } = sessionOf(sessionId);
  return layers(person ? modelPage(sessionId, chosen) : signInPage(sessionId), "", "");
}
