import { describe, expect, test } from "bun:test";
import { after } from "./watchlist-api";

const has = (symbol: string) => ["ALPH", "MIKE", "NOVA"].includes(symbol);

describe("watchlist document", () => {
  test("adds a symbol the market has, upper-cased and once, at the end", () => {
    expect(after([], [{ op: "add", path: "/symbols/-", value: " alph " }, { op: "add", path: "/symbols/-", value: "MIKE" }], has)).toEqual(["ALPH", "MIKE"]);
  });

  test("an add that cannot be is refused, and says why", () => {
    expect(() => after(["ALPH"], [{ op: "add", path: "/symbols/-", value: "alph" }], has)).toThrow("ALPH is on your board already.");
    expect(() => after([], [{ op: "add", path: "/symbols/-", value: "nope" }], has)).toThrow("The market does not quote NOPE.");
    expect(() => after([], [{ op: "add", path: "/symbols/-", value: " " }], has)).toThrow("Choose a symbol to watch.");
    expect(() => after([], [{ op: "add", path: "/symbols/-", value: "MIKE" }, { op: "add", path: "/symbols/-", value: "MIKE" }], has)).toThrow("MIKE is on your board already.");
  });

  test("removes by index; a row it lacks, or anything else, is nothing", () => {
    expect(after(["ALPH", "MIKE", "NOVA"], [{ op: "remove", path: "/symbols/1" }], has)).toEqual(["ALPH", "NOVA"]);
    const rest = [{ op: "remove", path: "/symbols/9" }, { op: "remove", path: "/symbols/x" }, { op: "replace", path: "/symbols/0", value: "X" }, { op: "add", path: "/other/-", value: "X" }, { op: "add", path: "/symbols", value: "X" }] as const;
    expect(after(["ALPH"], [...rest], has)).toEqual(["ALPH"]);
  });
});
