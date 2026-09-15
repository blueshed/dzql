import type { ServerWebSocket } from "bun";
import type { ConnectionData } from "../../../src/connection";
import * as sessionDoc from "../documents/session";

// Which connections are live, for echo and re-render: not persisted data, and not a compartment of
// its own -- a registry the session compartment keeps (onOpen/onClose) and the household and board
// compartments read. Nearly every write on this site changes what everyone sees (a claim takes a gift
// from every other household; an answer moves a figure into the photo everyone watches), so the
// usual question is simply "everyone".

const sockets = new Set<ServerWebSocket<ConnectionData>>();

export function join(ws: ServerWebSocket<ConnectionData>): void {
  sockets.add(ws);
}

export function leave(ws: ServerWebSocket<ConnectionData>): void {
  sockets.delete(ws);
}

export function everyone(): Iterable<ServerWebSocket<ConnectionData>> {
  return sockets;
}

/** The connections that can see a household's document: the household's own tabs, and the couple's. */
export function seeingHousehold(code: string): ServerWebSocket<ConnectionData>[] {
  return [...sockets].filter((ws) => {
    const session = sessionDoc.read(ws.data.sessionId);
    return session.kind === "couple" || session.code === code;
  });
}

/** The connections that can see the board: the couple's tabs. */
export function seeingBoard(): ServerWebSocket<ConnectionData>[] {
  return [...sockets].filter((ws) => sessionDoc.read(ws.data.sessionId).kind === "couple");
}
