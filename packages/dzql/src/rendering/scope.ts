import { AsyncLocalStorage } from "node:async_hooks";
import type { ServerWebSocket } from "bun";
import type { ConnectionData } from "./connection";
import type { Documents } from "./documents";
import type { Resource } from "./resources/resource";

// An app's own state: its resources by document type, its documents, its open sockets, and whether
// its sessions' ids are their cookies. A server is routes to resources, so a process may serve
// several apps side by side (the cafe, and in development the model at /model): each app's routes
// and socket run in its scope, and whatever they call -- `read`, `serverWrite`, who sees what --
// reads the app it is in. Outside any (a feed's tick, a unit test), the app a process serves alone.

export type Scope = {
  byDocType?: Map<string, Resource>;
  documents?: Documents;
  cookieIsSession: boolean;
  openSockets: Set<ServerWebSocket<ConnectionData>>;
  /** The app's page for a session (its resources' `page`), drawn for each of its sockets. */
  page?: (sessionId: string) => string;
  /** The cookie its sessions go by, and the path it is sent on: under its own path, so a browser sends it first there (the longest path first). */
  cookie: { name: string; path: string };
};

const storage = new AsyncLocalStorage<Scope>();
const serving = new Set<Scope>();
/** What a call outside any app reads when the process serves none, or more than one. */
const nobody: Scope = { cookieIsSession: false, openSockets: new Set(), cookie: { name: "session_id", path: "/" } };

/** A new app's scope, served until `unserved`. */
export function served(at = ""): Scope {
  const scope: Scope = { cookieIsSession: false, openSockets: new Set(), cookie: { name: "session_id", path: at || "/" } };
  serving.add(scope);
  return scope;
}

export function unserved(scope: Scope): void {
  serving.delete(scope);
}

/** The scope a call is in: its app's, else the one app served, else nobody's. */
export function scope(): Scope {
  return storage.getStore() ?? (serving.size === 1 ? [...serving][0]! : nobody);
}

/** Runs `fn` in `scope`, and every await it makes. */
export const within = <T>(s: Scope, fn: () => T): T => storage.run(s, fn);
