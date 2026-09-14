import type { ServerWebSocket } from "bun";
import type { ConnectionData } from "../connection";
import * as sessionDoc from "../documents/session";
import type { LedgerEntry } from "../ledger";
import { history, prefixDoc } from "../ledger";
import type { Concept } from "./concept";
import { ledger } from "./ledger";
import { room } from "./room";
import { session } from "./session";

// Order matters: each concept's render() is tried in turn, and the first
// one to return a view wins. "No name yet" has to be decided before
// "no room yet" makes sense. ledger has no view of its own (see
// concepts/ledger.ts) and no persisted document of its own to report on
// inspect, so it's excluded from this list -- it's only ever reached by
// docType, below.
export const concepts: Concept[] = [session, room];

export const conceptsByDocType = new Map([...concepts, ledger].map((concept) => [concept.docType, concept]));

// `list` defaults to the real concepts and is only ever overridden by tests,
// to exercise the fallback below without needing session/room to somehow
// both decline to render (they never do: together they cover every state).
export function renderFor(sessionId: string, list: Concept[] = concepts): string {
  for (const concept of list) {
    const html = concept.render?.(sessionId);
    if (html !== undefined) return html;
  }
  throw new Error(`no concept produced a view for session ${sessionId}`);
}

export type InspectDoc = { doc: string; version: number; head?: LedgerEntry };
export type Inspection = { session: sessionDoc.SessionDocument; docs: InspectDoc[] };

// Legibility: what this connection can currently see, and the latest ledger
// entry behind each of those documents -- so a person can answer "what
// happened" from the wire, without adding a log line.
export function inspectFor(ws: ServerWebSocket<ConnectionData>, list: Concept[] = concepts): Inspection {
  const docs: InspectDoc[] = [];
  for (const concept of list) {
    const docId = concept.resolveDoc(ws);
    if (docId === undefined) continue;
    const [head] = history(prefixDoc(concept.docType, docId), 1);
    docs.push({ doc: concept.docType, version: head?.version ?? 0, head });
  }
  return { session: sessionDoc.read(ws.data.sessionId), docs };
}
