import { describe, expect, test } from "bun:test";
import { history, nextUndo, prefixDoc } from "../../../src/ledger";
import { MARKET, has, patch, read, symbols } from "./market";

describe("market document", () => {
  test("reads a quote per symbol, and knows which symbols it has", () => {
    const market = read();
    expect(market.ALPH).toMatchObject({ name: "Alpha Systems" });
    expect(symbols()).toContain("MIKE");
    expect(has("ALPH")).toBe(true);
    expect(has("NOPE")).toBe(false);
  });

  test("a tick replaces a price, keeps the previous one, rounds to a cent, and is on the ledger with its inverse -- but never under Undo", () => {
    const { price: before, prev: prevBefore } = read().BRVO!;
    const session = crypto.randomUUID();
    const result = patch([{ op: "replace", path: "/BRVO/price", value: "65.123" }], session);
    // both fields a tick moves are said, so what follows the stream holds what the market does
    expect(result.applied).toEqual([{ op: "replace", path: "/BRVO/prev", value: before }, { op: "replace", path: "/BRVO/price", value: 65.12 }]);
    expect(read().BRVO).toMatchObject({ price: 65.12, prev: before });
    expect(history(prefixDoc("ticker", MARKET), 1)[0]!.inverse).toEqual([{ op: "replace", path: "/BRVO/prev", value: prevBefore }, { op: "replace", path: "/BRVO/price", value: before }]);
    expect(nextUndo(session)).toBeUndefined(); // a fact, not the person's doing
    patch(history(prefixDoc("ticker", MARKET), 1)[0]!.inverse, "feed");
    expect(read().BRVO!.price).toBe(before);
  });

  test("refuses what is not a tick: an unknown symbol, a non-price, a bad number, the same price, a remove", () => {
    const price = read().CHRL!.price;
    expect(
      patch(
        [
          { op: "replace", path: "/NOPE/price", value: 1 },
          { op: "replace", path: "/CHRL/name", value: "x" },
          { op: "replace", path: "/CHRL/price", value: "lots" },
          { op: "replace", path: "/CHRL/price", value: -1 },
          { op: "replace", path: "/CHRL/price", value: price },
          { op: "remove", path: "/CHRL/price" },
          { op: "replace", path: "", value: 1 },
        ],
        "feed",
      ).applied,
    ).toEqual([]);
  });
});
