import type { HTMLBundle } from "bun";
import type { Local } from "@blueshed/delta/local";
import type { ConnectionData } from "./connection";
import type { Compartment } from "./compartments/compartment";

/** A route handler in the same shape server.ts already hands Bun.serve's `routes` (e.g. the "/ws" upgrade handler). */
type RouteHandler = (
  req: Bun.BunRequest,
  server: Bun.Server<ConnectionData>,
) => Response | undefined | Promise<Response | undefined>;

/**
 * Everything the kernel needs from one example to become a running app: its
 * compartments, its one render, the page to serve, and the one guard the
 * kernel can't derive generically -- whether a session may write at all
 * right now (a stale, logged-out tab shouldn't be able to undo a write made
 * before it went stale, but only the example knows what "logged out" means
 * for its own documents).
 */
export type Example = {
  /** Identifies this example (distinguishes it from another example object at runtime). */
  name: string;
  /**
   * This example's compartments: one per document type, for write dispatch, who sees what, and
   * lifecycle. The session's own document (chat's and the wedding's `session`, the ticker's
   * `desk`) is one of them like any other; list it first, so `inspect` tells it first. The kernel
   * appends its own ledger compartment.
   */
  compartments: Compartment[];
  /** The whole page for this session, as HTML. The server is the only renderer, and this is all of it: which screen, in what order, reading whichever documents it must. */
  render(sessionId: string): string;
  /** May this session write at all right now? */
  active(sessionId: string): boolean;
  /** The page served at "/", via Bun's HTML import. */
  index: HTMLBundle;
  /**
   * The example's documents, in delta, in this process (Workshop/docs/eta-on-delta.md): its backends
   * registered on a `createLocal()`. The kernel keeps each page's documents from delta's stream of
   * changes, writes through delta, and the ledger is delta's.
   */
  delta: Local;
  /** Who a session is, as delta sees them -- for the ledger's `who` and for row-level security. Default: the session. */
  who?(sessionId: string): unknown;
  /** Extra HTTP routes this example needs (e.g. serving uploaded pictures). Merged into the kernel's routes; a kernel route of the same path wins. */
  routes?: Record<string, Bun.Serve.BaseRouteValue | RouteHandler>;
};
