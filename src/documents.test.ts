import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createLocal } from "@blueshed/delta/local";
import { createTables, defineCustomDoc, defineDoc, defineSchema, registerDocs } from "@blueshed/delta/sqlite";
import { registerMemory } from "@blueshed/delta/kinds";
import { activeDocuments, createDocuments, Pending, read, serverWrite, settled, setActiveDocuments, watch } from "./documents";

/** delta as the Postgres backend behaves: a write is answered first, and its change published later (over NOTIFY). */
function laggingDelta() {
  const local = createLocal();
  let value = { n: 0 };
  let v = 0;
  const later: (() => void)[] = [];
  local.server.on("open", (msg, _c, respond) => {
    if (msg.doc === "gone:1") return respond({ error: { code: 404, message: "Not found" } });
    if (typeof msg.doc === "string" && msg.doc.startsWith("slow:")) respond({ result: { ...value, _v: v } });
  });
  local.server.on("delta", (msg, _c, respond) => {
    if (msg.doc !== "slow:1") return;
    v += 1;
    const version = v;
    value = { n: msg.ops[0].value };
    respond({ result: { ack: true, ops: msg.ops, inverse: [], version } });
    later.push(() => local.server.publish("slow:1", { doc: "slow:1", ops: msg.ops, v: version }));
  });
  local.server.on("close", (_m, _c, respond) => respond({ result: { ack: true } }));
  return { local, flush: () => later.splice(0).forEach((f) => f()), skip: () => (v += 1) };
}

describe("the documents a page reads, kept from delta's stream of changes", () => {
  test("a read of a document not held yet is Pending; settled loads it and runs again", async () => {
    const { local } = laggingDelta();
    const documents = createDocuments(local);
    expect(() => documents.read("slow:1")).toThrow(Pending);
    let runs = 0;
    expect(await settled(documents, () => (runs++, documents.read<{ n: number }>("slow:1")))).toEqual({ n: 0 });
    expect(runs).toBe(2);
    expect(documents.read("slow:1")).toEqual({ n: 0 }); // held now
  });

  test("a write resolves once its change is back and held -- after the answer, as over Postgres", async () => {
    const { local, flush } = laggingDelta();
    const documents = createDocuments(local);
    const told: unknown[] = [];
    documents.onChange((c) => void told.push(c));
    const unheard: unknown[] = [];
    documents.onChange((c) => void unheard.push(c))(); // stopped listening at once: hears nothing
    await documents.load("slow:1");
    let done = false;
    const writing = documents.write("slow:1", [{ op: "replace", path: "/n", value: 5 }], { identity: "ada", cursor: "s1" }).then(() => (done = true));
    await Bun.sleep(5);
    expect(done).toBe(false); // answered, and not yet heard
    flush();
    await writing;
    expect(documents.read<{ n: number }>("slow:1")).toEqual({ n: 5 });
    expect(told).toEqual([{ doc: "slow:1", ops: [{ op: "replace", path: "/n", value: 5 }], v: 1 }]);
    expect(unheard).toEqual([]);
    await documents.quiet();
  });

  test("a change heard twice is held once; a change missed loads the document again and tells it whole", async () => {
    const { local, flush, skip } = laggingDelta();
    const documents = createDocuments(local);
    const told: { ops: unknown[] }[] = [];
    documents.onChange((c) => void told.push(c));
    await documents.load("slow:1");
    await Promise.all([documents.write("slow:1", [{ op: "replace", path: "/n", value: 1 }], { identity: "a", cursor: "s" }), Promise.resolve().then(flush)]);
    local.server.publish("slow:1", { doc: "slow:1", ops: [{ op: "replace", path: "/n", value: 99 }], v: 1 }); // heard already
    expect(documents.read<{ n: number }>("slow:1")).toEqual({ n: 1 });
    skip(); // version 2 happens somewhere we never hear
    local.server.publish("slow:1", { doc: "slow:1", ops: [{ op: "replace", path: "/n", value: 3 }], v: 3 });
    await documents.quiet();
    expect(told.at(-1)!.ops).toEqual([{ op: "replace", path: "", value: { n: 1 } }]); // loaded again: what delta has
    local.server.publish("other:1", { doc: "else", ops: [] }); // not a change to its own channel: ignored
  });

  test("a change that does not land on the copy loads the document again and tells it whole, and the write waiting for it resolves", async () => {
    const { local, flush } = laggingDelta();
    const documents = createDocuments(local);
    const told: unknown[] = [];
    documents.onChange((c) => void told.push(c));
    await documents.load("slow:1");
    // delta took it, and the copy holds no /m to take out: RFC 6902 refuses it, where it was a no-op
    await Promise.all([documents.write("slow:1", [{ op: "remove", path: "/m" }], { identity: "a", cursor: "s" }), Promise.resolve().then(flush)]);
    await documents.quiet();
    expect(told).toEqual([{ doc: "slow:1", ops: [{ op: "replace", path: "", value: { n: undefined } }], v: 1 }]); // loaded again: what delta has
  });

  test("changes are told one at a time, in order; a listener that fails is logged, and the rest are told all the same", async () => {
    const { local, flush } = laggingDelta();
    const documents = createDocuments(local);
    await documents.load("slow:1");
    const told: string[] = [];
    documents.onChange(async (c) => {
      told.push(`start ${c.v}`);
      await Bun.sleep(5);
      told.push(`end ${c.v}`);
    });
    documents.onChange((c) => {
      if (c.v === 1) throw new Error("boom");
    });
    documents.onChange((c) => void told.push(`after ${c.v}`));
    const logged: unknown[] = [];
    const error = console.error;
    console.error = (...args: unknown[]) => void logged.push(args);
    try {
      local.server.publish("slow:1", { doc: "slow:1", ops: [{ op: "replace", path: "/n", value: 1 }], v: 1 });
      local.server.publish("slow:1", { doc: "slow:1", ops: [{ op: "replace", path: "/n", value: 2 }], v: 2 });
      await documents.quiet();
    } finally {
      console.error = error;
    }
    expect(told).toEqual(["start 1", "end 1", "after 1", "start 2", "end 2", "after 2"]);
    expect(logged).toHaveLength(1);
    expect(String((logged[0] as unknown[])[0])).toContain("slow:1");
    flush();
  });

  test("a document delta does not have is held as nothing; release closes and drops what no page reads", async () => {
    const { local } = laggingDelta();
    const documents = createDocuments(local);
    await documents.load("gone:1");
    expect(documents.read("gone:1")).toBeUndefined();
    await documents.load("slow:1");
    await documents.release(new Set(["slow:1"]));
    expect(documents.read("slow:1")).toEqual({ n: 0 });
    expect(() => documents.read("gone:1")).toThrow(Pending);
    await documents.release(new Set());
    expect(() => documents.read("slow:1")).toThrow(Pending);
  });

  test("a refused write says why; undo without a ledger is delta's answer, that nothing handles it; history without a ledger is empty", async () => {
    const local = createLocal();
    registerMemory(local.server, { prefix: "here:", empty: () => ({ people: {} }) });
    const documents = createDocuments(local);
    const refused = await documents.write("here:x", [{ op: "replace", path: "/nobody/x", value: 1 }], { identity: undefined, cursor: "" });
    expect("error" in refused && refused.error.code).toBe(404); // not there: 404 on every backend since delta 0.10
    expect(await documents.walk("undo", { identity: "a", cursor: "s1" })).toEqual({ error: { code: 400, message: "Unknown action: undo" } });
    expect(await documents.history("here:x", "s1")).toEqual([]);
  });

  test("settled gives up: a Pending with nothing to load it from, or one that never comes", async () => {
    await expect(settled(undefined, () => { throw new Pending("a:1"); })).rejects.toBeInstanceOf(Pending);
    const { local } = laggingDelta();
    const documents = createDocuments(local);
    await expect(settled(documents, () => { throw new Pending("slow:1"); }, 2)).rejects.toBeInstanceOf(Pending);
    await expect(settled(documents, () => { throw new Error("not a read"); })).rejects.toThrow("not a read");
  });

  test("read and serverWrite speak to the active example's documents, and say so when there are none", async () => {
    setActiveDocuments(undefined);
    expect(() => read("here:x")).toThrow("no documents");
    await expect(serverWrite("here:x", [])).rejects.toThrow("no documents");
    const local = createLocal();
    registerMemory(local.server, { prefix: "here:", empty: () => ({ people: {} as Record<string, true> }) });
    const documents = createDocuments(local);
    setActiveDocuments(documents);
    await serverWrite("here:x", [{ op: "add", path: "/people/ada", value: true }]);
    expect(await settled(documents, () => read<{ people: Record<string, true> }>("here:x"))).toEqual({ people: { ada: true } });
    await expect(serverWrite("here:x", [{ op: "replace", path: "/nobody/x", value: 1 }])).rejects.toThrow("here:x");
    setActiveDocuments(undefined);
  });

  test("watch names a document for an applet's mount, with where it sits in its props and the version it is held at, which moves with each change", async () => {
    setActiveDocuments(undefined);
    expect(() => watch("slow:1")).toThrow("no documents");
    const { local, flush } = laggingDelta();
    const documents = createDocuments(local);
    setActiveDocuments(documents);
    expect(() => watch("slow:1")).toThrow(Pending); // read like any document: loaded, and the drawing run again
    expect(await settled(documents, () => watch("slow:1", "/slow"))).toEqual({ doc: "slow:1", under: "/slow", v: 0 });
    const writing = documents.write("slow:1", [{ op: "replace", path: "/n", value: 5 }], { identity: "ada", cursor: "s1" });
    await Bun.sleep(5);
    flush();
    await writing;
    expect(watch("slow:1")).toEqual({ doc: "slow:1", v: 1 });
    // a memory document has its version too; a document delta does not have, none, and none goes on the mount
    const memory = createLocal();
    registerMemory(memory.server, { prefix: "here:", empty: () => ({}) });
    setActiveDocuments(createDocuments(memory));
    expect(await settled(activeDocuments(), () => watch("here:x"))).toEqual({ doc: "here:x", v: 0 });
    expect(await settled(activeDocuments(), () => watch("nothing:x"))).toEqual({ doc: "nothing:x" });
    setActiveDocuments(undefined);
  });

  test("a view cut from a big document is held and told like any other: one over fewer collections hears only their rows; a recompute view is read again whole (the skill's strip)", async () => {
    const db = new Database(":memory:");
    const schema = defineSchema({
      trips: { columns: { title: "text" }, temporal: false },
      stops: { parent: "trips", columns: { day: "text", title: "text", note: "text?" }, temporal: false },
      hearts: { parent: "stops", columns: { who: "text" }, temporal: false },
    });
    createTables(db, schema);
    db.run("INSERT INTO trips (id, title) VALUES (1, 'Japan')");
    db.run("INSERT INTO stops (id, trips_id, day, title) VALUES ('a', 1, 'd1', 'Temple')");
    const local = createLocal();
    const days = defineCustomDoc<{ trip: string }>("days:", {
      watch: ["stops"],
      parse: (trip) => ({ trip }),
      recompute: (db, { trip }) => ({ stops: db.query("SELECT id, day, title FROM stops WHERE trips_id = ?").all(trip) }),
    });
    const docs = [defineDoc("trip:", { root: "trips", include: ["stops", "hearts"] }), defineDoc("strip:", { root: "trips", include: ["stops"] })];
    registerDocs(local.server, db, schema, docs, [days], { ledger: true });
    const documents = createDocuments(local);
    const told: string[] = [];
    documents.onChange((c) => void told.push(`${c.doc} ${c.ops.map((op) => `${op.op} ${op.path.split("/")[1] ?? ""}`)}`));
    for (const doc of ["trip:1", "strip:1", "days:1"]) await documents.load(doc);
    expect(documents.read<{ stops: unknown[] }>("days:1")).toEqual({ stops: [{ id: "a", day: "d1", title: "Temple" }] });

    const by = { identity: "ada", cursor: "s" };
    await documents.write("trip:1", [{ op: "add", path: "/hearts/-", value: { stops_id: "a", who: "ada" } }], by); // the trip's alone
    await documents.write("trip:1", [{ op: "replace", path: "/stops/a/note", value: "shoes off" }], by); // the stop's row: both views, days whole
    await documents.write("trip:1", [{ op: "replace", path: "/stops/a/day", value: "d2" }], by);
    await documents.quiet();
    expect(told).toEqual(["trip:1 add hearts", "trip:1 replace stops", "strip:1 replace stops", "days:1 replace ", "trip:1 replace stops", "strip:1 replace stops", "days:1 replace "]);
    expect(documents.read<{ stops: Record<string, { note: string }> }>("strip:1").stops.a!.note).toBe("shoes off"); // every column
    expect(documents.read<{ stops: unknown[] }>("days:1")).toEqual({ stops: [{ id: "a", day: "d2", title: "Temple" }] }); // only what it selects
  });
});
