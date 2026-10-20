import type { ServerWebSocket } from "bun";
import type { ConnectionData } from "../connection";
import type { Example } from "../example";
import type { PatchOp } from "../json-patch";
import { prefixDoc, splitDoc } from "../names";
import { shownTo } from "../reading";
import { part } from "../parts";
import type { Resource } from "./resource";
import { createLedgerResource } from "./ledger";
import { createToldResource, toldAt } from "../refusal";
import { sees, wireName, wireOps } from "./audience";
import { createDocuments, settled, type Documents } from "../documents";

// One copy of an example's documents per example while it is served: the server and the story
// harness assemble the same example and must see the same copy.
const copies = new WeakMap<Example, Documents>();

/** The example is no longer served: its copy is let go, and the next server of it holds its documents afresh (from the store it opens). */
export function forget(example: Example): void {
  copies.get(example)?.forget();
  copies.delete(example);
}

/** A ledger entry as `inspect` tells it. A session id is a person's only credential, so it never
 * goes on the wire: `mine` says whether the asker wrote the entry, which is all a reader may ask. */
export type InspectEntry = { id: number; doc: string; version: number; ops: PatchOp[]; inverse: PatchOp[]; at: number; mine: boolean };
export type InspectDoc = { doc: string; version: number; entries: InspectEntry[] };
export type Inspection = { docs: InspectDoc[] };

export type Assembled = {
  /** The example's resources and the kernel's own (the ledger, what a session is told), for lifecycle (`onOpen`/`onClose`) and write dispatch. */
  resources: Resource[];
  /** Every entry above, indexed by the docType it owns -- what server.ts's dispatcher resolves a `{doc, ops}` write against. */
  byDocType: Map<string, Resource>;
  /** The page for a session, where one of its tabs stands: the example's, and what its last undo or redo did, or why it was refused. */
  page(sessionId: string, address: string): string;
  /** The page, drawn until every document it reads is held. */
  draw(sessionId: string, address: string): Promise<string>;
  inspectFor(ws: ServerWebSocket<ConnectionData>, limit?: number): Promise<Inspection>;
  /** The example's documents: delta's, as the pages read them. */
  documents: Documents;
};

/**
 * Wires one example's resources into a running set: appends the kernel's own ledger and
 * told resources, and returns the render/inspect/dispatch surface server.ts needs -- without
 * server.ts ever importing a specific example's resources itself.
 */
export function assemble(example: Example): Assembled {
  const kernel = [createLedgerResource(example.active), createToldResource(example.delta)];

  const resources = [...example.resources, ...kernel];
  const byDocType = new Map<string, Resource>();
  for (const resource of resources) {
    // two owners of one type would leave the first silently unreachable
    if (byDocType.has(resource.docType)) throw new Error(`${example.name}: two resources own "${resource.docType}"${kernel.includes(resource) ? " (the kernel's own)" : ""}`);
    byDocType.set(resource.docType, resource);
  }

  const documents = copies.get(example) ?? createDocuments(example.delta);
  copies.set(example, documents);

  // Undo and redo are the kernel's own tools (the ledger, bento's page tools), so the kernel draws
  // what one did (`afterWalk` says), or why it was refused, over whatever page the example draws:
  // a part of its own, so what it says goes alone, not the page again.
  const page = (sessionId: string, address: string): string => {
    const line = toldAt(sessionId, "ledger", "/latest");
    return example.render(sessionId, address) + (line && part("undo-said", `<div class="undo-said">${line}</div>`));
  };
  const draw = (sessionId: string, address: string): Promise<string> => settled(documents, () => page(sessionId, address));

  // Every document this connection sees -- the one of each type it is on, then whatever else its
  // page read -- with its latest `limit` ledger entries (default 1), so "what happened" is answered
  // from the wire. The ledger is left out: its entries are under the documents they changed.
  async function inspectFor(ws: ServerWebSocket<ConnectionData>, limit = 1): Promise<Inspection> {
    const seen = await settled(documents, () => {
      const names: string[] = [];
      for (const resource of example.resources) {
        const docId = resource.resolveDoc(ws);
        if (docId !== undefined) names.push(prefixDoc(resource.docType, docId));
      }
      for (const name of shownTo(ws)) {
        const { docType, docId } = splitDoc(name);
        const owner = example.resources.find((c) => c.docType === docType);
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

  return { resources, byDocType, page, draw, inspectFor, documents };
}
