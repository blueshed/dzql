/**
 * Message — a shared document. Every window that opens it is subscribed: a change anyone
 * makes reaches them all. delta keeps its rows in message.json in the data folder.
 *
 * The schema says what the rows are; the document says what a person has in front of them.
 * The same two definitions run on SQLite and Postgres: moving on changes the import, not them.
 *
 * The types are shared: the client imports them as types only (`import type`), so none
 * of the server code below reaches the browser bundle.
 */
import type { WsServer } from "@blueshed/delta/server";
import { defineDoc, defineSchema, registerDocs } from "@blueshed/delta/json";

export type Message = { id: number; text: string };
/** What `message:1` holds: its one row. */
export type MessageDoc = { messages: Message };

export const schema = defineSchema({
  messages: { columns: { text: { type: "text", default: "Hello" } }, temporal: false },
});

// `implied`: `message:1` opens as Hello before anyone has written it, and its first save makes the row
export const docs = [defineDoc("message:", { root: "messages", include: [], implied: true })];

export function messageDoc(ws: WsServer, dataDir: string) {
  return registerDocs(ws, `${dataDir}/message.json`, schema, docs);
}
