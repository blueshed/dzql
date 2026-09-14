import type { Concept } from "./concept";
import { room } from "./room";
import { session } from "./session";

// Order matters: each concept's render() is tried in turn, and the first
// one to return a view wins. "No name yet" has to be decided before
// "no room yet" makes sense.
export const concepts: Concept[] = [session, room];

export const conceptsByDocType = new Map(concepts.map((concept) => [concept.docType, concept]));

// `list` defaults to the real concepts and is only ever overridden by tests,
// to exercise the fallback below without needing session/room to somehow
// both decline to render (they never do: together they cover every state).
export function renderFor(sessionId: string, list: Concept[] = concepts): string {
  for (const concept of list) {
    const html = concept.render(sessionId);
    if (html !== undefined) return html;
  }
  throw new Error(`no concept produced a view for session ${sessionId}`);
}
