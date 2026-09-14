import type { ServerWebSocket } from "bun";
import type { ConnectionData } from "../connection";
import { createEvent } from "./bus";

// Fires whenever a set of connections needs a fresh render pushed -- e.g.
// after a room-wide change (a message, presence, an undo). Full renders are
// cheap to broadcast now that the client morphs instead of replacing, so
// there's no separate granular wire vocabulary for "someone joined" or "a
// message arrived": everyone affected just gets asked to re-render.
export const renderRequested = createEvent<Iterable<ServerWebSocket<ConnectionData>>>();
