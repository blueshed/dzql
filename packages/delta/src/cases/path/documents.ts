/**
 * A document opened and written, the columns one holds, the serial a write
 * names, and two registrations over the same rows. Part of `pathCases`.
 */
import { describe, expect, test } from "bun:test";
import { course, drink, household, field } from "./fixture";
import { type PathBackend, content, told, openAll, assertCopiesHold, write, expectTold, expectSilent } from "./law";

/** What a document is, read and written through, on its own. */
export function documentCases(backend: () => PathBackend): void {
  describe("a document, read and written", () => {
    test("a remove whose cascade reaches a row twice -- a favour, the wedding's child and its household's -- takes it, tells it and records it once, and the undo puts it back", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-party:1"]);
      const out = await write(b.process, "fo-party:1", [{ op: "remove", path: "/weddings/1" }], { cursor: "p1" });
      const favour = (ops: any[]) => ops.filter((o) => o.path === "/favours/1");
      expect({ ops: favour(out.ops), inverse: favour(out.inverse) }).toEqual({
        ops: [{ op: "remove", path: "/favours/1" }],
        inverse: [{ op: "add", path: "/favours/1", value: { id: 1, weddings_id: 1, households_id: 1, gift: "jam" } }],
      });
      await assertCopiesHold(b, copies);
      const undone = await b.process.call("undo", { cursor: "p1" });
      expect({ error: undone.error, conflict: undone.result?.conflict }).toEqual({ error: undefined, conflict: undefined });
      expect(content((await b.process.call("open", { doc: "fo-party:1" })).result).favours).toEqual({ "1": { id: 1, weddings_id: 1, households_id: 1, gift: "jam" } });
    });

    test("a table, a parent key and columns named as SQL's keywords are created, written, opened, told and carried", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-asks:1", "fo-asks-from:ann"]);
      const ask = { id: 1, group: 1, in: 2, from: "ann", to: "cy" };
      expect((await write(b.process, "fo-asks:1", [{ op: "add", path: "/asks/-", value: { in: 2, from: "ann", to: "bob" } }])).ops[0].path).toBe("/asks/1");
      await write(b.process, "fo-asks-from:ann", [{ op: "replace", path: "/asks/1/to", value: "cy" }]);
      const open = (doc: string) => b.process.call("open", { doc }).then((r) => content(r.result));
      expect((await open("fo-asks:1")).asks).toEqual({ "1": ask });
      expect(await open("fo-asks-from:ann")).toEqual({ asks: { "1": ask } });
      expect(content((await b.process.call("open_at", { doc: "fo-asks:1", at: "2999-01-01T00:00:00.000Z" })).result).asks).toEqual({ "1": ask });
      await write(b.process, "fo-asks:1", [{ op: "remove", path: "/asks/1" }]);
      await assertCopiesHold(b, copies);
      expect((await b.exportTables()).tables.asks!.map(({ valid_from, valid_to, ...row }) => row)).toEqual([{ ...ask, to: "bob" }, ask]);
    });

    test("opening the board reads the rows as Postgres gives them: ids as numbers, no validity columns", async () => {
      const { result } = await backend().process.call("open", { doc: "fo-board:1" });
      expect(content(result)).toEqual({
        weddings: { id: 1, name: "ours" },
        households: { "1": household(1, "a@x"), "2": household(2, "b@x") },
        courses: { "1": course(1, "Soup") },
        drinks: { "1": drink(1, 1, "Sherry") },
        tags: { "1": { id: 1, label: "red" } },
        notes: { "1": { id: 1, weddings_id: 1, text: "bring chairs" } },
      });
    });

    test("what a document answers is the caller's own: a write does not change it, and a change to it is not served -- the open's, the custom document's, a told row", async () => {
      const b = backend();
      const docs = ["fo-board:1", "fo-inbox:a@x"];
      const kept = new Map<string, any>();
      for (const doc of docs) kept.set(doc, (await b.process.call("open", { doc })).result);
      const was = structuredClone(kept);
      b.process.heard.length = 0;
      await write(b.process, "fo-board:1", [
        { op: "replace", path: "/courses/1/name", value: "Broth" },
        { op: "replace", path: "/households/1/email", value: "moved@x" },
        { op: "remove", path: "/households/2" },
        { op: "add", path: "/courses/-", value: { name: "Fish" } },
      ]);
      await b.quiet();
      expect(kept).toEqual(was);   // a write does not change what was handed out
      // a caller that changes what it was handed, or a row it was told, changes nothing it is served
      const board = kept.get("fo-board:1");
      board.weddings.name = "MUTATED";
      board.courses["1"].name = "MUTATED";
      delete board.drinks["1"];
      kept.get("fo-inbox:a@x").households["1"].email = "MUTATED";
      for (const h of b.process.heard) for (const op of h.data.ops) if (op.value && typeof op.value === "object") op.value.name = "MUTATED";
      const text = JSON.stringify([
        (await b.process.call("open", { doc: "fo-board:1" })).result,
        (await b.process.call("open", { doc: "fo-inbox:a@x" })).result,
        (await b.process.call("open", { doc: "fo-menu:1" })).result,
      ]);
      expect(text).not.toContain("MUTATED");
      expect(text).toContain("Broth");
    });

    test("a document whose root is a child row reads that row as its root", async () => {
      const { result } = await backend().process.call("open", { doc: "fo-course:1" });
      expect(content(result)).toEqual({ courses: course(1, "Soup"), drinks: { "1": drink(1, 1, "Sherry") } });
    });

    test("a document whose root row is not there is not found", async () => {
      expect((await backend().process.call("open", { doc: "fo-household:99" })).error?.code).toBe(404);
    });

    test("a list-mode document reads every row of its root; one with a condition, the rows that meet it", async () => {
      const b = backend();
      expect(content((await b.process.call("open", { doc: "fo-all-courses:" })).result)).toEqual({ courses: { "1": course(1, "Soup"), "2": course(2, "Salad", 2) } });
      expect(content((await b.process.call("open", { doc: "fo-courses-like:So" })).result)).toEqual({ courses: { "1": course(1, "Soup") } });
      expect(content((await b.process.call("open", { doc: "fo-courses-like:X" })).result)).toEqual({ courses: {} });
    });

    test("a condition reads the name as its column takes it, as an add through the name is given it: a boolean's true, yes and 1 are the seats kept, false, off and 0 the rest; an integer's 05 is 5; a json value is the JSON it names", async () => {
      const b = backend();
      await b.process.call("open", { doc: "fo-seating:1" });
      await write(b.process, "fo-seating:1", [{ op: "add", path: "/seats/-", value: { table_no: 5, kept: false, wishes: [1, 2] } }]);
      const seats = async (doc: string) => {
        const res = await b.process.call("open", { doc });
        return { doc, seats: res.error ?? Object.keys(res.result.seats).map(Number) };
      };
      for (const name of ["true", "yes", "1", "t", "on", "Y"]) expect(await seats(`fo-seats-kept:${name}`)).toEqual({ doc: `fo-seats-kept:${name}`, seats: [1] });
      for (const name of ["false", "off", "0", "f", "no", "N"]) expect(await seats(`fo-seats-kept:${name}`)).toEqual({ doc: `fo-seats-kept:${name}`, seats: [2] });
      expect(await seats("fo-seats-upto:off")).toEqual({ doc: "fo-seats-upto:off", seats: [2] }); // false <= false; true is not
      expect(await seats("fo-seats-upto:yes")).toEqual({ doc: "fo-seats-upto:yes", seats: [1, 2] });
      expect(await seats("fo-seats-at:05")).toEqual({ doc: "fo-seats-at:05", seats: [2] });
      expect(await seats("fo-seats-at:3")).toEqual({ doc: "fo-seats-at:3", seats: [1] });
      expect(await seats("fo-seats-wished:[1, 2]")).toEqual({ doc: "fo-seats-wished:[1, 2]", seats: [2] });
    });

    test("a name its column cannot take is refused as a mistake (400), opened or written through: a boolean's maybe, an integer's abc or 3.5, a json value that is not JSON", async () => {
      const b = backend();
      const add = [{ op: "add", path: "/seats/-", value: { weddings_id: 1, table_no: 4, kept: true } }];
      for (const doc of ["fo-seats-kept:maybe", "fo-seats-upto:maybe", "fo-seats-at:abc", "fo-seats-at:3.5", "fo-seats-wished:abc"]) {
        const open = (await b.process.call("open", { doc })).error?.code;
        const written = (await b.process.call("delta", { doc, ops: add })).error?.code;
        expect({ doc, open, written }).toEqual({ doc, open: 400, written: 400 });
      }
    });

    test("a number's name is read by one grammar, a decimal a double holds: a real's 1.5, .5, 1e0 and 3. are numbers; Infinity, NaN, inf, 0x10, 1e400 and 1e-400 are refused (400), opened or written through, and an integer's 1_000, 0x10 and 2^53 too", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-slots-upto:", "fo-slots-upto:1.5", "fo-slots-upto:1e0"]);
      await write(b.process, "fo-slots-upto:", [
        { op: "add", path: "/slots/-", value: { weddings_id: 1, price: 1.5 } },
        { op: "add", path: "/slots/-", value: { weddings_id: 1, price: 0.25 } },
        { op: "add", path: "/slots/-", value: { weddings_id: 2, price: 3 } },
      ]);
      await assertCopiesHold(b, copies);
      const slots = async (doc: string) => {
        const res = await b.process.call("open", { doc });
        return { doc, slots: res.error ?? Object.keys(res.result.slots).map(Number) };
      };
      for (const [name, ids] of [["1.5", [1, 2]], [".5", [2]], ["1e0", [2]], ["3.", [1, 2, 3]], ["+2E-1", []], ["-1", []]] as const) {
        expect(await slots(`fo-slots-upto:${name}`)).toEqual({ doc: `fo-slots-upto:${name}`, slots: [...ids] });
      }
      const add = [{ op: "add", path: "/slots/-", value: { weddings_id: 1, price: 1 } }];
      const refused = [
        ...["Infinity", "-Infinity", "NaN", "inf", "0x10", "1e400", "1e-400"].map((name) => `fo-slots-upto:${name}`),
        ...["1_000", "0x10", "9007199254740992", "1".repeat(131073)].map((name) => `fo-seats-at:${name}`),   // past numeric's 131072 digits too
      ];
      for (const doc of refused) {
        const open = (await b.process.call("open", { doc })).error?.code;
        const written = (await b.process.call("delta", { doc, ops: add })).error?.code;
        expect({ doc, open, written }).toEqual({ doc, open: 400, written: 400 });
      }
    });

    test("a parent key's name is an id: a whole number (+1, 01 and ' 1' are 1); text that is no number is no row's, where every id is a number, and sorts after every number, as SQLite orders an id kept as text; a number not whole, or past 2^53 - 1, is refused (400)", async () => {
      const b = backend();
      await openAll(b.process, ["fo-slots-upto:"]);
      await write(b.process, "fo-slots-upto:", [
        { op: "add", path: "/slots/-", value: { weddings_id: 1, price: 1 } },
        { op: "add", path: "/slots/-", value: { weddings_id: 2, price: 2 } },
      ]);
      const names = ["fo-slots-of:1", "fo-slots-of:+1", "fo-slots-of:01", "fo-slots-of: 1", "fo-slots-of:abc", "fo-slots-under:1", "fo-slots-under:abc", "fo-slots-under:-1"];
      const copies = await openAll(b.process, names);
      expect(names.map((doc) => ({ doc, slots: Object.keys(copies.get(doc).slots).map(Number) }))).toEqual([
        { doc: "fo-slots-of:1", slots: [1] },
        { doc: "fo-slots-of:+1", slots: [1] },
        { doc: "fo-slots-of:01", slots: [1] },
        { doc: "fo-slots-of: 1", slots: [1] },
        { doc: "fo-slots-of:abc", slots: [] },
        { doc: "fo-slots-under:1", slots: [1] },
        { doc: "fo-slots-under:abc", slots: [1, 2] },
        { doc: "fo-slots-under:-1", slots: [] },
      ]);
      await write(b.process, "fo-slots-upto:", [{ op: "replace", path: "/slots/2/weddings_id", value: 1 }]);
      await assertCopiesHold(b, copies);
      const add = [{ op: "add", path: "/slots/-", value: { weddings_id: 1, price: 1 } }];
      for (const doc of ["fo-slots-of:1.5", "fo-slots-of:1e0", "fo-slots-of:9007199254740992", `fo-slots-of:${"1".repeat(131073)}`, "fo-slots-under:1.5"]) {
        const open = (await b.process.call("open", { doc })).error?.code;
        const written = (await b.process.call("delta", { doc, ops: add })).error?.code;
        expect({ doc, open, written }).toEqual({ doc, open: 400, written: 400 });
      }
    });

    test("a time's name is a date, YYYY-MM-DD, the instant midnight UTC begins it, and a stored time is compared as the instant it names, whatever its form; anything else is refused (400): garbage, 2026-02-30, 20260101, today", async () => {
      const b = backend();
      await openAll(b.process, ["fo-slots-upto:"]);
      const at = (starts: string | null) => ({ op: "add", path: "/slots/-", value: { weddings_id: 1, starts } });
      await write(b.process, "fo-slots-upto:", [
        at("2026-01-01T10:00:00.000Z"), // 1: after midnight
        at("2025-12-31T23:30:00-02:00"), // 2: 01:30 UTC, after midnight, though its text sorts before the date
        at("2026-01-01T00:00:00.000Z"), // 3: midnight, though its text is not the date's
        at("2025-12-31T23:59:59.999Z"), // 4: before
        at("2026-01-01T01:00:00+01:00"), // 5: midnight
        at(null), // 6: no time
        at("2025-12-31T10:00:00-14:00"), // 7: midnight, its text a day before -- as far as a zone takes it
        at("2026-01-01T13:59:59+14:00"), // 8: before midnight, its text on the day
      ]);
      const names = ["fo-slots-by:2026-01-01", "fo-slots-by: 2026-01-01", "fo-slots-by:2025-12-31", "fo-slots-by:2026-01-02", "fo-slots-on:2026-01-01", "fo-slots-on:2025-12-31"];
      const copies = await openAll(b.process, names);
      expect(names.map((doc) => ({ doc, slots: Object.keys(copies.get(doc).slots).map(Number) }))).toEqual([
        { doc: "fo-slots-by:2026-01-01", slots: [3, 4, 5, 7, 8] },
        { doc: "fo-slots-by: 2026-01-01", slots: [3, 4, 5, 7, 8] },
        { doc: "fo-slots-by:2025-12-31", slots: [] },
        { doc: "fo-slots-by:2026-01-02", slots: [1, 2, 3, 4, 5, 7, 8] },
        { doc: "fo-slots-on:2026-01-01", slots: [3, 5, 7] },
        { doc: "fo-slots-on:2025-12-31", slots: [] },
      ]);
      // an add through the name is given its time, and read back by it; rows move across midnight
      const { ops } = await write(b.process, "fo-slots-on:2026-01-01", [{ op: "add", path: "/slots/-", value: { weddings_id: 1 } }]);
      expect(ops.map((o: any) => o.path)).toEqual(["/slots/9"]);
      await write(b.process, "fo-slots-upto:", [
        { op: "replace", path: "/slots/1/starts", value: "2025-06-01T00:00:00Z" },
        { op: "replace", path: "/slots/3/starts", value: "2026-01-01T00:00:00.001Z" },
      ]);
      await assertCopiesHold(b, copies);
      expect(Object.keys((await b.process.call("open", { doc: "fo-slots-on:2026-01-01" })).result.slots).map(Number)).toEqual([5, 7, 9]);
      const add = [{ op: "add", path: "/slots/-", value: { weddings_id: 1, starts: "2026-01-01T00:00:00Z" } }];
      const refused = ["garbage", "2026-01-01T12:00:00Z", "2026-02-30", "2026-13-01", "0000-01-01", "20260101", "2026-1-1", "today", "now"];
      for (const doc of [...refused.map((name) => `fo-slots-by:${name}`), "fo-slots-on:garbage"]) {
        const open = (await b.process.call("open", { doc })).error?.code;
        const written = (await b.process.call("delta", { doc, ops: add })).error?.code;
        expect({ doc, open, written }).toEqual({ doc, open: 400, written: 400 });
      }
    });

    test("a row added at /- is named by the store: the next serial after the rows it holds", async () => {
      const b = backend();
      await openAll(b.process, ["fo-board:1"]);
      const result = await write(b.process, "fo-board:1", [
        { op: "add", path: "/courses/-", value: { name: "Fish" } },
        { op: "add", path: "/tags/-", value: { label: "blue" } },
      ]);
      expect(result.ops).toEqual([
        { op: "add", path: "/courses/3", value: course(3, "Fish") },
        { op: "add", path: "/tags/2", value: { id: 2, label: "blue" } },
      ]);
      await expectTold(b, "fo-board:1", [result.ops]);
    });

    test("a row added to a list-mode document is given its scope's values from the name: the value need not repeat them", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-tags-labelled:blue", "fo-board:1"]);
      const result = await write(b.process, "fo-tags-labelled:blue", [{ op: "add", path: "/tags/-", value: {} }]);
      expect(result.ops).toEqual([{ op: "add", path: "/tags/2", value: { id: 2, label: "blue" } }]);
      await expectTold(b, "fo-board:1", [result.ops]);
      await assertCopiesHold(b, copies);
    });

    test("a root row is made over the wire through a list document, and then opens as its own single document", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-all-courses:", "fo-board:1"]);
      expect((await b.process.call("open", { doc: "fo-course:3" })).error?.code).toBe(404);
      const { ops } = await write(b.process, "fo-all-courses:", [{ op: "add", path: "/courses/-", value: { weddings_id: 1, name: "Fish" } }]);
      expect(ops).toEqual([{ op: "add", path: "/courses/3", value: course(3, "Fish") }]);
      await expectTold(b, "fo-board:1", [ops]);
      expect(content((await b.process.call("open", { doc: "fo-course:3" })).result)).toEqual({ courses: course(3, "Fish"), drinks: {} });
      await assertCopiesHold(b, copies);
    });

    test("a row told of an add is, key for key, the row a fresh open reads -- as JSON, the same text", async () => {
      const b = backend();
      await openAll(b.process, ["fo-board:1"]);
      const { ops } = await write(b.process, "fo-board:1", [{ op: "add", path: "/courses/-", value: { name: "Fish" } }]);
      await b.quiet();
      const toldRow = JSON.stringify(told(b.process, "fo-board:1")[0]![0] && (told(b.process, "fo-board:1")[0]![0] as any).value);
      const fresh = (await b.process.call("open", { doc: "fo-board:1" })).result.courses[ops[0].path.split("/")[2]];
      expect(toldRow).toBe(JSON.stringify(fresh));
      expect(JSON.stringify(ops[0].value)).toBe(JSON.stringify(fresh));
    });

    test("the same mistake is refused with the same code: a row not there 404, an unknown field 400, a row already there 409", async () => {
      const b = backend();
      await openAll(b.process, ["fo-board:1"]);
      const code = async (ops: unknown[]) => (await b.process.call("delta", { doc: "fo-board:1", ops })).error?.code;
      expect(await code([{ op: "replace", path: "/courses/99/name", value: "x" }])).toBe(404);
      expect(await code([{ op: "replace", path: "/courses/1/nope", value: "x" }])).toBe(400);
      expect(await code([{ op: "add", path: "/courses/1", value: { name: "again" } }])).toBe(409);
      expect(await code([{ op: "remove", path: "/courses/2" }])).toBe(404); // the other wedding's: not in this document
      // RFC 6902: replace and remove need their target there (the JSON file's applyOps too, #4)
      expect(await code([{ op: "remove", path: "/courses/99" }])).toBe(404);
      expect(await code([{ op: "replace", path: "/courses/99", value: { name: "x" } }])).toBe(404);
    });

    test("a remove of a row that is not there is a 404, whatever holds its collection: a map, a collection with no parent, a list, a list's include (A6)", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:1", "fo-catalog:"]);
      const code = async (doc: string, ops: unknown[]) => (await b.process.call("delta", { doc, ops })).error?.code;
      expect(await code("fo-board:1", [{ op: "remove", path: "/households/999" }])).toBe(404);
      expect(await code("fo-board:1", [{ op: "remove", path: "/tags/999" }])).toBe(404);
      expect(await code("fo-catalog:", [{ op: "remove", path: "/courses/999" }])).toBe(404);
      expect(await code("fo-catalog:", [{ op: "remove", path: "/drinks/999" }])).toBe(404);
      expect(await code("fo-board:1", [{ op: "remove", path: "/tags/1" }, { op: "remove", path: "/tags/1" }])).toBe(404);   // twice in one write: the second is not there
      expect(content((await b.process.call("open", { doc: "fo-board:1" })).result).tags).toEqual({ "1": { id: 1, label: "red" } });
      await assertCopiesHold(b, copies);
    });

    test("a path's id is the number its digits name, however many there are: /courses/0001000000000000 is /courses/1000000000000, as /courses/007 is /courses/7", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:1"]);
      const { ops } = await write(b.process, "fo-board:1", [
        { op: "add", path: "/courses/007", value: { name: "Fish" } },
        { op: "add", path: "/courses/0001000000000000", value: { name: "Cheese" } },
      ]);
      expect(ops).toEqual([
        { op: "add", path: "/courses/7", value: course(7, "Fish") },
        { op: "add", path: "/courses/1000000000000", value: course(1000000000000, "Cheese") },
      ]);
      await assertCopiesHold(b, copies);
    });

    test("an id past 2^53 - 1 is refused as a mistake (400), in every op: a number would not hold it; 2^53 - 1 is kept", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:1"]);
      const code = async (ops: unknown[]) => (await b.process.call("delta", { doc: "fo-board:1", ops })).error?.code;
      expect(await code([{ op: "add", path: "/courses/9007199254740993", value: { name: "Fish" } }])).toBe(400);
      expect(await code([{ op: "add", path: "/courses/12345678901234567890", value: { name: "Fish" } }])).toBe(400); // past a bigint, too
      expect(await code([{ op: "replace", path: "/courses/9007199254740993/name", value: "Cod" }])).toBe(400);
      expect(await code([{ op: "replace", path: "/courses/9007199254740993", value: { name: "Cod" } }])).toBe(400);
      expect(await code([{ op: "remove", path: "/courses/9007199254740993" }])).toBe(400);
      const { ops } = await write(b.process, "fo-board:1", [{ op: "add", path: "/courses/9007199254740991", value: { name: "Fish" } }]);
      expect(ops).toEqual([{ op: "add", path: "/courses/9007199254740991", value: course(9007199254740991, "Fish") }]);
      await assertCopiesHold(b, copies);
    });

    test("a parent key is never null, nor anything but an id: refused as a mistake (400) in every form of replace", async () => {
      const b = backend();
      await openAll(b.process, ["fo-board:1", "fo-household:1"]);
      const code = async (doc: string, ops: unknown[]) => (await b.process.call("delta", { doc, ops })).error?.code;
      expect(await code("fo-board:1", [{ op: "replace", path: "/drinks/1/courses_id", value: null }])).toBe(400);
      expect(await code("fo-board:1", [{ op: "replace", path: "/households/1", value: { weddings_id: null } }])).toBe(400);
      expect(await code("fo-household:1", [{ op: "replace", path: "/households/weddings_id", value: null }])).toBe(400);
      expect(await code("fo-household:1", [{ op: "replace", path: "/households", value: { weddings_id: null } }])).toBe(400);
      expect(await code("fo-board:1", [{ op: "replace", path: "/drinks/1/courses_id", value: 1.5 }])).toBe(400);
      expect(await code("fo-household:1", [{ op: "replace", path: "/households/weddings_id", value: true }])).toBe(400);
    });

    test("a row keeps its id: one in a replace's value is the path's, as in an add's, and id is not a field (400)", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:1", "fo-household:1"]);
      const code = async (doc: string, ops: unknown[]) => (await b.process.call("delta", { doc, ops })).error?.code;
      expect(await code("fo-board:1", [{ op: "replace", path: "/households/1/id", value: 9 }])).toBe(400);
      expect(await code("fo-household:1", [{ op: "replace", path: "/households/id", value: 9 }])).toBe(400);
      const row = await write(b.process, "fo-board:1", [{ op: "replace", path: "/households/1", value: { id: 9, email: "q@x" } }]);
      expect(row.ops).toEqual([{ op: "replace", path: "/households/1", value: household(1, "q@x") }]);
      const root = await write(b.process, "fo-household:1", [{ op: "replace", path: "/households", value: { id: 9, email: "r@x" } }]);
      expect(root.ops).toEqual([{ op: "replace", path: "/households", value: household(1, "r@x") }]);
      expect((await b.process.call("open", { doc: "fo-household:9" })).error?.code).toBe(404);
      await assertCopiesHold(b, copies);
    });

    test("a replace of a row is the row, as RFC 6902 says: a field its value leaves out takes its default -- null where nullable -- a required one left out is refused (400), and where the row hangs stays; at /<coll>/<id>, the root's /<root>, and the root by its id", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:1", "fo-household:1"]);
      const code = async (doc: string, ops: unknown[]) => (await b.process.call("delta", { doc, ops })).error?.code;
      for (const [doc, path] of [["fo-board:1", "/households/1"], ["fo-household:1", "/households"], ["fo-household:1", "/households/1"]] as const) {
        await write(b.process, "fo-board:1", [{ op: "replace", path: "/households/1/t", value: "kept?" }]);
        expect({ path, code: await code(doc, [{ op: "replace", path, value: { t: "no email" } }]) }).toEqual({ path, code: 400 });
        await write(b.process, doc, [{ op: "replace", path, value: { email: `${path.length}@x` } }]);
        expect({ path, row: content((await b.process.call("open", { doc: "fo-household:1" })).result).households }).toEqual({ path, row: household(1, `${path.length}@x`) });
      }
      await expectTold(b, "fo-household:1", [1, 2, 3].flatMap((i) => [
        [field("/households/t", "kept?")],
        [field("/households/email", `${[13, 11, 13][i - 1]}@x`), field("/households/t", null)],
      ]));
      await assertCopiesHold(b, copies);
    });

    test("a column may take any name: a household's t, named as the write SQL named its row, is written and read in every form", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:1", "fo-household:1", "fo-inbox:a@x"]);
      await write(b.process, "fo-board:1", [{ op: "replace", path: "/households/1/t", value: "field" }]);
      await write(b.process, "fo-household:1", [{ op: "replace", path: "/households/t", value: "root" }]);
      await write(b.process, "fo-household:1", [{ op: "replace", path: "/households", value: { email: "a@x", t: "whole" } }]);
      await write(b.process, "fo-board:1", [{ op: "replace", path: "/households/2", value: { email: "b@x", t: "row" } }]);
      const added = await write(b.process, "fo-board:1", [{ op: "add", path: "/households/-", value: { email: "a@x", t: "added" } }]);
      expect(added.ops).toEqual([{ op: "add", path: "/households/4", value: household(4, "a@x", 1, "added") }]);
      expect(content((await b.process.call("open", { doc: "fo-board:1" })).result).households).toEqual({
        "1": household(1, "a@x", 1, "whole"), "2": household(2, "b@x", 1, "row"), "4": household(4, "a@x", 1, "added"),
      });
      const now = await b.process.call("open_at", { doc: "fo-household:1", at: new Date(Date.now() + 1000).toISOString() });
      expect(content(now.result)).toEqual({ households: household(1, "a@x", 1, "whole") });
      await write(b.process, "fo-board:1", [{ op: "remove", path: "/households/4" }]);
      await assertCopiesHold(b, copies);
    });

    test("a single document is its root and what hangs from it: it adds no other root row (400), and once its root is gone it takes no writes (404), as it opens -- but an undo, which may put it back (#59)", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-course:1", "fo-board:1", "fo-menu:1"]);
      const code = async (ops: unknown[]) => (await b.process.call("delta", { doc: "fo-course:1", ops })).error?.code;
      expect(await code([{ op: "add", path: "/courses/7", value: { weddings_id: 1, name: "Seven" } }])).toBe(400);
      expect(await code([{ op: "add", path: "/courses/-", value: { weddings_id: 1, name: "Dash" } }])).toBe(400);
      expect(await code([{ op: "add", path: "/courses/1", value: { weddings_id: 1, name: "Soup" } }])).toBe(409); // its own: there already
      await write(b.process, "fo-board:1", [{ op: "remove", path: "/courses/1" }]);
      expect(await code([{ op: "add", path: "/drinks/-", value: { name: "Port" } }])).toBe(404);
      expect(await code([{ op: "add", path: "/courses/1", value: { weddings_id: 1, name: "Soup again" } }])).toBe(404);
      expect(await code([{ op: "replace", path: "/courses/name", value: "Broth" }])).toBe(404);
      const board = content((await b.process.call("open", { doc: "fo-board:1" })).result);
      expect({ courses: board.courses, drinks: board.drinks }).toEqual({ courses: {}, drinks: {} });
      await assertCopiesHold(b, copies);
    });

    test("a single document that removed its own root takes no writes (404), but its undo puts the root back, and then it does (#43)", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-course:1", "fo-menu:1"]);
      const code = async (ops: unknown[]) => (await b.process.call("delta", { doc: "fo-course:1", ops })).error?.code;
      await write(b.process, "fo-course:1", [{ op: "remove", path: "/courses/1" }], { cursor: "s1" });
      expect(await code([{ op: "add", path: "/courses/1", value: { weddings_id: 1, name: "Soup again" } }])).toBe(404);
      expect(await code([{ op: "add", path: "/drinks/-", value: { name: "Port" } }])).toBe(404);
      const undone = await b.process.call("undo", { cursor: "s1" });
      expect({ ops: undone.result.ops.map((o: any) => `${o.op} ${o.path}`), conflict: undone.result.conflict }).toEqual({ ops: ["add /courses/1", "add /drinks/1"], conflict: undefined });
      await write(b.process, "fo-course:1", [{ op: "replace", path: "/courses/name", value: "Broth" }]);
      await assertCopiesHold(b, copies);
      expect(content((await b.process.call("open", { doc: "fo-course:1" })).result)).toEqual({ courses: course(1, "Broth"), drinks: { "1": drink(1, 1, "Sherry") } });
    });

    test("a single document named by its id and another column holds its root only where the row meets both: opened, written, read as it stood and asked its history, another's is not there (404) and nothing is written (0.10.0 review)", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-guest:1:a@x", "fo-board:1", "fo-household:1"]);
      const theirs = "fo-guest:1:z@x";   // household 1 is a@x's
      const code = async (action: string, msg: Record<string, unknown>) => (await b.process.call(action, { doc: theirs, ...msg })).error?.code;
      expect(await code("open", {})).toBe(404);
      expect(await code("delta", { ops: [{ op: "replace", path: "/households/t", value: "taken" }] })).toBe(404);
      expect(await code("delta", { ops: [{ op: "replace", path: "/households/1", value: { email: "a@x", t: "taken" } }] })).toBe(404);
      expect(await code("delta", { ops: [{ op: "remove", path: "/households/1" }] })).toBe(404);
      expect(await code("open_at", { at: new Date().toISOString() })).toBe(404);
      expect(await code("history", {})).toBe(404);
      await expectSilent(b, "fo-guest:1:a@x", "fo-board:1", "fo-household:1");
      expect(content((await b.process.call("open", { doc: "fo-guest:1:a@x" })).result)).toEqual({ households: household(1, "a@x") });
      await write(b.process, "fo-guest:1:a@x", [{ op: "replace", path: "/households/t", value: "hers" }], { cursor: "s1" });
      expect((await b.process.call("history", { doc: "fo-guest:1:a@x" })).result).toHaveLength(1);
      await assertCopiesHold(b, copies);
    });

    test("a single document that takes its root out in a write writes nothing more through it (404, nothing written) but that root back, and then on through it (#61)", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-course:1", "fo-board:1", "fo-menu:1"]);
      const code = async (ops: unknown[]) => (await b.process.call("delta", { doc: "fo-course:1", ops })).error?.code;
      const out = { op: "remove", path: "/courses/1" };
      expect(await code([out, { op: "add", path: "/drinks/-", value: { name: "Port" } }])).toBe(404); // a drink under no course
      expect(await code([out, { op: "replace", path: "/courses/name", value: "Broth" }])).toBe(404);
      expect(await code([out, { op: "remove", path: "/drinks/1" }])).toBe(404);
      await expectSilent(b, "fo-course:1", "fo-board:1", "fo-menu:1");
      expect(content((await b.process.call("open", { doc: "fo-course:1" })).result)).toEqual({ courses: course(1, "Soup"), drinks: { "1": drink(1, 1, "Sherry") } });
      const { ops } = await write(b.process, "fo-course:1", [out, { op: "add", path: "/courses/1", value: { weddings_id: 1, name: "Broth" } }, { op: "add", path: "/drinks/-", value: { name: "Port" } }]);
      expect(ops).toEqual([out, { op: "remove", path: "/drinks/1" }, { op: "add", path: "/courses/1", value: course(1, "Broth") }, { op: "add", path: "/drinks/3", value: drink(3, 1, "Port") }]);
      expect(content((await b.process.call("open", { doc: "fo-course:1" })).result)).toEqual({ courses: course(1, "Broth"), drinks: { "3": drink(3, 1, "Port") } });
      await assertCopiesHold(b, copies);
    });

    test("every change a document is told carries its next version, and an open reads the version it is at", async () => {
      const b = backend();
      const before = (await b.process.call("open", { doc: "fo-menu:1" })).result._v as number;
      await openAll(b.process, ["fo-board:1", "fo-menu:1"]);
      await write(b.process, "fo-board:1", [{ op: "replace", path: "/courses/1/name", value: "Broth" }]);
      await write(b.process, "fo-menu:1", [{ op: "replace", path: "/courses/1/name", value: "Bisque" }]);
      await expectTold(b, "fo-menu:1", [[field("/courses/1/name", "Broth")], [field("/courses/1/name", "Bisque")]]);
      expect(b.process.heard.filter((h) => h.channel === "fo-menu:1").map((h) => h.data.v)).toEqual([before + 1, before + 2]);
      expect((await b.process.call("open", { doc: "fo-menu:1" })).result._v).toBe(before + 2);
    });

    test("an empty write changes nothing: no next version, nothing told, nothing in the history", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:1"]);
      const before = copies.get("fo-board:1")._v as number;
      const empty = await write(b.process, "fo-board:1", [], { cursor: "s1" });
      expect({ version: empty.version, ops: empty.ops ?? [] }).toEqual({ version: before, ops: [] });
      await expectSilent(b, "fo-board:1");
      expect((await b.process.call("history", { doc: "fo-board:1", cursor: "s1" })).result).toEqual([]);
      await write(b.process, "fo-board:1", [{ op: "replace", path: "/weddings/name", value: "our day" }]);
      await expectTold(b, "fo-board:1", [[field("/weddings/name", "our day")]]);
      expect(b.process.heard.filter((h) => h.channel === "fo-board:1").map((h) => h.data.v)).toEqual([before + 1]);
      await assertCopiesHold(b, copies);
    });

    test("history lists entries of one version newest first: an undo that walked nothing after the write it met", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:1"]);
      const before = copies.get("fo-board:1")._v as number;
      await write(b.process, "fo-board:1", [{ op: "add", path: "/notes/-", value: { text: "x" } }], { cursor: "s1" });
      await write(b.process, "fo-board:1", [{ op: "remove", path: "/notes/2" }], { cursor: "s2" });
      expect((await b.process.call("undo", { cursor: "s1" })).result.conflict).toBeDefined();
      const { result } = await b.process.call("history", { doc: "fo-board:1", cursor: "s1" });
      expect(result.map((e: any) => [e.version - before, e.ops.length, e.mine])).toEqual([[2, 0, true], [2, 1, false], [1, 1, true]]);
    });

    test("an empty write to an implied document not yet made makes nothing: no root row, no version, nothing told; the first write that changes something does", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-plan:7"]);
      const empty = await write(b.process, "fo-plan:7", []);
      expect(empty.version).toBe(copies.get("fo-plan:7")._v);
      await expectSilent(b, "fo-plan:7");
      expect((await b.process.call("open", { doc: "fo-title:7" })).error?.code).toBe(404);
      await write(b.process, "fo-plan:7", [{ op: "replace", path: "/weddings/name", value: "planned" }]);
      expect((await b.process.call("open", { doc: "fo-title:7" })).result.weddings).toEqual({ id: 7, name: "planned" });
      await assertCopiesHold(b, copies);
    });

    test("an empty write through a document that is not there is not found (404): never there, or its root gone since", async () => {
      const b = backend();
      await openAll(b.process, ["fo-board:1", "fo-household:2"]);
      expect((await b.process.call("delta", { doc: "fo-board:99", ops: [] })).error?.code).toBe(404);
      await write(b.process, "fo-board:1", [{ op: "remove", path: "/households/2" }]);
      await b.quiet();
      expect((await b.process.call("delta", { doc: "fo-household:2", ops: [] })).error?.code).toBe(404);
    });

    test("history says what was written through a document, newest first, and whose it was", async () => {
      const b = backend();
      await openAll(b.process, ["fo-board:1"]);
      await write(b.process, "fo-board:1", [{ op: "replace", path: "/courses/1/name", value: "Broth" }], { cursor: "s1" });
      await write(b.process, "fo-board:1", [{ op: "replace", path: "/weddings/name", value: "our day" }], { cursor: "s1" });
      const { result } = await b.process.call("history", { doc: "fo-board:1", cursor: "s1" });
      expect(result.map((e: any) => ({ ops: e.ops.map((o: any) => `${o.op} ${o.path}`), mine: e.mine }))).toEqual([
        { ops: ["replace /weddings"], mine: true },
        { ops: ["replace /courses/1"], mine: true },
      ]);
    });

    test("a document read as it stood at a time before a change shows it as it was", async () => {
      const b = backend();
      await openAll(b.process, ["fo-board:1"]);
      const { result } = await b.process.call("open_at", { doc: "fo-notes:1", at: "2021-01-01T00:00:00.000Z" });
      expect(content(result).notes).toEqual({ "1": { id: 1, weddings_id: 1, text: "bring chairs" } });
      await write(b.process, "fo-board:1", [{ op: "replace", path: "/notes/1/text", value: "bring tables" }]);
      const then = await b.process.call("open_at", { doc: "fo-notes:1", at: "2021-01-01T00:00:00.000Z" });
      expect(content(then.result).notes).toEqual({ "1": { id: 1, weddings_id: 1, text: "bring chairs" } });
      const now = await b.process.call("open", { doc: "fo-notes:1" });
      expect(content(now.result).notes).toEqual({ "1": { id: 1, weddings_id: 1, text: "bring tables" } });
    });
  });
}

/** A document over some of its rows' columns: opened, told and written by those alone. */
export function columnCases(backend: () => PathBackend): void {
  describe("a document that holds some columns of a collection", () => {
    const slim = (id: number, email: string) => ({ id, weddings_id: 1, email });

    test("it opens with those columns, the id and the parent key -- as it stood too -- and a collection it does not name, whole", async () => {
      const b = backend();
      const { result } = await b.process.call("open", { doc: "fo-slim:1" });
      expect(content(result)).toEqual({
        weddings: { id: 1, name: "ours" },
        households: { "1": slim(1, "a@x"), "2": slim(2, "b@x") },
        seats: { "1": { id: 1, weddings_id: 1, table_no: 3 } },
      });
      const then = await b.process.call("open_at", { doc: "fo-slim:1", at: new Date().toISOString() });
      expect(content(then.result)).toEqual(content(result));
    });

    test("it is told only what changes of its columns: a write of another column tells it nothing; a row that arrives, its columns", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-slim:1", "fo-board:1"]);
      await write(b.process, "fo-board:1", [{ op: "replace", path: "/households/1/t", value: "notes" }]);
      await write(b.process, "fo-board:1", [{ op: "replace", path: "/households/1/email", value: "z@x" }, { op: "replace", path: "/households/1/t", value: "more" }]);
      await write(b.process, "fo-board:1", [{ op: "add", path: "/households/-", value: { email: "n@x", t: "long" } }]);
      await expectTold(b, "fo-slim:1", [[field("/households/1/email", "z@x")], [{ op: "add", path: "/households/4", value: slim(4, "n@x") }]]);
      await assertCopiesHold(b, copies);
    });

    test("a write through it may touch its columns alone (400 for another, as for a field no row has); a row replaced whole through it keeps the columns it does not hold; undone, a row removed through it comes back whole", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-slim:1", "fo-board:1"]);
      const code = async (ops: unknown[]) => (await b.process.call("delta", { doc: "fo-slim:1", ops })).error?.code;
      await write(b.process, "fo-board:1", [{ op: "replace", path: "/households/1/t", value: "kept" }]);
      expect(await code([{ op: "replace", path: "/households/1/t", value: "x" }])).toBe(400);
      expect(await code([{ op: "replace", path: "/households/1", value: { email: "a@x", t: "x" } }])).toBe(400);
      expect(await code([{ op: "add", path: "/households/-", value: { email: "n@x", t: "x" } }])).toBe(400);
      expect(await code([{ op: "add", path: "/seats/-", value: { table_no: 2 } }])).toBe(400);   // kept, which it does not hold, has no default
      await write(b.process, "fo-slim:1", [{ op: "replace", path: "/households/1", value: { email: "w@x" } }], { cursor: "s1" });
      await write(b.process, "fo-slim:1", [{ op: "remove", path: "/households/1" }], { cursor: "s1" });
      expect((await b.process.call("undo", { cursor: "s1" })).result?.conflict).toBeUndefined();
      expect(content((await b.process.call("open", { doc: "fo-board:1" })).result).households["1"]).toEqual(household(1, "w@x", 1, "kept"));
      await assertCopiesHold(b, copies);
    });

    test("its writer is answered only what it holds -- a write's ops and inverse, an undo's and a redo's, a dry run's, its history: its columns, and not the favour a household's removal takes, which it does not include -- while the ledger keeps every row whole, and undo puts them back", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-slim:1", "fo-board:1", "fo-party:1"]);
      await write(b.process, "fo-board:1", [{ op: "replace", path: "/households/1/t", value: "secret" }]);
      const hidden = (what: string, x: unknown) => expect({ what, leak: /"t":|secret|favour|jam/.test(JSON.stringify(x)) }).toEqual({ what, leak: false });
      const renamed = await write(b.process, "fo-slim:1", [{ op: "replace", path: "/households/1/email", value: "w@x" }], { cursor: "s1" });
      expect(renamed.ops).toEqual([{ op: "replace", path: "/households/1", value: slim(1, "w@x") }]);
      expect(renamed.inverse).toEqual([{ op: "replace", path: "/households/1", value: slim(1, "a@x") }]);
      // household 1 has a favour, which its removal takes: in the tables and the party, not in this writer's answer
      const removed = await write(b.process, "fo-slim:1", [{ op: "remove", path: "/households/1" }], { cursor: "s1" });
      expect({ ops: removed.ops, inverse: removed.inverse }).toEqual({ ops: [{ op: "remove", path: "/households/1" }], inverse: [{ op: "add", path: "/households/1", value: slim(1, "w@x") }] });
      const favours = async () => (await b.exportTables()).tables.favours ?? [];
      expect(await favours()).toEqual([]);
      hidden("dry", (await b.process.call("undo", { cursor: "s1", dry: true })).result);
      const undone = (await b.process.call("undo", { cursor: "s1" })).result;
      expect(undone.ops).toEqual([{ op: "add", path: "/households/1", value: slim(1, "w@x") }]);
      hidden("undo", undone);
      const jam = { id: 1, weddings_id: 1, households_id: 1, gift: "jam" };
      expect(await favours()).toEqual([jam]);   // the ledger kept it whole
      hidden("redo", (await b.process.call("redo", { cursor: "s1" })).result);
      hidden("undo again", (await b.process.call("undo", { cursor: "s1" })).result);
      hidden("history", (await b.process.call("history", { doc: "fo-slim:1", cursor: "s1" })).result);
      expect(content((await b.process.call("open", { doc: "fo-board:1" })).result).households["1"]).toEqual(household(1, "w@x", 1, "secret"));
      expect(await favours()).toEqual([jam]);
      await assertCopiesHold(b, copies);
    });

    test("a walk that sets back a field it does not hold is answered without it: a dry undo of a row removed and added back through it sets back the email it holds and the t it does not, and answers the email alone", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-slim:1", "fo-board:1"]);
      await write(b.process, "fo-board:1", [{ op: "replace", path: "/households/1/t", value: "secret" }]);
      await write(b.process, "fo-slim:1", [{ op: "remove", path: "/households/1" }, { op: "add", path: "/households/1", value: { email: "n@x" } }], { cursor: "s1" });
      const dry = (await b.process.call("undo", { cursor: "s1", dry: true })).result;
      expect({ ops: dry.ops, conflict: dry.conflict }).toEqual({ ops: [field("/households/1/email", "a@x")], conflict: undefined });
      await b.process.call("undo", { cursor: "s1" });
      expect(content((await b.process.call("open", { doc: "fo-board:1" })).result).households["1"]).toEqual(household(1, "a@x", 1, "secret"));
      await assertCopiesHold(b, copies);
    });
  });
}

/** A row added under an id it names moves the collection's serial past it, as importTables does (#63, #72). */
export function serialCases(backend: () => PathBackend): void {
  describe("a serial and an id a write names", () => {
    test("a row added under an id it names moves the serial past it: the next /- does not meet it (#63)", async () => {
      const b = backend();
      await openAll(b.process, ["fo-board:1"]);
      await write(b.process, "fo-board:1", [{ op: "add", path: "/courses/4", value: { name: "Fish" } }]);
      const { ops } = await write(b.process, "fo-board:1", [
        { op: "add", path: "/courses/-", value: { name: "Meat" } },
        { op: "add", path: "/courses/-", value: { name: "Cake" } },
      ]);
      expect(ops.map((o: any) => o.path)).toEqual(["/courses/5", "/courses/6"]);
      const { sequences } = await b.exportTables();
      expect(sequences?.courses).toBe(6);
    });

    test("an add names a new id, past the serial: one the table has handed out is refused alike (409), whether a row it may not read holds it or none does -- no answer, version or broadcast tells them apart (#71)", async () => {
      const b = backend();
      // wedding 2's: household 3 is there, 4 was and is not; note 2 is there, 3 was and is not
      await openAll(b.process, ["fo-board:2"]);
      await write(b.process, "fo-board:2", [
        { op: "add", path: "/households/-", value: { email: "d@x" } },
        { op: "remove", path: "/households/4" },
        { op: "add", path: "/notes/-", value: { text: "theirs" } },
        { op: "add", path: "/notes/-", value: { text: "gone" } },
        { op: "remove", path: "/notes/3" },
      ]);
      const copies = await openAll(b.process, ["fo-board:1", "fo-board:2"]);
      const refused = async (coll: string, id: number) => {
        const res = await b.process.call("delta", { doc: "fo-board:1", ops: [{ op: "add", path: `/${coll}/${id}`, value: coll === "notes" ? { text: "mine" } : { email: "e@x" } }] });
        return { code: res.error?.code, message: String(res.error?.message).replaceAll(`/${coll}/${id}`, `/${coll}/<id>`) };
      };
      const hidden = await refused("households", 3);   // taken, by a row fo-board:1 does not read
      expect(hidden.code).toBe(409);
      expect(await refused("households", 4)).toEqual(hidden);   // free, but handed out
      expect(await refused("households", 1)).toEqual(hidden);   // taken by its own row: no other answer
      const hiddenNote = await refused("notes", 2);
      expect(hiddenNote.code).toBe(409);
      expect(await refused("notes", 3)).toEqual(hiddenNote);   // a temporal row closed: free, but handed out
      await expectSilent(b, "fo-board:1", "fo-board:2");
      expect((await b.process.call("open", { doc: "fo-board:1" })).result._v).toBe(copies.get("fo-board:1")._v);
      // past the serial, an id is new: a client may still name it
      const { ops } = await write(b.process, "fo-board:1", [{ op: "add", path: "/households/5", value: { email: "e@x" } }]);
      expect(ops).toEqual([{ op: "add", path: "/households/5", value: household(5, "e@x") }]);
      await assertCopiesHold(b, copies);
    });

    test("a write refused part way names no id: the same add sent again goes through (#71)", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:1"]);
      const refused = await b.process.call("delta", { doc: "fo-board:1", ops: [
        { op: "add", path: "/courses/9", value: { name: "Fish" } },
        { op: "replace", path: "/courses/999/name", value: "x" },
      ] });
      expect(refused.error?.code).toBe(404);
      const { ops } = await write(b.process, "fo-board:1", [{ op: "add", path: "/courses/9", value: { name: "Fish" } }]);
      expect(ops).toEqual([{ op: "add", path: "/courses/9", value: course(9, "Fish") }]);
      await assertCopiesHold(b, copies);
    });

    test("an implied document's first write makes its root under the add rule: an id the serial has handed out is taken; one past it is made and the serial follows (#71)", async () => {
      const b = backend();
      await openAll(b.process, ["fo-weddings:"]);
      await write(b.process, "fo-weddings:", [{ op: "add", path: "/weddings/-", value: { name: "brief" } }, { op: "remove", path: "/weddings/3" }]);
      const copies = await openAll(b.process, ["fo-plan:3", "fo-plan:50", "fo-weddings:"]);
      const spent = await b.process.call("delta", { doc: "fo-plan:3", ops: [{ op: "add", path: "/courses/-", value: { name: "Soup" } }] });
      expect(spent.error).toEqual({ code: 409, message: expect.stringMatching(/^id already taken: \/weddings\/3 -- add to \/weddings\/- for a new id$/i) });
      await write(b.process, "fo-plan:50", [{ op: "add", path: "/courses/-", value: { name: "Soup" } }]);
      const code = async (id: number) => (await b.process.call("delta", { doc: "fo-weddings:", ops: [{ op: "add", path: `/weddings/${id}`, value: { name: "x" } }] })).error?.code;
      expect(await code(49)).toBe(409);
      expect(await code(50)).toBe(409);
      expect((await b.exportTables()).sequences?.weddings).toBe(50);
      await assertCopiesHold(b, copies);
    });
  });
}

/**
 * Two registrations over the same rows: a write through either is
 * told to the documents open through both, and a walk is guarded by every
 * write to the rows it sets back, whichever registration made it.
 */
export function registrationCases(backend: () => PathBackend): void {
  describe("two registrations over the same rows", () => {
    test("a document is told a write through the other registration with its next version, and opens at the version it was last told (review)", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:1", "fo-menu:1", "fo-pub-courses:"]);
      await write(b.process, "fo-pub-courses:", [{ op: "replace", path: "/courses/1/name", value: "Bisque" }]);
      await write(b.process, "fo-board:1", [{ op: "replace", path: "/courses/1/name", value: "Broth" }]);
      await write(b.process, "fo-pub-courses:", [{ op: "add", path: "/courses/-", value: { weddings_id: 1, name: "Fish" } }]);
      await b.quiet();
      for (const doc of ["fo-board:1", "fo-menu:1"]) {
        const from = copies.get(doc)._v as number;
        expect({ doc, v: b.process.heard.filter((h) => h.channel === doc).map((h) => h.data.v) }).toEqual({ doc, v: [from + 1, from + 2, from + 3] });
        expect({ doc, open: (await b.process.call("open", { doc })).result._v }).toEqual({ doc, open: from + 3 });
      }
      await assertCopiesHold(b, copies);
    });


    test("Ada's undo through the board meets Bob's rename since, through the public courses, as a conflict and leaves it; her next write is undone to his name, not hers before it", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:1", "fo-menu:1", "fo-pub-courses:", "fo-inbox:a@x"]);
      const rename = (doc: string, name: string, cursor: string) => write(b.process, doc, [{ op: "replace", path: "/courses/1/name", value: name }], { cursor });
      const walked = async (way: string) => {
        const { result, error } = await b.process.call(way, { cursor: "ada" });
        return { error, ops: result?.ops, conflict: result?.conflict };
      };
      const name = async () => (await b.process.call("open", { doc: "fo-pub-courses:" })).result.courses["1"].name;
      await rename("fo-board:1", "Broth", "ada");
      await rename("fo-pub-courses:", "Bisque", "bob");
      expect(await walked("undo")).toEqual({ error: undefined, ops: [], conflict: ["/courses/1"] });
      expect(await name()).toBe("Bisque");
      await rename("fo-board:1", "Consomme", "ada");
      expect(await walked("undo")).toEqual({ error: undefined, ops: [{ op: "replace", path: "/courses/1", value: course(1, "Bisque") }], conflict: undefined });
      expect(await name()).toBe("Bisque");
      // a redo meets a write since the same way
      await rename("fo-pub-courses:", "Gazpacho", "bob");
      expect(await walked("redo")).toEqual({ error: undefined, ops: [], conflict: ["/courses/1"] });
      expect(await name()).toBe("Gazpacho");
      await expectTold(b, "fo-menu:1", ["Broth", "Bisque", "Consomme", "Bisque", "Gazpacho"].map((n) => [field("/courses/1/name", n)]));
      // a row added and removed through the public courses reaches the board, and a household through the board the inbox
      const added = await write(b.process, "fo-pub-courses:", [{ op: "add", path: "/courses/-", value: { weddings_id: 1, name: "Fish" } }], { inverse: true });   // it keeps no ledger: asked for what it applied
      await write(b.process, "fo-pub-courses:", [{ op: "remove", path: added.ops[0].path }]);
      await write(b.process, "fo-board:1", [{ op: "add", path: "/households/-", value: { email: "a@x" } }]);
      await assertCopiesHold(b, copies);
    });
  });
}
