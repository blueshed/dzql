import type { HTMLBundle } from "bun";
import type { Local } from "@blueshed/delta/local";
import type { ConnectionData } from "./connection";
import type { Resource } from "./resources/resource";
import type { PatchOp } from "./json-patch";

/** A route handler in the same shape server.ts already hands Bun.serve's `routes` (e.g. the "/ws" upgrade handler). */
type RouteHandler = (
  req: Bun.BunRequest,
  server: Bun.Server<ConnectionData>,
) => Response | undefined | Promise<Response | undefined>;

/**
 * Everything the kernel needs from one example to become a running app: its
 * resources, its one render, the page to serve, and the one guard the
 * kernel can't derive generically -- whether a session may write at all
 * right now (a stale, logged-out tab shouldn't be able to undo a write made
 * before it went stale, but only the example knows what "logged out" means
 * for its own documents).
 */
export type Example = {
  /** Identifies this example (distinguishes it from another example object at runtime). */
  name: string;
  /**
   * This example's resources: one per document type, for write dispatch, who sees what, and
   * lifecycle. The session's own document (chat's and the wedding's `session`, the ticker's
   * `desk`) is one of them like any other; list it first, so `inspect` tells it first. The kernel
   * appends its own ledger resource.
   */
  resources: Resource[];
  /** The whole page for this session, as HTML. The server is the only renderer, and this is all of it: which screen, in what order, reading whichever documents it must. */
  render(sessionId: string): string;
  /**
   * May this session write at all right now? Chat's: once it has a name. Leave's: once it is signed in.
   * A tab left open after signing out may not write, nor undo what it wrote before.
   */
  active(sessionId: string): boolean;
  /** The page served at "/", via Bun's HTML import. */
  index: HTMLBundle;
  /**
   * The example's documents, in delta, in this process (`@blueshed/delta`): its backends
   * registered on a `createLocal()`. The kernel keeps each page's documents from delta's stream of
   * changes, writes through delta, and the ledger is delta's.
   */
  delta: Local;
  /**
   * The session a visit's cookie names (a random token, a person's only credential): its row's
   * number, the row made the first time the cookie is seen -- `sessionRows(delta, "sessions").of`
   * (./sessions.ts). Omitted: the cookie is the session, for an example that keeps no row by it.
   */
  session?(cookie: string): Promise<string>;
  /**
   * Where a session's address is written: the document and path a page's `data-page-write` names
   * (src/bento.ts's `site`), as `{ doc: "session", path: "/page" }`. A screen's address is its URL
   * (`/list?request=3`): the server routes it, putting the session there through this write --
   * permitted and shaped as any write -- before a tab's first page is drawn, so a link, a bookmark
   * or a reload opens on that screen. Omitted: a page with no address, and its URL is only "/".
   */
  address?: { doc: string; path: string };
  /** Who a session is, as delta sees them -- for the ledger's `who` and for row-level security. Default: the session. */
  who?(sessionId: string): unknown;
  /**
   * Who a socket's request is, before it opens: the cookie of the session to open it on, or a
   * Response that refuses it. Undefined: a visit, on the session its cookie names, or a new one.
   * Leave's believes a trusted proxy's header and the CLI's token. A person found here gets a fresh
   * session and cookie (never the one the visit had: a fixed session) unless the cookie's is
   * already theirs.
   */
  identify?(req: Bun.BunRequest): string | Response | undefined | Promise<string | Response | undefined>;
  /**
   * The path the app is served under (`"/model"`), when it shares a server with others; the root
   * when omitted. Its page, screens, routes and socket (`<at>/ws`) all sit under it, and its page's
   * shell says it too (`<meta name="dzql-at" content="/model">`), so the browser opens its socket there.
   */
  at?: string;
  /** Extra HTTP routes this example needs (e.g. serving uploaded pictures). Merged into the kernel's routes; a kernel route of the same path wins. */
  routes?: Record<string, Bun.Serve.BaseRouteValue | RouteHandler>;
  /**
   * Where the stories find the app's store, when it is not dzql's SQLite (`dzql/rendering/db`), in
   * which each story runs in a transaction rolled back after it. A store of its own begins and ends
   * each story on it, put back as it stood before the stories, and its ledger is read to check undo
   * and redo. On Postgres (PGlite included), `storyStore(pool, schema)` from `dzql/postgres`.
   */
  store?: StoryStore;
};

/** A store as the stories see it: each story begun and ended on it, and its ledger read. */
export type StoryStore = {
  begin(): Promise<void>;
  /** The story over: the store as it stood before the stories. */
  end(): Promise<void>;
  /** The ledger's last entry's id, 0 with none. */
  last(): Promise<number>;
  /** The ledger's entries after `id` that undo nothing, in order. */
  since(id: number): Promise<{ id: number; doc: string; undoable: boolean; ops: PatchOp[]; inverse: PatchOp[] }[]>;
};
