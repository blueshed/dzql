import { run, serve } from "@blueshed/delta/serve";
import { createLocal } from "@blueshed/delta/local";
import { defineDoc, defineSchema, registerDocs } from "@blueshed/delta/json";
import type { Example } from "dzql/rendering/example";
import { read } from "dzql/rendering/documents";
import { esc, write } from "dzql/rendering/html";
import { appOf } from "dzql/rendering/server";
import index from "./index.html";

// One shared message, kept in a JSON file: the app's routes and its one resource. The server draws
// the page, redraws every page that holds the message when anyone saves, and Undo comes with the ledger.
const schema = defineSchema({ messages: { columns: { text: { type: "text", default: "Hello" } }, temporal: false } });
const delta = createLocal();
registerDocs(delta.server, `${process.env.DATA_PATH ?? "data"}/message.json`, schema, [
  defineDoc("message:", { root: "messages", include: [], implied: true }),
], [], { ledger: true });

const text = () => read<{ messages: { text: string } }>("message:1").messages.text;

export const app: Example = {
  name: "message",
  resources: [{ docType: "message", resolveDoc: () => "1", permit: (_ws, op) => op.op === "replace" && op.path === "/messages/1/text" }],
  render: () => `<h1>${esc(text())}</h1><form${write("message", "replace", "/messages/1/text")}><input name="text" aria-label="Message"><button>Save</button></form>`,
  active: () => true,
  index,
  delta,
};

// delta's one server: the page at "/", its socket at "/ws", /health; `bun routes.ts`
if (import.meta.main) await run(() => serve(appOf(app)));
