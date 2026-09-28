import type { Local } from "@blueshed/delta/local";
import { registerMemory } from "@blueshed/delta/kinds";
import type { Compartment } from "./compartments/compartment";
import { activeDocuments, read, serverWrite, settled, type Documents } from "./documents";
import { esc } from "./html";

// What a session is told of its last write: why it was refused, or what it did (stories.md; the
// page rule "a refused write says why, next to the control that sent it"). A compartment's `permit`
// or `shape` throws `refuse(reason)`, and the kernel keeps the reason; what follows a write that
// lands (`afterWrite`, `afterWalk` for an undo or redo), or a route that answers a form, `tell`s
// what it did. The line is kept in the session's own `told` document -- in memory, off the ledger,
// since being told is not something that happened -- and the page draws it beside the control it
// names. The session's next write, whatever becomes of it, replaces it. A plain `false` from
// `permit` stays silent: a write no control offers has nowhere to say why.

/** What `refuse` throws: a refusal with a reason a person is shown. */
export class Refusal extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

/** Throw from a compartment's `permit` or `shape` to refuse a write and say why. */
export const refuse = (reason: string): Refusal => new Refusal(reason);

/**
 * A line told to a session: the control it is drawn beside -- the `doc` and `path` of that
 * control's own `data-write` -- and one of two kinds: why a write was refused (`reason`), or what
 * one did (`said`).
 */
export type Line = { doc: string; path: string } & ({ reason: string; said?: never } | { said: string; reason?: never });

type Kept = { doc: string | null; path: string | null; reason: string | null; said: string | null };

const none = (): Kept => ({ doc: null, path: null, reason: null, said: null });

const toldDoc = (sessionId: string): string => `told:${sessionId}`;

/**
 * The line this session was last told at a control -- the `doc` and `path` of that control's own
 * `data-write` -- drawn: why it was refused, an alert; what it did, a status; or nothing.
 */
export function toldAt(sessionId: string, doc: string, path: string): string {
  const t = read<Kept>(toldDoc(sessionId));
  if (t.doc !== doc || t.path !== path) return "";
  if (t.reason) return `<p class="refused" role="alert">${esc(t.reason)}</p>`;
  return t.said ? `<p class="said" role="status">${esc(t.said)}</p>` : "";
}

/** `documents`, read as though `sessionId` had been told nothing: a page drawn from them leaves its line out (the story harness checks the line on its own). */
export function toldNothing(documents: Documents, sessionId: string): Documents {
  return { ...documents, read: <T>(doc: string): T => (doc === toldDoc(sessionId) ? (none() as T) : documents.read<T>(doc)) };
}

/** Tells a session a line, in place of what it was told before; or, with none, clears it. */
export async function tell(sessionId: string, line?: Line): Promise<void> {
  const now: Kept = line ? { doc: line.doc, path: line.path, reason: line.reason ?? null, said: line.said ?? null } : none();
  const before = await settled(activeDocuments(), () => read<Kept>(toldDoc(sessionId)));
  const ops = (Object.keys(now) as (keyof Kept)[]).filter((k) => before[k] !== now[k]).map((k) => ({ op: "replace" as const, path: `/${k}`, value: now[k] }));
  if (ops.length > 0) await serverWrite(toldDoc(sessionId), ops);
}

const registered = new WeakSet<Local>();

/** The kernel's `told` compartment, its documents registered in the example's delta once. */
export function createToldCompartment(delta: Local): Compartment {
  if (!registered.has(delta)) registerMemory(delta.server, { prefix: "told:", empty: none });
  registered.add(delta);
  return { docType: "told", perSession: true, kind: "live", resolveDoc: (ws) => ws.data.sessionId };
}
