import type { ServerWebSocket } from "bun";
import type { ConnectionData } from "../connection";
import { patchMessage, type PatchOp } from "../json-patch";
import { prefixDoc, splitDoc } from "../ledger";
import { shows } from "../reading";
import type { Compartment, WriteResult } from "./compartment";
import { renderRequested } from "./render";

// Who sees a document is derived, not declared: a connection sees what its page read
// (`src/reading.ts`), and the one of each type it is on (`resolveDoc`). A session's own documents
// (`own`) are seen by that session alone. Which sockets are open at all is the kernel's, kept
// here; every compartment reaches both through `audienceFor`/`notify`.

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
 * A document's name on the wire, as `ws` is told it: the whole name, `<docType>:<docId>`, so one
 * socket can hold any number of documents of one type (this month's appointments and last
 * month's). A session's own document (its session, its ledger, its desk: `own`) is named by its
 * type alone: its id is a session id, a person's only credential, which never goes on the wire.
 * A document keyed by a live session's id that does not say it is `own` is refused by name, loudly:
 * naming it would hand that session's credential to whoever reads the wire.
 */
export function wireName(docType: string, docId: string, ws: ServerWebSocket<ConnectionData>): string {
  if (byDocType?.get(docType)?.own || docId === ws.data.sessionId) return docType;
  if ([...openSockets].some((other) => other.data.sessionId === docId)) {
    throw new Error(`${docType} is keyed by a session id: declare its compartment \`own\`, so the id never goes on the wire`);
  }
  return prefixDoc(docType, docId);
}

/**
 * The document a write names, for the compartment that owns it: a whole name (`room:general`) is
 * that document; a bare type (`room`, `session`) is the one of that type this connection is on --
 * its `resolveDoc`. Undefined when nothing owns the type or the connection is on none of it.
 */
export function resolveName(
  owners: Map<string, Compartment>,
  name: string,
  ws: ServerWebSocket<ConnectionData>,
): { owner: Compartment; docId: string } | undefined {
  const { docType, docId } = name.includes(":") ? splitDoc(name) : { docType: name, docId: undefined };
  const owner = owners.get(docType);
  if (!owner) return undefined;
  const id = docId ?? owner.resolveDoc(ws);
  return id === undefined ? undefined : { owner, docId: id };
}

/**
 * Does `ws` see `docId`: a session's own document only its session; any other, when it is the one
 * of its type the connection is on (`resolveDoc`), or when the page last drawn for it read it.
 */
export function sees(owner: Compartment, ws: ServerWebSocket<ConnectionData>, docId: string): boolean {
  if (owner.own) return docId === ws.data.sessionId;
  return owner.resolveDoc(ws) === docId || shows(ws, owner.docType, docId);
}

/**
 * Every open connection that sees `docId` (`sees`, above). `exclude`, if given, is left out
 * regardless -- for an announcement that doesn't need telling about itself (a room's own presence
 * op), the same way a direct write's own connection doesn't need a second echo.
 */
export function audienceFor(docType: string, docId: string, exclude?: ServerWebSocket<ConnectionData>): ServerWebSocket<ConnectionData>[] {
  const owner = byDocType?.get(docType);
  if (!owner) return [];
  return [...openSockets].filter((ws) => ws !== exclude && sees(owner, ws, docId));
}

/** Every open connection whose page, as last drawn, read the document -- a session's own included: chat's presence reads everyone's name from their sessions. */
export function readersOf(docType: string, docId: string): ServerWebSocket<ConnectionData>[] {
  return [...openSockets].filter((ws) => shows(ws, docType, docId));
}

/**
 * Tells people about a write: echoes its applied ops to everyone who sees the document, the writer
 * included, and redraws those and everyone else whose page read it -- each is sent only the parts
 * of their page that changed (src/parts.ts). A page that read another session's own document is
 * redrawn and never sent its ops. `echoTo` narrows or replaces who hears the ops (chat's presence
 * leaves out the socket that came or went); `renderTo` replaces who is redrawn (the wedding
 * redraws every open page, since totals and the photo draw on every household). A no-op patch
 * tells nobody.
 */
export function notify(
  docType: string,
  docId: string,
  result: WriteResult,
  { echoTo = audienceFor(docType, docId), renderTo }: { echoTo?: ServerWebSocket<ConnectionData>[]; renderTo?: ServerWebSocket<ConnectionData>[] } = {},
): void {
  if (result.applied.length === 0) return;
  for (const ws of echoTo) ws.send(patchMessage(wireName(docType, docId, ws), result.version, result.applied));
  const redraw = renderTo ?? [...new Set([...echoTo, ...readersOf(docType, docId)])];
  if (redraw.length > 0) renderRequested.emit({ sockets: redraw, written: { docType, docId } });
}

/**
 * A document's ops as the wire says them, for an echo and for `inspect` alike: at eta's paths (the
 * compartment's `at` taken off), and -- for a session's own document, keyed by the session id -- with
 * that id taken out of whatever they carry: a credential, never on the wire, not even to its own tabs.
 */
export function wireOps(owner: Compartment, docId: string, ops: PatchOp[]): PatchOp[] {
  const at = owner.at ?? "";
  const moved = ops.map((op) => (at && (op.path === at || op.path.startsWith(`${at}/`)) ? { ...op, path: op.path.slice(at.length) } : op));
  return owner.own ? (JSON.parse(JSON.stringify(moved, (_k, v) => (v === docId ? undefined : v))) as PatchOp[]) : moved;
}
