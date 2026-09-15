import { describe, expect, test } from "bun:test";
import { history, nextUndo, prefixDoc } from "../../../src/ledger";
import { DEFAULT_TZ, ZONES, cityOf, offsetOf, patch, read } from "./clock";

describe("clock document", () => {
  test("a fresh session's clock shows the default city; the zones are the runtime's own", () => {
    expect(read(crypto.randomUUID())).toEqual({ tz: DEFAULT_TZ, city: "Zurich", offset: expect.stringMatching(/^\+0[12]:00$/) });
    expect(ZONES).toContain("Asia/Tokyo");
    expect(ZONES.length).toBeGreaterThan(300);
  });

  test("a city is the zone's last segment, spoken; an offset is the zone's, now", () => {
    expect(cityOf("America/New_York")).toBe("New York");
    expect(cityOf("UTC")).toBe("UTC");
    expect(offsetOf("Asia/Tokyo")).toBe("+09:00");
    expect(offsetOf("Asia/Kolkata")).toBe("+05:30");
    expect(offsetOf("UTC")).toBe("+00:00");
    expect(offsetOf("America/New_York", new Date("2026-01-15T12:00:00Z"))).toBe("-05:00");
  });

  test("replace /tz with a zone the runtime knows applies, is on the ledger with its inverse, and is the person's to undo", () => {
    const s = crypto.randomUUID();
    expect(patch(s, [{ op: "replace", path: "/tz", value: " Asia/Tokyo " }]).applied).toEqual([{ op: "replace", path: "/tz", value: "Asia/Tokyo" }]);
    expect(read(s)).toMatchObject({ tz: "Asia/Tokyo", city: "Tokyo", offset: "+09:00" });
    expect(history(prefixDoc("clock", s), 1)[0]!.inverse).toEqual([{ op: "replace", path: "/tz", value: DEFAULT_TZ }]);
    expect(nextUndo(s)?.doc).toBe(prefixDoc("clock", s));
    expect(patch(s, [{ op: "replace", path: "/tz", value: "Mars/Base" }, { op: "replace", path: "/tz", value: "Asia/Tokyo" }, { op: "remove", path: "/tz" }, { op: "replace", path: "/city", value: "Tokyo" }]).applied).toEqual([]);
  });
});
