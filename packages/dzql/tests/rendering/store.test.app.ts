import { run, serve } from "@blueshed/delta/serve";
import { defineDoc, defineSchema, openStore } from "dzql/postgres";
import { read } from "dzql/rendering/documents";
import type { Example } from "dzql/rendering/example";
import { appOf } from "dzql/rendering/server";
import index from "./server.test.fixture.html";

// An app on Postgres as an app is laid out, in one file, for store.test.ts: its store said as it
// loads, opened by the server as it starts (`appOf`). Run, it is the server, as `bun --hot` runs one.

const schema = defineSchema({ notes: { columns: { text: "text" } } });
export const store = openStore({ schema });
store.register([defineDoc("notes:", { root: "notes", include: [] })]);

type Notes = { notes: Record<string, { id: number; text: string }> };

/** Anyone may add a note; the page is each note's id. */
export const app: Example = {
  name: "notes",
  index,
  delta: store.delta,
  store,
  resources: [{ docType: "notes", resolveDoc: () => "", permit: (_ws, op) => op.op === "add" && op.path === "/notes/-" }],
  render: () => `<ul id="notes">${Object.keys(read<Notes>("notes:").notes).map((id) => `<li id="n${id}">${id}</li>`).join("")}</ul>`,
  active: () => true,
};

if (import.meta.main) await run(async () => serve(await appOf(app)));
