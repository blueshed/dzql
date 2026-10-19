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
  /** The cookie its sessions go by, and the path it is sent on: its own name under its own path, so two apps on one server never take each other's. */
  cookie: { name: string; path: string };
  /** Writes awaiting their echo, and each session's handles for the changes it made (./server.ts): the app's own. */
  claims: Set<unknown>;
  handles: Map<string, Map<string, number>>;
};

/** The cookie an app's sessions go by: `session_id` at the root, `session_id_model` under `/model`. */
export const cookieNameFor = (at = ""): string => (at ? `session_id_${at.replace(/[^A-Za-z0-9]/g, "")}` : "session_id");

/** A cookie's value in a `Cookie` header, by its name: the first of that name, as a browser sends the app under the longest path first. */
export const cookieIn = (header: string | null | undefined, name: string): string | undefined => new RegExp(`(?:^|;\\s*)${name}=([^;\\s]+)`).exec(header ?? "")?.[1];

/** The session a sign-in's answer (its `Set-Cookie`), or a socket's upgrade, names: the app's `session_id`, or one under a path's. */
export const sessionIn = (text: string | null | undefined): string | undefined => /session_id\w*=([^;\s]+)/.exec(text ?? "")?.[1];

/** The cookie of the app a socket's or a route's URL is under: `ws://host/model/ws` is the model's. */
export const cookieNameForUrl = (url: string | URL): string => cookieNameFor(new URL(String(url).replace(/^ws/, "http")).pathname.replace(/\/(ws|login)?\/?$/, ""));

const storage = new AsyncLocalStorage<Scope>();
const serving = new Set<Scope>();
/** What a call outside any app reads when the process serves none, or more than one. */
const scopeAt = (at: string): Scope => ({ cookieIsSession: false, openSockets: new Set(), cookie: { name: cookieNameFor(at), path: at || "/" }, claims: new Set(), handles: new Map() });
const nobody: Scope = scopeAt("");

/** A new app's scope, served until `unserved`. */
export function served(at = ""): Scope {
  const scope = scopeAt(at);
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
