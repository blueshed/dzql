/**
 * Who is told what: a write reaches every other open document that holds a
 * row it changed, and none that do not. Part of `pathCases`.
 */
import { describe, expect, test } from "bun:test";
import { course, drink, household, seat, field } from "./fixture";
import { type PathBackend, content, openAll, assertCopiesHold, write, expectTold, expectSilent } from "./law";

/** A write reaches every other open document that holds a row it changed -- and none that do not. */
export function fanOutCases(backend: () => PathBackend): void {
  describe("a holder is told what changed", () => {
    test("one field written is told as that field alone, to every holder -- the writer's own, a map, a root -- never the row again", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:1", "fo-household:1", "fo-all-households:"]);
      await write(b.process, "fo-board:1", [{ op: "replace", path: "/households/1/email", value: "new@x" }]);
      await expectTold(b, "fo-board:1", [[field("/households/1/email", "new@x")]]);
      await expectTold(b, "fo-all-households:", [[field("/households/1/email", "new@x")]]);
      await expectTold(b, "fo-household:1", [[field("/households/email", "new@x")]]);
      await assertCopiesHold(b, copies);
    });

    test("a field written as it is is told nothing: the rest of the write is told; a write that changes nothing tells the others nothing", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:1", "fo-menu:1", "fo-seating:1"]);
      await write(b.process, "fo-board:1", [{ op: "replace", path: "/courses/1/name", value: "Soup" }, { op: "replace", path: "/drinks/1/name", value: "Port" }]);
      await expectTold(b, "fo-menu:1", [[field("/drinks/1/name", "Port")]]);
      await write(b.process, "fo-seating:1", [{ op: "replace", path: "/seats/1/wishes", value: { veg: true } }, { op: "replace", path: "/seats/1/kept", value: true }]);
      await expectTold(b, "fo-seating:1", [[]]);   // the writer's version moves on: its write is recorded, and changed nothing
      await expectTold(b, "fo-board:1", [[field("/drinks/1/name", "Port")]]);
      await assertCopiesHold(b, copies);
    });

    test("a field the store sets itself as the row is written -- a trigger -- is told beside the field written", async () => {
      const b = backend();
      if (!b.storeSetsT) return;   // the JSON file: no SQL reaches its store
      const undo = await b.storeSetsT();
      try {
        const copies = await openAll(b.process, ["fo-board:1", "fo-household:1"]);
        await write(b.process, "fo-board:1", [{ op: "replace", path: "/households/1/email", value: "new@x" }]);
        await expectTold(b, "fo-board:1", [[field("/households/1/email", "new@x"), field("/households/1/t", "NEW@X")]]);
        await expectTold(b, "fo-household:1", [[field("/households/email", "new@x"), field("/households/t", "NEW@X")]]);
        await assertCopiesHold(b, copies);
      } finally {
        await undo();
      }
    });
  });

  describe("a row two documents hold as a map", () => {
    test("a field written through the board reaches the menu as that field of the row, and the course's own document as that field of its root", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:1", "fo-menu:1", "fo-course:1"]);
      await write(b.process, "fo-board:1", [{ op: "replace", path: "/courses/1/name", value: "Consommé" }]);
      await expectTold(b, "fo-menu:1", [[field("/courses/1/name", "Consommé")]]);
      await expectTold(b, "fo-course:1", [[field("/courses/name", "Consommé")]]);
      await assertCopiesHold(b, copies);
    });

    test("a row added through the board reaches the menu", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:1", "fo-menu:1"]);
      await write(b.process, "fo-board:1", [{ op: "add", path: "/courses/10", value: { name: "Fish" } }]);
      await expectTold(b, "fo-menu:1", [[{ op: "add", path: "/courses/10", value: course(10, "Fish") }]]);
      await assertCopiesHold(b, copies);
    });

    test("a grandchild added through the board reaches the menu and its course's own document, found through its parent", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:1", "fo-menu:1", "fo-course:1"]);
      await write(b.process, "fo-board:1", [{ op: "add", path: "/drinks/10", value: { courses_id: 1, name: "Claret" } }]);
      await expectTold(b, "fo-menu:1", [[{ op: "add", path: "/drinks/10", value: drink(10, 1, "Claret") }]]);
      await expectTold(b, "fo-course:1", [[{ op: "add", path: "/drinks/10", value: drink(10, 1, "Claret") }]]);
      await assertCopiesHold(b, copies);
    });

    test("a course and its drink added in one write reach the menu course first, so the drink finds its parent", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:1", "fo-menu:1"]);
      await write(b.process, "fo-board:1", [
        { op: "add", path: "/courses/10", value: { name: "Fish" } },
        { op: "add", path: "/drinks/10", value: { courses_id: 10, name: "Chablis" } },
      ]);
      await expectTold(b, "fo-menu:1", [[
        { op: "add", path: "/courses/10", value: course(10, "Fish") },
        { op: "add", path: "/drinks/10", value: drink(10, 10, "Chablis") },
      ]]);
      await assertCopiesHold(b, copies);
    });

    test("a course removed through the board leaves the menu, with the drinks it takes with it", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:1", "fo-menu:1"]);
      await write(b.process, "fo-board:1", [{ op: "remove", path: "/courses/1" }]);
      await expectTold(b, "fo-menu:1", [[{ op: "remove", path: "/courses/1" }, { op: "remove", path: "/drinks/1" }]]);
      await assertCopiesHold(b, copies);
    });

    test("a course removed through a list that does not include drinks still takes its drinks, as the schema says: every document that held them is told, and its writer is answered the course alone (it holds no drinks); undone, both come back -- and a household's favour, which cascades on it, the same", async () => {
      const b = backend();
      const docs = ["fo-all-courses:", "fo-board:1", "fo-menu:1", "fo-drinks:1", "fo-course:1", "fo-catalog:", "fo-all-households:", "fo-party:1"];
      const copies = await openAll(b.process, docs);
      const gone = [{ op: "remove", path: "/courses/1" }, { op: "remove", path: "/drinks/1" }];
      const { ops, inverse } = await write(b.process, "fo-all-courses:", [gone[0]], { cursor: "c1" });
      expect({ ops, inverse }).toEqual({ ops: [gone[0]], inverse: [{ op: "add", path: "/courses/1", value: course(1, "Soup") }] });
      await expectTold(b, "fo-all-courses:", [[gone[0]]]);
      for (const doc of ["fo-board:1", "fo-menu:1", "fo-catalog:"]) await expectTold(b, doc, [gone]);
      await expectTold(b, "fo-drinks:1", [[gone[1]]]);
      await expectTold(b, "fo-course:1", [[{ op: "replace", path: "/courses", value: null }, gone[1]]]);
      expect((await b.exportTables()).tables.drinks).toEqual([drink(2, 2, "Water")]);
      const undone = await b.process.call("undo", { cursor: "c1" });
      expect({ ops: undone.result?.ops, conflict: undone.result?.conflict, error: undone.error }).toEqual({
        ops: [{ op: "add", path: "/courses/1", value: course(1, "Soup") }], conflict: undefined, error: undefined,
      });
      expect((await b.exportTables()).tables.drinks).toEqual([drink(1, 1, "Sherry"), drink(2, 2, "Water")]);   // the ledger kept it whole
      await assertCopiesHold(b, copies);
      await write(b.process, "fo-all-households:", [{ op: "remove", path: "/households/1" }]);
      expect((await b.exportTables()).tables.favours ?? []).toEqual([]);
      await assertCopiesHold(b, copies);
    });

    test("a drink written through its course's own document reaches the board and the menu", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-course:1", "fo-board:1", "fo-menu:1"]);
      await write(b.process, "fo-course:1", [{ op: "replace", path: "/drinks/1/name", value: "Madeira" }]);
      await expectTold(b, "fo-board:1", [[field("/drinks/1/name", "Madeira")]]);
      await expectTold(b, "fo-menu:1", [[field("/drinks/1/name", "Madeira")]]);
      await assertCopiesHold(b, copies);
    });
  });

  describe("a write's ops land in the order sent", () => {
    test("a drink changed and then removed in one write is told so, in order, to every document that held it; undone, it comes back as it was", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:1", "fo-menu:1", "fo-course:1"]);
      const { ops, inverse } = await write(b.process, "fo-board:1", [
        { op: "replace", path: "/drinks/1/name", value: "Port" },
        { op: "remove", path: "/drinks/1" },
      ], { cursor: "s1" });
      const changed = { op: "replace", path: "/drinks/1", value: drink(1, 1, "Port") };
      const removed = { op: "remove", path: "/drinks/1" };
      const back = { op: "add", path: "/drinks/1", value: drink(1, 1, "Sherry") };
      expect(ops).toEqual([changed, removed]);
      expect(inverse).toEqual([back, { op: "replace", path: "/drinks/1", value: drink(1, 1, "Sherry") }]);
      const undone = await b.process.call("undo", { cursor: "s1" });
      expect({ ops: undone.result.ops, conflict: undone.result.conflict }).toEqual({ ops: [back], conflict: undefined });
      for (const doc of ["fo-board:1", "fo-menu:1", "fo-course:1"]) await expectTold(b, doc, [[field("/drinks/1/name", "Port"), removed], [back]]);
      await assertCopiesHold(b, copies);
    });

    test("the wedding renamed, a course added and named twice, in one write: each op lands and is told where it was sent (the two namings, one straight after the other, as one), and the undo takes the course and gives the name back", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:1", "fo-menu:1", "fo-title:1"]);
      const { ops, inverse } = await write(b.process, "fo-board:1", [
        { op: "replace", path: "/weddings/name", value: "our day" },
        { op: "add", path: "/courses/-", value: { name: "Fish" } },
        { op: "replace", path: "/courses/3/name", value: "Cod" },
        { op: "replace", path: "/courses/3", value: { name: "Hake" } },
      ], { cursor: "s1" });
      const renamed = { op: "replace", path: "/weddings", value: { id: 1, name: "our day" } };
      expect(ops).toEqual([
        renamed,
        { op: "add", path: "/courses/3", value: course(3, "Fish") },
        { op: "replace", path: "/courses/3", value: course(3, "Hake") },
      ]);
      expect(inverse).toEqual([
        { op: "replace", path: "/courses/3", value: null },
        { op: "remove", path: "/courses/3" },
        { op: "replace", path: "/weddings", value: { id: 1, name: "ours" } },
      ]);
      const undone = await b.process.call("undo", { cursor: "s1" });
      const taken = [{ op: "remove", path: "/courses/3" }, { op: "replace", path: "/weddings", value: { name: "ours" } }];
      expect({ ops: undone.result.ops.map((o: any) => o.op === "remove" ? o : { ...o, value: { name: o.value.name } }), conflict: undone.result.conflict }).toEqual({ ops: taken, conflict: undefined });
      await expectTold(b, "fo-menu:1", [[field("/weddings/name", "our day"), ops[1], field("/courses/3/name", "Hake")], [taken[0], field("/weddings/name", "ours")]]);
      await expectTold(b, "fo-title:1", [[field("/weddings/name", "our day")], [field("/weddings/name", "ours")]]);
      await assertCopiesHold(b, copies);
    });

    test("a row replaced again and again, one op straight after another, is answered, recorded and told once, as the run leaves it; a replace of another row between starts a run of its own", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-course:1", "fo-board:1", "fo-menu:1"]);
      const { ops, inverse } = await write(b.process, "fo-course:1", [
        { op: "replace", path: "/courses/name", value: "A" },
        { op: "replace", path: "/courses", value: { name: "B" } },
        { op: "replace", path: "/courses/01/name", value: "C" },
        { op: "replace", path: "/drinks/1/name", value: "Port" },
        { op: "replace", path: "/drinks/1", value: { name: "Madeira" } },
        { op: "replace", path: "/courses/name", value: "D" },
      ], { cursor: "s1" });
      expect(ops).toEqual([
        { op: "replace", path: "/courses", value: course(1, "C") },
        { op: "replace", path: "/drinks/1", value: drink(1, 1, "Madeira") },
        { op: "replace", path: "/courses", value: course(1, "D") },
      ]);
      expect(inverse).toEqual([
        { op: "replace", path: "/courses", value: course(1, "Soup") },
        { op: "replace", path: "/drinks/1", value: drink(1, 1, "Sherry") },
        { op: "replace", path: "/courses", value: course(1, "Soup") },
      ]);
      const undone = await b.process.call("undo", { cursor: "s1" });
      expect({ ops: undone.result.ops, conflict: undone.result.conflict }).toEqual({ ops: [{ op: "replace", path: "/courses", value: course(1, "Soup") }, { op: "replace", path: "/drinks/1", value: drink(1, 1, "Sherry") }], conflict: undefined });
      const told = (course: string) => [
        [field(`${course}/name`, "C"), field("/drinks/1/name", "Madeira"), field(`${course}/name`, "D")],
        [field(`${course}/name`, "Soup"), field("/drinks/1/name", "Sherry")],
      ];
      await expectTold(b, "fo-course:1", told("/courses"));
      await expectTold(b, "fo-board:1", told("/courses/1"));
      await expectTold(b, "fo-menu:1", told("/courses/1"));
      await assertCopiesHold(b, copies);
    });

    test("a drink written and then taken with its course, in one write, is told as written -- written, then gone once -- to each document that held it, as a drink written and removed is; undone, both come back", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:1", "fo-menu:1", "fo-course:1", "fo-all-courses:"]);
      const { ops } = await write(b.process, "fo-board:1", [
        { op: "replace", path: "/drinks/1/name", value: "Port" },
        { op: "remove", path: "/courses/1" },
      ], { cursor: "s1" });
      const gone = [{ op: "remove", path: "/drinks/1" }, { op: "remove", path: "/courses/1" }];
      expect(ops).toEqual([{ op: "replace", path: "/drinks/1", value: drink(1, 1, "Port") }, { op: "remove", path: "/courses/1" }, { op: "remove", path: "/drinks/1" }]);
      const undone = await b.process.call("undo", { cursor: "s1" });
      const back = [{ op: "add", path: "/courses/1", value: course(1, "Soup") }, { op: "add", path: "/drinks/1", value: drink(1, 1, "Sherry") }];
      expect({ ops: undone.result.ops, conflict: undone.result.conflict }).toEqual({ ops: back, conflict: undefined });
      const port = field("/drinks/1/name", "Port");
      await expectTold(b, "fo-board:1", [[port, ...ops.slice(1)], back]);
      await expectTold(b, "fo-menu:1", [[port, ...ops.slice(1)], back]);
      // the course's own document holds the drink by its key until the course is told gone (null), then hears the drink go
      await expectTold(b, "fo-course:1", [[port, { op: "replace", path: "/courses", value: null }, gone[0]], [{ op: "replace", path: "/courses", value: course(1, "Soup") }, back[1]]]);
      await expectTold(b, "fo-all-courses:", [[gone[1]], [back[0]]]);
      await assertCopiesHold(b, copies);
    });

    test("a course and its drink made and then taken out in one write -- the drink by the course's cascade, written first or not -- are told as written, add before remove, to each document that held them: the board, the menu, the drinks alone, the lists; none is told a remove of a row it never had", async () => {
      const b = backend();
      const docs = ["fo-board:1", "fo-menu:1", "fo-drinks:1", "fo-catalog:", "fo-all-courses:"];
      const copies = await openAll(b.process, docs);
      // a course and a drink, as told: the second write's ids are new, as an add's must be (#71)
      const life = (c: number, d: number) => ({
        madeCourse: { op: "add", path: `/courses/${c}`, value: course(c, "Fish") },
        madeDrink: { op: "add", path: `/drinks/${d}`, value: drink(d, c, "Chablis") },
        named: { op: "replace", path: `/drinks/${d}`, value: drink(d, c, "Muscadet") },
        namedTold: field(`/drinks/${d}/name`, "Muscadet"),
        goneCourse: { op: "remove", path: `/courses/${c}` },
        goneDrink: { op: "remove", path: `/drinks/${d}` },
      });
      const first = life(9, 5);
      const second = life(10, 6);
      const made = await write(b.process, "fo-board:1", [
        { op: "add", path: "/courses/9", value: { name: "Fish" } },
        { op: "add", path: "/drinks/5", value: { courses_id: 9, name: "Chablis" } },
        { op: "remove", path: "/courses/9" },
      ], { cursor: "m1" });
      expect({ ops: made.ops, inverse: made.inverse }).toEqual({ ops: [first.madeCourse, first.madeDrink, first.goneCourse, first.goneDrink], inverse: [] });
      const renamed = await write(b.process, "fo-board:1", [
        { op: "add", path: "/courses/10", value: { name: "Fish" } },
        { op: "add", path: "/drinks/6", value: { courses_id: 10, name: "Chablis" } },
        { op: "replace", path: "/drinks/6/name", value: "Muscadet" },
        { op: "remove", path: "/courses/10" },
      ]);
      expect(renamed.ops).toEqual([second.madeCourse, second.madeDrink, second.named, second.goneCourse, second.goneDrink]);
      for (const doc of ["fo-board:1", "fo-menu:1", "fo-catalog:"]) await expectTold(b, doc, [made.ops, [second.madeCourse, second.madeDrink, second.namedTold, second.goneCourse, second.goneDrink]]);
      await expectTold(b, "fo-drinks:1", [[first.madeDrink, first.goneDrink], [second.madeDrink, second.namedTold, second.goneDrink]]);
      await expectTold(b, "fo-all-courses:", [[first.madeCourse, first.goneCourse], [second.madeCourse, second.goneCourse]]);
      await assertCopiesHold(b, copies);
    });

    test("a row that leaves the document in a write is not there for the rest of it (404), and nothing is written: moved to the other wedding and then removed, renamed or given a drink; out of a list's condition, or added outside it, and then written", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:1", "fo-board:2", "fo-course:1", "fo-courses-like:So", "fo-all-courses:"]);
      const code = async (doc: string, ops: unknown[]) => (await b.process.call("delta", { doc, ops })).error?.code;
      const moved = { op: "replace", path: "/courses/1/weddings_id", value: 2 };
      expect(await code("fo-board:1", [moved, { op: "remove", path: "/courses/1" }])).toBe(404);
      expect(await code("fo-board:1", [moved, { op: "replace", path: "/courses/1/name", value: "X" }])).toBe(404);
      expect(await code("fo-board:1", [moved, { op: "replace", path: "/drinks/1/name", value: "X" }])).toBe(404); // its drink went with it
      expect(await code("fo-board:1", [moved, { op: "add", path: "/drinks/-", value: { courses_id: 1, name: "Gin" } }])).toBe(404);
      expect(await code("fo-courses-like:So", [{ op: "replace", path: "/courses/1/name", value: "Xyz" }, { op: "replace", path: "/courses/1/name", value: "Soup2" }])).toBe(404);
      expect(await code("fo-courses-like:So", [{ op: "add", path: "/courses/-", value: { weddings_id: 1, name: "Fish" } }, { op: "replace", path: "/courses/3/name", value: "Sole" }])).toBe(404);
      await expectSilent(b, "fo-board:1", "fo-board:2", "fo-course:1", "fo-courses-like:So", "fo-all-courses:");
      await assertCopiesHold(b, copies);
    });
  });

  describe("a row one document holds as a map and another as its root", () => {
    test("written in the board's map, it reaches the household's own document as that field of its root; the other household hears nothing", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:1", "fo-household:1", "fo-household:2"]);
      await write(b.process, "fo-board:1", [{ op: "replace", path: "/households/1/email", value: "new@x" }]);
      await expectTold(b, "fo-household:1", [[field("/households/email", "new@x")]]);
      await expectSilent(b, "fo-household:2");
      await assertCopiesHold(b, copies);
    });

    test("written through the household's own document, it reaches the board's map as that field of the keyed row", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-household:1", "fo-board:1"]);
      await write(b.process, "fo-household:1", [{ op: "replace", path: "/households/email", value: "mine@x" }]);
      await expectTold(b, "fo-household:1", [[field("/households/email", "mine@x")]]);
      await expectTold(b, "fo-board:1", [[field("/households/1/email", "mine@x")]]);
      await assertCopiesHold(b, copies);
    });

    test("taken out of the board's map, it takes the household's root with it", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:1", "fo-household:1"]);
      await write(b.process, "fo-board:1", [{ op: "remove", path: "/households/1" }]);
      await expectTold(b, "fo-board:1", [[{ op: "remove", path: "/households/1" }]]);
      await expectTold(b, "fo-household:1", [[{ op: "replace", path: "/households", value: null }]]);
      await assertCopiesHold(b, copies);
    });

    test("removed through its own document, a course goes with the drinks it holds: the board and the menu are told they left, the document its root is null; it is then not found, as any missing root", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-course:1", "fo-board:1", "fo-menu:1", "fo-all-courses:"]);
      const code = async (ops: unknown[]) => (await b.process.call("delta", { doc: "fo-course:1", ops })).error?.code;
      expect(await code([{ op: "remove", path: "/courses/2" }])).toBe(404); // another course: not this document's
      const { ops } = await write(b.process, "fo-course:1", [{ op: "remove", path: "/courses/1" }]);
      expect(ops).toEqual([{ op: "remove", path: "/courses/1" }, { op: "remove", path: "/drinks/1" }]);
      await expectTold(b, "fo-course:1", [[{ op: "replace", path: "/courses", value: null }, { op: "remove", path: "/drinks/1" }]]);
      await expectTold(b, "fo-board:1", [ops]);
      await expectTold(b, "fo-menu:1", [ops]);
      await expectTold(b, "fo-all-courses:", [[{ op: "remove", path: "/courses/1" }]]);
      expect((await b.process.call("open", { doc: "fo-course:1" })).error?.code).toBe(404);
      expect(await code([{ op: "replace", path: "/courses/name", value: "Broth" }])).toBe(404);
      await assertCopiesHold(b, copies);
    });

    test("a household's root written and removed in one write through its own document is told as written, the field first; removed first, the field is not found", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-household:1", "fo-household:2", "fo-board:1"]);
      expect((await b.process.call("delta", { doc: "fo-household:2", ops: [
        { op: "remove", path: "/households/2" },
        { op: "replace", path: "/households/email", value: "late@x" },
      ] })).error?.code).toBe(404);
      const { ops } = await write(b.process, "fo-household:1", [
        { op: "replace", path: "/households/email", value: "gone@x" },
        { op: "remove", path: "/households/1" },
      ]);
      // its favour, which cascades on it, goes with it -- from the tables; its writer is answered the household alone, which holds no favours
      expect(ops).toEqual([{ op: "replace", path: "/households", value: household(1, "gone@x") }, { op: "remove", path: "/households/1" }]);
      expect((await b.exportTables()).tables.favours ?? []).toEqual([]);
      await expectTold(b, "fo-household:1", [[field("/households/email", "gone@x"), { op: "replace", path: "/households", value: null }]]);
      await expectTold(b, "fo-board:1", [[field("/households/1/email", "gone@x"), { op: "remove", path: "/households/1" }]]);
      await expectSilent(b, "fo-household:2");
      await assertCopiesHold(b, copies);
    });

    test("a single document's root named by its id is its root: replace /courses/1 and /courses/01/name write it and are told as /courses; another id is not found (404); undone, it goes back", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-course:1", "fo-board:1", "fo-menu:1", "fo-title:1", "fo-all-courses:"]);
      const code = async (doc: string, ops: unknown[]) => (await b.process.call("delta", { doc, ops })).error?.code;
      expect(await code("fo-course:1", [{ op: "replace", path: "/courses/2", value: { name: "x" } }])).toBe(404); // another course: not this document's
      expect(await code("fo-course:1", [{ op: "replace", path: "/courses/2/name", value: "x" }])).toBe(404);
      expect(await code("fo-course:1", [{ op: "replace", path: "/courses/1", value: { nope: 1 } }])).toBe(400);
      expect(await code("fo-course:1", [{ op: "replace", path: "/courses/1", value: 5 }])).toBe(400);
      expect(await code("fo-course:1", [{ op: "replace", path: "/courses/1/nope", value: "x" }])).toBe(400);
      expect(await code("fo-course:1", [{ op: "replace", path: "/courses/1/id", value: 9 }])).toBe(400);
      expect(await code("fo-course:1", [{ op: "replace", path: "/courses/9007199254740993", value: { name: "x" } }])).toBe(400);
      const { ops } = await write(b.process, "fo-course:1", [
        { op: "replace", path: "/courses/1", value: { id: 9, name: "Bisque" } },
        { op: "replace", path: "/courses/01/name", value: "Broth" },
      ], { cursor: "s1" });
      expect(ops).toEqual([{ op: "replace", path: "/courses", value: course(1, "Broth") }]); // one straight after the other: one run
      const titled = await write(b.process, "fo-board:1", [{ op: "replace", path: "/weddings/1/name", value: "our day" }]);
      expect(titled.ops).toEqual([{ op: "replace", path: "/weddings", value: { id: 1, name: "our day" } }]);
      const undone = await b.process.call("undo", { cursor: "s1" });
      expect({ ops: undone.result.ops, conflict: undone.result.conflict }).toEqual({ ops: [{ op: "replace", path: "/courses", value: course(1, "Soup") }], conflict: undefined });
      const renamed = (name: string) => field("/courses/1/name", name);
      const titledTold = [field("/weddings/name", "our day")];
      await expectTold(b, "fo-menu:1", [[renamed("Broth")], titledTold, [renamed("Soup")]]);
      await expectTold(b, "fo-all-courses:", [[renamed("Broth")], [renamed("Soup")]]);
      await expectTold(b, "fo-title:1", [titledTold]);
      await assertCopiesHold(b, copies);
    });

    test("one write to two households: each household's document is told of its own row alone, once", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:1", "fo-household:1", "fo-household:2"]);
      await write(b.process, "fo-board:1", [
        { op: "replace", path: "/households/1/email", value: "one@x" },
        { op: "replace", path: "/households/2/email", value: "two@x" },
      ]);
      await expectTold(b, "fo-household:1", [[field("/households/email", "one@x")]]);
      await expectTold(b, "fo-household:2", [[field("/households/email", "two@x")]]);
      await assertCopiesHold(b, copies);
    });
  });

  describe("a root two documents share", () => {
    test("the wedding renamed through the board reaches the menu and the title, each as the field of its root", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:1", "fo-menu:1", "fo-title:1"]);
      await write(b.process, "fo-board:1", [{ op: "replace", path: "/weddings/name", value: "our day" }]);
      await expectTold(b, "fo-menu:1", [[field("/weddings/name", "our day")]]);
      await expectTold(b, "fo-title:1", [[field("/weddings/name", "our day")]]);
      await assertCopiesHold(b, copies);
    });
  });

  describe("a collection with no parent: every document that includes it holds all of it", () => {
    test("a tag added through one wedding's board reaches the other wedding's board, and every tagged document", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:1", "fo-board:2", "fo-tagged:1", "fo-tagged:2"]);
      await write(b.process, "fo-board:1", [{ op: "add", path: "/tags/10", value: { label: "blue" } }]);
      for (const doc of ["fo-board:2", "fo-tagged:1", "fo-tagged:2"]) {
        await expectTold(b, doc, [[{ op: "add", path: "/tags/10", value: { id: 10, label: "blue" } }]]);
      }
      await assertCopiesHold(b, copies);
    });
  });

  describe("an included collection whose parent the document does not include", () => {
    test("the wedding's drinks, their courses left out, are held through the courses they hang from: opened, written, told and read as they stood", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-drinks:1", "fo-drinks:2", "fo-board:1"]);
      expect(content(copies.get("fo-drinks:1"))).toEqual({ weddings: { id: 1, name: "ours" }, drinks: { "1": drink(1, 1, "Sherry") } });
      // a drink of another wedding's course is not this document's to add
      expect((await b.process.call("delta", { doc: "fo-drinks:1", ops: [{ op: "add", path: "/drinks/11", value: { courses_id: 2, name: "Gin" } }] })).error?.code).toBe(404);
      const added = await write(b.process, "fo-drinks:1", [{ op: "add", path: "/drinks/10", value: { courses_id: 1, name: "Port" } }]);
      expect(added.ops).toEqual([{ op: "add", path: "/drinks/10", value: drink(10, 1, "Port") }]);
      await write(b.process, "fo-board:1", [{ op: "replace", path: "/drinks/1/name", value: "Madeira" }]);
      await expectTold(b, "fo-drinks:1", [added.ops, [field("/drinks/1/name", "Madeira")]]);
      await expectTold(b, "fo-board:1", [added.ops, [field("/drinks/1/name", "Madeira")]]);
      await expectSilent(b, "fo-drinks:2");
      const then = await b.process.call("open_at", { doc: "fo-drinks:1", at: new Date().toISOString() });
      expect(content(then.result).drinks).toEqual({ "1": drink(1, 1, "Madeira"), "10": drink(10, 1, "Port") });
      await assertCopiesHold(b, copies);
    });

    test("a course's households, which hang from the wedding it does not include, are none of its: not read, not written, not told", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-course-guests:1", "fo-board:1"]);
      expect(content(copies.get("fo-course-guests:1"))).toEqual({ courses: course(1, "Soup"), households: {} });
      const code = async (ops: unknown[]) => (await b.process.call("delta", { doc: "fo-course-guests:1", ops })).error?.code;
      expect(await code([{ op: "replace", path: "/households/1/email", value: "x@x" }])).toBe(404);
      expect(await code([{ op: "remove", path: "/households/1" }])).toBe(404);
      expect(await code([{ op: "add", path: "/households/10", value: { weddings_id: 1, email: "n@x" } }])).toBe(404);
      await write(b.process, "fo-board:1", [{ op: "replace", path: "/households/1/email", value: "new@x" }]);
      await expectSilent(b, "fo-course-guests:1");
      const then = await b.process.call("open_at", { doc: "fo-course-guests:1", at: new Date().toISOString() });
      expect(content(then.result).households).toEqual({});
      await assertCopiesHold(b, copies);
    });
  });

  describe("who is not told", () => {
    test("the writer's own document hears its write once, not again by fan-out", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:1", "fo-menu:1"]);
      await write(b.process, "fo-board:1", [{ op: "replace", path: "/courses/1/name", value: "Broth" }]);
      await expectTold(b, "fo-board:1", [[field("/courses/1/name", "Broth")]]);
      await assertCopiesHold(b, copies);
    });

    test("documents over another wedding hear nothing of this one's writes", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:1", "fo-board:2", "fo-menu:2", "fo-household:3", "fo-course:2", "fo-title:2", "fo-notes:2"]);
      await write(b.process, "fo-board:1", [
        { op: "replace", path: "/courses/1/name", value: "Broth" },
        { op: "add", path: "/drinks/10", value: { courses_id: 1, name: "Port" } },
        { op: "replace", path: "/households/1/email", value: "z@x" },
        { op: "replace", path: "/weddings/name", value: "ours, renamed" },
        { op: "replace", path: "/notes/1/text", value: "bring lights" },
      ]);
      await expectSilent(b, "fo-board:2", "fo-menu:2", "fo-household:3", "fo-course:2", "fo-title:2", "fo-notes:2");
      await assertCopiesHold(b, copies);
    });

    test("a document that does not include the collection hears nothing of it", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:1", "fo-title:1", "fo-tagged:1"]);
      await write(b.process, "fo-board:1", [{ op: "replace", path: "/courses/1/name", value: "Broth" }]);
      await expectSilent(b, "fo-title:1", "fo-tagged:1");
      await assertCopiesHold(b, copies);
    });

    test("a document closed before the write is not told, and opened afresh it reads the write", async () => {
      const b = backend();
      await openAll(b.process, ["fo-board:1", "fo-menu:1"]);
      await b.process.call("close", { doc: "fo-menu:1" });
      await write(b.process, "fo-board:1", [{ op: "replace", path: "/courses/1/name", value: "Broth" }]);
      await expectSilent(b, "fo-menu:1");
      expect((await b.process.call("open", { doc: "fo-menu:1" })).result.courses["1"]).toEqual(course(1, "Broth"));
    });
  });

  describe("a row that moves from one document's scope to another's", () => {
    test("a scoped list adds a child only under a root it holds: a drink under the other course, or under none, is refused (404) and nobody is told; under its own it goes", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-menu-like:So", "fo-catalog:"]);
      const code = async (fk: number) => (await b.process.call("delta", { doc: "fo-menu-like:So", ops: [{ op: "add", path: "/drinks/-", value: { courses_id: fk, name: "graft" } }] })).error?.code;
      expect(await code(2)).toBe(404);   // Salad: not the list's
      expect(await code(999)).toBe(404);   // no course
      await expectSilent(b, "fo-menu-like:So", "fo-catalog:");
      const { ops } = await write(b.process, "fo-menu-like:So", [{ op: "add", path: "/drinks/9", value: { courses_id: 1, name: "Port" } }]);
      expect(ops).toEqual([{ op: "add", path: "/drinks/9", value: drink(9, 1, "Port") }]);
      await assertCopiesHold(b, copies);
    });

    test("a row moved through a document to a parent it does not hold is refused (404), as an add there is -- a household to the other wedding, a drink to its course -- and nobody is told", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:1", "fo-board:2", "fo-menu:1", "fo-drinks:1", "fo-household:1", "fo-course:2"]);
      const code = async (doc: string, ops: unknown[]) => (await b.process.call("delta", { doc, ops })).error?.code;
      expect(await code("fo-board:1", [{ op: "replace", path: "/households/1/weddings_id", value: 2 }])).toBe(404);
      expect(await code("fo-board:1", [{ op: "replace", path: "/households/1", value: { weddings_id: 2, email: "a@x" } }])).toBe(404);
      expect(await code("fo-board:1", [{ op: "replace", path: "/drinks/1/courses_id", value: 2 }])).toBe(404);
      expect(await code("fo-board:1", [{ op: "replace", path: "/drinks/1", value: { courses_id: 2, name: "Gin" } }])).toBe(404);
      expect(await code("fo-menu:1", [{ op: "replace", path: "/drinks/1/courses_id", value: 2 }])).toBe(404);
      expect(await code("fo-drinks:1", [{ op: "replace", path: "/drinks/1/courses_id", value: 2 }])).toBe(404);   // its courses left out: their chain, from the tables
      expect(await code("fo-board:1", [{ op: "replace", path: "/drinks/1/courses_id", value: 99 }])).toBe(404);   // no such course
      await expectSilent(b, "fo-board:1", "fo-board:2", "fo-menu:1", "fo-drinks:1", "fo-household:1", "fo-course:2");
      await assertCopiesHold(b, copies);
    });

    test("a list's root row written through the list stays in its scope: a field, a row or a merge that takes it out -- a slot to another wedding's list, a course out of a name's -- is refused (404), the write undone, and nobody is told", async () => {
      const b = backend();
      await b.process.call("open", { doc: "fo-slots-of:1" });
      expect((await write(b.process, "fo-slots-of:1", [{ op: "add", path: "/slots/-", value: { price: 1 } }])).ops[0].value.weddings_id).toBe(1);
      await b.quiet();
      const copies = await openAll(b.process, ["fo-slots-of:1", "fo-slots-of:2", "fo-slots-upto:5", "fo-courses-like:So", "fo-courses-like:Fi", "fo-board:1"]);
      const code = async (doc: string, ops: unknown[]) => (await b.process.call("delta", { doc, ops })).error?.code;
      expect(await code("fo-slots-of:1", [{ op: "replace", path: "/slots/1/weddings_id", value: 2 }])).toBe(404);
      expect(await code("fo-slots-of:1", [{ op: "replace", path: "/slots/1", value: { weddings_id: 2 } }])).toBe(404);
      expect(await code("fo-slots-of:1", [{ op: "replace", path: "/slots/1/price", value: 3 }, { op: "replace", path: "/slots/1/weddings_id", value: 2 }])).toBe(404);   // a run: its first write undone too
      expect(await code("fo-slots-of:1", [{ op: "replace", path: "/slots/1/weddings_id", value: 2 }, { op: "replace", path: "/slots/1/weddings_id", value: 1 }])).toBe(404);   // out and back: out is out
      expect(await code("fo-slots-upto:5", [{ op: "replace", path: "/slots/1/price", value: 9 }])).toBe(404);
      expect(await code("fo-courses-like:So", [{ op: "replace", path: "/courses/1/name", value: "Fish soup" }])).toBe(404);
      await expectSilent(b, "fo-slots-of:1", "fo-slots-of:2", "fo-slots-upto:5", "fo-courses-like:So", "fo-courses-like:Fi", "fo-board:1");
      expect(content((await b.process.call("open", { doc: "fo-slots-of:1" })).result).slots).toEqual({ "1": { id: 1, weddings_id: 1, price: 1, starts: null } });
      // one that stays in the scope is written
      await write(b.process, "fo-slots-of:1", [{ op: "replace", path: "/slots/1", value: { weddings_id: 1, price: 2 } }]);
      await write(b.process, "fo-courses-like:So", [{ op: "replace", path: "/courses/1/name", value: "Soup of the day" }]);
      await assertCopiesHold(b, copies);
    });

    test("a single document's root written through it stays in its scope, as a list's rows do: a field, the root, the row by its id or a run that takes it out of its own name's condition -- a seat to another table's list -- is refused (404), the write undone, and nobody is told (0.10.0 review)", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-seat-of:1:3", "fo-seats-at:3", "fo-seats-at:7", "fo-seating:1"]);
      const code = async (ops: unknown[]) => (await b.process.call("delta", { doc: "fo-seat-of:1:3", ops })).error?.code;
      expect(await code([{ op: "replace", path: "/seats/table_no", value: 7 }])).toBe(404);
      expect(await code([{ op: "replace", path: "/seats", value: { table_no: 7, kept: true } }])).toBe(404);
      expect(await code([{ op: "replace", path: "/seats/1", value: { table_no: 7, kept: true } }])).toBe(404);
      expect(await code([{ op: "replace", path: "/seats/1/table_no", value: 7 }])).toBe(404);
      expect(await code([{ op: "replace", path: "/seats/kept", value: false }, { op: "replace", path: "/seats/table_no", value: 7 }])).toBe(404);   // a run: its first write undone too
      await expectSilent(b, "fo-seat-of:1:3", "fo-seats-at:3", "fo-seats-at:7", "fo-seating:1");
      expect(content((await b.process.call("open", { doc: "fo-seat-of:1:3" })).result)).toEqual({ seats: seat(1, 3, true, { veg: true }) });
      await write(b.process, "fo-seat-of:1:3", [{ op: "replace", path: "/seats/kept", value: false }]);   // within it
      await assertCopiesHold(b, copies);
    });

    test("an add through a document stays in its scope: a list's row that does not meet its condition -- a name not like it, a price past its bound -- or a single document's own root added back outside its name's, is refused (404), the write undone, and nobody is told", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-courses-like:So", "fo-all-courses:", "fo-board:1", "fo-board:2", "fo-slots-upto:5", "fo-slots-upto:", "fo-seat-of:1:3", "fo-seats-at:7"]);
      const code = async (doc: string, ops: unknown[]) => (await b.process.call("delta", { doc, ops })).error?.code;
      expect(await code("fo-courses-like:So", [{ op: "add", path: "/courses/-", value: { weddings_id: 2, name: "Zzz" } }])).toBe(404);
      expect(await code("fo-courses-like:So", [{ op: "add", path: "/courses/9", value: { weddings_id: 1, name: "Fish" } }])).toBe(404);
      expect(await code("fo-slots-upto:5", [{ op: "add", path: "/slots/-", value: { weddings_id: 1, price: 9 } }])).toBe(404);
      expect(await code("fo-seat-of:1:3", [{ op: "remove", path: "/seats/1" }, { op: "add", path: "/seats/1", value: { weddings_id: 1, table_no: 7, kept: true } }])).toBe(404);
      await expectSilent(b, "fo-courses-like:So", "fo-all-courses:", "fo-board:1", "fo-board:2", "fo-slots-upto:5", "fo-slots-upto:", "fo-seat-of:1:3", "fo-seats-at:7");
      // within it, each is written
      expect((await write(b.process, "fo-courses-like:So", [{ op: "add", path: "/courses/-", value: { weddings_id: 1, name: "Sole" } }])).ops.map((o: any) => o.value.name)).toEqual(["Sole"]);   // its id: a Postgres sequence keeps what a refused add took
      await write(b.process, "fo-slots-upto:5", [{ op: "add", path: "/slots/-", value: { weddings_id: 1, price: 4 } }]);
      await write(b.process, "fo-seat-of:1:3", [{ op: "remove", path: "/seats/1" }, { op: "add", path: "/seats/1", value: { weddings_id: 1, table_no: 3, kept: false } }]);
      await assertCopiesHold(b, copies);
    });

    test("a course moved to the other wedding through a list, which holds every course, leaves this board and arrives on that one", async () => {
      const b = backend();
      await b.process.call("open", { doc: "fo-board:1" });
      await write(b.process, "fo-board:1", [{ op: "add", path: "/courses/10", value: { name: "Fish" } }]);
      await b.quiet();
      const copies = await openAll(b.process, ["fo-all-courses:", "fo-board:1", "fo-board:2", "fo-course:10"]);
      await write(b.process, "fo-all-courses:", [{ op: "replace", path: "/courses/10/weddings_id", value: 2 }]);
      await expectTold(b, "fo-board:1", [[{ op: "remove", path: "/courses/10" }]]);
      await expectTold(b, "fo-board:2", [[{ op: "add", path: "/courses/10", value: course(10, "Fish", 2) }]]);
      await expectTold(b, "fo-course:10", [[field("/courses/weddings_id", 2)]]);
      await assertCopiesHold(b, copies);
    });

    test("a course moved to the other wedding takes its drink, the wedding's grandchild, with it: the documents it leaves are told the drink left, those it arrives in that it arrived, course first; those that hold the drink either way are told nothing of it", async () => {
      const b = backend();
      const docs = ["fo-board:1", "fo-board:2", "fo-menu:1", "fo-menu:2", "fo-drinks:1", "fo-drinks:2", "fo-course:1", "fo-catalog:", "fo-all-courses:"];
      const copies = await openAll(b.process, docs);
      await write(b.process, "fo-all-courses:", [{ op: "replace", path: "/courses/1/weddings_id", value: 2 }]);
      const moved = course(1, "Soup", 2);
      const left = [{ op: "remove", path: "/courses/1" }, { op: "remove", path: "/drinks/1" }];
      const arrived = [{ op: "add", path: "/courses/1", value: moved }, { op: "add", path: "/drinks/1", value: drink(1, 1, "Sherry") }];
      for (const doc of ["fo-board:1", "fo-menu:1"]) await expectTold(b, doc, [left]);
      for (const doc of ["fo-board:2", "fo-menu:2"]) await expectTold(b, doc, [arrived]);
      await expectTold(b, "fo-drinks:1", [[left[1]]]);
      await expectTold(b, "fo-drinks:2", [[arrived[1]]]);
      await expectTold(b, "fo-course:1", [[field("/courses/weddings_id", 2)]]);
      for (const doc of ["fo-catalog:", "fo-all-courses:"]) await expectTold(b, doc, [[field("/courses/1/weddings_id", 2)]]);
      await assertCopiesHold(b, copies);
    });

    test("a course moved out and back in one write, its drink renamed between, is told each step: the other wedding's board hears the drink arrive, renamed and leave, never a remove of a drink it was not told", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:1", "fo-board:2", "fo-course:1", "fo-catalog:"]);
      const { ops } = await write(b.process, "fo-catalog:", [
        { op: "replace", path: "/courses/1/weddings_id", value: 2 },
        { op: "replace", path: "/drinks/1/name", value: "Port" },
        { op: "replace", path: "/courses/1/weddings_id", value: 1 },
      ]);
      const away = { op: "replace", path: "/courses/1", value: course(1, "Soup", 2) };
      const port = { op: "replace", path: "/drinks/1", value: drink(1, 1, "Port") };
      const home = { op: "replace", path: "/courses/1", value: course(1, "Soup") };
      expect(ops).toEqual([away, port, home]);
      const named = field("/drinks/1/name", "Port");
      await expectTold(b, "fo-catalog:", [[field("/courses/1/weddings_id", 2), named, field("/courses/1/weddings_id", 1)]]);
      await expectTold(b, "fo-board:2", [[
        { op: "add", path: "/courses/1", value: away.value }, { op: "add", path: "/drinks/1", value: drink(1, 1, "Sherry") },
        named, { op: "remove", path: "/courses/1" }, { op: "remove", path: "/drinks/1" },
      ]]);
      await expectTold(b, "fo-board:1", [[
        { op: "remove", path: "/courses/1" }, { op: "remove", path: "/drinks/1" },
        { op: "add", path: "/courses/1", value: home.value }, { op: "add", path: "/drinks/1", value: port.value },
      ]]);
      await expectTold(b, "fo-course:1", [[field("/courses/weddings_id", 2), named, field("/courses/weddings_id", 1)]]);
      await assertCopiesHold(b, copies);
    });

    test("a course moved and renamed in one run of replaces is told once, as the run leaves it, and carries its drink as it is", async () => {
      const b = backend();
      const docs = ["fo-board:1", "fo-board:2", "fo-drinks:1", "fo-drinks:2", "fo-catalog:"];
      const copies = await openAll(b.process, docs);
      await write(b.process, "fo-catalog:", [
        { op: "replace", path: "/courses/1/weddings_id", value: 2 },
        { op: "replace", path: "/courses/1/name", value: "Broth" },
      ]);
      const moved = course(1, "Broth", 2);
      await expectTold(b, "fo-catalog:", [[field("/courses/1/name", "Broth"), field("/courses/1/weddings_id", 2)]]);
      await expectTold(b, "fo-board:1", [[{ op: "remove", path: "/courses/1" }, { op: "remove", path: "/drinks/1" }]]);
      await expectTold(b, "fo-board:2", [[{ op: "add", path: "/courses/1", value: moved }, { op: "add", path: "/drinks/1", value: drink(1, 1, "Sherry") }]]);
      await expectTold(b, "fo-drinks:2", [[{ op: "add", path: "/drinks/1", value: drink(1, 1, "Sherry") }]]);
      await assertCopiesHold(b, copies);
    });

    test("a course moved and moved back in one run of replaces goes nowhere: no document but the writer's hears anything, for nothing changed (#69)", async () => {
      const b = backend();
      const docs = ["fo-board:1", "fo-board:2", "fo-drinks:1", "fo-drinks:2", "fo-catalog:"];
      const copies = await openAll(b.process, docs);
      await write(b.process, "fo-catalog:", [
        { op: "replace", path: "/courses/1/weddings_id", value: 2 },
        { op: "replace", path: "/courses/1/weddings_id", value: 1 },
      ]);
      await expectSilent(b, "fo-board:1", "fo-board:2", "fo-drinks:1", "fo-drinks:2");
      await assertCopiesHold(b, copies);
    });

    test("a single document's root is not moved through it to a parent it does not hold -- a field, the root merged, or the row by its id -- (404, the write undone, nobody told), as its other rows are not; written as it is, it is no move (0.10.0 review)", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-household:1", "fo-board:1", "fo-board:2", "fo-course:1", "fo-all-households:"]);
      const code = async (doc: string, ops: unknown[]) => (await b.process.call("delta", { doc, ops })).error?.code;
      expect(await code("fo-household:1", [{ op: "replace", path: "/households/weddings_id", value: 2 }])).toBe(404);
      expect(await code("fo-household:1", [{ op: "replace", path: "/households", value: { weddings_id: 2, email: "a@x" } }])).toBe(404);
      expect(await code("fo-household:1", [{ op: "replace", path: "/households/1/weddings_id", value: 2 }])).toBe(404);
      expect(await code("fo-household:1", [{ op: "replace", path: "/households/1", value: { weddings_id: 2, email: "a@x" } }])).toBe(404);
      expect(await code("fo-household:1", [{ op: "replace", path: "/households/email", value: "x@x" }, { op: "replace", path: "/households/weddings_id", value: 2 }])).toBe(404);   // a run: its first write undone too
      expect(await code("fo-course:1", [{ op: "replace", path: "/courses/weddings_id", value: 2 }])).toBe(404);
      expect(await code("fo-household:1", [{ op: "remove", path: "/households/1" }, { op: "add", path: "/households/1", value: { weddings_id: 2, email: "a@x" } }])).toBe(404);   // taken out and added back elsewhere
      await expectSilent(b, "fo-household:1", "fo-board:1", "fo-board:2", "fo-course:1", "fo-all-households:");
      await write(b.process, "fo-household:1", [{ op: "replace", path: "/households", value: { weddings_id: 1, email: "a2@x" } }]);   // its own parent, as it is: no move
      await assertCopiesHold(b, copies);
    });

    test("a household moved through a list that holds both weddings' households leaves this board and arrives on that one; its own document is told it moved", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-household:1", "fo-board:1", "fo-board:2", "fo-all-households:"]);
      await write(b.process, "fo-all-households:", [{ op: "replace", path: "/households/1/weddings_id", value: 2 }]);
      await expectTold(b, "fo-household:1", [[field("/households/weddings_id", 2)]]);
      await expectTold(b, "fo-board:1", [[{ op: "remove", path: "/households/1" }]]);
      await expectTold(b, "fo-board:2", [[{ op: "add", path: "/households/1", value: household(1, "a@x", 2) }]]);
      await assertCopiesHold(b, copies);
    });

    test("a drink moved to another course leaves the one course's document and arrives in the other's", async () => {
      const b = backend();
      await b.process.call("open", { doc: "fo-board:1" });
      await write(b.process, "fo-board:1", [{ op: "add", path: "/courses/10", value: { name: "Fish" } }]);
      await b.quiet();
      const copies = await openAll(b.process, ["fo-board:1", "fo-course:1", "fo-course:10"]);
      await write(b.process, "fo-board:1", [{ op: "replace", path: "/drinks/1/courses_id", value: 10 }]);
      await expectTold(b, "fo-course:1", [[{ op: "remove", path: "/drinks/1" }]]);
      await expectTold(b, "fo-course:10", [[{ op: "add", path: "/drinks/1", value: drink(1, 10, "Sherry") }]]);
      await assertCopiesHold(b, copies);
    });

    test("a course renamed out of one list's condition and into another's leaves the one and arrives in the other", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:1", "fo-courses-like:So", "fo-courses-like:Fi", "fo-all-courses:"]);
      await write(b.process, "fo-board:1", [{ op: "replace", path: "/courses/1/name", value: "Fish soup" }]);
      await expectTold(b, "fo-courses-like:So", [[{ op: "remove", path: "/courses/1" }]]);
      await expectTold(b, "fo-courses-like:Fi", [[{ op: "add", path: "/courses/1", value: course(1, "Fish soup") }]]);
      await expectTold(b, "fo-all-courses:", [[field("/courses/1/name", "Fish soup")]]);
      await assertCopiesHold(b, copies);
    });

    test("a course added through the board reaches every-course and the list it meets the condition of, not the others", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:1", "fo-all-courses:", "fo-courses-like:Fi", "fo-courses-like:So"]);
      await write(b.process, "fo-board:1", [{ op: "add", path: "/courses/10", value: { name: "Fish" } }]);
      await expectTold(b, "fo-all-courses:", [[{ op: "add", path: "/courses/10", value: course(10, "Fish") }]]);
      await expectTold(b, "fo-courses-like:Fi", [[{ op: "add", path: "/courses/10", value: course(10, "Fish") }]]);
      await expectSilent(b, "fo-courses-like:So");
      await assertCopiesHold(b, copies);
    });

    test("a course removed through the board leaves every-course", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:1", "fo-all-courses:"]);
      await write(b.process, "fo-board:1", [{ op: "remove", path: "/courses/1" }]);
      await expectTold(b, "fo-all-courses:", [[{ op: "remove", path: "/courses/1" }]]);
      await assertCopiesHold(b, copies);
    });
  });

  describe("a scoped list holds what hangs under the roots it admits (#137)", () => {
    test("opened, a scoped list holds its roots and the rows under them, never a row under a root it does not admit; a list with no condition holds them all", async () => {
      const b = backend();
      const so = (await b.process.call("open", { doc: "fo-menu-like:So" })).result;
      expect(content(so)).toEqual({ courses: { "1": course(1, "Soup") }, drinks: { "1": drink(1, 1, "Sherry") } });
      const sa = (await b.process.call("open", { doc: "fo-menu-like:Sa" })).result;
      expect(content(sa)).toEqual({ courses: { "2": course(2, "Salad", 2) }, drinks: { "2": drink(2, 2, "Water") } });
      expect(Object.keys((await b.process.call("open", { doc: "fo-catalog:" })).result.drinks)).toEqual(["1", "2"]);
    });

    test("a write under a root a scoped list does not admit is not told to it; under one it admits, it is", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-menu-like:So", "fo-menu-like:Sa", "fo-catalog:"]);
      await write(b.process, "fo-catalog:", [{ op: "add", path: "/drinks/9", value: { courses_id: 2, name: "Lemonade" } }]);
      await write(b.process, "fo-board:1", [{ op: "replace", path: "/drinks/1/name", value: "Port" }]);
      await write(b.process, "fo-catalog:", [{ op: "remove", path: "/drinks/2" }]);
      await expectTold(b, "fo-menu-like:So", [[field("/drinks/1/name", "Port")]]);
      await expectTold(b, "fo-menu-like:Sa", [[{ op: "add", path: "/drinks/9", value: drink(9, 2, "Lemonade") }], [{ op: "remove", path: "/drinks/2" }]]);
      await assertCopiesHold(b, copies);
    });

    test("a root renamed into a scoped list's condition brings the rows under it, course first; renamed out, it takes them away; a list that holds it either way is told the field", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-menu-like:So", "fo-menu-like:Fi", "fo-catalog:", "fo-board:1"]);
      await write(b.process, "fo-board:1", [{ op: "replace", path: "/courses/1/name", value: "Fish soup" }]);
      await expectTold(b, "fo-menu-like:So", [[{ op: "remove", path: "/courses/1" }, { op: "remove", path: "/drinks/1" }]]);
      await expectTold(b, "fo-menu-like:Fi", [[{ op: "add", path: "/courses/1", value: course(1, "Fish soup") }, { op: "add", path: "/drinks/1", value: drink(1, 1, "Sherry") }]]);
      await expectTold(b, "fo-catalog:", [[field("/courses/1/name", "Fish soup")]]);
      await assertCopiesHold(b, copies);
    });

    test("a scoped list writes only what it holds: a row under a root it does not admit is not there (404), and nobody is told", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-menu-like:So", "fo-menu-like:Sa", "fo-catalog:"]);
      const code = async (ops: unknown[]) => (await b.process.call("delta", { doc: "fo-menu-like:So", ops })).error?.code;
      expect(await code([{ op: "replace", path: "/drinks/2/name", value: "Gin" }])).toBe(404);
      expect(await code([{ op: "replace", path: "/drinks/2", value: { courses_id: 1, name: "Gin" } }])).toBe(404);
      expect(await code([{ op: "remove", path: "/drinks/2" }])).toBe(404);
      await expectSilent(b, "fo-menu-like:So", "fo-menu-like:Sa", "fo-catalog:");
      await assertCopiesHold(b, copies);
    });
  });
}
