import { describe, expect, test } from "bun:test";
import { slug, grid } from "../../src/rendering/grid";

describe("grid", () => {
  test("places cells first-fit in the box's own order, and says which tray corners each sits in", () => {
    // a tray: the map tall on the left, then households, photos wide, gifts wide, the answer
    const t = grid(
      [
        { key: "stay", rows: 2 },
        { key: "households" },
        { key: "photos", span: 2 },
        { key: "gifts", span: 2 },
        { key: "answer" },
      ],
      4,
    );
    expect(t.rows).toBe(2);
    expect(t.areas).toBe('"stay households photos photos"\n"stay gifts gifts answer"');
    const by = Object.fromEntries(t.cells.map((c) => [c.key, c]));
    expect(by.stay).toMatchObject({ column: 0, row: 0, span: 1, rows: 2, corners: ["tl", "bl"] });
    expect(by.households!.corners).toEqual([]);
    expect(by.photos!.corners).toEqual(["tr"]);
    expect(by.gifts!.corners).toEqual([]);
    expect(by.answer!.corners).toEqual(["br"]);
  });

  test("a single column is the phone: everything stacks, the first takes the top corners and the last the bottom", () => {
    const t = grid([{ key: "a", span: 3, rows: 2 }, { key: "b" }, { key: "c" }], 1);
    expect(t.areas).toBe('"a"\n"a"\n"b"\n"c"');
    expect(t.cells.map((c) => c.corners)).toEqual([["tl", "tr"], [], ["br", "bl"]]);
    expect(t.cells[0]!.span).toBe(1); // clamped to the tray
  });

  test("a cell that does not fit the rest of a row starts the next, in the box's order; a gap mid-tray stays a gap", () => {
    const t = grid([{ key: "a" }, { key: "b", span: 2 }, { key: "c" }, { key: "d" }], 2);
    expect(t.areas).toBe('"a ."\n"b b"\n"c d"');
    expect(t.cells[0]!.corners).toEqual(["tl"]); // the gap beside it owns the top-right corner, and nobody takes it
  });

  test("a gap at the end of the last row goes to the cell before it, so the tray's foot is whole", () => {
    const t = grid([{ key: "a" }, { key: "b", span: 2 }, { key: "c" }], 2);
    expect(t.areas).toBe('"a ."\n"b b"\n"c c"');
    expect(t.cells[2]).toMatchObject({ span: 2, corners: ["br", "bl"] });
    // the wedding's home: guests across the top, five small ones after, the last row of two grows to three
    const home = grid([{ key: "guests", span: 3 }, { key: "asks" }, { key: "gifts" }, { key: "the-day" }, { key: "where-to-stay" }, { key: "everyone" }], 3);
    expect(home.areas).toBe('"guests guests guests"\n"asks gifts the-day"\n"where-to-stay everyone everyone"');
    // a tall cell ending on the last row is not stretched: it was asked for as it is
    const tall = grid([{ key: "a", rows: 2 }, { key: "b" }], 2);
    expect(tall.areas).toBe('"a b"\n"a ."');
  });

  test("one cell fills the tray and has all four corners", () => {
    expect(grid([{ key: "only" }], 1).cells[0]!.corners).toEqual(["tl", "tr", "br", "bl"]);
  });

  test("refuses what it cannot lay out", () => {
    expect(() => grid([], 0)).toThrow("at least one column");
    expect(() => grid([{ key: "the day" }], 2)).toThrow("not a grid-area name");
    expect(() => grid([{ key: "a" }, { key: "a" }], 2)).toThrow('two cells called "a"');
  });

  test("slug turns a label into a grid-area name", () => {
    expect(slug("Where to stay")).toBe("where-to-stay");
    expect(slug("The day!")).toBe("the-day");
    expect(slug("42 things")).toBe("c-42-things");
    expect(slug("---")).toBe("c-x");
  });
});
