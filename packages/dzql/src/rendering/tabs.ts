import type { ServerWebSocket } from "bun";
import type { ConnectionData } from "./connection";
import { scope } from "./scope";

// Where a tab is: its address (`list?request=3`, src/rendering/bento.ts), which is its URL. It is the
// tab's own, not the session's -- the session keeps who you are and what is yours, and two tabs of
// one session may stand on two screens. A tab opened at a URL starts there (Example.address routes
// it), a control or the back button moves it (the address write, which the kernel takes off the
// session for the tab that sent it), and what follows a write may move the writer's tab (`moveTab`).

/** A tab, as the server holds it: a socket, and its session. */
export type Tab = ServerWebSocket<ConnectionData>;

/** Where `ws`'s tab stands: its address, "" for the page alone at the root (or a socket that is no page's, the CLI's). */
export const addressOf = (ws: Tab): string => ws.data.address ?? "";

/**
 * Moves a tab to `address`, and draws it there: for what follows a write, from its resource's
 * `afterWrite` or `afterWalk` -- the modal a write answered put away, the drawer of the request it
 * made opened. Only the writer's tab moves; another of the same session stays where it is.
 */
export function moveTab(ws: Tab, address: string): void {
  ws.data.address = address;
  scope().moved?.(ws);
}
