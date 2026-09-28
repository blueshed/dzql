import type { Local } from "@blueshed/delta/local";
import { registerMemory } from "@blueshed/delta/kinds";
import type { Compartment } from "./compartments/compartment";
import { activeDocuments, read, serverWrite, settled } from "./documents";
import { esc } from "./html";

// A refused write that says why (stories.md; the page rule "a refused write says why, next to the
// control that sent it"). A compartment's `permit` or `shape` throws `refuse(reason)`; the kernel
// keeps the reason in the session's own `refusal` document -- in memory, off the ledger, since a
// refusal is not something that happened -- and the page draws it beside the control whose write
// it was. The session's next write, whatever becomes of it, replaces it. A plain `false` from
// `permit` stays silent: a write no control offers has nowhere to say why.

/** What `refuse` throws: a refusal with a reason a person is shown. */
export class Refusal extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

/** Throw from a compartment's `permit` or `shape` to refuse a write and say why. */
export const refuse = (reason: string): Refusal => new Refusal(reason);

type Refused = { doc: string | null; path: string | null; reason: string | null };

const none = (): Refused => ({ doc: null, path: null, reason: null });

/**
 * Why this session's last write was refused, as a line to draw beside the control that sent it --
 * the `doc` and `path` of that control's own `data-write` -- or nothing.
 */
export function reasonFor(sessionId: string, doc: string, path: string): string {
  const r = read<Refused>(`refusal:${sessionId}`);
  return r.reason && r.doc === doc && r.path === path ? said(r.reason) : "";
}

/** The line that says why: what `reasonFor` draws, and what the story harness looks for. */
export const said = (reason: string): string => `<p class="refused" role="alert">${esc(reason)}</p>`;

/** After a session's write: keeps why it was refused, or clears what an earlier write was told. */
export async function tell(sessionId: string, now: Refused = none()): Promise<void> {
  const before = await settled(activeDocuments(), () => read<Refused>(`refusal:${sessionId}`));
  const ops = (Object.keys(now) as (keyof Refused)[]).filter((k) => before[k] !== now[k]).map((k) => ({ op: "replace" as const, path: `/${k}`, value: now[k] }));
  if (ops.length > 0) await serverWrite(`refusal:${sessionId}`, ops);
}

const registered = new WeakSet<Local>();

/** The kernel's `refusal` compartment, its documents registered in the example's delta once. */
export function createRefusalCompartment(delta: Local): Compartment {
  if (!registered.has(delta)) registerMemory(delta.server, { prefix: "refusal:", empty: none });
  registered.add(delta);
  return { docType: "refusal", perSession: true, kind: "live", resolveDoc: (ws) => ws.data.sessionId };
}
