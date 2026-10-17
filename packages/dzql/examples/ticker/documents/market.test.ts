import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDocuments, setActiveDocuments } from "dzql/rendering/documents";
import { delta } from "../delta";
import { has, read, ticks } from "./market";

beforeAll(async () => {
  const documents = createDocuments(delta);
  setActiveDocuments(documents);
  await documents.load("ticker:market");
});

afterAll(() => setActiveDocuments(undefined));

describe("market document", () => {
  test("reads a quote per symbol, and knows which symbols it has", () => {
    expect(read().ALPH).toEqual({ id: "ALPH", markets_id: "market", name: "Alpha Systems", price: expect.any(Number), prev: expect.any(Number) });
    expect(Object.keys(read())).toHaveLength(16);
    expect(has("ALPH")).toBe(true);
    expect(has("NOPE")).toBe(false);
  });

  test("a tick says both fields it moves -- the last price becomes prev -- rounded to a cent; a second tick in one write follows the first", () => {
    const before = read().BRVO!.price;
    expect(ticks([{ op: "replace", path: "/BRVO/price", value: "65.123" }, { op: "replace", path: "/BRVO/price", value: 66 }])).toEqual([
      { op: "replace", path: "/BRVO/prev", value: before },
      { op: "replace", path: "/BRVO/price", value: 65.12 },
      { op: "replace", path: "/BRVO/prev", value: 65.12 },
      { op: "replace", path: "/BRVO/price", value: 66 },
    ]);
  });

  test("what is not a tick is nothing: an unknown symbol, a non-price, a bad number, the same price, a remove", () => {
    const price = read().CHRL!.price;
    expect(
      ticks([
        { op: "replace", path: "/NOPE/price", value: 1 },
        { op: "replace", path: "/CHRL/name", value: "x" },
        { op: "replace", path: "/CHRL/price", value: "lots" },
        { op: "replace", path: "/CHRL/price", value: -1 },
        { op: "replace", path: "/CHRL/price", value: price },
        { op: "remove", path: "/CHRL/price" },
        { op: "replace", path: "", value: 1 },
      ]),
    ).toEqual([]);
  });
});
