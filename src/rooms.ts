import type { ServerWebSocket } from "bun";
import type { SessionData } from "./session";

const roomSocketSets = new Map<string, Set<ServerWebSocket<SessionData>>>();

function getSocketSet(roomId: string): Set<ServerWebSocket<SessionData>> {
  let sockets = roomSocketSets.get(roomId);
  if (!sockets) {
    sockets = new Set();
    roomSocketSets.set(roomId, sockets);
  }
  return sockets;
}

export function joinRoom(roomId: string, ws: ServerWebSocket<SessionData>): void {
  getSocketSet(roomId).add(ws);
}

export function leaveRoom(roomId: string, ws: ServerWebSocket<SessionData>): void {
  roomSocketSets.get(roomId)?.delete(ws);
}

export function roomSockets(roomId: string): Set<ServerWebSocket<SessionData>> {
  return getSocketSet(roomId);
}
