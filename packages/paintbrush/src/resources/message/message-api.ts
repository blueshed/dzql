/**
 * Message — a shared document. Every window that opens it is subscribed: a change anyone
 * makes reaches them all. delta keeps it as message.json in the data folder.
 *
 * The type is shared: the client imports it as a type only (`import type`), so none
 * of the server code below reaches the browser bundle.
 */
import { registerDoc, type WsServer } from "@blueshed/delta/server";

export type Message = { text: string };

export function messageDoc(ws: WsServer, dataDir: string) {
  return registerDoc<Message>(ws, "message", {
    file: `${dataDir}/message.json`,
    empty: { text: "Hello" },
    // The message changes one way: a replace of its text with a string. Anything else is refused
    // (400) before delta applies it, and nothing changes; an empty write writes nothing.
    accept: (op) => (op?.op === "replace" && op.path === "/text" && typeof op.value === "string") || "a message is a replace of /text with a string",
  });
}
