import type { ServerWebSocket } from "bun";
import type { ConnectionData } from "../connection";
import type { PatchOp } from "../json-patch";
import { prefixDoc, splitDoc } from "../names";
import { shows } from "../reading";
import type { Resource } from "./resource";
import { scope } from "../scope";

// Who sees a document is derived, not declared: a connection sees what its page read
// (`src/reading.ts`), and the one of each type it is on (`resolveDoc`). A session's own documents
// (`perSession`) are seen by that session alone. Which sockets are open at all is the kernel's, kept
// here; the kernel tells a change to its `audienceFor` and redraws its `readersOf` (src/server.ts).

// The app's resources and open sockets are its scope's (../scope.ts): a process may serve several.
const open = () => scope().openSockets;

/** Set when an app is served, in its scope. `cookieIsSession`: the example keeps no session row
 * (no `Example.session`), so a session's id is its cookie. */
export function setActiveResources(map: Map<string, Resource> | undefined, opts: { cookieIsSession?: boolean } = {}): void {
  scope().byDocType = map;
  setCookieIsSession(map !== undefined && opts.cookieIsSession === true);
}

/** Whether a session's id is its cookie, as `setActiveResources` sets it; the previous setting, so a test can put it back. */
export function setCookieIsSession(on: boolean): boolean {
  const s = scope();
  const was = s.cookieIsSession;
  s.cookieIsSession = on;
  return was;
}

export function openConnection(ws: ServerWebSocket<ConnectionData>): void {
  open().add(ws);
}

export function closeConnection(ws: ServerWebSocket<ConnectionData>): void {
  open().delete(ws);
}

/** Every open connection of the app, whatever it sees: the exception, for what is everyone's concern; reach for `audienceFor` first. */
export function allOpenSockets(): ServerWebSocket<ConnectionData>[] {
  return [...open()];
}

/**
 * A document's name on the wire: the whole name, `<docType>:<docId>`, so one socket can hold any
 * number of documents of one type (this month's appointments and last month's). A session's own
 * document (its session, its ledger, its desk: `perSession`) is named by its type alone: a tab
 * knows only its own, and its session's number -- a row's, like any other -- is not the wire's to
 * say. The credential is the cookie, which nothing on the wire carries.
 *
 * Where the cookie is the session (an example with no `Example.session`), a session's id is that
 * credential: a document keyed by `ws`'s own session goes by its type, and one keyed by any other
 * live session that does not say it is `perSession` is refused by name, loudly -- naming it would
 * hand that session's credential to whoever reads the wire.
 */
export function wireName(docType: string, docId: string, ws?: ServerWebSocket<ConnectionData>): string {
  if (scope().byDocType?.get(docType)?.perSession) return docType;
  if (scope().cookieIsSession) {
    if (docId === ws?.data.sessionId) return docType;
    if ([...open()].some((other) => other.data.sessionId === docId)) {
      throw new Error(`${docType} is keyed by a session id: declare its resource \`perSession\`, so the id never goes on the wire`);
    }
  }
  return prefixDoc(docType, docId);
}

/**
 * The document a write names, for the resource that owns it: a whole name (`room:general`) is
 * that document; a bare type (`room`, `session`) is the one of that type this connection is on --
 * its `resolveDoc`. Undefined when nothing owns the type or the connection is on none of it.
 */
export function resolveName(
  owners: Map<string, Resource>,
  name: string,
  ws: ServerWebSocket<ConnectionData>,
): { owner: Resource; docId: string } | undefined {
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
export function sees(owner: Resource, ws: ServerWebSocket<ConnectionData>, docId: string): boolean {
  if (owner.perSession) return docId === ws.data.sessionId;
  return owner.resolveDoc(ws) === docId || shows(ws, owner.docType, docId);
}

/** Every open connection that sees `docId` (`sees`, above). */
export function audienceFor(docType: string, docId: string): ServerWebSocket<ConnectionData>[] {
  const owner = scope().byDocType?.get(docType);
  if (!owner) return [];
  return [...open()].filter((ws) => sees(owner, ws, docId));
}

/** Every open connection whose page, as last drawn, read the document -- a session's own included: chat's presence reads everyone's name from their sessions. */
export function readersOf(docType: string, docId: string): ServerWebSocket<ConnectionData>[] {
  return [...open()].filter((ws) => shows(ws, docType, docId));
}

/**
 * A document's ops as the wire says them, for an echo and for `inspect` alike: at eta's paths (the
 * resource's `under` taken off), and -- for a session's own document, keyed by the session id -- with
 * that id taken out where it is the row's `id`: never on the wire, not even to its own tabs. The same
 * number whether the id is written as one or as text; any other value is the session's to say, "3"
 * included. Where the cookie is the session (no `Example.session`), the id is a credential, so every
 * value equal to it is taken out, whatever field holds it.
 */
export function wireOps(owner: Resource, docId: string, ops: PatchOp[]): PatchOp[] {
  const at = owner.under ?? "";
  const moved = ops.map((op) => (at && (op.path === at || op.path.startsWith(`${at}/`)) ? { ...op, path: op.path.slice(at.length) } : op));
  if (!owner.perSession) return moved;
  const secret = (k: string, v: unknown) => (scope().cookieIsSession ? v === docId : k === "id" && (typeof v === "number" || typeof v === "string") && String(v) === docId);
  return JSON.parse(JSON.stringify(moved, (k, v) => (secret(k, v) ? undefined : v))) as PatchOp[];
}
