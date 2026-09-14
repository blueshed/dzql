import type { Concept } from "./concept";
import { room } from "./room";
import { session } from "./session";

// Order matters: each concept's render() is tried in turn, and the first
// one to return a view wins. "No name yet" has to be decided before
// "no room yet" makes sense.
export const concepts: Concept[] = [session, room];

export function renderFor(sessionId: string): string {
  for (const concept of concepts) {
    const html = concept.render(sessionId);
    if (html !== undefined) return html;
  }
  throw new Error(`no concept produced a view for session ${sessionId}`);
}
