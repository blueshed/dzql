import type { ServerWebSocket } from "bun";
import type { ConnectionData } from "../connection";
import type { Example } from "../example";
import type { LedgerEntry } from "../ledger";
import { history, prefixDoc } from "../ledger";
import type { Compartment } from "./compartment";
import { createLedgerCompartment } from "./ledger";

export type InspectDoc = { doc: string; version: number; entries: LedgerEntry[] };
export type Inspection = { docs: InspectDoc[] };

export type Assembled = {
  /** The example's own compartments plus the kernel's ledger compartment, in render order. */
  compartments: Compartment[];
  /** Every compartment above, indexed by the docType it owns -- what server.ts's dispatcher resolves a `{doc, ops}` write against. */
  byDocType: Map<string, Compartment>;
  renderFor(sessionId: string): string;
  inspectFor(ws: ServerWebSocket<ConnectionData>, limit?: number): Inspection;
};

/**
 * Wires one example's compartments into a running set: appends the kernel's own
 * ledger compartment (reached only by docType, see compartments/ledger.ts, so it's
 * not part of the example's own render order), and returns the render/
 * inspect/dispatch surface server.ts needs -- without server.ts ever
 * importing a specific example's compartments itself.
 */
export function assemble(example: Example): Assembled {
  let byDocType: Map<string, Compartment>;
  const lookup = (docType: string) => byDocType.get(docType);
  const ledger = createLedgerCompartment(lookup, example.active);

  const compartments = [...example.compartments, ledger];
  byDocType = new Map(compartments.map((compartment) => [compartment.docType, compartment]));

  // Order matters: each compartment's render() is tried in turn, and the first
  // one to return a view wins (e.g. chat's "no name yet" has to be decided
  // before "no room yet" makes sense). `list` defaults to the example's own
  // compartments and is only ever overridden by a test, to exercise the
  // fallback below without needing a real example to somehow have every
  // compartment decline to render.
  function renderFor(sessionId: string, list: Compartment[] = example.compartments): string {
    for (const compartment of list) {
      const html = compartment.render?.(sessionId);
      if (html !== undefined) return html;
    }
    throw new Error(`no compartment produced a view for session ${sessionId}`);
  }

  // Legibility: what this connection can currently see, and its most recent ledger entries --
  // so a person (or a late-joining `watch`) can answer "what happened" from the wire, without
  // adding a log line. `limit` (default 1, the longstanding "just the head" behavior) is how far
  // back to look; a watcher catching up before it watches asks for more. Ledger itself is
  // excluded (no render() the fallback path needs it for, and no ledger:<id> document to report
  // a version for -- real entries live under the owning document's own key).
  function inspectFor(ws: ServerWebSocket<ConnectionData>, limit = 1): Inspection {
    const docs: InspectDoc[] = [];
    for (const compartment of example.compartments) {
      const docId = compartment.resolveDoc(ws);
      if (docId === undefined) continue;
      const entries = history(prefixDoc(compartment.docType, docId), limit);
      docs.push({ doc: compartment.docType, version: entries[0]?.version ?? 0, entries });
    }
    return { docs };
  }

  return { compartments, byDocType, renderFor, inspectFor };
}
