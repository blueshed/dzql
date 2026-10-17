/**
 * An implied document: open before its root row is made, and made by its
 * first write. Part of `pathCases`.
 */
import { describe, expect, test } from "bun:test";
import { course, drink, field } from "./fixture";
import { type PathBackend, content, openAll, assertCopiesHold, write, expectTold } from "./law";

/** An implied document, opened empty and made by its first write. */
export function impliedCases(backend: () => PathBackend): void {
  describe("an implied document", () => {
    test("it opens before its root row is, empty, and makes no row; a first write that fails makes none; the first that lands makes the row, and is told as written", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-plan:7", "fo-plan:8", "fo-all-courses:"]);
      expect(content(copies.get("fo-plan:7"))).toEqual({ weddings: { id: 7, name: "" }, courses: {}, drinks: {} });
      expect((await b.process.call("open", { doc: "fo-title:7" })).error?.code).toBe(404);   // no row made
      expect((await b.process.call("delta", { doc: "fo-plan:7", ops: [{ op: "add", path: "/courses/10", value: {} }] })).error?.code).toBe(400);
      expect((await b.process.call("open", { doc: "fo-title:7" })).error?.code).toBe(404);   // a failed first write makes none
      const added = await write(b.process, "fo-plan:7", [{ op: "add", path: "/courses/10", value: { name: "Soup" } }]);
      expect(added.ops).toEqual([{ op: "add", path: "/courses/10", value: course(10, "Soup", 7) }]);
      const named = await write(b.process, "fo-plan:8", [{ op: "replace", path: "/weddings/name", value: "the other" }]);
      expect(named.ops).toEqual([{ op: "replace", path: "/weddings", value: { id: 8, name: "the other" } }]);
      await expectTold(b, "fo-plan:7", [added.ops]);
      await expectTold(b, "fo-plan:8", [[field("/weddings/name", "the other")]]);
      await expectTold(b, "fo-all-courses:", [added.ops]);
      expect(content((await b.process.call("open", { doc: "fo-title:7" })).result)).toEqual({ weddings: { id: 7, name: "" } });
      await assertCopiesHold(b, copies);
    });

    test("the root its first write makes arrives in a list of those roots, before what the write put under it; the implied documents, which showed it, are told the write as written (the cafe's kitchen)", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-plan:7", "fo-plan:8", "fo-weddings:"]);
      const added = await write(b.process, "fo-plan:7", [{ op: "add", path: "/courses/10", value: { name: "Soup" } }]);
      const named = await write(b.process, "fo-plan:8", [{ op: "replace", path: "/weddings/name", value: "the other" }]);
      expect(named.ops).toEqual([{ op: "replace", path: "/weddings", value: { id: 8, name: "the other" } }]);
      await expectTold(b, "fo-plan:7", [added.ops]);
      await expectTold(b, "fo-plan:8", [[field("/weddings/name", "the other")]]);
      await expectTold(b, "fo-weddings:", [
        [{ op: "add", path: "/weddings/7", value: { id: 7, name: "" } }, ...added.ops],
        [{ op: "add", path: "/weddings/8", value: { id: 8, name: "" } }, field("/weddings/8/name", "the other")],
      ]);
      await write(b.process, "fo-weddings:", [{ op: "replace", path: "/weddings/7/name", value: "ours too" }]);   // the list's copy holds it to write
      await assertCopiesHold(b, copies);
    });

    test("its root removed through it, the row and the rows under it go and it opens empty again: a copy is told that empty root; undone, they come back, root first", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-plan:7", "fo-all-courses:"]);
      const added = await write(b.process, "fo-plan:7", [
        { op: "add", path: "/courses/10", value: { name: "Soup" } },
        { op: "add", path: "/drinks/10", value: { courses_id: 10, name: "Sherry" } },
      ], { cursor: "s1" });
      const removed = await write(b.process, "fo-plan:7", [{ op: "remove", path: "/weddings/7" }], { cursor: "s1" });
      expect(removed.ops).toEqual([{ op: "remove", path: "/weddings/7" }, { op: "remove", path: "/courses/10" }, { op: "remove", path: "/drinks/10" }]);
      expect(content((await b.process.call("open", { doc: "fo-plan:7" })).result)).toEqual({ weddings: { id: 7, name: "" }, courses: {}, drinks: {} });
      const undone = await b.process.call("undo", { cursor: "s1" });
      expect({ ops: undone.result.ops, conflict: undone.result.conflict }).toEqual({ ops: [
        { op: "add", path: "/weddings/7", value: { id: 7, name: "" } },
        { op: "add", path: "/courses/10", value: course(10, "Soup", 7) },
        { op: "add", path: "/drinks/10", value: drink(10, 10, "Sherry") },
      ], conflict: undefined });
      await expectTold(b, "fo-plan:7", [
        added.ops,
        [{ op: "replace", path: "/weddings", value: { id: 7, name: "" } }, { op: "remove", path: "/courses/10" }, { op: "remove", path: "/drinks/10" }],
        [{ op: "replace", path: "/weddings", value: { id: 7, name: "" } }, { op: "add", path: "/courses/10", value: course(10, "Soup", 7) }, { op: "add", path: "/drinks/10", value: drink(10, 10, "Sherry") }],
      ]);
      await expectTold(b, "fo-all-courses:", [[added.ops[0]], [{ op: "remove", path: "/courses/10" }], [{ op: "add", path: "/courses/10", value: course(10, "Soup", 7) }]]);
      await assertCopiesHold(b, copies);
    });
    test("a course of the plan moved to another wedding through a list leaves it, its drink with it; undone, redone and undone again, the plan holds the law", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-plan:7", "fo-plan:8", "fo-all-courses:"]);
      await write(b.process, "fo-plan:7", [
        { op: "add", path: "/courses/10", value: { name: "Soup" } },
        { op: "add", path: "/drinks/10", value: { courses_id: 10, name: "Sherry" } },
      ]);
      await write(b.process, "fo-plan:8", [{ op: "replace", path: "/weddings/name", value: "the other" }]);
      await write(b.process, "fo-all-courses:", [{ op: "replace", path: "/courses/10/weddings_id", value: 8 }], { cursor: "s1" });
      for (const way of ["undo", "redo", "undo"]) expect((await b.process.call(way, { cursor: "s1" })).result.conflict).toBeUndefined();
      await expectTold(b, "fo-plan:8", [
        [field("/weddings/name", "the other")],
        [{ op: "add", path: "/courses/10", value: course(10, "Soup", 8) }, { op: "add", path: "/drinks/10", value: drink(10, 10, "Sherry") }],
        [{ op: "remove", path: "/courses/10" }, { op: "remove", path: "/drinks/10" }],
        [{ op: "add", path: "/courses/10", value: course(10, "Soup", 8) }, { op: "add", path: "/drinks/10", value: drink(10, 10, "Sherry") }],
        [{ op: "remove", path: "/courses/10" }, { op: "remove", path: "/drinks/10" }],
      ]);
      await assertCopiesHold(b, copies);
    });
  });
}
