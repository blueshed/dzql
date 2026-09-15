import type { ServerWebSocket } from "bun";
import type { ConnectionData } from "../connection";
import { patchMessage } from "../json-patch";
import type { Compartment, WriteResult } from "./compartment";
import { renderRequested } from "./render";

// Change-request.md item 1: who sees a document is the owning compartment's own question
// (`sees?`, or its default -- does `resolveDoc` currently point at it); which sockets are open
// at all is the kernel's, generic and answered once here, so a compartment doesn't keep a
// registry of its own to answer it (chat's room used to keep a room->sockets map; the wedding
// kept one set of everyone, filtered per document type). `server.ts` maintains both; every
// compartment reaches them through `audienceFor`/`notify` instead.

const openSockets = new Set<ServerWebSocket<ConnectionData>>();
let byDocType: Map<string, Compartment> | undefined;

/** Set by `createServer` when an example becomes active, and cleared when it stops -- so a
 * server-less call (unreachable in practice) answers "nobody" rather than throwing. */
export function setActiveCompartments(map: Map<string, Compartment> | undefined): void {
  byDocType = map;
}

export function openConnection(ws: ServerWebSocket<ConnectionData>): void {
  openSockets.add(ws);
}

export function closeConnection(ws: ServerWebSocket<ConnectionData>): void {
  openSockets.delete(ws);
}

/** Every open connection, regardless of what it sees -- for the rare write whose effect is
 * genuinely everyone's concern (a shared total, a crowd photo drawn from every household), not
 * just this document's own audience. Named plainly so it stays the exception: reach for
 * `audienceFor` first. */
export function allOpenSockets(): ServerWebSocket<ConnectionData>[] {
  return [...openSockets];
}

/**
 * Every open connection whose compartment says it sees `docId` -- `sees?(ws, docId)` if the
 * compartment implements it, or (its default, right for most documents: one writer, the same
 * one who reads it) whether `resolveDoc(ws)` currently resolves to it. `exclude`, if given, is
 * left out regardless -- for an announcement that doesn't need telling about itself (a room's
 * own presence op), the same way a direct write's own connection doesn't need a second echo.
 */
export function audienceFor(docType: string, docId: string, exclude?: ServerWebSocket<ConnectionData>): ServerWebSocket<ConnectionData>[] {
  const owner = byDocType?.get(docType);
  if (!owner) return [];
  return [...openSockets].filter((ws) => ws !== exclude && (owner.sees ? owner.sees(ws, docId) : owner.resolveDoc(ws) === docId));
}

/**
 * Echoes a write's applied ops to everyone who sees the document, then asks them to be brought
 * up to date (`Concept.fragments`, or item 10's own-element default, or the page) -- the one
 * thing besides applying the patch that every compartment's `write()`/`replay()` needs to do.
 * A no-op patch (nothing applied) tells nobody, same as a document that finds no audience at all.
 */
export function notify(docType: string, docId: string, result: WriteResult): void {
  if (result.applied.length === 0) return;
  const audience = audienceFor(docType, docId);
  if (audience.length === 0) return;
  const payload = patchMessage(docType, result.version, result.applied);
  for (const ws of audience) ws.send(payload);
  renderRequested.emit({ sockets: audience, write: { docType, docId, result } });
}
