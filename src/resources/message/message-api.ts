/**
 * Message — a shared document. Every window that opens it is subscribed: a change anyone
 * makes reaches them all. delta keeps it as message.json in the data folder.
 *
 * The type is shared: the client imports it as a type only (`import type`), so none
 * of the server code below reaches the browser bundle.
 */
import { registerDoc, type WsServer } from "@blueshed/delta/server";
import type { DeltaOp } from "@blueshed/delta/core";

export type Message = { text: string };

// The message changes one way: a replace of its text with a string
const isText = (op: DeltaOp) => op.op === "replace" && op.path === "/text" && typeof op.value === "string";

export function messageDoc(ws: WsServer, dataDir: string) {
  // Asked before delta applies a write: a throw with a code is delta's answer, and nothing changes
  ws.on("delta", (msg) => {
    if (msg.doc === "message" && !(Array.isArray(msg.ops) && msg.ops.every(isText))) {
      throw Object.assign(new Error("a message is a replace of /text with a string"), { code: 400 });
    }
  });
  return registerDoc<Message>(ws, "message", { file: `${dataDir}/message.json`, empty: { text: "Hello" } });
}
