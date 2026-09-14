import { describe, expect, test } from "bun:test";
import { parsePointer } from "./json-pointer";

describe("parsePointer", () => {
  test("the root pointer is an empty path", () => {
    expect(parsePointer("")).toEqual([]);
  });

  test("splits a simple pointer into segments", () => {
    expect(parsePointer("/name")).toEqual(["name"]);
    expect(parsePointer("/transcript/-")).toEqual(["transcript", "-"]);
    expect(parsePointer("/people/0/name")).toEqual(["people", "0", "name"]);
  });

  test("unescapes ~1 to / and ~0 to ~", () => {
    expect(parsePointer("/a~1b")).toEqual(["a/b"]);
    expect(parsePointer("/a~0b")).toEqual(["a~b"]);
    expect(parsePointer("/a~01")).toEqual(["a~1"]); // ~0 then literal 1, not ~1 then 0
  });

  test("a pointer that doesn't start with / throws", () => {
    expect(() => parsePointer("name")).toThrow();
  });
});
