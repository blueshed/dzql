import type { HTMLBundle } from "bun";
import type { ConnectionData } from "./connection";
import type { Compartment } from "./compartments/compartment";

/** A route handler in the same shape server.ts already hands Bun.serve's `routes` (e.g. the "/ws" upgrade handler). */
type RouteHandler = (
  req: Bun.BunRequest,
  server: Bun.Server<ConnectionData>,
) => Response | undefined | Promise<Response | undefined>;

/**
 * Everything the kernel needs from one example to become a running app: its
 * compartments (in render order), the page to serve, and the one guard the
 * kernel can't derive generically -- whether a session may write at all
 * right now (a stale, logged-out tab shouldn't be able to undo a write made
 * before it went stale, but only the example knows what "logged out" means
 * for its own documents).
 */
export type Example = {
  /** Identifies this example (namespaces its migrations, distinguishes it from another example object at runtime). */
  name: string;
  /** This example's compartments, in render order (the first to return a view wins). The kernel appends its own ledger compartment after these -- neither the ledger nor `tray` below is a compartment (item 10's rule 3). */
  compartments: Compartment[];
  /**
   * The ground the compartments sit on: which page a tab is on, which drawer is open, how a
   * collection is read -- a document with no place of its own on the page, so it has no `render`
   * and isn't in `compartments` above. Optional: an example with no such state (the ticker, where
   * anyone may write with no sign-in) doesn't need one.
   */
  tray?: Compartment;
  /** May this session write at all right now? */
  active(sessionId: string): boolean;
  /** The page served at "/", via Bun's HTML import. */
  index: HTMLBundle;
  /** Extra HTTP routes this example needs (e.g. serving uploaded pictures). Merged into the kernel's routes; a kernel route of the same path wins. */
  routes?: Record<string, Bun.Serve.BaseRouteValue | RouteHandler>;
};
