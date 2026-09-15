import { describe, expect, test } from "bun:test";
import { history, prefixDoc } from "../../../src/ledger";
import { patch, read } from "./watchlist";

describe("watchlist document", () => {
  test("a fresh session watches nothing", () => {
    expect(read(crypto.randomUUID())).toEqual({ symbols: [] });
  });

  test("adds a symbol the market has, upper-cased and once, in order; the inverse removes it by index", () => {
    const s = crypto.randomUUID();
    const r = patch(s, [{ op: "add", path: "/symbols/-", value: " alph " }, { op: "add", path: "/symbols/-", value: "MIKE" }]);
    expect(r.applied).toEqual([{ op: "add", path: "/symbols/-", value: "ALPH" }, { op: "add", path: "/symbols/-", value: "MIKE" }]);
    expect(read(s)).toEqual({ symbols: ["ALPH", "MIKE"] });
    expect(history(prefixDoc("watchlist", s), 1)[0]!.inverse).toEqual([{ op: "remove", path: "/symbols/1" }, { op: "remove", path: "/symbols/0" }]);
    expect(patch(s, [{ op: "add", path: "/symbols/-", value: "ALPH" }, { op: "add", path: "/symbols/-", value: "NOPE" }, { op: "add", path: "/symbols/-", value: "" }]).applied).toEqual([]);
  });

  test("removes by index; the inverse adds the symbol back at the end", () => {
    const s = crypto.randomUUID();
    patch(s, [{ op: "add", path: "/symbols/-", value: "ALPH" }, { op: "add", path: "/symbols/-", value: "MIKE" }, { op: "add", path: "/symbols/-", value: "NOVA" }]);
    expect(patch(s, [{ op: "remove", path: "/symbols/1" }]).applied).toEqual([{ op: "remove", path: "/symbols/1" }]);
    expect(read(s).symbols).toEqual(["ALPH", "NOVA"]);
    const inverse = history(prefixDoc("watchlist", s), 1)[0]!.inverse;
    expect(inverse).toEqual([{ op: "add", path: "/symbols/-", value: "MIKE" }]);
    patch(s, inverse);
    expect(read(s).symbols).toEqual(["ALPH", "NOVA", "MIKE"]);
    expect(patch(s, [{ op: "remove", path: "/symbols/9" }, { op: "remove", path: "/symbols/x" }, { op: "replace", path: "/symbols/0", value: "X" }, { op: "add", path: "/other/-", value: "X" }]).applied).toEqual([]);
  });
});
