import type { ServerWebSocket } from "bun";
import type { ConnectionData } from "../connection";
import type { Example } from "../example";
import type { LedgerEntry } from "../ledger";
import { history, prefixDoc } from "../ledger";
import type { Concept } from "./concept";
import { createLedgerConcept } from "./ledger";

export type InspectDoc = { doc: string; version: number; head?: LedgerEntry };
export type Inspection = { docs: InspectDoc[] };

export type Assembled = {
  /** The example's own concepts plus the kernel's ledger concept, in render order. */
  concepts: Concept[];
  /** Every concept above, indexed by the docType it owns -- what server.ts's dispatcher resolves a `{doc, ops}` write against. */
  byDocType: Map<string, Concept>;
  renderFor(sessionId: string): string;
  inspectFor(ws: ServerWebSocket<ConnectionData>): Inspection;
};

/**
 * Wires one example's concepts into a running set: appends the kernel's own
 * ledger concept (reached only by docType, see concepts/ledger.ts, so it's
 * not part of the example's own render order), and returns the render/
 * inspect/dispatch surface server.ts needs -- without server.ts ever
 * importing a specific example's concepts itself.
 */
export function assemble(example: Example): Assembled {
  let byDocType: Map<string, Concept>;
  const lookup = (docType: string) => byDocType.get(docType);
  const ledger = createLedgerConcept(lookup, example.active);

  const concepts = [...example.concepts, ledger];
  byDocType = new Map(concepts.map((concept) => [concept.docType, concept]));

  // Order matters: each concept's render() is tried in turn, and the first
  // one to return a view wins (e.g. chat's "no name yet" has to be decided
  // before "no room yet" makes sense). `list` defaults to the example's own
  // concepts and is only ever overridden by a test, to exercise the
  // fallback below without needing a real example to somehow have every
  // concept decline to render.
  function renderFor(sessionId: string, list: Concept[] = example.concepts): string {
    for (const concept of list) {
      const html = concept.render?.(sessionId);
      if (html !== undefined) return html;
    }
    throw new Error(`no concept produced a view for session ${sessionId}`);
  }

  // Legibility: what this connection can currently see, and the latest
  // ledger entry behind each of those documents -- so a person can answer
  // "what happened" from the wire, without adding a log line. Ledger itself
  // is excluded (no render() the fallback path needs it for, and no
  // ledger:<id> document to report a version for -- real entries live
  // under the owning document's own key).
  function inspectFor(ws: ServerWebSocket<ConnectionData>): Inspection {
    const docs: InspectDoc[] = [];
    for (const concept of example.concepts) {
      const docId = concept.resolveDoc(ws);
      if (docId === undefined) continue;
      const [head] = history(prefixDoc(concept.docType, docId), 1);
      docs.push({ doc: concept.docType, version: head?.version ?? 0, head });
    }
    return { docs };
  }

  return { concepts, byDocType, renderFor, inspectFor };
}
