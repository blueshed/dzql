/**
 * The noOverlap SQL (`compileOverlaps`): pure, the same text for the same definitions, pinned; and
 * nothing to hold where no table says one. What it answers is delta's `noOverlapCases`
 * (tests/delta/writes.test.ts) and tests/delta-pg/no-overlap.test.ts.
 */
import { expect, test } from "bun:test";
import { bookedApp, pathSchema } from "@blueshed/delta/testing";
import { compileOverlaps, exclusionName } from "../../src/compile/overlaps";

test("the text is the same for the same definitions, and pinned", () => {
  const text = compileOverlaps(bookedApp.schema);
  expect(compileOverlaps(bookedApp.schema)).toBe(text);
  expect(text).toMatchSnapshot();
});

test("a schema with no noOverlap holds none, and drops none it made but its own", () => {
  const text = compileOverlaps(pathSchema);
  expect(text).toContain("NULL;   -- no collection holds its ranges apart");
  expect(text).not.toContain("btree_gist");
  expect(text).not.toContain("ADD CONSTRAINT");
});

test("a constraint's name past 63 bytes ends in a hash of the whole, as Postgres keeps 63", () => {
  const n = { name: `excl_${"t".repeat(40)}_${"starts".repeat(4)}_${"ends".repeat(4)}`, range: ["a", "b"] as [string, string], same: [], bounds: "[)" as const, type: "date" as const };
  expect(exclusionName(n).length).toBe(63);
  expect(exclusionName(n)).not.toBe(exclusionName({ ...n, name: `${n.name}x` }));
  expect(exclusionName({ ...n, name: "excl_short_a_b" })).toBe("excl_short_a_b");
});
