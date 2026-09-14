import type { ServerWebSocket } from "bun";
import type { SessionData } from "../session";

export type EventHandler = (
  ws: ServerWebSocket<SessionData>,
  payload: Record<string, unknown>,
) => boolean | void;

export type Concept = {
  /** Wire event name -> handler. Returning `true` skips the automatic full render afterward. */
  events: Record<string, EventHandler>;
  /** Returns this concept's view of the current session, or `undefined` to defer to the next concept. */
  render(sessionId: string): string | undefined;
  onOpen?(ws: ServerWebSocket<SessionData>): void;
  onClose?(ws: ServerWebSocket<SessionData>): void;
};
