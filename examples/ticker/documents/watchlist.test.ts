import { describe, expect, test } from "bun:test";
import { after } from "./watchlist";

const has = (symbol: string) => ["ALPH", "MIKE", "NOVA"].includes(symbol);

describe("watchlist document", () => {
  test("adds a symbol the market has, upper-cased and once, at the end", () => {
    expect(after([], [{ op: "add", path: "/symbols/-", value: " alph " }, { op: "add", path: "/symbols/-", value: "MIKE" }], has)).toEqual(["ALPH", "MIKE"]);
    expect(after(["ALPH"], [{ op: "add", path: "/symbols/-", value: "ALPH" }, { op: "add", path: "/symbols/-", value: "NOPE" }, { op: "add", path: "/symbols/-", value: "" }], has)).toEqual(["ALPH"]);
  });

  test("removes by index; a row it lacks, or anything else, is nothing", () => {
    expect(after(["ALPH", "MIKE", "NOVA"], [{ op: "remove", path: "/symbols/1" }], has)).toEqual(["ALPH", "NOVA"]);
    const rest = [{ op: "remove", path: "/symbols/9" }, { op: "remove", path: "/symbols/x" }, { op: "replace", path: "/symbols/0", value: "X" }, { op: "add", path: "/other/-", value: "X" }, { op: "add", path: "/symbols", value: "X" }] as const;
    expect(after(["ALPH"], [...rest], has)).toEqual(["ALPH"]);
  });
});
