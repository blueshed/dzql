import { part } from "dzql/rendering/parts";
import { esc } from "dzql/rendering/html";

// Who is here's part of the page: the faces across the head of a room's conversation.

/** The first letter of a name, as the face it wears. */
export const face = (name: string, me: boolean): string => `<span class="face${me ? " me" : ""}" aria-hidden="true">${esc(name.charAt(0).toUpperCase())}</span>`;

/**
 * Who is here, across the head of the conversation: a list, and a part, sent alone when someone
 * arrives or leaves. You are your face in your own colour, not your name; a reader, who cannot see
 * the colour, hears "You", as your messages say.
 */
export function renderPeople(people: string[], me: string): string {
  const who = (p: string) => (p === me ? `<li class="who">${face(p, true)}<span class="sr-only">You</span></li>` : `<li class="who">${face(p, false)}<span class="note">${esc(p)}</span></li>`);
  return part("people", `<ul id="people" class="people" aria-label="Here">${people.map(who).join("")}</ul>`);
}
