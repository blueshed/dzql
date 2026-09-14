import type { ServerWebSocket } from "bun";
import type { ConnectionData } from "../connection";

export type EventHandler = (
  ws: ServerWebSocket<ConnectionData>,
  payload: Record<string, unknown>,
) => boolean | void;

export type Concept = {
  /** Wire event name -> handler. Returning `true` skips the automatic full render afterward. */
  events: Record<string, EventHandler>;
  /** Returns this concept's view of the current session, or `undefined` to defer to the next concept. */
  render(sessionId: string): string | undefined;
  onOpen?(ws: ServerWebSocket<ConnectionData>): void;
  onClose?(ws: ServerWebSocket<ConnectionData>): void;
};
