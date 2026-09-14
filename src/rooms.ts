import type { ServerWebSocket } from "bun";
import type { SessionData } from "./session";

export const DEFAULT_ROOM = "general";

export type ChatMessage = { name: string; text: string; sentAt: number };

type Room = {
  sockets: Set<ServerWebSocket<SessionData>>;
  messages: ChatMessage[];
};

const MAX_MESSAGES = 50;
const rooms = new Map<string, Room>();

function getRoom(roomId: string): Room {
  let room = rooms.get(roomId);
  if (!room) {
    room = { sockets: new Set(), messages: [] };
    rooms.set(roomId, room);
  }
  return room;
}

export function joinRoom(roomId: string, ws: ServerWebSocket<SessionData>): void {
  getRoom(roomId).sockets.add(ws);
}

export function leaveRoom(roomId: string, ws: ServerWebSocket<SessionData>): void {
  rooms.get(roomId)?.sockets.delete(ws);
}

export function roomSockets(roomId: string): Set<ServerWebSocket<SessionData>> {
  return getRoom(roomId).sockets;
}

export function getMessages(roomId: string): ChatMessage[] {
  return getRoom(roomId).messages;
}

export function addMessage(roomId: string, name: string, text: string): void {
  const room = getRoom(roomId);
  room.messages.push({ name, text, sentAt: Date.now() });
  if (room.messages.length > MAX_MESSAGES) room.messages.shift();
}
