/**
 * Time: a temporal collection (a remove closes the row; its history stays),
 * and a document read as it stood (`open_at`, a name with `at:`). Part of `pathCases`.
 */
import { describe, expect, test } from "bun:test";
import { course, drink, field } from "./fixture";
import { type PathBackend, content, openAll, assertCopiesHold, write, expectTold, expectSilent } from "./law";

/**
 * A document read as it stood -- by open_at, or a time in its name (`at:`):
 * a list's root rows as its scope admits them and each included collection in
 * full (#74), a single document's root and its children; a temporal table's
 * rows as they stood, the others as they are (they keep no history).
 */
export function asItStoodCases(backend: () => PathBackend): void {
  describe("a document read as it stood", () => {
    const at = (b: PathBackend, doc: string, when: string) => b.process.call("open_at", { doc, at: when }).then((r) => content(r.result));
    const note = (id: number, text: string) => ({ id, weddings_id: 1, text });

    test("a list read as it stood reads its included collections as they stood too", async () => {
      const b = backend();
      await openAll(b.process, ["fo-board:1"]);
      await write(b.process, "fo-board:1", [{ op: "replace", path: "/notes/1/text", value: "bring tables" }, { op: "add", path: "/notes/-", value: { text: "new" } }]);
      expect((await at(b, "fo-courses-noted:", "2021-01-01T00:00:00.000Z")).notes).toEqual({ "1": note(1, "bring chairs") });
      expect((await at(b, "fo-courses-noted:", "2019-01-01T00:00:00.000Z")).notes).toEqual({});
    });

    test("a temporal root: a row made since is not there, one removed since is", async () => {
      const b = backend();
      await openAll(b.process, ["fo-board:1"]);
      await write(b.process, "fo-board:1", [{ op: "remove", path: "/notes/1" }, { op: "add", path: "/notes/-", value: { text: "new" } }]);
      expect(await at(b, "fo-all-notes:", "2021-01-01T00:00:00.000Z")).toEqual({ notes: { "1": note(1, "bring chairs") } });
      expect(await at(b, "fo-all-notes:", "2019-01-01T00:00:00.000Z")).toEqual({ notes: {} });
      expect(await at(b, "fo-all-notes:", "2999-01-01T00:00:00.000Z")).toEqual({ notes: { "2": note(2, "new") } });
    });

    test("a time in the name (at:) reads the document as it stood then, its root and its included collections, single or list", async () => {
      const b = backend();
      await openAll(b.process, ["fo-board:1"]);
      await write(b.process, "fo-board:1", [{ op: "replace", path: "/notes/1/text", value: "bring tables" }, { op: "add", path: "/notes/-", value: { text: "new" } }]);
      const open = (doc: string) => b.process.call("open", { doc }).then((r) => content(r.result));
      const then = { "1": note(1, "bring chairs") };
      expect((await open("fo-notes-on:2021-01-01")).notes).toEqual(then);
      expect((await open("fo-courses-noted-on:2021-01-01")).notes).toEqual(then);
      const board = await open("fo-board-on:1:2021-01-01");
      expect([board.weddings, board.notes]).toEqual([{ id: 1, name: "ours" }, then]);
      expect((await open("fo-notes-on:2019-01-01")).notes).toEqual({});
      // no time in the name: as it is
      expect((await open("fo-notes-on:")).notes).toEqual({ "1": note(1, "bring tables"), "2": note(2, "new") });
      expect((await open("fo-board-on:1")).notes).toEqual({ "1": note(1, "bring tables"), "2": note(2, "new") });
    });

    test("a table that keeps no history reads as it is, through the list's scope", async () => {
      const b = backend();
      await openAll(b.process, ["fo-board:1"]);
      await write(b.process, "fo-board:1", [{ op: "add", path: "/courses/-", value: { name: "Sorbet" } }, { op: "add", path: "/drinks/-", value: { courses_id: 1, name: "Port" } }]);
      const then = "2019-01-01T00:00:00.000Z";
      expect(await at(b, "fo-catalog:", then)).toEqual({
        courses: { "1": course(1, "Soup"), "2": course(2, "Salad", 2), "3": course(3, "Sorbet") },
        drinks: { "1": drink(1, 1, "Sherry"), "2": drink(2, 2, "Water"), "3": drink(3, 1, "Port") },
      });
      expect(await at(b, "fo-courses-like:So", then)).toEqual({ courses: { "1": course(1, "Soup"), "3": course(3, "Sorbet") } });
      expect(await at(b, "fo-tags-labelled:blue", then)).toEqual({ tags: {} });
    });
  });
}

/** A temporal collection, and a document named with a time. */
export function temporalCases(backend: () => PathBackend): void {
  describe("a temporal collection", () => {
    test("a note changed through the board reaches the notes document as the field that changed: its validity, a new version's, is not told", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:1", "fo-notes:1"]);
      await write(b.process, "fo-board:1", [{ op: "replace", path: "/notes/1/text", value: "bring tables" }]);
      await expectTold(b, "fo-notes:1", [[field("/notes/1/text", "bring tables")]]);
      await assertCopiesHold(b, copies);
    });

    test("a note as a document's root, alone or in a list, is read, written, told, undone and read as it was without its validity", async () => {
      const b = backend();
      const note = (id: number, text: string) => ({ id, weddings_id: 1, text });
      const copies = await openAll(b.process, ["fo-note:1", "fo-all-notes:", "fo-notes:1"]);
      expect(content(copies.get("fo-note:1"))).toEqual({ notes: note(1, "bring chairs") });
      expect(content(copies.get("fo-all-notes:"))).toEqual({ notes: { "1": note(1, "bring chairs") } });
      const changed = await write(b.process, "fo-note:1", [{ op: "replace", path: "/notes/text", value: "bring tables" }], { cursor: "s1" });
      expect({ ops: changed.ops, inverse: changed.inverse }).toEqual({
        ops: [{ op: "replace", path: "/notes", value: note(1, "bring tables") }],
        inverse: [{ op: "replace", path: "/notes", value: note(1, "bring chairs") }],
      });
      const added = await write(b.process, "fo-all-notes:", [{ op: "add", path: "/notes/-", value: { weddings_id: 1, text: "bring lights" } }]);
      expect(added.ops).toEqual([{ op: "add", path: "/notes/2", value: note(2, "bring lights") }]);
      const undone = await b.process.call("undo", { cursor: "s1" });
      expect({ ops: undone.result.ops, conflict: undone.result.conflict }).toEqual({ ops: [{ op: "replace", path: "/notes", value: note(1, "bring chairs") }], conflict: undefined });
      await expectTold(b, "fo-note:1", [[field("/notes/text", "bring tables")], [field("/notes/text", "bring chairs")]]);
      await expectTold(b, "fo-all-notes:", [[field("/notes/1/text", "bring tables")], added.ops, [field("/notes/1/text", "bring chairs")]]);
      const then = await b.process.call("open_at", { doc: "fo-note:1", at: "2021-01-01T00:00:00.000Z" });
      expect(content(then.result)).toEqual({ notes: note(1, "bring chairs") });
      const history = (await b.process.call("history", { doc: "fo-note:1", cursor: "s1" })).result;
      expect(JSON.stringify(history)).not.toContain("valid_");
      await assertCopiesHold(b, copies);
    });

    test("a note written twice in one write, another row between, is one new version: each replace is answered and told, and its history holds the note before the write and after it", async () => {
      const b = backend();
      const note = (text: string) => ({ id: 1, weddings_id: 1, text });
      const copies = await openAll(b.process, ["fo-board:1", "fo-notes:1", "fo-note:1"]);
      const { ops } = await write(b.process, "fo-board:1", [
        { op: "replace", path: "/notes/1/text", value: "bring tables" },
        { op: "replace", path: "/weddings/name", value: "our day" },
        { op: "replace", path: "/notes/1", value: { text: "bring lights" } },
      ], { cursor: "s1" });
      expect(ops).toEqual([
        { op: "replace", path: "/notes/1", value: note("bring tables") },
        { op: "replace", path: "/weddings", value: { id: 1, name: "our day" } },
        { op: "replace", path: "/notes/1", value: note("bring lights") },
      ]);
      const versions = async () => (await b.exportTables()).tables.notes!.filter((r: any) => r.id === 1).map((r: any) => ({ text: r.text, live: r.valid_to == null }));
      expect(await versions()).toEqual([{ text: "bring chairs", live: false }, { text: "bring lights", live: true }]);
      const undone = await b.process.call("undo", { cursor: "s1" });
      const back = [{ op: "replace", path: "/notes/1", value: note("bring chairs") }, { op: "replace", path: "/weddings", value: { id: 1, name: "ours" } }];
      expect({ ops: undone.result.ops, conflict: undone.result.conflict }).toEqual({ ops: back, conflict: undefined });
      expect(await versions()).toEqual([{ text: "bring chairs", live: false }, { text: "bring lights", live: false }, { text: "bring chairs", live: true }]);
      await expectTold(b, "fo-note:1", [[field("/notes/text", "bring tables"), field("/notes/text", "bring lights")], [field("/notes/text", "bring chairs")]]);
      await expectTold(b, "fo-notes:1", [
        [field("/notes/1/text", "bring tables"), field("/weddings/name", "our day"), field("/notes/1/text", "bring lights")],
        [field("/notes/1/text", "bring chairs"), field("/weddings/name", "ours")],
      ]);
      await assertCopiesHold(b, copies);
    });

    test("a note written, removed and added back in one write through the board -- or added, removed and added again -- is one moment: one new version, undone, redone and undone again to the notes as they were", async () => {
      const b = backend();
      const note = (id: number, text: string) => ({ id, weddings_id: 1, text });
      const copies = await openAll(b.process, ["fo-board:1", "fo-notes:1", "fo-note:1", "fo-all-notes:"]);
      const versions = async (id: number) => (await b.exportTables()).tables.notes!.filter((r: any) => r.id === id).map((r: any) => ({ text: r.text, live: r.valid_to == null }));
      const walked = async (cursor: string, way: string) => {
        const { result } = await b.process.call(way, { cursor });
        return { ops: result.ops, conflict: result.conflict };
      };
      const rewritten = await write(b.process, "fo-board:1", [
        { op: "replace", path: "/notes/1/text", value: "bring tables" },
        { op: "remove", path: "/notes/1" },
        { op: "add", path: "/notes/1", value: { text: "bring lights" } },
      ], { cursor: "s1" });
      expect(rewritten.ops).toEqual([
        { op: "replace", path: "/notes/1", value: note(1, "bring tables") },
        { op: "remove", path: "/notes/1" },
        { op: "add", path: "/notes/1", value: note(1, "bring lights") },
      ]);
      const readded = await write(b.process, "fo-board:1", [
        { op: "add", path: "/notes/7", value: { text: "bring tables" } },
        { op: "remove", path: "/notes/7" },
        { op: "add", path: "/notes/7", value: { text: "bring lights" } },
      ], { cursor: "s2" });
      expect(readded.ops).toEqual([
        { op: "add", path: "/notes/7", value: note(7, "bring tables") },
        { op: "remove", path: "/notes/7" },
        { op: "add", path: "/notes/7", value: note(7, "bring lights") },
      ]);
      expect({ 1: await versions(1), 7: await versions(7) }).toEqual({
        1: [{ text: "bring chairs", live: false }, { text: "bring lights", live: true }],
        7: [{ text: "bring lights", live: true }],
      });
      const as = (text: string) => [{ op: "replace", path: "/notes/1", value: note(1, text) }];
      const taken = [{ op: "remove", path: "/notes/7" }];
      const made = [{ op: "add", path: "/notes/7", value: note(7, "bring lights") }];
      for (const [cursor, back, again] of [["s1", as("bring chairs"), as("bring lights")], ["s2", taken, made]] as const) {
        expect({ cursor, ...(await walked(cursor, "undo")) }).toEqual({ cursor, ops: back, conflict: undefined });
        expect({ cursor, ...(await walked(cursor, "redo")) }).toEqual({ cursor, ops: again, conflict: undefined });
        expect({ cursor, ...(await walked(cursor, "undo")) }).toEqual({ cursor, ops: back, conflict: undefined });
      }
      const was = (text: string, live = false) => ({ text, live });
      expect({ 1: await versions(1), 7: await versions(7) }).toEqual({
        1: [was("bring chairs"), was("bring lights"), was("bring chairs"), was("bring lights"), was("bring chairs", true)],
        7: [was("bring lights"), was("bring lights")],
      });
      expect(content((await b.process.call("open", { doc: "fo-notes:1" })).result)).toEqual({ weddings: { id: 1, name: "ours" }, notes: { "1": note(1, "bring chairs") } });
      const text = (t: string) => [field("/notes/1/text", t)];
      await expectTold(b, "fo-notes:1", [[...text("bring tables"), ...rewritten.ops.slice(1)], readded.ops, text("bring chairs"), text("bring lights"), text("bring chairs"), taken, made, taken]);
      await assertCopiesHold(b, copies);
    });

    test("a note written, removed and added back in one write through its own document is one moment: one new version, told at its root, undone, redone and undone again to the note it was", async () => {
      const b = backend();
      const note = (text: string) => ({ id: 1, weddings_id: 1, text });
      const copies = await openAll(b.process, ["fo-note:1", "fo-notes:1", "fo-all-notes:"]);
      const versions = async () => (await b.exportTables()).tables.notes!.filter((r: any) => r.id === 1).map((r: any) => ({ text: r.text, live: r.valid_to == null }));
      const walked = async (way: string) => {
        const { result } = await b.process.call(way, { cursor: "s1" });
        return { ops: result.ops, conflict: result.conflict };
      };
      const { ops } = await write(b.process, "fo-note:1", [
        { op: "replace", path: "/notes/text", value: "bring tables" },
        { op: "remove", path: "/notes/1" },
        { op: "add", path: "/notes/1", value: { weddings_id: 1, text: "bring lights" } },
      ], { cursor: "s1" });
      expect(ops).toEqual([
        { op: "replace", path: "/notes", value: note("bring tables") },
        { op: "remove", path: "/notes/1" },
        { op: "add", path: "/notes/1", value: note("bring lights") },
      ]);
      expect(await versions()).toEqual([{ text: "bring chairs", live: false }, { text: "bring lights", live: true }]);
      const as = (text: string) => [{ op: "replace", path: "/notes", value: note(text) }];
      expect(await walked("undo")).toEqual({ ops: as("bring chairs"), conflict: undefined });
      expect(await walked("redo")).toEqual({ ops: as("bring lights"), conflict: undefined });
      expect(await walked("undo")).toEqual({ ops: as("bring chairs"), conflict: undefined });
      const was = (text: string, live = false) => ({ text, live });
      expect(await versions()).toEqual([was("bring chairs"), was("bring lights"), was("bring chairs"), was("bring lights"), was("bring chairs", true)]);
      const text = (t: string) => [field("/notes/text", t)];
      await expectTold(b, "fo-note:1", [
        [...text("bring tables"), { op: "replace", path: "/notes", value: null }, ...as("bring lights")],
        text("bring chairs"), text("bring lights"), text("bring chairs"),
      ]);
      await assertCopiesHold(b, copies);
    });

    test("a note closed through the board (removed: its history kept, no longer current) leaves the notes document", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:1", "fo-notes:1"]);
      await write(b.process, "fo-board:1", [{ op: "remove", path: "/notes/1" }]);
      await expectTold(b, "fo-notes:1", [[{ op: "remove", path: "/notes/1" }]]);
      await assertCopiesHold(b, copies);
    });

    test("an add never makes a second live note: one that meets a live id is refused as already there (409), as a plain row's is", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:1", "fo-notes:1"]);
      const code = async (ops: unknown[]) => (await b.process.call("delta", { doc: "fo-board:1", ops })).error?.code;
      // a mint that meets a row: dzql's tests/delta-pg/path-pglite.test.ts, "a row put in by hand"
      await write(b.process, "fo-board:1", [{ op: "add", path: "/notes/2", value: { text: "named" } }]);
      expect(await code([{ op: "add", path: "/notes/2", value: { text: "again" } }])).toBe(409);
      await write(b.process, "fo-board:1", [{ op: "add", path: "/courses/3", value: { name: "named" } }]);
      expect(await code([{ op: "add", path: "/courses/3", value: { name: "again" } }])).toBe(409);
      expect(content((await b.process.call("open", { doc: "fo-notes:1" })).result).notes).toEqual({
        "1": { id: 1, weddings_id: 1, text: "bring chairs" },
        "2": { id: 2, weddings_id: 1, text: "named" },
      });
      await assertCopiesHold(b, copies);
    });
  });

  describe("a document named with a time (at:) reads the past", () => {
    const note = (text: string) => field("/notes/1/text", text);
    const named = (name: string) => field("/weddings/name", name);

    test("open across a write, it is told only what its time does not keep -- the wedding's name, which keeps no history, not the note written since; a time to come reads as now, and hears both", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:1", "fo-board-on:1:2021-01-01", "fo-notes-on:2021-01-01", "fo-board-on:1:2999-01-01", "fo-notes-on:"]);
      await write(b.process, "fo-board:1", [{ op: "replace", path: "/notes/1/text", value: "bring tables" }, { op: "replace", path: "/weddings/name", value: "renamed" }]);
      await expectTold(b, "fo-board-on:1:2021-01-01", [[named("renamed")]]);
      await expectTold(b, "fo-board-on:1:2999-01-01", [[note("bring tables"), named("renamed")]]);
      await expectTold(b, "fo-notes-on:", [[note("bring tables")]]);
      await expectSilent(b, "fo-notes-on:2021-01-01");
      await assertCopiesHold(b, copies);
    });

    test("open across every kind of write -- an add, a field, a remove, a cascade, a move, an undo and a redo -- each holds the law: told what its time does not keep, nothing of what it does", async () => {
      const b = backend();
      const docs = ["fo-board:1", "fo-all-courses:", "fo-board-on:1:2021-01-01", "fo-courses-noted-on:2021-01-01", "fo-notes-on:2021-01-01", "fo-board-on:1:2999-01-01", "fo-courses-noted-on:"];
      const copies = await openAll(b.process, docs);
      await write(b.process, "fo-board:1", [{ op: "add", path: "/courses/-", value: { name: "Fish" } }, { op: "add", path: "/notes/-", value: { text: "new" } }], { cursor: "s1" });
      await write(b.process, "fo-board:1", [{ op: "replace", path: "/notes/1/text", value: "bring tables" }, { op: "replace", path: "/weddings/name", value: "renamed" }], { cursor: "s1" });
      await write(b.process, "fo-board:1", [{ op: "remove", path: "/notes/1" }], { cursor: "s1" });
      await write(b.process, "fo-board:1", [{ op: "remove", path: "/courses/1" }], { cursor: "s1" });   // its drink with it
      await write(b.process, "fo-all-courses:", [{ op: "replace", path: "/courses/3/weddings_id", value: 2 }], { cursor: "s1" });
      for (const way of ["undo", "undo", "undo", "redo"]) expect((await b.process.call(way, { cursor: "s1" })).result.conflict).toBeUndefined();
      await expectSilent(b, "fo-notes-on:2021-01-01");
      await assertCopiesHold(b, copies);
    });

    test("it takes no writes (403), past or to come, and nothing is written", async () => {
      const b = backend();
      await openAll(b.process, ["fo-board:1", "fo-board-on:1:2021-01-01", "fo-notes-on:2021-01-01", "fo-board-on:1:2999-01-01"]);
      const code = async (doc: string, ops: unknown[]) => (await b.process.call("delta", { doc, ops })).error?.code;
      expect(await code("fo-notes-on:2021-01-01", [{ op: "replace", path: "/notes/1/text", value: "via the past" }])).toBe(403);
      expect(await code("fo-board-on:1:2021-01-01", [{ op: "add", path: "/notes/-", value: { text: "via the past" } }])).toBe(403);
      expect(await code("fo-board-on:1:2021-01-01", [{ op: "replace", path: "/weddings/name", value: "via the past" }])).toBe(403);
      expect(await code("fo-board-on:1:2999-01-01", [{ op: "replace", path: "/weddings/name", value: "via what is to come" }])).toBe(403);
      const board = content((await b.process.call("open", { doc: "fo-board:1" })).result);
      expect([board.weddings, board.notes]).toEqual([{ id: 1, name: "ours" }, { "1": { id: 1, weddings_id: 1, text: "bring chairs" } }]);
      await expectSilent(b, "fo-board:1", "fo-board-on:1:2021-01-01", "fo-notes-on:2021-01-01", "fo-board-on:1:2999-01-01");
    });

    test("its time is a date, YYYY-MM-DD, the instant midnight UTC begins it; anything else is refused as a mistake (400)", async () => {
      const b = backend();
      for (const doc of ["fo-notes-on:notadate", "fo-notes-on:2021-02-30", "fo-notes-on:20210101", "fo-notes-on:today", "fo-board-on:1:2021-13-01"]) {
        expect({ doc, code: (await b.process.call("open", { doc })).error?.code }).toEqual({ doc, code: 400 });
      }
      // the seed's note began at 2020-01-01T00:00:00Z: there at that date, not the day before
      const notes = async (doc: string) => content((await b.process.call("open", { doc })).result).notes;
      expect(await notes("fo-notes-on:2020-01-01")).toEqual({ "1": { id: 1, weddings_id: 1, text: "bring chairs" } });
      expect(await notes("fo-notes-on:2019-12-31")).toEqual({});
    });
  });
}
