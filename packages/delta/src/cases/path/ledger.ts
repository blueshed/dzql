/**
 * The ledger: undo and redo are writes too, guarded by what each entry left,
 * and a change named by its entry. Part of `pathCases`.
 */
import { describe, expect, test } from "bun:test";
import { course, drink, household, seat, field } from "./fixture";
import { type PathBackend, content, told, openAll, assertCopiesHold, write, expectTold, expectSilent } from "./law";

/** Undo and redo, by the cursor and by a change named by its entry. */
export function ledgerCases(backend: () => PathBackend): void {
  describe("undo and redo are writes too", () => {
    test("a row a write makes and takes out again has no inverse of its own: [add, remove] inverts to [], [add, remove, add] to [remove], on a plain table and a temporal one -- and the inverse sent back puts the rows back as they were", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:1"]);
      const add = { op: "add", path: "/notes/7", value: { text: "seven" } };
      const remove = { op: "remove", path: "/notes/7" };
      // a write names only a new id, or one it has written (#71): /notes/6 here, /notes/7 below
      expect((await write(b.process, "fo-board:1", [{ ...add, path: "/notes/6" }, { ...remove, path: "/notes/6" }], { cursor: "m1" })).inverse).toEqual([]);
      const board = async () => content((await b.process.call("open", { doc: "fo-board:1" })).result);
      const was = await board();
      const made = await write(b.process, "fo-board:1", [
        { op: "add", path: "/courses/9", value: { name: "Fish" } },
        { op: "remove", path: "/courses/9" },
        add, remove, add,
      ], { cursor: "m1" });
      expect(made.inverse).toEqual([{ op: "remove", path: "/notes/7" }]);
      await write(b.process, "fo-board:1", made.inverse);
      expect(await board()).toEqual(was);
      await assertCopiesHold(b, copies);
    });

    test("undoing a course added through the board takes it out of the menu; redoing puts it back", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:1", "fo-menu:1"]);
      await write(b.process, "fo-board:1", [{ op: "add", path: "/courses/10", value: { name: "Fish" } }], { cursor: "s1" });
      const undone = await b.process.call("undo", { cursor: "s1" });
      expect(undone.error).toBeUndefined();
      const redone = await b.process.call("redo", { cursor: "s1" });
      expect(redone.error).toBeUndefined();
      await expectTold(b, "fo-menu:1", [
        [{ op: "add", path: "/courses/10", value: course(10, "Fish") }],
        [{ op: "remove", path: "/courses/10" }],
        [{ op: "add", path: "/courses/10", value: course(10, "Fish") }],
      ]);
      await assertCopiesHold(b, copies);
    });

    test("a course named by an id of 16 digits (a client minting Date.now() * 1000) is told, undone and redone as the number it names", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:1", "fo-menu:1"]);
      const id = 1000000000000000;
      const made = await write(b.process, "fo-board:1", [{ op: "add", path: `/courses/${id}`, value: { name: "Fish" } }], { cursor: "s1" });
      expect(made.ops).toEqual([{ op: "add", path: `/courses/${id}`, value: course(id, "Fish") }]);
      const undone = await b.process.call("undo", { cursor: "s1" });
      expect({ ops: undone.result.ops, conflict: undone.result.conflict }).toEqual({ ops: [{ op: "remove", path: `/courses/${id}` }], conflict: undefined });
      const redone = await b.process.call("redo", { cursor: "s1" });
      expect({ ops: redone.result.ops, conflict: redone.result.conflict }).toEqual({ ops: made.ops, conflict: undefined });
      await expectTold(b, "fo-menu:1", [made.ops, undone.result.ops, made.ops]);
      await assertCopiesHold(b, copies);
    });

    test("an undo puts a dropped course back with its drink, course first, and the menu hears it so", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:1", "fo-menu:1"]);
      await write(b.process, "fo-board:1", [{ op: "remove", path: "/courses/1" }], { cursor: "s1" });
      const undone = await b.process.call("undo", { cursor: "s1" });
      expect(undone.result.ops.map((o: any) => `${o.op} ${o.path}`)).toEqual(["add /courses/1", "add /drinks/1"]);
      await expectTold(b, "fo-menu:1", [
        [{ op: "remove", path: "/courses/1" }, { op: "remove", path: "/drinks/1" }],
        [{ op: "add", path: "/courses/1", value: course(1, "Soup") }, { op: "add", path: "/drinks/1", value: drink(1, 1, "Sherry") }],
      ]);
      await assertCopiesHold(b, copies);
    });

    test("a course and its drinks added in one write, undone, are redone course first -- and undone again", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:1", "fo-menu:1"]);
      const made = await write(b.process, "fo-board:1", [
        { op: "add", path: "/courses/10", value: { name: "Fish" } },
        { op: "add", path: "/drinks/10", value: { courses_id: 10, name: "Chablis" } },
        { op: "add", path: "/drinks/11", value: { courses_id: 10, name: "Muscadet" } },
      ], { cursor: "s1" });
      const taken = [{ op: "remove", path: "/drinks/11" }, { op: "remove", path: "/drinks/10" }, { op: "remove", path: "/courses/10" }];
      const walked = async (way: string) => {
        const { result } = await b.process.call(way, { cursor: "s1" });
        return { ops: result.ops, conflict: result.conflict };
      };
      expect(await walked("undo")).toEqual({ ops: taken, conflict: undefined });
      expect(await walked("redo")).toEqual({ ops: made.ops, conflict: undefined });
      expect(await walked("undo")).toEqual({ ops: taken, conflict: undefined });
      await expectTold(b, "fo-menu:1", [made.ops, taken, made.ops, taken]);
      await assertCopiesHold(b, copies);
    });

    test("a course removed with its drink, undone and redone, is undone again course first", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:1", "fo-menu:1"]);
      const removed = await write(b.process, "fo-board:1", [{ op: "remove", path: "/courses/1" }], { cursor: "s1" });
      const back = [{ op: "add", path: "/courses/1", value: course(1, "Soup") }, { op: "add", path: "/drinks/1", value: drink(1, 1, "Sherry") }];
      const walked = async (way: string) => {
        const { result } = await b.process.call(way, { cursor: "s1" });
        return { ops: result.ops, conflict: result.conflict };
      };
      expect(await walked("undo")).toEqual({ ops: back, conflict: undefined });
      expect(await walked("redo")).toEqual({ ops: [{ op: "remove", path: "/drinks/1" }, { op: "remove", path: "/courses/1" }], conflict: undefined });
      expect(await walked("undo")).toEqual({ ops: back, conflict: undefined });
      await expectTold(b, "fo-menu:1", [removed.ops, back, [{ op: "remove", path: "/drinks/1" }, { op: "remove", path: "/courses/1" }], back]);
      await assertCopiesHold(b, copies);
    });

    test("a course removed through its own document is undone course first, then its drink, redone drink first, and undone again -- the document read again each time", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-course:1", "fo-board:1", "fo-menu:1"]);
      const removed = await write(b.process, "fo-course:1", [{ op: "remove", path: "/courses/1" }], { cursor: "s1" });
      const back = [{ op: "add", path: "/courses/1", value: course(1, "Soup") }, { op: "add", path: "/drinks/1", value: drink(1, 1, "Sherry") }];
      const taken = [{ op: "remove", path: "/drinks/1" }, { op: "remove", path: "/courses/1" }];
      expect(removed.inverse).toEqual(back);
      const walked = async (way: string) => {
        const { result } = await b.process.call(way, { cursor: "s1" });
        return { ops: result.ops, conflict: result.conflict };
      };
      const opened = async () => content((await b.process.call("open", { doc: "fo-course:1" })).result);
      expect(await walked("undo")).toEqual({ ops: back, conflict: undefined });
      expect(await opened()).toEqual({ courses: course(1, "Soup"), drinks: { "1": drink(1, 1, "Sherry") } });
      expect(await walked("redo")).toEqual({ ops: taken, conflict: undefined });
      expect(await walked("undo")).toEqual({ ops: back, conflict: undefined });
      const gone = { op: "replace", path: "/courses", value: null };
      const here = [{ op: "replace", path: "/courses", value: course(1, "Soup") }, back[1]];
      await expectTold(b, "fo-course:1", [[gone, { op: "remove", path: "/drinks/1" }], here, [{ op: "remove", path: "/drinks/1" }, gone], here]);
      await expectTold(b, "fo-menu:1", [removed.ops, back, taken, back]);
      await assertCopiesHold(b, copies);
    });

    test("a course renamed and then removed through its own document in one write is undone as it was before the write, then its drink; redone, and undone again", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-course:1", "fo-board:1", "fo-menu:1"]);
      const removed = await write(b.process, "fo-course:1", [
        { op: "replace", path: "/courses/name", value: "Gone" },
        { op: "remove", path: "/courses/1" },
      ], { cursor: "s1" });
      expect(removed.ops).toEqual([{ op: "replace", path: "/courses", value: course(1, "Gone") }, { op: "remove", path: "/courses/1" }, { op: "remove", path: "/drinks/1" }]);
      const back = [{ op: "add", path: "/courses/1", value: course(1, "Soup") }, { op: "add", path: "/drinks/1", value: drink(1, 1, "Sherry") }];
      const taken = [{ op: "remove", path: "/drinks/1" }, { op: "remove", path: "/courses/1" }];
      expect(removed.inverse).toEqual(back);
      const walked = async (way: string) => {
        const { result } = await b.process.call(way, { cursor: "s1" });
        return { ops: result.ops, conflict: result.conflict };
      };
      expect(await walked("undo")).toEqual({ ops: back, conflict: undefined });
      expect(content((await b.process.call("open", { doc: "fo-course:1" })).result)).toEqual({ courses: course(1, "Soup"), drinks: { "1": drink(1, 1, "Sherry") } });
      expect(await walked("redo")).toEqual({ ops: taken, conflict: undefined });
      expect(await walked("undo")).toEqual({ ops: back, conflict: undefined });
      const written = [field("/courses/1/name", "Gone"), { op: "remove", path: "/courses/1" }, { op: "remove", path: "/drinks/1" }];
      await expectTold(b, "fo-menu:1", [written, back, taken, back]);
      await expectTold(b, "fo-board:1", [written, back, taken, back]);
      await assertCopiesHold(b, copies);
    });

    test("a household removed and added back through its own document in one write is walked as one row, at its root: undone, redone and undone again", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-household:1", "fo-board:1", "fo-inbox:a@x", "fo-inbox:z@x"]);
      const written = await write(b.process, "fo-household:1", [
        { op: "remove", path: "/households/1" },
        { op: "add", path: "/households/1", value: { weddings_id: 1, email: "z@x" } },
      ], { cursor: "s1" });
      // its favour, which cascades on it, goes with it, and an undo puts it back
      const favour = { id: 1, weddings_id: 1, households_id: 1, gift: "jam" };
      const favourGone = { op: "remove", path: "/favours/1" };
      const favourBack = { op: "add", path: "/favours/1", value: favour };
      // ... out of the answer: the household's document holds no favours (the ledger keeps it, whole)
      expect(written.ops).toEqual([{ op: "remove", path: "/households/1" }, { op: "add", path: "/households/1", value: household(1, "z@x") }]);
      const dry = await b.process.call("undo", { cursor: "s1", dry: true });
      expect({ ops: dry.result.ops, conflict: dry.result.conflict }).toEqual({ ops: [field("/households/email", "a@x")], conflict: undefined });
      const walked = async (way: string) => {
        const { result } = await b.process.call(way, { cursor: "s1" });
        return { ops: result.ops, conflict: result.conflict };
      };
      const as = (email: string) => [{ op: "replace", path: "/households", value: household(1, email) }];
      const favours = async () => (await b.exportTables()).tables.favours ?? [];
      expect(await walked("undo")).toEqual({ ops: as("a@x"), conflict: undefined });
      expect(await favours()).toEqual([favour]);
      expect(await walked("redo")).toEqual({ ops: as("z@x"), conflict: undefined });
      expect(await favours()).toEqual([]);
      expect(await walked("undo")).toEqual({ ops: as("a@x"), conflict: undefined });
      expect({ gone: favourGone.path, back: favourBack.value, now: await favours() }).toEqual({ gone: "/favours/1", back: favour, now: [favour] });
      const inBoard = (email: string) => [field("/households/1/email", email)];
      const told = (email: string) => [field("/households/email", email)];
      await expectTold(b, "fo-household:1", [[{ op: "replace", path: "/households", value: null }, as("z@x")[0]], told("a@x"), told("z@x"), told("a@x")]);
      await expectTold(b, "fo-board:1", [written.ops, inBoard("a@x"), inBoard("z@x"), inBoard("a@x")]);
      await assertCopiesHold(b, copies);
    });

    test("a course removed, added back and renamed through its own document in one write -- or renamed first too -- is walked as one row, its drink with it: undone, redone and undone again", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-course:1", "fo-course:2", "fo-board:1", "fo-menu:1", "fo-board:2"]);
      const walked = async (cursor: string, way: string) => {
        const { result } = await b.process.call(way, { cursor });
        return { ops: result.ops, conflict: result.conflict };
      };
      const cases: [string, number, number, string, string, unknown[]][] = [
        ["s1", 1, 1, "Soup", "Sherry", []],
        ["s2", 2, 2, "Salad", "Water", [{ op: "replace", path: "/courses/name", value: "Renamed" }]],
      ];
      for (const [cursor, id, wedding, name, drinkName, first] of cases) {
        const doc = `fo-course:${id}`;
        const { ops } = await write(b.process, doc, [
          ...first,
          { op: "remove", path: `/courses/${id}` },
          { op: "add", path: `/courses/${id}`, value: { weddings_id: wedding, name: "New" } },
          { op: "replace", path: "/courses/name", value: "Newer" },
        ], { cursor });
        expect(ops.slice(-3)).toEqual([{ op: "remove", path: `/drinks/${id}` }, { op: "add", path: `/courses/${id}`, value: course(id, "New", wedding) }, { op: "replace", path: "/courses", value: course(id, "Newer", wedding) }]);
        const back = [{ op: "replace", path: "/courses", value: course(id, name, wedding) }, { op: "add", path: `/drinks/${id}`, value: drink(id, id, drinkName) }];
        expect({ cursor, ...(await walked(cursor, "undo")) }).toEqual({ cursor, ops: back, conflict: undefined });
        expect(content((await b.process.call("open", { doc })).result)).toEqual({ courses: course(id, name, wedding), drinks: { [id]: drink(id, id, drinkName) } });
        expect({ cursor, ...(await walked(cursor, "redo")) }).toEqual({ cursor, ops: [{ op: "remove", path: `/drinks/${id}` }, { op: "replace", path: "/courses", value: course(id, "Newer", wedding) }], conflict: undefined });
        expect({ cursor, ...(await walked(cursor, "undo")) }).toEqual({ cursor, ops: back, conflict: undefined });
      }
      await assertCopiesHold(b, copies);
    });

    test("a household removed through its own document is undone: the board and the document hear it come back, and the party its favour, which cascades on it", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-household:1", "fo-board:1", "fo-party:1"]);
      const removed = await write(b.process, "fo-household:1", [{ op: "remove", path: "/households/1" }], { cursor: "s1" });
      const favour = { id: 1, weddings_id: 1, households_id: 1, gift: "jam" };
      // its writer is answered the household alone: its document holds no favours; the party, which does, is told both
      expect(removed.ops).toEqual([{ op: "remove", path: "/households/1" }]);
      const undone = await b.process.call("undo", { cursor: "s1" });
      expect({ ops: undone.result.ops, conflict: undone.result.conflict }).toEqual({ ops: [{ op: "add", path: "/households/1", value: household(1, "a@x") }], conflict: undefined });
      await expectTold(b, "fo-household:1", [[{ op: "replace", path: "/households", value: null }], [{ op: "replace", path: "/households", value: household(1, "a@x") }]]);
      await expectTold(b, "fo-board:1", [[removed.ops[0]], [undone.result.ops[0]]]);
      await expectTold(b, "fo-party:1", [
        [removed.ops[0], { op: "remove", path: "/favours/1" }],
        [undone.result.ops[0], { op: "add", path: "/favours/1", value: favour }],
      ]);
      await assertCopiesHold(b, copies);
    });

    test("a value kept as its column's type is told and undone as kept: a scope's \"10\" in a text column stays \"10\"", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-tags-labelled:10", "fo-board:1"]);
      const result = await write(b.process, "fo-tags-labelled:10", [{ op: "add", path: "/tags/-", value: {} }], { cursor: "s1" });
      expect(result.ops).toEqual([{ op: "add", path: "/tags/2", value: { id: 2, label: "10" } }]);
      const undone = await b.process.call("undo", { cursor: "s1" });
      expect({ ops: undone.result.ops, conflict: undone.result.conflict }).toEqual({ ops: [{ op: "remove", path: "/tags/2" }], conflict: undefined });
      await assertCopiesHold(b, copies);
    });

    test("a value kept as its column's type is told and undone as kept: a text scope's \"007\" stays \"007\"", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-tags-labelled:007", "fo-board:1"]);
      const result = await write(b.process, "fo-tags-labelled:007", [{ op: "add", path: "/tags/-", value: {} }], { cursor: "s1" });
      expect(result.ops).toEqual([{ op: "add", path: "/tags/2", value: { id: 2, label: "007" } }]);
      const undone = await b.process.call("undo", { cursor: "s1" });
      expect({ ops: undone.result.ops, conflict: undone.result.conflict }).toEqual({ ops: [{ op: "remove", path: "/tags/2" }], conflict: undefined });
      await assertCopiesHold(b, copies);
    });

    test("a boolean scope takes the name as Postgres takes a boolean: an unambiguous prefix of true/false, yes/no, on/off, any case; anything else is a 400", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-seating:1"]);
      const add = [{ op: "add", path: "/seats/-", value: { weddings_id: 1, table_no: 4 } }];
      const told: unknown[][] = [];
      let id = 1;
      // what the add stores, as the seating plan reads it (what a list reads by such a name has its own cases)
      for (const [name, kept] of [["fa", false], ["of", false], ["n", false], ["tr", true], ["on", true], ["YES", true]] as const) {
        await b.process.call("open", { doc: `fo-seats-kept:${name}` });
        const { ops } = await write(b.process, `fo-seats-kept:${name}`, add);
        id += 1;
        expect({ name, ops }).toEqual({ name, ops: [{ op: "add", path: `/seats/${id}`, value: seat(id, 4, kept) }] });
        told.push(ops);
      }
      for (const name of ["maybe", "o", "onx"]) {
        await b.process.call("open", { doc: `fo-seats-kept:${name}` }); // refused here already (400): the write is asked on its own
        expect({ name, code: (await b.process.call("delta", { doc: `fo-seats-kept:${name}`, ops: add })).error?.code }).toEqual({ name, code: 400 });
      }
      await expectTold(b, "fo-seating:1", told);
      await assertCopiesHold(b, copies);
    });

    test("a value kept as its column's type is told and undone as kept: a boolean scope's \"0\" is false", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-seats-kept:0", "fo-seats-kept:1", "fo-seating:1"]);
      const result = await write(b.process, "fo-seats-kept:0", [{ op: "add", path: "/seats/-", value: { weddings_id: 1, table_no: 4 } }], { cursor: "s1" });
      expect(result.ops).toEqual([{ op: "add", path: "/seats/2", value: seat(2, 4, false) }]);
      const undone = await b.process.call("undo", { cursor: "s1" });
      expect({ ops: undone.result.ops, conflict: undone.result.conflict }).toEqual({ ops: [{ op: "remove", path: "/seats/2" }], conflict: undefined });
      await expectTold(b, "fo-seats-kept:0", [result.ops, [{ op: "remove", path: "/seats/2" }]]);
      await expectSilent(b, "fo-seats-kept:1");
      await assertCopiesHold(b, copies);
    });

    test("a value kept as its column's type is told and undone as kept: a json scope's \"5\" is the number 5, as the document's condition reads it", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-seats-wished:5", "fo-seating:1"]);
      const result = await write(b.process, "fo-seats-wished:5", [{ op: "add", path: "/seats/-", value: { weddings_id: 1, table_no: 4, kept: false } }], { cursor: "s1" });
      expect(result.ops).toEqual([{ op: "add", path: "/seats/2", value: seat(2, 4, false, 5) }]);
      const undone = await b.process.call("undo", { cursor: "s1" });
      expect({ ops: undone.result.ops, conflict: undone.result.conflict }).toEqual({ ops: [{ op: "remove", path: "/seats/2" }], conflict: undefined });
      await expectTold(b, "fo-seats-wished:5", [result.ops, [{ op: "remove", path: "/seats/2" }]]);
      await assertCopiesHold(b, copies);
    });

    test("a seat added through a json list named as a JSON string, object or array, or a number spelled another way, is given the JSON the name is, told to the writer and read back by it", async () => {
      const b = backend();
      const names: [string, unknown][] = [['"5"', "5"], ['"a"', "a"], ["{}", {}], ["[]", []], ["5.0", 5], [" 5", 5], ["1e0", 1], ['[1, "a", null]', [1, "a", null]]];
      const lists = names.map(([name]) => `fo-seats-wished:${name}`);
      const copies = await openAll(b.process, [...lists, "fo-seating:1"]);
      let id = 1;
      for (const [name, wishes] of names) {
        const doc = `fo-seats-wished:${name}`;
        const { ops } = await write(b.process, doc, [{ op: "add", path: "/seats/-", value: { weddings_id: 1, table_no: 4, kept: false } }]);
        id += 1;
        expect({ name, ops }).toEqual({ name, ops: [{ op: "add", path: `/seats/${id}`, value: seat(id, 4, false, wishes) }] });
        await b.quiet();
        expect({ name, told: told(b.process, doc).at(-1) }).toEqual({ name, told: ops });
      }
      await assertCopiesHold(b, copies);
    });

    test("a seat added through a boolean list named off is read back by it, told to every list its value meets -- off, no, 0, false and up to off -- and not to yes; undone and redone without a conflict", async () => {
      const b = backend();
      const lists = ["fo-seats-kept:off", "fo-seats-kept:no", "fo-seats-kept:0", "fo-seats-kept:false", "fo-seats-upto:off"];
      const copies = await openAll(b.process, [...lists, "fo-seats-kept:yes", "fo-seating:1"]);
      const made = await write(b.process, "fo-seats-kept:off", [{ op: "add", path: "/seats/-", value: { weddings_id: 1, table_no: 4 } }], { cursor: "s1" });
      expect(made.ops).toEqual([{ op: "add", path: "/seats/2", value: seat(2, 4, false) }]);
      expect(Object.keys((await b.process.call("open", { doc: "fo-seats-kept:off" })).result.seats)).toEqual(["2"]);
      const walked = async (way: string) => {
        const { result } = await b.process.call(way, { cursor: "s1" });
        return { ops: result.ops, conflict: result.conflict };
      };
      const taken = [{ op: "remove", path: "/seats/2" }];
      expect(await walked("undo")).toEqual({ ops: taken, conflict: undefined });
      expect(await walked("redo")).toEqual({ ops: made.ops, conflict: undefined });
      for (const doc of lists) await expectTold(b, doc, [made.ops, taken, made.ops]);
      await expectSilent(b, "fo-seats-kept:yes");
      await assertCopiesHold(b, copies);
    });

    test("a value kept as its column's type is told and undone as kept: a json string that reads as a number stays a string", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-seating:1"]);
      const result = await write(b.process, "fo-seating:1", [{ op: "add", path: "/seats/-", value: { table_no: 5, kept: true, wishes: "123" } }], { cursor: "s1" });
      expect(result.ops).toEqual([{ op: "add", path: "/seats/2", value: seat(2, 5, true, "123") }]);
      const undone = await b.process.call("undo", { cursor: "s1" });
      expect({ ops: undone.result.ops, conflict: undone.result.conflict }).toEqual({ ops: [{ op: "remove", path: "/seats/2" }], conflict: undefined });
      await assertCopiesHold(b, copies);
    });

    test("a value kept as its column's type is told and undone as kept: a household's parent key written as \"2\" (through a list, which moves it) is the number 2", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-all-households:", "fo-household:1", "fo-board:1", "fo-board:2"]);
      const result = await write(b.process, "fo-all-households:", [{ op: "replace", path: "/households/1/weddings_id", value: "2" }], { cursor: "s1" });
      expect(result.ops).toEqual([{ op: "replace", path: "/households/1", value: household(1, "a@x", 2) }]);
      const undone = await b.process.call("undo", { cursor: "s1" });
      expect({ ops: undone.result.ops, conflict: undone.result.conflict }).toEqual({ ops: [{ op: "replace", path: "/households/1", value: household(1, "a@x") }], conflict: undefined });
      await assertCopiesHold(b, copies);
    });

    test("a value kept as its column's type is told and undone as kept: a parent key written as \"10\" is the number 10", async () => {
      const b = backend();
      await b.process.call("open", { doc: "fo-board:1" });
      await write(b.process, "fo-board:1", [{ op: "add", path: "/courses/10", value: { name: "Fish" } }]);
      const copies = await openAll(b.process, ["fo-board:1", "fo-course:1", "fo-course:10"]);
      const result = await write(b.process, "fo-board:1", [{ op: "replace", path: "/drinks/1/courses_id", value: "10" }], { cursor: "s1" });
      expect(result.ops).toEqual([{ op: "replace", path: "/drinks/1", value: drink(1, 10, "Sherry") }]);
      const undone = await b.process.call("undo", { cursor: "s1" });
      expect({ ops: undone.result.ops, conflict: undone.result.conflict }).toEqual({ ops: [{ op: "replace", path: "/drinks/1", value: drink(1, 1, "Sherry") }], conflict: undefined });
      await assertCopiesHold(b, copies);
    });
  });

  describe("a row someone has put rows under since", () => {
    const fish = { op: "add", path: "/courses/10", value: { name: "Fish" } };
    const chablis = { op: "add", path: "/drinks/10", value: { courses_id: 10, name: "Chablis" } };
    const held = async (b: PathBackend) => {
      const board = (await b.process.call("open", { doc: "fo-board:1" })).result;
      return { course: board.courses["10"]?.name, drink: board.drinks["10"]?.name };
    };

    test("undoing its making is a conflict: nothing is walked, the course stays with the drink put under it, and the drink's own undo still takes the drink", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:1", "fo-menu:1", "fo-all-courses:"]);
      await write(b.process, "fo-board:1", [fish], { cursor: "s1" });
      await write(b.process, "fo-board:1", [chablis], { cursor: "s2" });
      for (const doc of ["fo-board:1", "fo-menu:1"]) expect({ doc, dry: (await b.process.call("undo", { cursor: "s1", dry: true })).result.conflict }).toEqual({ doc, dry: ["/courses/10"] });
      const met = await b.process.call("undo", { cursor: "s1" });
      expect({ ops: met.result.ops, conflict: met.result.conflict }).toEqual({ ops: [], conflict: ["/courses/10"] });
      expect(await held(b)).toEqual({ course: "Fish", drink: "Chablis" });
      const theirs = await b.process.call("undo", { cursor: "s2" });
      expect({ ops: theirs.result.ops, conflict: theirs.result.conflict }).toEqual({ ops: [{ op: "remove", path: "/drinks/10" }], conflict: undefined });
      expect(await held(b)).toEqual({ course: "Fish", drink: undefined });
      await assertCopiesHold(b, copies);
    });

    test("so is a named undo of it, which records nothing: once the rows under it are gone, it is undone", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:1", "fo-menu:1"]);
      const made = await write(b.process, "fo-board:1", [fish], { cursor: "s1" });
      await write(b.process, "fo-board:1", [chablis], { cursor: "s2" });
      const met = await b.process.call("undo", { cursor: "s1", change: made.entry });
      expect({ ops: met.result.ops, conflict: met.result.conflict }).toEqual({ ops: [], conflict: ["/courses/10"] });
      expect(await held(b)).toEqual({ course: "Fish", drink: "Chablis" });
      await b.process.call("undo", { cursor: "s2" });
      const undone = await b.process.call("undo", { cursor: "s1", change: made.entry });
      expect({ ops: undone.result.ops, conflict: undone.result.conflict }).toEqual({ ops: [{ op: "remove", path: "/courses/10" }], conflict: undefined });
      await assertCopiesHold(b, copies);
    });

    test("rows the change made under it itself are its own: the course and its drink made in one write, then another row added beside them, undo as one", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:1"]);
      await write(b.process, "fo-board:1", [fish, chablis], { cursor: "s1" });
      await write(b.process, "fo-board:1", [{ op: "add", path: "/drinks/11", value: { courses_id: 1, name: "Port" } }], { cursor: "s2" });   // under another course
      const undone = await b.process.call("undo", { cursor: "s1" });
      expect({ ops: undone.result.ops, conflict: undone.result.conflict }).toEqual({ ops: [{ op: "remove", path: "/drinks/10" }, { op: "remove", path: "/courses/10" }], conflict: undefined });
      await assertCopiesHold(b, copies);
    });
  });

  describe("a change named by its entry", () => {
    /** What a walk answered, as the cases compare it. */
    const walked = (res: any) => ({ doc: res.result?.doc, ops: res.result?.ops, conflict: res.result?.conflict, error: res.error });
    const name = async (b: PathBackend) => (await b.process.call("open", { doc: "fo-course:1" })).result.courses.name;
    const soup = { op: "replace", path: "/courses/1/name", value: "Broth" };
    const wedding = { op: "replace", path: "/weddings/name", value: "the big day" };

    test("undo names a change: the cursor's older write is walked back and its later one stands; the cursor's own undo then takes the later one, and passes the named one by", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:1", "fo-menu:1", "fo-title:1"]);
      const older = await write(b.process, "fo-board:1", [soup], { cursor: "s1" });
      await write(b.process, "fo-board:1", [wedding], { cursor: "s1" });
      const undone = await b.process.call("undo", { cursor: "s1", change: older.entry });
      expect(walked(undone)).toEqual({ doc: "fo-board:1", ops: [{ op: "replace", path: "/courses/1", value: course(1, "Soup") }], conflict: undefined, error: undefined });
      expect(await name(b)).toBe("Soup");
      expect((await b.process.call("open", { doc: "fo-title:1" })).result.weddings.name).toBe("the big day");
      const next = await b.process.call("undo", { cursor: "s1" });
      expect(walked(next)).toEqual({ doc: "fo-board:1", ops: [{ op: "replace", path: "/weddings", value: { id: 1, name: "ours" } }], conflict: undefined, error: undefined });
      expect((await b.process.call("undo", { cursor: "s1" })).result).toBeNull();
      await expectTold(b, "fo-menu:1", [[field("/courses/1/name", "Broth")], [field("/weddings/name", "the big day")], [field("/courses/1/name", "Soup")], [field("/weddings/name", "ours")]]);
      await expectTold(b, "fo-title:1", [[field("/weddings/name", "the big day")], [field("/weddings/name", "ours")]]);
      await assertCopiesHold(b, copies);
    });

    test("redo names a change: one undone is walked forward again, even after the cursor's fresh write, by any entry of its chain -- its write, its undo, its redo; one that stands has nothing to redo, and one undone nothing to undo (null)", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:1", "fo-menu:1"]);
      const made = await write(b.process, "fo-board:1", [soup], { cursor: "s1" });
      expect((await b.process.call("redo", { cursor: "s1", change: made.entry })).result).toBeNull();
      const undone = await b.process.call("undo", { cursor: "s1", change: made.entry });
      expect((await b.process.call("undo", { cursor: "s1", change: made.entry })).result).toBeNull();
      await write(b.process, "fo-board:1", [{ op: "replace", path: "/households/1/email", value: "z@x" }], { cursor: "s1" });
      expect((await b.process.call("redo", { cursor: "s1" })).result).toBeNull();   // the fresh write ended the cursor's redo
      const redone = await b.process.call("redo", { cursor: "s1", change: undone.result.entry });
      expect(walked(redone)).toEqual({ doc: "fo-board:1", ops: [{ op: "replace", path: "/courses/1", value: course(1, "Broth") }], conflict: undefined, error: undefined });
      expect((await b.process.call("redo", { cursor: "s1", change: made.entry })).result).toBeNull();
      const again = await b.process.call("undo", { cursor: "s1", change: redone.result.entry });
      expect(walked(again)).toEqual({ doc: "fo-board:1", ops: [{ op: "replace", path: "/courses/1", value: course(1, "Soup") }], conflict: undefined, error: undefined });
      await expectTold(b, "fo-menu:1", ["Broth", "Soup", "Broth", "Soup"].map((name) => [field("/courses/1/name", name)]));
      await assertCopiesHold(b, copies);
    });

    test("a change that is not the cursor's -- another cursor's, a fact, an entry there is not -- is not found (404), and nothing is walked; a change that is not an entry's id is malformed (400)", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:1"]);
      const theirs = await write(b.process, "fo-board:1", [soup], { cursor: "s2" });
      const fact = await write(b.process, "fo-board:1", [wedding], { cursor: "s1", undoable: false });
      const undone = await b.process.call("undo", { cursor: "s2", change: theirs.entry });   // its undo, which is s2's too
      for (const change of [theirs.entry, fact.entry, undone.result.entry, 999]) {
        for (const way of ["undo", "redo"]) {
          expect({ way, change, error: (await b.process.call(way, { cursor: "s1", change })).error }).toEqual({ way, change, error: { code: 404, message: `Entry ${change} is no change of this cursor's` } });
        }
      }
      for (const change of ["1", 1.5, -1, 0, null, {}]) {
        if (change === null) continue;   // null is no change named: the cursor's own next
        expect({ change, code: (await b.process.call("undo", { cursor: "s1", change })).error?.code }).toEqual({ change, code: 400 });
      }
      expect(await name(b)).toBe("Soup");
      await assertCopiesHold(b, copies);
    });

    test("a named undo that meets a later write -- anyone's, or the cursor's own -- walks nothing, answers the conflict and records nothing: once the field holds what the change left, it is undone", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:1", "fo-menu:1"]);
      const older = await write(b.process, "fo-board:1", [soup], { cursor: "s1" });
      await write(b.process, "fo-board:1", [{ ...soup, value: "Bisque" }], { cursor: "s2" });
      const met = await b.process.call("undo", { cursor: "s1", change: older.entry });
      expect({ ...walked(met), entry: met.result.entry }).toEqual({ doc: "fo-board:1", ops: [], conflict: ["/courses/1"], error: undefined, entry: undefined });
      // the cursor's own later write, over it: the same
      const own = await write(b.process, "fo-board:1", [{ ...soup, value: "Consommé" }], { cursor: "s1" });
      expect(walked(await b.process.call("undo", { cursor: "s1", change: older.entry }))).toEqual({ doc: "fo-board:1", ops: [], conflict: ["/courses/1"], error: undefined });
      expect(await name(b)).toBe("Consommé");
      // the cursor's own undo takes its later write back to Bisque; s2's to Broth, what the change left
      expect(walked(await b.process.call("undo", { cursor: "s1", change: own.entry })).ops).toEqual([{ op: "replace", path: "/courses/1", value: course(1, "Bisque") }]);
      expect(walked(await b.process.call("undo", { cursor: "s2" })).ops).toEqual([{ op: "replace", path: "/courses/1", value: course(1, "Broth") }]);
      const undone = await b.process.call("undo", { cursor: "s1", change: older.entry });
      expect(walked(undone)).toEqual({ doc: "fo-board:1", ops: [{ op: "replace", path: "/courses/1", value: course(1, "Soup") }], conflict: undefined, error: undefined });
      await assertCopiesHold(b, copies);
    });

    test("asking first: dry answers what the named walk would do, and the entry it would walk, and walks nothing; entry then walks it only if that is still the change's next (409 otherwise)", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:1", "fo-menu:1"]);
      const older = await write(b.process, "fo-board:1", [soup], { cursor: "s1" });
      const later = await write(b.process, "fo-board:1", [wedding], { cursor: "s1" });
      const dry = await b.process.call("undo", { cursor: "s1", change: older.entry, dry: true });
      expect(dry.result).toEqual({ doc: "fo-board:1", entry: older.entry, ops: [field("/courses/1/name", "Soup")] });
      expect(await name(b)).toBe("Broth");
      expect((await b.process.call("undo", { cursor: "s1", change: older.entry, entry: later.entry })).error?.code).toBe(409);
      expect(await name(b)).toBe("Broth");
      const undone = await b.process.call("undo", { cursor: "s1", change: older.entry, entry: older.entry });
      expect(walked(undone).ops).toEqual([{ op: "replace", path: "/courses/1", value: course(1, "Soup") }]);
      const redry = await b.process.call("redo", { cursor: "s1", change: older.entry, dry: true });
      expect(redry.result).toEqual({ doc: "fo-board:1", entry: undone.result.entry, ops: [field("/courses/1/name", "Broth")] });
      await assertCopiesHold(b, copies);
    });
  });
}
