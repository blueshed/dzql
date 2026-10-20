import { prop } from "dzql/rendering/bento";
import { esc, join, write } from "dzql/rendering/html";
import { toldAt } from "dzql/rendering/refusal";
import { clashes, days, offOn, worked, workingDaysOf } from "../../calendar";
import { surfaces } from "../../surfaces";
import { also, dayFields } from "../team/team-view";
import type { Person, Span, Team } from "../team/team-api";

// The session's part of the page: signed out, the door; signed in, your draft's drawer -- what it
// would mean before you ask: how many working days, who else is off.

const { tool, drawer, go } = surfaces;

/** Signed out: the one thing to do, and why the last try did not work, if it did not. */
export function signInPage(sessionId: string): string {
  return join(
    `<section class="door"><h1 class="cap">Leave</h1>`,
    `<form class="sign-in" method="post" action="/login">`,
    `<label class="modal-field"><span class="note">Email</span><input name="email" type="email" autocomplete="username" required autofocus></label>`,
    `<label class="modal-field"><span class="note">Password</span><input name="password" type="password" autocomplete="current-password" required></label>`,
    toldAt(sessionId, "session", "/login"),
    `<button type="submit" class="tool">Sign in</button>`,
    `</form></section>`,
  );
}

/** Your draft's drawer: its days, what it would mean -- working days, who else is off, the clashes -- and asking for it, or not. */
export function draftSheet(t: Team, me: Person, draft: Span | null, path: string, sessionId: string): string {
  const clashing = draft ? clashes(offOn([...t.requests, { id: "draft", person_id: me.id, ...draft, status: "asked", answered_by: null }])).filter((d) => workingDaysOf(draft).includes(d)).length : 0;
  const body = join(
    dayFields("session", "/draft", draft ?? {}, sessionId),
    draft && `<div class="props">${prop("Days", `<span>${esc(days(draft))} · ${worked(draft)}</span>`)}${me.role === "manager" ? prop("Asked for", `<span>approved at once, by you: you manage the team</span>`) : ""}${also(t, me, draft, me.id)}${prop("Clashes", `<span class="${clashing ? "state-declined" : ""}">${clashing ? `${clashing} ${clashing === 1 ? "day" : "days"} with someone else off` : "none"}</span>`)}</div>`,
    toldAt(sessionId, "team", "/requests/-"),
    `<div class="drawer-foot">${tool("Ask", { icon: "plus", kind: "add", write: write("team", "add", "/requests/-"), disabled: !draft })}${tool("Cancel", { kind: "quiet", write: draft ? write("session", "remove", "/draft") : go(path) })}</div>`,
  );
  return drawer("draft", draft ? "Your draft" : "Ask for leave", body, go(path), "draft-drawer");
}
