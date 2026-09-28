import type { ServerWebSocket } from "bun";
import type { ConnectionData } from "../connection";
import type { Example } from "../example";
import type { PatchOp } from "../json-patch";
import { prefixDoc, splitDoc } from "../names";
import { shownTo } from "../reading";
import type { Compartment } from "./compartment";
import { createLedgerCompartment } from "./ledger";
import { createToldCompartment, toldAt } from "../refusal";
import { sees, wireName, wireOps } from "./audience";
import { createDocuments, settled, type Documents } from "../documents";

// One copy of an example's documents per example: the server and the story harness assemble the
// same example and must see the same copy.
const copies = new WeakMap<Example, Documents>();

/** A ledger entry as `inspect` tells it. A session id is a person's only credential, so it never
 * goes on the wire: `mine` says whether the asker wrote the entry, which is all a reader may ask. */
export type InspectEntry = { id: number; doc: string; version: number; ops: PatchOp[]; inverse: PatchOp[]; at: number; mine: boolean };
export type InspectDoc = { doc: string; version: number; entries: InspectEntry[] };
export type Inspection = { docs: InspectDoc[] };

export type Assembled = {
  /** The example's compartments and the kernel's own (the ledger, what a session is told), for lifecycle (`onOpen`/`onClose`) and write dispatch. */
  compartments: Compartment[];
  /** Every entry above, indexed by the docType it owns -- what server.ts's dispatcher resolves a `{doc, ops}` write against. */
  byDocType: Map<string, Compartment>;
  /** The page for a session: the example's, and what its last undo or redo did, or why it was refused. */
  page(sessionId: string): string;
  /** The page, drawn until every document it reads is held. */
  draw(sessionId: string): Promise<string>;
  inspectFor(ws: ServerWebSocket<ConnectionData>, limit?: number): Promise<Inspection>;
  /** The example's documents: delta's, as the pages read them. */
  documents: Documents;
};

/**
 * Wires one example's compartments into a running set: appends the kernel's own ledger and
 * told compartments, and returns the render/inspect/dispatch surface server.ts needs -- without
 * server.ts ever importing a specific example's compartments itself.
 */
export function assemble(example: Example): Assembled {
  const kernel = [createLedgerCompartment(example.active), createToldCompartment(example.delta)];

  const compartments = [...example.compartments, ...kernel];
  const byDocType = new Map<string, Compartment>();
  for (const compartment of compartments) {
    // two owners of one type would leave the first silently unreachable
    if (byDocType.has(compartment.docType)) throw new Error(`${example.name}: two compartments own "${compartment.docType}"${kernel.includes(compartment) ? " (the kernel's own)" : ""}`);
    byDocType.set(compartment.docType, compartment);
  }

  const documents = copies.get(example) ?? createDocuments(example.delta);
  copies.set(example, documents);

  // Undo and redo are the kernel's own tools (the ledger, bento's page tools), so the kernel draws
  // what one did, or why it was refused, over whatever page the example draws.
  const page = (sessionId: string): string => {
    const line = toldAt(sessionId, "ledger", "/latest");
    return example.render(sessionId) + (line && `<div class="undo-said">${line}</div>`);
  };
  const draw = (sessionId: string): Promise<string> => settled(documents, () => page(sessionId));

  // Legibility: every document this connection sees -- the one of each type it is on, then
  // whatever else its page read -- and each one's most recent ledger entries,
  // so a person (or a late-joining `watch`) can answer "what happened" from the wire, without
  // adding a log line. `limit` (default 1, the longstanding "just the head" behavior) is how far
  // back to look; a watcher catching up before it watches asks for more. The session's own document
  // is included (it can be worth recording to, chat's is); the ledger itself is excluded -- no
  // render() the fallback path needs it for, and no ledger:<id> document to report a version for
  // (real entries live under the owning document's own key).
  async function inspectFor(ws: ServerWebSocket<ConnectionData>, limit = 1): Promise<Inspection> {
    const seen = await settled(documents, () => {
      const names: string[] = [];
      for (const compartment of example.compartments) {
        const docId = compartment.resolveDoc(ws);
        if (docId !== undefined) names.push(prefixDoc(compartment.docType, docId));
      }
      for (const name of shownTo(ws)) {
        const { docType, docId } = splitDoc(name);
        const owner = example.compartments.find((c) => c.docType === docType);
        if (owner && sees(owner, ws, docId)) names.push(name); // not another session's own
      }
      return names;
    });
    const docs: InspectDoc[] = [];
    for (const name of new Set(seen)) {
      const { docType, docId } = splitDoc(name);
      const doc = wireName(docType, docId, ws); // as the wire names it: whole, or the bare type for a session's own
      const owner = byDocType.get(docType)!;
      const entries = (await documents.history(name, ws.data.sessionId, limit)).map((e) => ({
        id: e.id, // the ledger entry's own
        doc,
        version: e.version,
        ops: wireOps(owner, docId, e.ops as never),
        inverse: wireOps(owner, docId, e.inverse as never),
        at: e.at,
        mine: e.mine,
      }));
      docs.push({ doc, version: entries[0]?.version ?? 0, entries });
    }
    return { docs };
  }

  return { compartments, byDocType, page, draw, inspectFor, documents };
}
