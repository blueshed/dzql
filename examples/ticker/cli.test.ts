import { describe, expect, test } from "bun:test";
import { parseCommand } from "../../src/cli/commands";
import { aliases } from "./cli";

describe("ticker's cli aliases", () => {
  test("each verb maps to its wire ops", () => {
    expect(parseCommand(["add", "alph"], aliases)).toEqual({ kind: "write", doc: "watchlist", ops: [{ op: "add", path: "/symbols/-", value: "alph" }] });
    expect(parseCommand(["drop", "1"], aliases)).toEqual({ kind: "write", doc: "watchlist", ops: [{ op: "remove", path: "/symbols/1" }] });
    expect(parseCommand(["tick", "alph", "190.5"], aliases)).toEqual({ kind: "write", doc: "ticker", ops: [{ op: "replace", path: "/ALPH/price", value: 190.5 }] });
    expect(parseCommand(["tick"], aliases)).toEqual({ kind: "write", doc: "ticker", ops: [{ op: "replace", path: "//price", value: NaN }] });
    expect(parseCommand(["add"], aliases)).toEqual({ kind: "write", doc: "watchlist", ops: [{ op: "add", path: "/symbols/-", value: "" }] });
    expect(parseCommand(["drop"], aliases)).toEqual({ kind: "write", doc: "watchlist", ops: [{ op: "remove", path: "/symbols/" }] });
  });
});
