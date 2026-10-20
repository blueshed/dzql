import { afterAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import type { DeltaOp } from "@blueshed/delta/core";
import { createLocal } from "@blueshed/delta/local";
import { createWs } from "@blueshed/delta/server";
import { serve } from "@blueshed/delta/serve";
import { createTables, defineDoc, defineSchema, registerDocs } from "@blueshed/delta/sqlite";
import { documentsOf, type DocumentsClient } from "../../src/rendering/test-socket";

// One test of a document, for either page: over delta's socket, as the light page holds it, and
// over the app's documents in this process, as the thin client's page reads them. Only what
// `documentsOf` is given differs.

const schema = defineSchema({ notes: { columns: { text: { type: "text", default: "Hello" } }, temporal: false } });
const docs = [defineDoc("note:", { root: "notes", include: [], implied: true })];
const store = () => {
  const db = new Database(":memory:");
  createTables(db, schema);
  return db;
};

type Note = { notes: { id: number; text: string } };

/** What a test of the note says, whichever client holds it. */
async function holdsTheNote(client: DocumentsClient) {
  const note = await client.open<Note>("note:1");
  expect(note.value()).toEqual({ notes: { id: 1, text: "Hello" } }); // implied: Hello before anyone writes
  const told: DeltaOp[][] = [];
  const stop = note.onOps((ops) => told.push(ops));
  await note.send([{ op: "replace", path: "/notes/text", value: "Hi" }]);
  expect(note.value().notes.text).toBe("Hi"); // told back before the write resolves
  await expect(note.send([{ op: "replace", path: "/notes/text", value: 1 }])).rejects.toMatchObject({ code: 400, message: "/notes/text: text must be a string" });
  await note.send([{ op: "replace", path: "/notes/text", value: "Hi again" }]);
  stop();
  await note.send([{ op: "replace", path: "/notes/text", value: "unheard" }]);
  expect(told.length).toBe(2); // each change as it was told, until it stopped listening
  await client.undo();
  for (let i = 0; i < 100 && note.value().notes.text !== "Hi again"; i++) await Bun.sleep(10);
  expect(note.value().notes.text).toBe("Hi again"); // the client's last write undone
  client.close();
}

describe("documentsOf: a document as a page reads it, the same test for either page", () => {
  test("in this process: the app's own documents, as the thin client's page reads them", async () => {
    const local = createLocal();
    registerDocs(local.server, store(), schema, docs, [], { ledger: true });
    await holdsTheNote(await documentsOf(local));
  });

  const ws = createWs();
  registerDocs(ws, store(), schema, docs, [], { ledger: true });
  const server = serve({ ws, routes: {} }, { port: 0, dev: false });
  afterAll(() => server.stop(true));

  test("over delta's socket: as the light page holds it", async () => {
    await holdsTheNote(await documentsOf(server));
  });
});
