import type { ServerWebSocket } from "bun";
import type { ConnectionData } from "../connection";
import type { Example } from "../example";
import type { LedgerEntry } from "../ledger";
import { history, prefixDoc } from "../ledger";
import type { Compartment } from "./compartment";
import { createLedgerCompartment } from "./ledger";
import { wireName } from "./audience";

/** A ledger entry as `inspect` tells it. A session id is a person's only credential, so it never
 * goes on the wire: `mine` says whether the asker wrote the entry, which is all a reader may ask. */
export type InspectEntry = Omit<LedgerEntry, "sessionId"> & { mine: boolean };
export type InspectDoc = { doc: string; version: number; entries: InspectEntry[] };
export type Inspection = { docs: InspectDoc[] };

export type Assembled = {
  /** The example's compartments and the kernel's own ledger, for lifecycle (`onOpen`/`onClose`) and write dispatch. */
  compartments: Compartment[];
  /** Every entry above, indexed by the docType it owns -- what server.ts's dispatcher resolves a `{doc, ops}` write against. */
  byDocType: Map<string, Compartment>;
  renderFor(sessionId: string): string;
  inspectFor(ws: ServerWebSocket<ConnectionData>, limit?: number): Inspection;
};

/**
 * Wires one example's compartments into a running set: appends the kernel's own ledger
 * compartment, and returns the render/inspect/dispatch surface server.ts needs -- without
 * server.ts ever importing a specific example's compartments itself.
 */
export function assemble(example: Example): Assembled {
  let byDocType: Map<string, Compartment>;
  const lookup = (docType: string) => byDocType.get(docType);
  const ledger = createLedgerCompartment(lookup, example.active);

  const compartments = [...example.compartments, ledger];
  byDocType = new Map(compartments.map((compartment) => [compartment.docType, compartment]));

  const renderFor = (sessionId: string): string => example.render(sessionId);

  // Legibility: what this connection can currently see, and its most recent ledger entries --
  // so a person (or a late-joining `watch`) can answer "what happened" from the wire, without
  // adding a log line. `limit` (default 1, the longstanding "just the head" behavior) is how far
  // back to look; a watcher catching up before it watches asks for more. The tray's own document
  // is included (it can be worth recording to, chat's is); the ledger itself is excluded -- no
  // render() the fallback path needs it for, and no ledger:<id> document to report a version for
  // (real entries live under the owning document's own key).
  function inspectFor(ws: ServerWebSocket<ConnectionData>, limit = 1): Inspection {
    const docs: InspectDoc[] = [];
    for (const compartment of example.compartments) {
      const docId = compartment.resolveDoc(ws);
      if (docId === undefined) continue;
      const doc = wireName(compartment.docType, docId, ws); // as the wire names it: whole, or the bare type for a session's own
      const entries = history(prefixDoc(compartment.docType, docId), limit).map(({ sessionId, ...entry }) => ({ ...entry, doc, mine: sessionId === ws.data.sessionId }));
      docs.push({ doc, version: entries[0]?.version ?? 0, entries });
    }
    return { docs };
  }

  return { compartments, byDocType, renderFor, inspectFor };
}
