import { describe, expect, test } from "bun:test";
import { after, between, type Ui } from "./desk";

describe("the desk (the ticker's tray)", () => {
  test("the desk keeps one address: a window it has, and over it a symbol, the clock, the ask or the asking-first; anywhere else is nowhere", () => {
    const go = (ui: Ui, value: unknown) => after(ui, [{ op: "replace", path: "/page", value }]);
    expect(go({}, "board")).toEqual({ page: "board" });
    expect(go({}, "board?symbol= brvo ")).toEqual({ page: "board?symbol=BRVO" }); // a symbol is kept as the market writes it
    for (const there of ["board?confirm=BRVO", "board?new", "?clock", "market?symbol=CHRL"]) expect(go({}, there)).toEqual({ page: there });
    // nowhere: a window the desk lacks, a thing that is not a symbol, the ask anywhere but the board, a stray key
    for (const nowhere of ["attic", "market?symbol=not a symbol", "market?new", "board?attic=1"]) expect(go({ page: "?clock" }, nowhere)).toEqual({ page: "?clock" });
    expect(after({ page: "?clock" }, [{ op: "replace", path: "/attic", value: 1 }])).toEqual({ page: "?clock" });
    expect(after({ page: "?clock" }, [{ op: "remove", path: "/page" }])).toEqual({ page: "" });
  });

  test("a reading, find's word and the eye are kept by the collection's name; closing find forgets the eye", () => {
    let ui = after({}, [{ op: "replace", path: "/reading/board", value: "list" }, { op: "replace", path: "/filter/market", value: "ch" }, { op: "replace", path: "/hide/market", value: true }]);
    expect(ui).toEqual({ reading: { board: "list" }, filter: { market: "ch" }, hide: { market: true } });
    expect(after(ui, [{ op: "remove", path: "/hide/board" }])).toEqual(ui); // no such eye
    ui = after(ui, [{ op: "remove", path: "/filter/market" }]);
    expect(ui).toEqual({ reading: { board: "list" } });
  });

  test("the write the document takes is each field that moved, replaced whole; a field gone is null", () => {
    expect(between({ page: "board", filter: { market: "ch" } }, { page: "market", reading: { board: "list" } })).toEqual([
      { op: "replace", path: "/page", value: "market" },
      { op: "replace", path: "/reading", value: { board: "list" } },
      { op: "replace", path: "/filter", value: null },
    ]);
    expect(between({ page: "board" }, { page: "board" })).toEqual([]);
  });
});
